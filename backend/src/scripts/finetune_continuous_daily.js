import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cacheDir = path.resolve(__dirname, '../data/binance_cache');

console.log('Fine-tuning continuous 15m scanning for daily profit...');

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

function runDetailedTest(cfg) {
  let balance = 100.0;
  let peakBalance = balance;
  let maxDD = 0;
  const activeTrades = [];
  const closedTrades = [];
  const dailyPnL = {};

  const feeRate = 0.0010;
  const slipRate = 0.0005;

  for (let tIdx = 50; tIdx < timeSource.length; tIdx++) {
    const bar = timeSource[tIdx];
    const openTime = bar.openTime;
    const dateStr = bar.time.split('T')[0];

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
      let exitReason = null;

      if (c.low <= pos.currentStop) {
        exitPrice = pos.currentStop * (1 - slipRate);
        exitReason = pos.currentStop > pos.entryPrice ? 'TRAILING' : 'STOP_LOSS';
      } else if (c.high >= pos.entryPrice * (1 + cfg.tp / 100)) {
        exitPrice = pos.entryPrice * (1 + cfg.tp / 100) * (1 - slipRate);
        exitReason = 'TAKE_PROFIT';
      } else if (pos.barsHeld >= cfg.maxHoldBars) {
        exitPrice = c.close * (1 - slipRate);
        exitReason = 'TIME_LIMIT';
      } else {
        const peakGainPct = ((c.high - pos.entryPrice) / pos.entryPrice) * 100;
        if (c.high > pos.peakPrice) pos.peakPrice = c.high;

        if (cfg.trailingTrigger && peakGainPct >= cfg.trailingTrigger) {
          const trStop = pos.peakPrice * (1 - cfg.trailingDist / 100);
          if (trStop > pos.currentStop) pos.currentStop = trStop;
        } else if (cfg.beTrigger && peakGainPct >= cfg.beTrigger) {
          const bePrice = pos.entryPrice * (1 + cfg.beLock / 100);
          if (bePrice > pos.currentStop) pos.currentStop = bePrice;
        }
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

        closedTrades.push({
          symbol: pos.symbol,
          entryPrice: pos.entryPrice,
          exitPrice,
          netPnL,
          returnPct: (netPnL / notional) * 100,
          exitReason,
          date: dateStr
        });

        activeTrades.splice(pIdx, 1);
      }
    }

    // Entries
    if (activeTrades.length < cfg.maxSlots) {
      // BTC 4H health
      const btc4 = sym4h['BTCUSDT'];
      const nearest4hTime = openTime - (openTime % (4 * 3600 * 1000));
      const btcIdx4 = btc4.timeMap.get(nearest4hTime);
      if (cfg.useBtc && btcIdx4 !== undefined && btcIdx4 >= 50 && btc4.candles[btcIdx4].close < btc4.tech.ema50[btcIdx4]) {
        continue;
      }

      let bestCand = null;
      let highestScore = -Infinity;

      for (const sym of symbols) {
        if (activeTrades.some(t => t.symbol === sym)) continue;
        const c15Obj = sym15m[sym];
        const c4Obj = sym4h[sym];
        if (!c15Obj || !c4Obj) continue;

        const idx15 = c15Obj.timeMap.get(openTime);
        const idx4 = c4Obj.timeMap.get(nearest4hTime);
        if (idx15 === undefined || idx15 < 50 || idx4 === undefined || idx4 < 50) continue;

        // 4H Bull trend check
        const is4hBull = c4Obj.tech.ema21[idx4] > c4Obj.tech.ema50[idx4] && c4Obj.candles[idx4].close > c4Obj.tech.ema50[idx4];
        if (!is4hBull) continue;

        const c15 = c15Obj.candles[idx15];
        const rsi15 = c15Obj.tech.rsi14[idx15];
        if (rsi15 > cfg.maxRsi) continue;

        const candleRange = c15.high - c15.low;
        if (candleRange <= 0) continue;
        const lowerWick = Math.min(c15.open, c15.close) - c15.low;
        const isRejection = (lowerWick / candleRange) >= cfg.hammerRatio;
        if (!isRejection) continue;

        const score = (50 - rsi15) * 2 + (c4Obj.tech.ema21[idx4] / c4Obj.tech.ema50[idx4]) * 10;
        if (score > highestScore) {
          highestScore = score;
          bestCand = { symbol: sym, price: c15.close * (1 + slipRate) };
        }
      }

      if (bestCand) {
        const slotSize = balance / cfg.maxSlots;
        activeTrades.push({
          symbol: bestCand.symbol,
          entryPrice: bestCand.price,
          notional: slotSize,
          peakPrice: bestCand.price,
          currentStop: bestCand.price * (1 - cfg.sl / 100),
          barsHeld: 0
        });
      }
    }
  }

  const totalTrades = closedTrades.length;
  const wins = closedTrades.filter(t => t.netPnL > 0.001);
  const losses = closedTrades.filter(t => t.netPnL < -0.001);
  const winRate = totalTrades > 0 ? (wins.length / totalTrades) * 100 : 0;
  const totalProfit = wins.reduce((acc, t) => acc + t.netPnL, 0);
  const totalLoss = Math.abs(losses.reduce((acc, t) => acc + t.netPnL, 0));
  const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : totalProfit;
  const roi = ((balance - 100) / 100) * 100;

  const tradedDays = Object.keys(dailyPnL).length;
  const profitableDays = Object.values(dailyPnL).filter(v => v > 0.01).length;
  const losingDays = Object.values(dailyPnL).filter(v => v < -0.01).length;

  return {
    name: cfg.name,
    roi: Number(roi.toFixed(2)),
    finalBalance: Number(balance.toFixed(2)),
    totalTrades,
    winRate: Number(winRate.toFixed(1)),
    profitFactor: Number(profitFactor.toFixed(2)),
    maxDD: Number(maxDD.toFixed(1)),
    tradedDays,
    totalDays: 290,
    profitableDays,
    losingDays,
    dailyWinRatePct: Number(((profitableDays / (tradedDays || 1)) * 100).toFixed(1))
  };
}

const tests = [
  { name: '1. Fast Scalp (TP 3.0% / SL 1.8% / 1 Slot)', tp: 3.0, sl: 1.8, maxSlots: 1, maxRsi: 30, hammerRatio: 0.35, beTrigger: 1.8, beLock: 0.25, trailingTrigger: 2.2, trailingDist: 0.8, maxHoldBars: 24, useBtc: true },
  { name: '2. Swing Scalp (TP 4.5% / SL 2.0% / 1 Slot)', tp: 4.5, sl: 2.0, maxSlots: 1, maxRsi: 30, hammerRatio: 0.35, beTrigger: 2.0, beLock: 0.25, trailingTrigger: 3.0, trailingDist: 1.0, maxHoldBars: 32, useBtc: true },
  { name: '3. Alpha Scalp (TP 6.0% / SL 2.0% / 1 Slot)', tp: 6.0, sl: 2.0, maxSlots: 1, maxRsi: 30, hammerRatio: 0.38, beTrigger: 2.0, beLock: 0.25, trailingTrigger: 3.5, trailingDist: 1.2, maxHoldBars: 32, useBtc: true },
  { name: '4. Fast Scalp Multi (TP 3.5% / SL 2.0% / 2 Slots)', tp: 3.5, sl: 2.0, maxSlots: 2, maxRsi: 30, hammerRatio: 0.35, beTrigger: 2.0, beLock: 0.25, trailingTrigger: 2.5, trailingDist: 0.9, maxHoldBars: 32, useBtc: true },
  { name: '5. Alpha Scalp Multi (TP 5.0% / SL 2.0% / 2 Slots)', tp: 5.0, sl: 2.0, maxSlots: 2, maxRsi: 30, hammerRatio: 0.38, beTrigger: 2.0, beLock: 0.25, trailingTrigger: 3.0, trailingDist: 1.0, maxHoldBars: 32, useBtc: true }
];

const results = tests.map(runDetailedTest);
console.table(results);
