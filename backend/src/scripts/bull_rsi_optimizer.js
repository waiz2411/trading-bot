import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cacheDir = path.resolve(__dirname, '../data/binance_cache');

console.log('Testing RSI Re-entry WITH 4H Macro Bull Filter across various TP, SL, and Hold Times...');

const files = fs.readdirSync(cacheDir).filter(f => f.endsWith('.json'));
const datasets = {};

for (const file of files) {
  const sym = file.split('_')[0];
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(cacheDir, file), 'utf8'));
    if (Array.isArray(raw) && raw.length > 5000) {
      const parsed = raw.map(c => ({
        openTime: c.openTime || c[0],
        time: c.time || new Date(c.openTime || c[0]).toISOString(),
        open: Number(c.open || c[1]),
        high: Number(c.high || c[2]),
        low: Number(c.low || c[3]),
        close: Number(c.close || c[4]),
        volume: Number(c.volume || c[5])
      })).filter(c => c.openTime >= 1767225600000 && !isNaN(c.close));

      parsed.sort((a, b) => a.openTime - b.openTime);
      if (parsed.length > 1000) datasets[sym] = parsed;
    }
  } catch (_) {}
}

const symbols = Object.keys(datasets).filter(s => s !== 'BTCUSDT' && s !== 'PAXGUSDT');

function calculateTech(candles) {
  const len = candles.length;
  const closes = candles.map(c => c.close);
  const ema21 = new Float64Array(len);
  const ema50 = new Float64Array(len);
  const rsi14 = new Float64Array(len);

  const k21 = 2 / 22, k50 = 2 / 51;
  let e21 = closes[0], e50 = closes[0];
  for (let i = 0; i < len; i++) {
    const cl = closes[i];
    e21 = i === 0 ? cl : cl * k21 + e21 * (1 - k21);
    e50 = i === 0 ? cl : cl * k50 + e50 * (1 - k50);
    ema21[i] = e21; ema50[i] = e50;
  }

  let avgG = 0, avgL = 0;
  for (let i = 1; i <= 14 && i < len; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) avgG += d; else avgL += Math.abs(d);
  }
  avgG /= 14; avgL /= 14;
  rsi14[14] = avgL === 0 ? 100 : 100 - (100 / (1 + avgG / avgL));
  for (let i = 15; i < len; i++) {
    const d = closes[i] - closes[i - 1];
    avgG = (avgG * 13 + (d > 0 ? d : 0)) / 14;
    avgL = (avgL * 13 + (d < 0 ? Math.abs(d) : 0)) / 14;
    rsi14[i] = avgL === 0 ? 100 : 100 - (100 / (1 + avgG / avgL));
  }
  return { ema21, ema50, rsi14 };
}

function resampleTo4H(c15m) {
  const c4h = [];
  for (let i = 0; i < c15m.length; i += 16) {
    const slice = c15m.slice(i, i + 16);
    if (slice.length === 16) {
      c4h.push({
        openTime: slice[0].openTime,
        time: slice[0].time,
        open: slice[0].open,
        high: Math.max(...slice.map(c => c.high)),
        low: Math.min(...slice.map(c => c.low)),
        close: slice[15].close,
        volume: slice.reduce((acc, c) => acc + c.volume, 0)
      });
    }
  }
  return c4h;
}

const sym15m = {};
const sym4h = {};

for (const sym of [...symbols, 'BTCUSDT']) {
  if (!datasets[sym]) continue;
  const c15 = datasets[sym];
  sym15m[sym] = { candles: c15, tech: calculateTech(c15), timeMap: new Map() };
  c15.forEach((c, i) => sym15m[sym].timeMap.set(c.openTime, i));

  const c4 = resampleTo4H(c15);
  sym4h[sym] = { candles: c4, tech: calculateTech(c4), timeMap: new Map() };
  c4.forEach((c, i) => sym4h[sym].timeMap.set(c.openTime, i));
}

const timeSource = sym15m['BTCUSDT'].candles;
const sortedTimes = timeSource.map(c => c.openTime);

// Precompute signals where 4H is Bull (EMA21 > EMA50 & Close > EMA50) AND 15m RSI crosses > 30 from <= 30
const bullSignalsMap = new Map();
for (let tIdx = 50; tIdx < sortedTimes.length; tIdx++) {
  const openTime = sortedTimes[tIdx];
  const nearest4hTime = openTime - (openTime % (4 * 3600 * 1000));
  const sigs = [];

  for (const sym of symbols) {
    const c15Obj = sym15m[sym];
    const c4Obj = sym4h[sym];
    if (!c15Obj || !c4Obj) continue;

    const idx15 = c15Obj.timeMap.get(openTime);
    const idx4 = c4Obj.timeMap.get(nearest4hTime);
    if (idx15 === undefined || idx15 < 20 || idx4 === undefined || idx4 < 50) continue;

    const is4hBull = c4Obj.tech.ema21[idx4] > c4Obj.tech.ema50[idx4] && c4Obj.candles[idx4].close > c4Obj.tech.ema50[idx4];
    if (!is4hBull) continue;

    if (c15Obj.tech.rsi14[idx15 - 1] <= 30 && c15Obj.tech.rsi14[idx15] > 30) {
      sigs.push(sym);
    }
  }
  if (sigs.length > 0) bullSignalsMap.set(openTime, sigs);
}

function simulateBullRSI(tp, sl, maxHoldBars, maxSlots) {
  let balance = 100.0;
  let peakBalance = balance;
  let maxDD = 0;
  const activeTrades = [];
  const closedTrades = [];
  const dailyPnL = {};

  const feeRate = 0.0010;
  const slipRate = 0.0003;

  for (let tIdx = 50; tIdx < sortedTimes.length; tIdx++) {
    const openTime = sortedTimes[tIdx];
    const dateStr = timeSource[tIdx].time.split('T')[0];

    // Exits
    for (let pIdx = activeTrades.length - 1; pIdx >= 0; pIdx--) {
      const pos = activeTrades[pIdx];
      const sObj = sym15m[pos.symbol];
      if (!sObj) continue;
      const cIdx = sObj.timeMap.get(openTime);
      if (cIdx === undefined) continue;

      const c = sObj.candles[cIdx];
      pos.barsHeld++;

      let exitPrice = null;

      if (c.low <= pos.entryPrice * (1 - sl / 100)) {
        exitPrice = pos.entryPrice * (1 - sl / 100) * (1 - slipRate);
      } else if (c.high >= pos.entryPrice * (1 + tp / 100)) {
        exitPrice = pos.entryPrice * (1 + tp / 100) * (1 - slipRate);
      } else if (pos.barsHeld >= maxHoldBars) {
        exitPrice = c.close * (1 - slipRate);
      }

      if (exitPrice !== null) {
        const notional = pos.notional;
        const grossReturnPct = ((exitPrice - pos.entryPrice) / pos.entryPrice) * 100;
        const grossGain = notional * (grossReturnPct / 100);
        const fees = notional * feeRate * 2;
        const netPnL = grossGain - fees;

        balance = Number((balance + netPnL).toFixed(2));
        if (balance > peakBalance) peakBalance = balance;
        const dd = peakBalance > 0 ? ((peakBalance - balance) / peakBalance) * 100 : 0;
        if (dd > maxDD) maxDD = dd;

        dailyPnL[dateStr] = (dailyPnL[dateStr] || 0) + netPnL;
        closedTrades.push(netPnL);
        activeTrades.splice(pIdx, 1);
      }
    }

    if (activeTrades.length < maxSlots) {
      const sigs = bullSignalsMap.get(openTime);
      if (sigs) {
        for (const sym of sigs) {
          if (activeTrades.length >= maxSlots) break;
          if (activeTrades.some(t => t.symbol === sym)) continue;

          const sObj = sym15m[sym];
          const cIdx = sObj.timeMap.get(openTime);
          const c = sObj.candles[cIdx];
          const slotSize = Math.max(5.0, balance / maxSlots);

          activeTrades.push({
            symbol: sym,
            entryPrice: c.close * (1 + slipRate),
            notional: slotSize,
            barsHeld: 0
          });
        }
      }
    }
  }

  const totalTrades = closedTrades.length;
  const wins = closedTrades.filter(pnl => pnl > 0.001);
  const winRate = totalTrades > 0 ? (wins.length / totalTrades) * 100 : 0;
  const roi = ((balance - 100) / 100) * 100;
  const tradedDays = Object.keys(dailyPnL).length;
  const avgDailyReturnPct = tradedDays > 0 ? roi / tradedDays : 0;

  return {
    tp,
    sl,
    holdMins: maxHoldBars * 15,
    maxSlots,
    totalTrades,
    tradedDays,
    winRate: Number(winRate.toFixed(1)),
    finalBal: Number(balance.toFixed(2)),
    roi: Number(roi.toFixed(1)),
    dailyReturnPct: Number(avgDailyReturnPct.toFixed(3)),
    maxDD: Number(maxDD.toFixed(1))
  };
}

const tpList = [0.8, 1.0, 1.2, 1.5, 2.0, 2.5, 3.0, 4.0];
const slList = [0.8, 1.0, 1.2, 1.5, 1.8, 2.0];
const holdList = [2, 4, 8, 16]; // 30m, 60m, 120m, 240m

const bullResults = [];
for (const tp of tpList) {
  for (const sl of slList) {
    for (const hold of holdList) {
      bullResults.push(simulateBullRSI(tp, sl, hold, 1));
    }
  }
}

bullResults.sort((a, b) => b.roi - a.roi);

console.log('\n--- TOP 10 PROFITABLE WITH 4H BULL FILTER ---');
console.table(bullResults.slice(0, 10));

console.log('\n--- TOP 5 WITH EXACT 30 MINS MAX HOLD ---');
const hold30 = bullResults.filter(r => r.holdMins === 30);
console.table(hold30.slice(0, 5));
