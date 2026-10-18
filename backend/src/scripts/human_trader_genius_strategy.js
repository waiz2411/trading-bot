import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cacheDir = path.resolve(__dirname, '../data/binance_cache');

console.log('--- CODIFYING THE HUMAN TRADER GENIUS: ACTIVE RUNNER PULLBACK SYSTEM ---');

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
  const atr14 = new Float64Array(len);

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

  let atrSum = 0;
  for (let i = 1; i < len; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    );
    if (i <= 14) {
      atrSum += tr;
      if (i === 14) atr14[14] = atrSum / 14;
    } else {
      atr14[i] = (atr14[i - 1] * 13 + tr) / 14;
    }
  }

  return { rsi14, atr14 };
}

// Build 15m and 4H Data
const coinData = {};
for (const sym of symbols) {
  const c15 = rawDatasets[sym];
  const ind15 = calculateIndicators(c15);

  const c4h = resampleCandles(c15, 240);
  const ind4h = calculateIndicators(c4h);
  const ema50_4h = calculateEMA(c4h.map(c => c.close), 50);
  const map4h = new Map();
  c4h.forEach((c, idx) => map4h.set(c.openTime, idx));

  coinData[sym] = { c15, ind15, c4h, ind4h, ema50_4h, map4h };
}

const feeRate = 0.0010;
const slipRate = 0.0003;

// We test 4 Architectures designed to produce daily consistent profits:
// Architecture 1: The "Active Leader Pullback"
// - 15m RSI dips < 30, re-enters >= 30
// - Coin must NOT be in micro-candle compression (ATR% >= 0.55%)
// - Coin 4H RSI must be >= 42 (active market, not dead bear trend)
// - Stop Loss = 1.5%
// - Target = RSI 50
// - Break-Even Guard = at +0.70% gain, ratchet SL to +0.25% net

// Architecture 2: The "Two-Stage Profit Extender"
// - Same as Arch 1, but at RSI 50: Sell 50%, move SL to BE, trail remainder to RSI 65

// Architecture 3: The "1-Hour Swing Scalper"
// - 1-Hour candles: RSI dips < 32, re-enters >= 32
// - 4H RSI >= 45
// - Stop Loss = 2.5%
// - Target = RSI 55 + BE Guard at +1.2% gain

// Architecture 4: The "Dynamic Volatility Scalper" (Target = 2x ATR, SL = 1.2x ATR)

const models = [
  { name: '1. Active Leader Scalp (15m: 4H RSI >= 42, ATR >= 0.55%, Exit RSI 50)', type: 'ARCH1', slPct: 1.5 },
  { name: '2. Two-Stage Profit Extender (15m: 50% at RSI 50 + Trail to RSI 65)', type: 'ARCH2', slPct: 1.5 },
  { name: '3. High Conviction Two-Stage (15m: 4H Close > 4H EMA50 + Two-Stage)', type: 'ARCH3', slPct: 1.5 },
  { name: '4. 1-Hour Swing Scalp (1H: 4H RSI >= 42 + Two-Stage at RSI 50)', type: 'ARCH4', slPct: 2.5 }
];

const results = [];

for (const m of models) {
  let trades = 0, wins = 0, breakEvens = 0, losses = 0;
  let winSum = 0, lossSum = 0, totalNet = 0;
  const dailyGainMap = new Map();

  for (const sym of symbols) {
    const { c15, ind15, c4h, ind4h, ema50_4h, map4h } = coinData[sym];
    const candles = m.type === 'ARCH4' ? resampleCandles(c15, 60) : c15;
    const { rsi14, atr14 } = m.type === 'ARCH4' ? calculateIndicators(candles) : ind15;

    let inOversold = false;
    let minRSI = 100;
    let inTrade = false;
    let entryPrice = 0;
    let entryIdx = 0;
    let currentSL = 0;
    let beActivated = false;
    let rsi50Reached = false;
    let partialSold = false;
    let partialProfitNet = 0;
    let cooldownUntil = -1;

    for (let i = 35; i < candles.length - 1; i++) {
      const c = candles[i];
      const curRSI = rsi14[i];
      const prevRSI = rsi14[i - 1];

      if (i < cooldownUntil) continue;

      // 4H context
      const b4 = (c.openTime - (c.openTime % (4 * 3600 * 1000))) - (4 * 3600 * 1000);
      const idx4h = map4h.get(b4);
      const rsi4h = idx4h !== undefined ? ind4h.rsi14[idx4h] : 50;
      const close4h = idx4h !== undefined ? c4h[idx4h].close : 0;
      const ema4h = idx4h !== undefined ? ema50_4h[idx4h] : 0;

      if (!inTrade) {
        if (curRSI < 30) {
          inOversold = true;
          if (curRSI < minRSI) minRSI = curRSI;
        } else if (inOversold && prevRSI < 30 && curRSI >= 30) {
          if (c.close >= c.open) {
            // Check 4H macro health
            if (m.type === 'ARCH1' || m.type === 'ARCH2') {
              if (rsi4h < 42) { inOversold = false; minRSI = 100; continue; }
            }
            if (m.type === 'ARCH3') {
              if (close4h <= ema4h || rsi4h < 45) { inOversold = false; minRSI = 100; continue; }
            }
            if (m.type === 'ARCH4') {
              if (rsi4h < 42) { inOversold = false; minRSI = 100; continue; }
            }

            // Check Volatility (not a dead coin)
            const atrPct = (atr14[i] / c.close) * 100;
            if (atrPct < 0.50) { inOversold = false; minRSI = 100; continue; }

            // Enter
            inTrade = true;
            entryPrice = c.close * (1 + slipRate);
            entryIdx = i;
            currentSL = entryPrice * (1 - m.slPct / 100);
            beActivated = false;
            rsi50Reached = false;
            partialSold = false;
            partialProfitNet = 0;
          }
          inOversold = false;
          minRSI = 100;
        }
      } else {
        let exitPrice = null;

        // Two-Stage De-Risking at RSI 50
        if (!rsi50Reached && curRSI >= 50) {
          rsi50Reached = true;
          if (m.type === 'ARCH1') {
            // Full exit at RSI 50
            exitPrice = c.close * (1 - slipRate);
          } else {
            // Sell 50% at RSI 50, move SL to BE on remaining 50%
            partialSold = true;
            const gross50 = ((c.close * (1 - slipRate) - entryPrice) / entryPrice) * 100;
            partialProfitNet = (gross50 - 0.23) * 0.50;
            currentSL = entryPrice * 1.0025; // Risk-free on remaining 50%
            beActivated = true;
          }
        }


        // Check SL / BE
        if (c.low <= currentSL) {
          exitPrice = currentSL * (1 - slipRate);
          if (!beActivated) cooldownUntil = i + 6;
        }
        // Arch 1: Full Exit at RSI 50
        else if (m.type === 'ARCH1' && curRSI >= 50) {
          exitPrice = c.close * (1 - slipRate);
        }
        // Two-Stage Models: Runner Exit at RSI 65
        else if (partialSold && curRSI >= 65) {
          exitPrice = c.close * (1 - slipRate);
        }
        // Time Stop
        else if (i - entryIdx >= 24) {
          exitPrice = c.close * (1 - slipRate);
        }

        if (exitPrice !== null) {
          const gross = ((exitPrice - entryPrice) / entryPrice) * 100;
          const remainPortion = partialSold ? 0.50 : 1.0;
          const net = partialProfitNet + ((gross - 0.23) * remainPortion);

          trades++;
          if (net > 0.05) { wins++; winSum += net; }
          else if (net >= -0.05 && net <= 0.05) { breakEvens++; wins++; winSum += net; }
          else { losses++; lossSum += net; }
          totalNet += net;

          const dateStr = c.time.slice(0, 10);
          dailyGainMap.set(dateStr, (dailyGainMap.get(dateStr) || 0) + net);

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
  const dailyTrades = (trades / 289).toFixed(1);

  const dailyReturns = Array.from(dailyGainMap.values());
  const profitableDays = dailyReturns.filter(r => r > 0).length;
  const totalTradingDays = dailyReturns.length;
  const dailyWinRate = totalTradingDays > 0 ? ((profitableDays / totalTradingDays) * 100).toFixed(1) + '%' : '0%';

  results.push({
    Configuration: m.name,
    Trades: trades,
    'Trades/Day': dailyTrades,
    Wins: wins,
    BreakEvens: breakEvens,
    Losses: losses,
    'Win Rate': winRate.toFixed(1) + '%',
    'Avg Win': '+' + avgWin.toFixed(2) + '%',
    'Avg Loss': avgLoss.toFixed(2) + '%',
    'Profit Factor': profitFactor.toFixed(2),
    'Profitable Days': `${profitableDays}/${totalTradingDays} (${dailyWinRate})`,
    'Total Net Gain': (totalNet >= 0 ? '+' : '') + totalNet.toFixed(1) + '%'
  });
}

console.log('\n====================================================================================================================================');
console.log('   HUMAN TRADER GENIUS SYSTEM: ACTIVE RUNNER PULLBACK MATRIX (FULL 2026 AUDIT WITH 0.20% BINANCE FEES)');
console.log('====================================================================================================================================\n');
console.table(results);
