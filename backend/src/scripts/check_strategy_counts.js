import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cacheDir = path.resolve(__dirname, '../data/binance_cache');

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

const allSymbols = Object.keys(rawDatasets).filter(s => s !== 'BTCUSDT');
console.log('Loaded symbols:', allSymbols.length);

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

const btc15 = rawDatasets['BTCUSDT'];
const btc1h = resampleCandles(btc15, 60);
const btcEMA50_1h = calculateEMA(btc1h.map(c => c.close), 50);
const btcRSI_1h = calculateRSI14(btc1h);
const btc1hMap = new Map();
btc1h.forEach((c, idx) => btc1hMap.set(c.openTime, idx));

console.log('BTC 1H candles:', btc1h.length);

// Quick test of trade frequency across all 93 coins on 1H and 30m
for (const tf of ['30m', '1h']) {
  let tradesCount = 0;
  let btcTradesCount = 0;
  const targetMinutes = tf === '30m' ? 30 : 60;
  
  for (const sym of allSymbols) {
    const candles = resampleCandles(rawDatasets[sym], targetMinutes);
    const rsi = calculateRSI14(candles);
    const ema100 = calculateEMA(candles.map(c => c.close), 100);

    let inOversold = false;
    for (let i = 1; i < candles.length; i++) {
      const curRSI = rsi[i];
      const prevRSI = rsi[i - 1];
      const c = candles[i];

      if (curRSI < 30) {
        inOversold = true;
      } else if (inOversold && prevRSI < 30 && curRSI >= 30) {
        inOversold = false;
        if (c.close > ema100[i]) {
          tradesCount++;
          // check btc
          const btcBucket = c.openTime - (c.openTime % (3600 * 1000));
          const btcIdx = btc1hMap.get(btcBucket);
          if (btcIdx !== undefined && btc1h[btcIdx].close > btcEMA50_1h[btcIdx]) {
            btcTradesCount++;
          }
        }
      }
    }
  }
  console.log(`[${tf}] All 93 coins -> Trend (Close > EMA100): ${tradesCount} signals | BTC Safe + Trend: ${btcTradesCount} signals`);
}
