import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cacheDir = path.resolve(__dirname, '../data/binance_cache');
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

const liquidSymbols = [
  'SOLUSDT', 'AVAXUSDT', 'SUIUSDT', 'NEARUSDT', 'APTUSDT', 'ARBUSDT', 'LINKUSDT',
  'INJUSDT', 'DOGEUSDT', 'LTCUSDT', 'ETHUSDT', 'BNBUSDT', 'OPUSDT', 'ZKUSDT',
  'TIAUSDT', 'SEIUSDT', 'FETUSDT', 'RENDERUSDT', 'WIFUSDT', 'PEPEUSDT', 'GALAUSDT',
  'FTMUSDT', 'MATICUSDT', 'POLUSDT', 'ICPUSDT'
].filter(s => rawDatasets[s] !== undefined);

function calculateDailyVWAP(candles) {
  const len = candles.length;
  const vwap = new Float64Array(len);
  let cumPV = 0;
  let cumVol = 0;
  let lastDay = -1;

  for (let i = 0; i < len; i++) {
    const c = candles[i];
    const day = Math.floor(c.openTime / (86400 * 1000));
    if (day !== lastDay) {
      cumPV = 0; cumVol = 0; lastDay = day;
    }
    const typicalPrice = (c.high + c.low + c.close) / 3;
    cumPV += typicalPrice * c.volume;
    cumVol += c.volume;
    vwap[i] = cumVol > 0 ? cumPV / cumVol : c.close;
  }
  return vwap;
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

const tfData = { '15m': {}, '30m': {}, '1h': {} };
for (const sym of allSymbols) {
  const c15 = rawDatasets[sym];
  tfData['15m'][sym] = { candles: c15, vwap: calculateDailyVWAP(c15), ema8: calculateEMA(c15.map(c=>c.close), 8), ema20: calculateEMA(c15.map(c=>c.close), 20) };
  const c30 = resampleCandles(c15, 30);
  tfData['30m'][sym] = { candles: c30, vwap: calculateDailyVWAP(c30), ema8: calculateEMA(c30.map(c=>c.close), 8), ema20: calculateEMA(c30.map(c=>c.close), 20) };
  const c1h = resampleCandles(c15, 60);
  tfData['1h'][sym] = { candles: c1h, vwap: calculateDailyVWAP(c1h), ema8: calculateEMA(c1h.map(c=>c.close), 8), ema20: calculateEMA(c1h.map(c=>c.close), 20) };
}

function testSetup(cfg) {
  const targetSymbols = cfg.liquidOnly ? liquidSymbols : allSymbols;
  const tf = cfg.tf;
  const trades = [];
  const slipRate = 0.00015;
  const feeRoundTrip = 0.20;

  for (const sym of targetSymbols) {
    const data = tfData[tf][sym];
    const candles = data.candles;
    const vwap = data.vwap;
    const ema8 = data.ema8;
    const ema20 = data.ema20;
    const len = candles.length;

    let inTrade = false;
    let entryPrice = 0;
    let entryIdx = 0;
    let stopLossPrice = 0;
    let takeProfitPrice = 0;
    let cooldownUntil = 0;
    let beActive = false;

    for (let i = 50; i < len; i++) {
      const c = candles[i];
      const curVWAP = vwap[i];
      const curEMA = cfg.trailEMA === 20 ? ema20[i] : ema8[i];

      if (i < cooldownUntil) continue;

      if (!inTrade) {
        // PB Rule: Long only above VWAP
        if (c.close > curVWAP) {
          // VWAP Bounce: Low touched VWAP, Closed above VWAP, Green candle
          const touchedVWAP = c.low <= curVWAP * 1.002 && c.close >= curVWAP;
          const green = c.close >= c.open;

          if (touchedVWAP && green) {
            inTrade = true;
            entryPrice = c.close * (1 + slipRate);
            entryIdx = i;
            stopLossPrice = entryPrice * (1 - cfg.slPct / 100);
            takeProfitPrice = cfg.tpPct ? entryPrice * (1 + cfg.tpPct / 100) : 0;
            beActive = false;
          }
        }
      } else {
        let exitPrice = null;

        // Check SL
        if (c.low <= stopLossPrice) {
          exitPrice = stopLossPrice * (1 - slipRate);
          cooldownUntil = i + (cfg.cooldownBars || 2);
        }
        // Fixed TP
        else if (takeProfitPrice > 0 && c.high >= takeProfitPrice) {
          exitPrice = takeProfitPrice * (1 - slipRate);
        }
        // Trailing EMA exit (if configured)
        else if (cfg.useEMATrail && i > entryIdx && c.close < curEMA) {
          exitPrice = c.close * (1 - slipRate);
        }
        // Max bars
        else if (i - entryIdx >= (cfg.maxBars || 24)) {
          exitPrice = c.close * (1 - slipRate);
        }

        // Break-Even ratchet
        if (!beActive && cfg.beAtGain && ((c.high - entryPrice) / entryPrice) * 100 >= cfg.beAtGain) {
          beActive = true;
          stopLossPrice = entryPrice * 1.0025;
        }

        if (exitPrice !== null) {
          const gross = ((exitPrice - entryPrice) / entryPrice) * 100;
          const net = gross - feeRoundTrip - (slipRate * 2 * 100);
          trades.push({ net, win: net > 0.05 });
          inTrade = false;
        }
      }
    }
  }

  const total = trades.length;
  const wins = trades.filter(t => t.win).length;
  const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : '0.0';
  const totalNet = trades.reduce((acc, t) => acc + t.net, 0);
  const winSum = trades.filter(t => t.net > 0.05).reduce((acc, t) => acc + t.net, 0);
  const lossSum = Math.abs(trades.filter(t => t.net < -0.05).reduce((acc, t) => acc + t.net, 0));
  const pf = lossSum > 0 ? (winSum / lossSum).toFixed(2) : '0.00';

  return {
    name: cfg.name,
    trades: total,
    wins,
    losses: total - wins,
    winRate: winRate + '%',
    profitFactor: pf,
    totalNetGain: (totalNet > 0 ? '+' : '') + totalNet.toFixed(2) + '%'
  };
}

const tests = [
  // A. PB Original (15m, 8 EMA Trail, 1.5% SL)
  { name: 'A. PB Original (15m, 8 EMA Trail, 1.5% SL)', tf: '15m', liquidOnly: true, slPct: 1.5, useEMATrail: true, trailEMA: 8 },
  // B. PB with Fixed 1:2 R:R (15m, +3.0% TP, 1.5% SL, NO 8-EMA premature exit)
  { name: 'B. PB Fixed 1:2 R:R (15m, +3.0% TP, 1.5% SL)', tf: '15m', liquidOnly: true, slPct: 1.5, tpPct: 3.0, useEMATrail: false },
  // C. PB with Fixed 1:1.5 R:R (15m, +2.25% TP, 1.5% SL)
  { name: 'C. PB Fixed 1:1.5 R:R (15m, +2.25% TP, 1.5% SL)', tf: '15m', liquidOnly: true, slPct: 1.5, tpPct: 2.25, useEMATrail: false },
  // D. PB with 20 EMA Trailing (giving breathing room)
  { name: 'D. PB 20 EMA Trail (15m, 1.5% SL)', tf: '15m', liquidOnly: true, slPct: 1.5, useEMATrail: true, trailEMA: 20 },
  // E. PB on 1-Hour Candles (1H, +4.0% TP, 2.0% SL)
  { name: 'E. PB Fixed 1:2 R:R (1H, +4.0% TP, 2.0% SL)', tf: '1h', liquidOnly: true, slPct: 2.0, tpPct: 4.0, useEMATrail: false },
  // F. PB on 1-Hour Candles (1H, +3.0% TP, 1.5% SL, BE at +1.5%)
  { name: 'F. PB 1H +3.0% TP, 1.5% SL, BE at +1.5%', tf: '1h', liquidOnly: true, slPct: 1.5, tpPct: 3.0, beAtGain: 1.5, useEMATrail: false }
];

console.log('Testing PB optimizations...');
const res = tests.map(testSetup);
console.table(res);
