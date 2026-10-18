import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';

const cacheDir = './src/data/binance_cache';
const outDir = 'C:/Users/waizt/.gemini/antigravity/brain/9240cc1b-f576-4996-a196-552f1f9e4603';

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

// 4H Candlesticks
const multi4H = {};
for (const sym of allSymbols) {
  const c4 = resampleCandles(rawDatasets[sym], 240);
  multi4H[sym] = {
    candles: c4,
    ema20: calculateEMA(c4.map(c => c.close), 20),
    ema50: calculateEMA(c4.map(c => c.close), 50),
    rsi14: calculateRSI14(c4)
  };
}

// BTC 4H
const btc4 = resampleCandles(rawDatasets['BTCUSDT'], 240);
const btcEMA50_4h = calculateEMA(btc4.map(c => c.close), 50);
const btc4Map = new Map();
btc4.forEach((c, idx) => btc4Map.set(c.openTime, idx));

// Test 4H Swing Pullbacks on Leading Altcoins
// Entry: Coin 4H Close > EMA 20, EMA 20 > EMA 50, Pullback to EMA 20 with Bullish Reversal candle
// Target: +6.0% TP, -2.5% SL (2.4 : 1 R:R)
const fee = 0.23;
const allTrades = [];

for (const sym of allSymbols) {
  const d = multi4H[sym];
  const c = d.candles;
  const ema20 = d.ema20;
  const ema50 = d.ema50;
  const len = c.length;

  let inTrade = false;
  let entryPrice = 0;
  let entryTime = '';
  let entryIdx = 0;
  let sl = 0;
  let tp = 0;

  for (let i = 50; i < len; i++) {
    const cur = c[i];
    const prev = c[i - 1];

    if (!inTrade) {
      // BTC Safe
      const btcIdx = btc4Map.get(cur.openTime);
      if (btcIdx !== undefined && btc4[btcIdx].close <= btcEMA50_4h[btcIdx]) continue;

      // Strong 4H Trend
      if (cur.close > ema20[i] && ema20[i] > ema50[i]) {
        // Pullback: Low touched EMA 20, Closed Green
        const dipped = cur.low <= ema20[i] * 1.005 && cur.close >= ema20[i];
        const green = cur.close > cur.open;
        // Bullish candle body or lower wick rejection
        const lowerWick = Math.min(cur.close, cur.open) - cur.low;
        const body = Math.abs(cur.close - cur.open);

        if (dipped && green && lowerWick >= body * 0.5) {
          inTrade = true;
          entryPrice = cur.close * 1.00015;
          entryTime = cur.time;
          entryIdx = i;
          sl = entryPrice * 0.975; // -2.5% SL
          tp = entryPrice * 1.060; // +6.0% TP (2.4 : 1 R:R)
        }
      }
    } else {
      let exitPrice = null;
      let exitReason = '';

      if (cur.low <= sl) {
        exitPrice = sl * 0.99985;
        exitReason = 'Stop Loss Hit (-2.5%)';
      } else if (cur.high >= tp) {
        exitPrice = tp * 0.99985;
        exitReason = 'Take Profit Target Hit (+6.0%)';
      } else if (i - entryIdx >= 18) { // 3 days max hold
        exitPrice = cur.close * 0.99985;
        exitReason = 'Max Hold Time Exit';
      }

      if (exitPrice !== null) {
        const gross = ((exitPrice - entryPrice) / entryPrice) * 100;
        const net = gross - fee;
        allTrades.push({
          symbol: sym,
          entryTime,
          exitTime: cur.time,
          entryPrice,
          exitPrice,
          netReturnPct: Number(net.toFixed(2)),
          outcome: net > 0 ? 'WIN' : 'LOSS',
          exitReason
        });
        inTrade = false;
      }
    }
  }
}

allTrades.sort((a, b) => new Date(a.entryTime).getTime() - new Date(b.entryTime).getTime());
let equity = 0;
for (let t of allTrades) {
  equity += t.netReturnPct;
  t.cumNet = Number(equity.toFixed(2));
}

const total = allTrades.length;
const wins = allTrades.filter(t => t.outcome === 'WIN').length;
const losses = allTrades.filter(t => t.outcome === 'LOSS').length;
const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : '0.0';
const winSum = allTrades.filter(t => t.netReturnPct > 0).reduce((acc, t) => acc + t.netReturnPct, 0);
const lossSum = Math.abs(allTrades.filter(t => t.netReturnPct < 0).reduce((acc, t) => acc + t.netReturnPct, 0));
const pf = lossSum > 0 ? (winSum / lossSum).toFixed(2) : '0.00';
const totalNet = allTrades.reduce((acc, t) => acc + t.netReturnPct, 0);

console.log('=== 4H SWING PULLBACK AUDIT RESULTS ===');
console.log('Total Trades:', total);
console.log('Wins:', wins, 'Losses:', losses);
console.log('Win Rate:', winRate + '%');
console.log('Avg Win:', '+' + (winSum / wins).toFixed(2) + '%');
console.log('Avg Loss:', '-' + (lossSum / losses).toFixed(2) + '%');
console.log('Profit Factor:', pf);
console.log('Total Net Gain:', (totalNet > 0 ? '+' : '') + totalNet.toFixed(2) + '%');
