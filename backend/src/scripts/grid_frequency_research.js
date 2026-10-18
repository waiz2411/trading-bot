import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cacheDir = path.resolve(__dirname, '../data/binance_cache');

console.log('Searching for the optimal balance between high daily activity and positive ROI...');

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

// What if we test different thresholds:
// 1. RSI Dip threshold: 30 vs 35 vs 40 vs 45
// 2. Allow trading on every 15m candle (not just 4H candle boundary)
// 3. Multi-slot: 1 slot vs 2 slots vs 3 slots vs 5 slots
// 4. TP: 2.0% vs 3.0% vs 4.0% vs 5.0%

function runGridTest(rsiThreshold, maxSlots, tp, sl, checkBoundaryOnly) {
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
      } else if (c.high >= pos.entryPrice * (1 + tp / 100)) {
        exitPrice = pos.entryPrice * (1 + tp / 100) * (1 - slipRate);
        exitReason = 'TAKE_PROFIT';
      } else if (pos.barsHeld >= 32) {
        exitPrice = c.close * (1 - slipRate);
        exitReason = 'TIME_LIMIT';
      } else {
        const peakGainPct = ((c.high - pos.entryPrice) / pos.entryPrice) * 100;
        if (c.high > pos.peakPrice) pos.peakPrice = c.high;
        if (peakGainPct >= 2.0) {
          const bePrice = pos.entryPrice * 1.0025;
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

        closedTrades.push({ netPnL });
        activeTrades.splice(pIdx, 1);
      }
    }

    // Entries
    if (activeTrades.length < maxSlots) {
      let bestCand = null;
      let highestScore = -Infinity;

      for (const sym of symbols) {
        if (activeTrades.some(t => t.symbol === sym)) continue;
        const c15Obj = sym15m[sym];
        const c4Obj = sym4h[sym];
        if (!c15Obj || !c4Obj) continue;

        const idx15 = c15Obj.timeMap.get(openTime);
        const idx4 = c4Obj.timeMap.get(openTime);

        if (checkBoundaryOnly && idx4 === undefined) continue;
        // If not checking boundary only, find the current active 4H candle
        let effectiveIdx4 = idx4;
        if (effectiveIdx4 === undefined) {
          // get the most recent 4H candle
          const barTime = openTime;
          const nearest4hTime = barTime - (barTime % (4 * 3600 * 1000));
          effectiveIdx4 = c4Obj.timeMap.get(nearest4hTime);
        }

        if (idx15 === undefined || idx15 < 50 || effectiveIdx4 === undefined || effectiveIdx4 < 50) continue;

        // 4H Bull trend
        const is4hBull = c4Obj.tech.ema21[effectiveIdx4] > c4Obj.tech.ema50[effectiveIdx4] && c4Obj.candles[effectiveIdx4].close > c4Obj.tech.ema50[effectiveIdx4];
        if (!is4hBull) continue;

        const c15 = c15Obj.candles[idx15];
        const rsi15 = c15Obj.tech.rsi14[idx15];
        if (rsi15 > rsiThreshold) continue;

        const candleRange = c15.high - c15.low;
        if (candleRange <= 0) continue;
        const lowerWick = Math.min(c15.open, c15.close) - c15.low;
        const isRejection = (lowerWick / candleRange) >= 0.35;
        if (!isRejection) continue;

        const score = (50 - rsi15) * 2;
        if (score > highestScore) {
          highestScore = score;
          bestCand = { symbol: sym, price: c15.close * (1 + slipRate) };
        }
      }

      if (bestCand) {
        const slotSize = balance / maxSlots;
        activeTrades.push({
          symbol: bestCand.symbol,
          entryPrice: bestCand.price,
          notional: slotSize,
          peakPrice: bestCand.price,
          currentStop: bestCand.price * (1 - sl / 100),
          barsHeld: 0
        });
      }
    }
  }

  const totalTrades = closedTrades.length;
  const wins = closedTrades.filter(t => t.netPnL > 0.001);
  const winRate = totalTrades > 0 ? (wins.length / totalTrades) * 100 : 0;
  const roi = ((balance - 100) / 100) * 100;
  const tradedDays = Object.keys(dailyPnL).length;
  const profitableDays = Object.values(dailyPnL).filter(v => v > 0.01).length;

  return {
    rsiThreshold,
    maxSlots,
    tp,
    sl,
    continuous15m: !checkBoundaryOnly,
    roi: Number(roi.toFixed(2)),
    finalBalance: Number(balance.toFixed(2)),
    totalTrades,
    winRate: Number(winRate.toFixed(1)),
    tradedDays,
    profitableDays,
    maxDD: Number(maxDD.toFixed(1))
  };
}

const tests = [
  // Panic Dip with 4H boundary check
  runGridTest(30, 1, 6.0, 2.0, true),
  // Panic Dip with 3 slots
  runGridTest(30, 3, 5.0, 2.0, true),
  // Continuous 15m scanning (scans every 15m candle, not just 4H boundaries)
  runGridTest(30, 1, 6.0, 2.0, false),
  runGridTest(32, 2, 5.0, 2.0, false),
  runGridTest(35, 3, 4.0, 2.0, false),
  runGridTest(35, 5, 3.5, 2.0, false),
  runGridTest(38, 3, 3.0, 2.0, false),
  runGridTest(40, 3, 3.0, 2.0, false)
];

console.table(tests);
