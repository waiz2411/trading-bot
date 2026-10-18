import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cacheDir = path.resolve(__dirname, '../data/binance_cache');

console.log('--- TESTING ASYMMETRIC REWARD:RISK ON 30m & 1H RSI STRATEGY ---');

const files = fs.readdirSync(cacheDir).filter(f => f.endsWith('.json'));
const rawDatasets = {};

for (const file of files) {
  const sym = file.split('_')[0];
  if (['PAXGUSDT', 'FDUSDUSDT', 'USDCUSDT'].includes(sym)) continue;
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
      if (parsed.length > 2000) rawDatasets[sym] = parsed;
    }
  } catch (_) {}
}

const symbols = Object.keys(rawDatasets).filter(s => s !== 'BTCUSDT');

function resampleCandles(c15m, targetMinutes) {
  const stepMs = targetMinutes * 60 * 1000;
  const buckets = new Map();
  for (const c of c15m) {
    const bucket = c.openTime - (c.openTime % stepMs);
    let arr = buckets.get(bucket);
    if (!arr) { arr = []; buckets.set(bucket, arr); }
    arr.push(c);
  }
  const resampled = [];
  for (const [openTime, slice] of buckets.entries()) {
    let open = slice[0].open;
    let high = -Infinity;
    let low = Infinity;
    let close = slice[slice.length - 1].close;
    let volume = 0;
    for (const c of slice) {
      if (c.high > high) high = c.high;
      if (c.low < low) low = c.low;
      volume += c.volume;
    }
    resampled.push({ openTime, time: new Date(openTime).toISOString(), open, high, low, close, volume });
  }
  resampled.sort((a, b) => a.openTime - b.openTime);
  return resampled;
}

function calculateRSI14(candles) {
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
  return rsi14;
}

const data30m = {};
const data1h = {};

for (const sym of symbols) {
  const c30 = resampleCandles(rawDatasets[sym], 30);
  const c1h = resampleCandles(rawDatasets[sym], 60);
  data30m[sym] = { candles: c30, rsi14: calculateRSI14(c30) };
  data1h[sym] = { candles: c1h, rsi14: calculateRSI14(c1h) };
}

const feeRate = 0.0010;
const slipRate = 0.0003;

const configs = [
  // 30m
  { name: '1. 30m: Exit at RSI 50 (Baseline, 2% SL)', tf: '30m', slPct: 2.0, targetRSI: 50, moveBEAt50: false },
  { name: '2. 30m: Move SL to BE at RSI 50, Exit at RSI 55', tf: '30m', slPct: 2.0, targetRSI: 55, moveBEAt50: true },
  { name: '3. 30m: Move SL to BE at RSI 50, Exit at RSI 60', tf: '30m', slPct: 2.0, targetRSI: 60, moveBEAt50: true },
  { name: '4. 30m: 50% Profit at RSI 50 + Trail 50% to RSI 65', tf: '30m', slPct: 2.0, scaleHalfAt50: true, targetRSI: 65 },

  // 1H
  { name: '5. 1H: Exit at RSI 50 (Baseline, 2.5% SL)', tf: '1h', slPct: 2.5, targetRSI: 50, moveBEAt50: false },
  { name: '6. 1H: Move SL to BE at RSI 50, Exit at RSI 55', tf: '1h', slPct: 2.5, targetRSI: 55, moveBEAt50: true },
  { name: '7. 1H: Move SL to BE at RSI 50, Exit at RSI 60', tf: '1h', slPct: 2.5, targetRSI: 60, moveBEAt50: true },
  { name: '8. 1H: Move SL to BE at RSI 50, Exit at RSI 65', tf: '1h', slPct: 2.5, targetRSI: 65, moveBEAt50: true },
  { name: '9. 1H: 50% Profit at RSI 50 + Move to BE + Trail to RSI 65', tf: '1h', slPct: 2.5, scaleHalfAt50: true, targetRSI: 65 },
  { name: '10. 1H: 50% Profit at RSI 50 + Move to BE + Trail to RSI 70', tf: '1h', slPct: 2.5, scaleHalfAt50: true, targetRSI: 70 },
  { name: '11. 1H: Fixed +3.5% TP (Move SL to BE at +1.5% gain, 2.5% SL)', tf: '1h', slPct: 2.5, fixedTP: 3.5, beAtGain: 1.5 }
];

const results = [];

for (const cfg of configs) {
  const store = cfg.tf === '30m' ? data30m : data1h;
  let trades = 0, wins = 0, breakEvens = 0, losses = 0;
  let winSum = 0, lossSum = 0, totalNet = 0;

  for (const sym of symbols) {
    const { candles, rsi14 } = store[sym];

    let inOversold = false;
    let minRSI = 100;
    let inTrade = false;
    let entryPrice = 0;
    let entryIdx = 0;
    let currentSL = 0;
    let beActivated = false;
    let rsi50Touched = false;
    let partialProfitNet = 0;
    let partialSold = false;
    let cooldownUntil = -1;

    for (let i = 25; i < candles.length - 1; i++) {
      const c = candles[i];
      const curRSI = rsi14[i];
      const prevRSI = rsi14[i - 1];

      if (i < cooldownUntil) continue;

      if (!inTrade) {
        if (curRSI < 30) {
          inOversold = true;
          if (curRSI < minRSI) minRSI = curRSI;
        } else if (inOversold && prevRSI < 30 && curRSI >= 30) {
          if (c.close >= c.open) {
            inTrade = true;
            entryPrice = c.close * (1 + slipRate);
            entryIdx = i;
            currentSL = entryPrice * (1 - cfg.slPct / 100);
            beActivated = false;
            rsi50Touched = false;
            partialProfitNet = 0;
            partialSold = false;
          }
          inOversold = false;
          minRSI = 100;
        }
      } else {
        const peakGain = ((c.high - entryPrice) / entryPrice) * 100;

        // Check if RSI reached 50
        if (!rsi50Touched && curRSI >= 50) {
          rsi50Touched = true;
          if (cfg.moveBEAt50 || cfg.scaleHalfAt50) {
            beActivated = true;
            currentSL = entryPrice * 1.0025; // Move SL to BE + 0.25% net
          }
          if (cfg.scaleHalfAt50) {
            partialSold = true;
            const gross50 = ((c.close * (1 - slipRate) - entryPrice) / entryPrice) * 100;
            partialProfitNet = (gross50 - 0.23) * 0.50; // Bank 50% profit
          }
        }

        // Fixed TP Check
        if (cfg.beAtGain && !beActivated && peakGain >= cfg.beAtGain) {
          beActivated = true;
          currentSL = entryPrice * 1.0025;
        }

        let exitPrice = null;

        // Check SL or BE
        if (c.low <= currentSL) {
          exitPrice = currentSL * (1 - slipRate);
          if (!beActivated) cooldownUntil = i + 4;
        }
        // Fixed TP
        else if (cfg.fixedTP && c.high >= entryPrice * (1 + cfg.fixedTP / 100)) {
          exitPrice = entryPrice * (1 + cfg.fixedTP / 100) * (1 - slipRate);
        }
        // Baseline: Exit at RSI 50
        else if (cfg.targetRSI === 50 && !cfg.scaleHalfAt50 && curRSI >= 50) {
          exitPrice = c.close * (1 - slipRate);
        }
        // Runner Target (RSI 55, 60, 65, 70)
        else if (cfg.targetRSI > 50 && curRSI >= cfg.targetRSI) {
          exitPrice = c.close * (1 - slipRate);
        }
        // Max Time Limit (24 bars)
        else if (i - entryIdx >= 24) {
          exitPrice = c.close * (1 - slipRate);
        }

        if (exitPrice !== null) {
          const gross = ((exitPrice - entryPrice) / entryPrice) * 100;
          const portion = partialSold ? 0.50 : 1.0;
          const net = partialProfitNet + ((gross - 0.23) * portion);

          trades++;
          if (net > 0.05) {
            wins++;
            winSum += net;
          } else if (net >= -0.05 && net <= 0.05) {
            breakEvens++;
            wins++;
            winSum += net;
          } else {
            losses++;
            lossSum += net;
          }
          totalNet += net;
          inTrade = false;
        }
      }
    }
  }

  const winRate = trades > 0 ? (wins / trades) * 100 : 0;
  const avgWin = wins > 0 ? winSum / wins : 0;
  const avgLoss = losses > 0 ? lossSum / losses : 0;
  const avgNet = trades > 0 ? totalNet / trades : 0;
  const profitFactor = Math.abs(lossSum) > 0 ? Math.abs(winSum / lossSum) : 999;
  const daily = (trades / 289).toFixed(1);

  results.push({
    Strategy: cfg.name,
    Trades: trades,
    'Trades/Day': daily,
    Wins: wins,
    'Break-Evens': breakEvens,
    Losses: losses,
    'Win Rate': winRate.toFixed(1) + '%',
    'Avg Win': '+' + avgWin.toFixed(2) + '%',
    'Avg Loss': avgLoss.toFixed(2) + '%',
    'Reward:Risk': avgLoss !== 0 ? (avgWin / Math.abs(avgLoss)).toFixed(2) : 'N/A',
    'Profit Factor': profitFactor.toFixed(2),
    'Avg Net/Trade': (avgNet >= 0 ? '+' : '') + avgNet.toFixed(2) + '%',
    'Total Net Gain': (totalNet >= 0 ? '+' : '') + totalNet.toFixed(1) + '%'
  });
}

console.table(results);
