import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cacheDir = path.resolve(__dirname, '../data/binance_cache');

const raw = JSON.parse(fs.readFileSync(path.join(cacheDir, 'ZKUSDT_15m_60d.json'), 'utf8'));
const candles = raw.map(c => ({
  openTime: c.openTime || c[0],
  time: c.time || new Date(c.openTime || c[0]).toISOString(),
  open: Number(c.open || c[1]),
  high: Number(c.high || c[2]),
  low: Number(c.low || c[3]),
  close: Number(c.close || c[4]),
  volume: Number(c.volume || c[5])
})).filter(c => c.openTime >= 1767225600000 && !isNaN(c.close));

candles.sort((a, b) => a.openTime - b.openTime);

// RSI 14
const len = candles.length;
const closes = candles.map(c => c.close);
const rsi14 = new Float64Array(len);
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

console.log(`Analyzing ZKUSDT trades across ${candles.length} candles in 2026...`);

const trades = [];
let inOversold = false;
let minRSI = 100;
let dipLowestPrice = Infinity;
let inTrade = false;
let entryPrice = 0;
let entryIdx = 0;
let stopLossPrice = 0;

for (let i = 35; i < candles.length - 1; i++) {
  const c = candles[i];
  const curRSI = rsi14[i];
  const prevRSI = rsi14[i - 1];

  if (!inTrade) {
    if (curRSI < 35) {
      inOversold = true;
      if (curRSI < minRSI) minRSI = curRSI;
      if (c.low < dipLowestPrice) dipLowestPrice = c.low;
    } else if (inOversold && prevRSI < 35 && curRSI >= 35) {
      if (c.close >= c.open && minRSI <= 32) {
        inTrade = true;
        entryPrice = c.close * 1.0003;
        entryIdx = i;
        stopLossPrice = entryPrice * 0.99; // 1% SL

        trades.push({
          type: 'ENTRY',
          time: c.time,
          price: entryPrice,
          minRSI: minRSI.toFixed(1),
          reentryRSI: curRSI.toFixed(1)
        });
      }
      inOversold = false;
      minRSI = 100;
      dipLowestPrice = Infinity;
    }
  } else {
    let exitPrice = null;
    let reason = '';
    if (c.low <= stopLossPrice) {
      exitPrice = stopLossPrice * 0.9997;
      reason = 'STOP_LOSS_1PCT';
    } else if (curRSI >= 50) {
      exitPrice = c.close * 0.9997;
      reason = 'RSI_50';
    } else if (i - entryIdx >= 32) {
      exitPrice = c.close * 0.9997;
      reason = 'TIME_EXIT';
    }

    if (exitPrice !== null) {
      const gross = ((exitPrice - entryPrice) / entryPrice) * 100;
      const net = gross - 0.23;
      trades[trades.length - 1].exitTime = c.time;
      trades[trades.length - 1].exitPrice = exitPrice;
      trades[trades.length - 1].reason = reason;
      trades[trades.length - 1].netPct = net;
      trades[trades.length - 1].isWin = net > 0;
      inTrade = false;
    }
  }
}

const completed = trades.filter(t => t.exitPrice !== undefined);
const wins = completed.filter(t => t.isWin);
const losses = completed.filter(t => !t.isWin);
console.log(`Total Trades on ZKUSDT: ${completed.length}`);
console.log(`Wins: ${wins.length} (${((wins.length / completed.length) * 100).toFixed(1)}%), Losses: ${losses.length}`);
console.log('\nLast 15 Trades on ZKUSDT:');
console.table(completed.slice(-15).map(t => ({
  entryTime: t.time.slice(0, 16),
  exitTime: t.exitTime ? t.exitTime.slice(0, 16) : '',
  entryPrice: t.price.toFixed(5),
  exitPrice: t.exitPrice ? t.exitPrice.toFixed(5) : '',
  reason: t.reason,
  minRSI: t.minRSI,
  netPct: t.netPct ? t.netPct.toFixed(2) + '%' : '',
  isWin: t.isWin ? 'WIN' : 'LOSS'
})));
