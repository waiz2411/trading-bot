import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cacheDir = path.resolve(__dirname, '../data/binance_cache');

console.log('Running Grid Optimizer for TradingView RSI Re-Entry (TP, SL, Max Hold Time)...');

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

function calculateRSI(candles, length = 14) {
  const len = candles.length;
  const closes = candles.map(c => c.close);
  const rsi = new Float64Array(len);

  let avgG = 0, avgL = 0;
  for (let i = 1; i <= length && i < len; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) avgG += d; else avgL += Math.abs(d);
  }
  avgG /= length; avgL /= length;
  rsi[length] = avgL === 0 ? 100 : 100 - (100 / (1 + avgG / avgL));

  for (let i = length + 1; i < len; i++) {
    const d = closes[i] - closes[i - 1];
    avgG = (avgG * (length - 1) + (d > 0 ? d : 0)) / length;
    avgL = (avgL * (length - 1) + (d < 0 ? Math.abs(d) : 0)) / length;
    rsi[i] = avgL === 0 ? 100 : 100 - (100 / (1 + avgG / avgL));
  }
  return rsi;
}

const symRSI = {};
for (const sym of symbols) {
  const c = datasets[sym];
  symRSI[sym] = {
    candles: c,
    rsi: calculateRSI(c, 14),
    timeMap: new Map()
  };
  c.forEach((bar, idx) => symRSI[sym].timeMap.set(bar.openTime, idx));
}

const timeSource = datasets['ETHUSDT'] || datasets[symbols[0]];

function simulateFast(tp, sl, maxHoldBars, maxSlots) {
  let balance = 100.0;
  let peakBalance = balance;
  let maxDD = 0;
  const activeTrades = [];
  const closedTrades = [];
  const dailyPnL = {};

  const feeRate = 0.0010; // 0.10% each way = 0.20% round trip
  const slipRate = 0.0003; // 0.03% slippage

  for (let tIdx = 50; tIdx < timeSource.length; tIdx++) {
    const bar = timeSource[tIdx];
    const openTime = bar.openTime;
    const dateStr = bar.time.split('T')[0];

    // Exits
    for (let pIdx = activeTrades.length - 1; pIdx >= 0; pIdx--) {
      const pos = activeTrades[pIdx];
      const sObj = symRSI[pos.symbol];
      if (!sObj) continue;
      const cIdx = sObj.timeMap.get(openTime);
      if (cIdx === undefined) continue;

      const c = sObj.candles[cIdx];
      pos.barsHeld++;

      let exitPrice = null;
      let exitReason = null;

      if (c.low <= pos.entryPrice * (1 - sl / 100)) {
        exitPrice = pos.entryPrice * (1 - sl / 100) * (1 - slipRate);
        exitReason = 'STOP_LOSS';
      } else if (c.high >= pos.entryPrice * (1 + tp / 100)) {
        exitPrice = pos.entryPrice * (1 + tp / 100) * (1 - slipRate);
        exitReason = 'TAKE_PROFIT';
      } else if (pos.barsHeld >= maxHoldBars) {
        exitPrice = c.close * (1 - slipRate);
        exitReason = 'TIME_LIMIT';
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

    // Entries: RSI re-enters purple block (> 30 from <= 30)
    if (activeTrades.length < maxSlots) {
      for (const sym of symbols) {
        if (activeTrades.length >= maxSlots) break;
        if (activeTrades.some(t => t.symbol === sym)) continue;

        const sObj = symRSI[sym];
        if (!sObj) continue;
        const idx = sObj.timeMap.get(openTime);
        if (idx === undefined || idx < 20) continue;

        const prevRsi = sObj.rsi[idx - 1];
        const currRsi = sObj.rsi[idx];

        if (prevRsi <= 30 && currRsi > 30) {
          const c = sObj.candles[idx];
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
  const wins = closedTrades.filter(t => t.netPnL > 0.001);
  const winRate = totalTrades > 0 ? (wins.length / totalTrades) * 100 : 0;
  const roi = ((balance - 100) / 100) * 100;
  const tradedDays = Object.keys(dailyPnL).length;
  const avgDailyProfitDollar = tradedDays > 0 ? (balance - 100) / tradedDays : 0;
  const avgDailyReturnPct = tradedDays > 0 ? roi / tradedDays : 0;

  return {
    tp,
    sl,
    maxHoldMins: maxHoldBars * 15,
    maxSlots,
    totalTrades,
    tradedDays,
    winRate: Number(winRate.toFixed(1)),
    finalBalance: Number(balance.toFixed(2)),
    roi: Number(roi.toFixed(1)),
    avgDailyReturnPct: Number(avgDailyReturnPct.toFixed(3)),
    avgDailyProfitDollar: Number(avgDailyProfitDollar.toFixed(2)),
    maxDD: Number(maxDD.toFixed(1))
  };
}

const grid = [];
const tpOptions = [0.6, 0.8, 1.0, 1.2, 1.5, 2.0, 2.5, 3.0];
const slOptions = [0.6, 0.8, 1.0, 1.2, 1.5, 1.8, 2.0];
const holdBarsOptions = [2, 3, 4, 6]; // 30 mins, 45 mins, 60 mins, 90 mins
const slotOptions = [1, 2, 3];

for (const tp of tpOptions) {
  for (const sl of slOptions) {
    for (const hold of holdBarsOptions) {
      grid.push({ tp, sl, hold, slots: 1 });
      grid.push({ tp, sl, hold, slots: 3 });
    }
  }
}

console.log(`Evaluating ${grid.length} parameter permutations across full year data...`);

const allResults = [];
for (let i = 0; i < grid.length; i++) {
  const g = grid[i];
  const res = simulateFast(g.tp, g.sl, g.hold, g.slots);
  allResults.push(res);
}

// Sort by ROI descending
allResults.sort((a, b) => b.roi - a.roi);

console.log('\n--- TOP 10 PROFITABLE CONFIGURATIONS ---');
console.table(allResults.slice(0, 10));

console.log('\n--- BOTTOM 5 WORST CONFIGURATIONS ---');
console.table(allResults.slice(-5));
