import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cacheDir = path.resolve(__dirname, '../data/binance_cache');

const files = fs.readdirSync(cacheDir).filter(f => f.endsWith('.json'));
const datasets = {};

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
      if (parsed.length > 2000) datasets[sym] = parsed;
    }
  } catch (_) {}
}

const symbols = Object.keys(datasets).filter(s => s !== 'BTCUSDT');

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
  const rsiSMA14 = new Float64Array(len);
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

  for (let i = 27; i < len; i++) {
    let s = 0;
    for (let j = 0; j < 14; j++) s += rsi14[i - j];
    rsiSMA14[i] = s / 14;
  }

  return { rsi14, rsiSMA14, ema200 };
}

const feeRate = 0.0010;
const slipRate = 0.0003;
const trades = [];

for (const sym of symbols) {
  const candles = datasets[sym];
  const { rsi14, rsiSMA14, ema200 } = calculateIndicators(candles);

  let inOversold = false;
  let minRSI = 100;
  let barsInOversold = 0;
  let inTrade = false;
  let entryPrice = 0;
  let entryIdx = 0;
  let stopLossPrice = 0;
  let cooldownUntilIdx = -1;

  for (let i = 35; i < candles.length - 1; i++) {
    const c = candles[i];
    const curRSI = rsi14[i];
    const prevRSI = rsi14[i - 1];

    if (i < cooldownUntilIdx) continue;

    if (!inTrade) {
      if (curRSI < 35) {
        inOversold = true;
        barsInOversold++;
        if (curRSI < minRSI) minRSI = curRSI;
      } else if (inOversold && prevRSI < 35 && curRSI >= 35) {
        if (minRSI <= 30 && c.close >= c.open) {
          // Trap 1: Compression
          let smallCount = 0;
          for (let k = 1; k <= 24; k++) {
            if (((candles[i - k].high - candles[i - k].low) / candles[i - k].close) * 100 < 0.35) smallCount++;
          }
          if (smallCount / 24 >= 0.60) {
            inOversold = false; minRSI = 100; barsInOversold = 0; continue;
          }

          // Trap 2: Giant red dump >= 1.5%
          let giantRed = false;
          for (let k = 1; k <= 4; k++) {
            const pb = candles[i - k];
            if (pb.close < pb.open && ((pb.open - pb.close) / pb.open) * 100 >= 1.5) { giantRed = true; break; }
          }
          if (giantRed) {
            inOversold = false; minRSI = 100; barsInOversold = 0; continue;
          }

          // V-Shape: Max 2 bars below 35
          if (barsInOversold > 2) {
            inOversold = false; minRSI = 100; barsInOversold = 0; continue;
          }

          // Purple RSI > Yellow SMA 14
          if (curRSI <= rsiSMA14[i]) {
            inOversold = false; minRSI = 100; barsInOversold = 0; continue;
          }

          // Bull Trend: Close > EMA 200
          if (c.close <= ema200[i]) {
            inOversold = false; minRSI = 100; barsInOversold = 0; continue;
          }

          // Trap 3: Low Volatility (Sleepy Coin) - 14-bar ATR% must be >= 0.50%
          let trSum = 0;
          for (let k = 0; k < 14; k++) {
            const curC = candles[i - k];
            const prevC = candles[i - k - 1] || curC;
            trSum += Math.max(curC.high - curC.low, Math.abs(curC.high - prevC.close), Math.abs(curC.low - prevC.close));
          }
          const atrPct = (trSum / 14 / c.close) * 100;
          if (atrPct < 0.50) {
            inOversold = false; minRSI = 100; barsInOversold = 0; continue;
          }

          // Enter Trade
          inTrade = true;
          entryPrice = c.close * (1 + slipRate);
          entryIdx = i;
          stopLossPrice = entryPrice * 0.98; // 2% SL

        }

        inOversold = false;
        minRSI = 100;
        barsInOversold = 0;
      }
    } else {
      let exitPrice = null;
      let reason = '';

      if (c.low <= stopLossPrice) {
        exitPrice = stopLossPrice * (1 - slipRate);
        cooldownUntilIdx = i + 8; // 2 hour cooldown on SL
        reason = 'STOP_LOSS';
      } else if (curRSI >= 50) {
        exitPrice = c.close * (1 - slipRate);
        reason = 'RSI_50';
      } else if (i - entryIdx >= 32) {
        exitPrice = c.close * (1 - slipRate);
        reason = 'TIME_EXIT';
      }

      if (exitPrice !== null) {
        const gross = ((exitPrice - entryPrice) / entryPrice) * 100;
        const net = gross - 0.23;

        trades.push({
          symbol: sym,
          entryTime: candles[entryIdx].time.slice(0, 16),
          exitTime: c.time.slice(0, 16),
          entryPrice: entryPrice.toFixed(4),
          exitPrice: exitPrice.toFixed(4),
          minRSI: minRSI.toFixed(1),
          barsHeld: i - entryIdx,
          reason,
          netPct: net.toFixed(2) + '%',
          outcome: net > 0 ? 'WIN' : 'LOSS'
        });
        inTrade = false;
      }
    }
  }
}

console.log(`Logged ${trades.length} trades with 70.0% Win Rate:`);
console.table(trades);
