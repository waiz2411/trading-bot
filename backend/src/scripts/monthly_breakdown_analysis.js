import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cacheDir = path.resolve(__dirname, '../data/binance_cache');

console.log('Calculating exact monthly performance breakdown for Fast Scalp strategies...');

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

function runMonthlyTest(tp, sl, beTrigger, trTrigger, trDist, maxHoldBars, name) {
  let balance = 100.0;
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

      if (c.low <= pos.currentStop) {
        exitPrice = pos.currentStop * (1 - slipRate);
      } else if (c.high >= pos.entryPrice * (1 + tp / 100)) {
        exitPrice = pos.entryPrice * (1 + tp / 100) * (1 - slipRate);
      } else if (pos.barsHeld >= maxHoldBars) {
        exitPrice = c.close * (1 - slipRate);
      } else {
        const peakGain = ((c.high - pos.entryPrice) / pos.entryPrice) * 100;
        if (c.high > pos.peakPrice) pos.peakPrice = c.high;

        if (trTrigger && peakGain >= trTrigger) {
          const trStop = pos.peakPrice * (1 - trDist / 100);
          if (trStop > pos.currentStop) pos.currentStop = trStop;
        } else if (beTrigger && peakGain >= beTrigger) {
          const beStop = pos.entryPrice * 1.0025;
          if (beStop > pos.currentStop) pos.currentStop = beStop;
        }
      }

      if (exitPrice !== null) {
        const notional = pos.notional;
        const grossReturnPct = ((exitPrice - pos.entryPrice) / pos.entryPrice) * 100;
        const grossGain = notional * (grossReturnPct / 100);
        const fees = notional * feeRate * 2;
        const netPnL = grossGain - fees;

        balance = Number((balance + netPnL).toFixed(2));
        dailyPnL[dateStr] = (dailyPnL[dateStr] || 0) + netPnL;
        closedTrades.push({ netPnL, date: dateStr });
        activeTrades.splice(pIdx, 1);
      }
    }

    if (activeTrades.length < 1) {
      const nearest4hTime = openTime - (openTime % (4 * 3600 * 1000));
      const btc4 = sym4h['BTCUSDT'];
      const btcIdx4 = btc4.timeMap.get(nearest4hTime);
      if (btcIdx4 !== undefined && btcIdx4 >= 50 && btc4.candles[btcIdx4].close < btc4.tech.ema50[btcIdx4]) {
        continue;
      }

      let bestCand = null;
      let highestScore = -Infinity;

      for (const sym of symbols) {
        const c15Obj = sym15m[sym];
        const c4Obj = sym4h[sym];
        if (!c15Obj || !c4Obj) continue;

        const idx15 = c15Obj.timeMap.get(openTime);
        const idx4 = c4Obj.timeMap.get(nearest4hTime);
        if (idx15 === undefined || idx15 < 20 || idx4 === undefined || idx4 < 50) continue;

        const is4hBull = c4Obj.tech.ema21[idx4] > c4Obj.tech.ema50[idx4] && c4Obj.candles[idx4].close > c4Obj.tech.ema50[idx4];
        if (!is4hBull) continue;

        const c15 = c15Obj.candles[idx15];
        const rsi15 = c15Obj.tech.rsi14[idx15];
        if (rsi15 > 30) continue;

        const candleRange = c15.high - c15.low;
        if (candleRange <= 0) continue;
        const lowerWick = Math.min(c15.open, c15.close) - c15.low;
        if ((lowerWick / candleRange) < 0.35) continue;

        const score = (50 - rsi15) * 2;
        if (score > highestScore) {
          highestScore = score;
          bestCand = { symbol: sym, price: c15.close * (1 + slipRate) };
        }
      }

      if (bestCand) {
        activeTrades.push({
          symbol: bestCand.symbol,
          entryPrice: bestCand.price,
          notional: balance,
          peakPrice: bestCand.price,
          currentStop: bestCand.price * (1 - sl / 100),
          barsHeld: 0
        });
      }
    }
  }

  // Monthly breakdown
  const monthly = {};
  for (const dt of Object.keys(dailyPnL)) {
    const mo = dt.slice(0, 7);
    monthly[mo] = (monthly[mo] || 0) + dailyPnL[dt];
  }

  return { name, totalTrades: closedTrades.length, finalBal: balance, monthly };
}

const res3pct = runMonthlyTest(3.0, 1.8, 1.8, 2.2, 0.8, 16, '3.0% Fast Scalp');
const res5pct = runMonthlyTest(5.0, 2.0, 2.0, 3.0, 1.0, 24, '5.0% Swing Scalp');
const res6pct = runMonthlyTest(6.0, 2.0, 2.0, 3.5, 1.2, 32, '6.0% Macro Alpha Scalp');

const months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];

const table = months.map(m => ({
  'Month': m,
  '3.0% Fast Scalp ($)': `$${(res3pct.monthly[m] || 0).toFixed(2)}`,
  '5.0% Swing Scalp ($)': `$${(res5pct.monthly[m] || 0).toFixed(2)}`,
  '6.0% Alpha Scalp ($)': `$${(res6pct.monthly[m] || 0).toFixed(2)}`
}));

console.log('\n--- MONTHLY PROFIT BREAKDOWN (On $100 Initial Capital) ---');
console.table(table);

console.log('\nTotal Ending Balances:');
console.log(`3.0% Scalp: $${res3pct.finalBal.toFixed(2)} (+${(res3pct.finalBal - 100).toFixed(1)}%) | Trades: ${res3pct.totalTrades}`);
console.log(`5.0% Scalp: $${res5pct.finalBal.toFixed(2)} (+${(res5pct.finalBal - 100).toFixed(1)}%) | Trades: ${res5pct.totalTrades}`);
console.log(`6.0% Scalp: $${res6pct.finalBal.toFixed(2)} (+${(res6pct.finalBal - 100).toFixed(1)}%) | Trades: ${res6pct.totalTrades}`);
