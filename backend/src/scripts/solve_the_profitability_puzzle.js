import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cacheDir = path.resolve(__dirname, '../data/binance_cache');

console.log('--- SOLVING THE PROFITABILITY PUZZLE: 30m & 1H STRATEGY WITH TREND FILTER & SCALPING ---');

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

function calculateEMA(closes, p) {
  const ema = new Float64Array(closes.length);
  const k = 2 / (p + 1);
  let e = closes[0];
  for (let i = 0; i < closes.length; i++) {
    e = i === 0 ? closes[i] : closes[i] * k + e * (1 - k);
    ema[i] = e;
  }
  return ema;
}

function calculateIndicators(candles) {
  const len = candles.length;
  const closes = candles.map(c => c.close);
  const rsi14 = new Float64Array(len);
  const ema50 = calculateEMA(closes, 50);
  const ema200 = calculateEMA(closes, 200);

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
  return { rsi14, ema50, ema200 };
}

// Prepare 30m and 1h
const data30m = {};
const data1h = {};

for (const sym of [...symbols, 'BTCUSDT']) {
  if (!rawDatasets[sym]) continue;
  const c30 = resampleCandles(rawDatasets[sym], 30);
  const c1h = resampleCandles(rawDatasets[sym], 60);
  data30m[sym] = { candles: c30, tech: calculateIndicators(c30) };
  data1h[sym] = { candles: c1h, tech: calculateIndicators(c1h) };
}

const feeRate = 0.0010;
const slipRate = 0.0003;

// Test configurations
const testConfigs = [
  // 30m Experiments
  { name: '30m: Raw 30->50 (1.5% SL)', tf: '30m', slPct: 1.5, targetMode: 'RSI_50' },
  { name: '30m: Trend Filter (Close > EMA50) + 2.0% SL', tf: '30m', slPct: 2.0, targetMode: 'RSI_50', filterEMA50: true },
  { name: '30m: Trend Filter (Close > EMA200) + 2.0% SL', tf: '30m', slPct: 2.0, targetMode: 'RSI_50', filterEMA200: true },
  { name: '30m: Trend Filter (Close > EMA50) + Fixed +2.5% TP (2% SL)', tf: '30m', slPct: 2.0, targetMode: 'TP_2.5', filterEMA50: true },
  
  // 1H Experiments
  { name: '1H: Raw 30->50 (2.5% SL)', tf: '1h', slPct: 2.5, targetMode: 'RSI_50' },
  { name: '1H: Trend Filter (Close > EMA50) + 2.5% SL', tf: '1h', slPct: 2.5, targetMode: 'RSI_50', filterEMA50: true },
  { name: '1H: Trend Filter (Close > EMA200) + 2.5% SL', tf: '1h', slPct: 2.5, targetMode: 'RSI_50', filterEMA200: true },
  { name: '1H: Trend Filter (Close > EMA50) + Target RSI 55 (3% SL)', tf: '1h', slPct: 3.0, targetMode: 'RSI_55', filterEMA50: true },
  { name: '1H: Trend Filter (Close > EMA50) + Fixed +3.0% TP (2.5% SL)', tf: '1h', slPct: 2.5, targetMode: 'TP_3.0', filterEMA50: true },
  { name: '1H: BTC Safe (BTC > EMA50) + Coin (Close > EMA50) + 3% SL', tf: '1h', slPct: 3.0, targetMode: 'RSI_50', filterEMA50: true, filterBTC: true }
];

const results = [];

for (const cfg of testConfigs) {
  const store = cfg.tf === '30m' ? data30m : data1h;
  const btcStore = store['BTCUSDT'];
  let trades = 0, wins = 0, losses = 0, winSum = 0, lossSum = 0, totalNet = 0;

  for (const sym of symbols) {
    if (!store[sym]) continue;
    const { candles, tech } = store[sym];
    const { rsi14, ema50, ema200 } = tech;

    let inOversold = false;
    let minRSI = 100;
    let inTrade = false;
    let entryPrice = 0;
    let entryIdx = 0;
    let currentSL = 0;
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
            // Trend checks
            if (cfg.filterEMA50 && c.close <= ema50[i]) { inOversold = false; minRSI = 100; continue; }
            if (cfg.filterEMA200 && c.close <= ema200[i]) { inOversold = false; minRSI = 100; continue; }
            if (cfg.filterBTC && btcStore && btcStore.candles[i] && btcStore.candles[i].close <= btcStore.tech.ema50[i]) {
              inOversold = false; minRSI = 100; continue;
            }

            inTrade = true;
            entryPrice = c.close * (1 + slipRate);
            entryIdx = i;
            currentSL = entryPrice * (1 - cfg.slPct / 100);
          }
          inOversold = false; minRSI = 100;
        }
      } else {
        let exitPrice = null;

        if (c.low <= currentSL) {
          exitPrice = currentSL * (1 - slipRate);
          cooldownUntil = i + 4;
        } else if (cfg.targetMode === 'RSI_50' && curRSI >= 50) {
          exitPrice = c.close * (1 - slipRate);
        } else if (cfg.targetMode === 'RSI_55' && curRSI >= 55) {
          exitPrice = c.close * (1 - slipRate);
        } else if (cfg.targetMode === 'TP_2.5' && c.high >= entryPrice * 1.025) {
          exitPrice = entryPrice * 1.025 * (1 - slipRate);
        } else if (cfg.targetMode === 'TP_3.0' && c.high >= entryPrice * 1.030) {
          exitPrice = entryPrice * 1.030 * (1 - slipRate);
        } else if (i - entryIdx >= 24) {
          exitPrice = c.close * (1 - slipRate);
        }

        if (exitPrice !== null) {
          const gross = ((exitPrice - entryPrice) / entryPrice) * 100;
          const net = gross - 0.23;

          trades++;
          if (net > 0) { wins++; winSum += net; } else { losses++; lossSum += net; }
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
    Losses: losses,
    'Win Rate': winRate.toFixed(1) + '%',
    'Avg Win': '+' + avgWin.toFixed(2) + '%',
    'Avg Loss': avgLoss.toFixed(2) + '%',
    'Profit Factor': profitFactor.toFixed(2),
    'Avg Net/Trade': (avgNet >= 0 ? '+' : '') + avgNet.toFixed(2) + '%',
    'Total Net Gain': (totalNet >= 0 ? '+' : '') + totalNet.toFixed(1) + '%'
  });
}

console.table(results);
