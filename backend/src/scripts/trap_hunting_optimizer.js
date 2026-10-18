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
  const volumes = candles.map(c => c.volume);
  const rsi14 = new Float64Array(len);
  const rsiSMA14 = new Float64Array(len);
  const volSMA20 = new Float64Array(len);
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

  for (let i = 27; i < len; i++) {
    let s = 0;
    for (let j = 0; j < 14; j++) s += rsi14[i - j];
    rsiSMA14[i] = s / 14;
  }

  for (let i = 19; i < len; i++) {
    let s = 0;
    for (let j = 0; j < 20; j++) s += volumes[i - j];
    volSMA20[i] = s / 20;
  }

  // ATR 14
  const atr14 = new Float64Array(len);
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

  return { rsi14, rsiSMA14, volSMA20, ema50, ema200, atr14 };
}

// Resample 1H
function resampleTo1H(c15m) {
  const buckets = new Map();
  for (const c of c15m) {
    const b = c.openTime - (c.openTime % (3600 * 1000));
    let g = buckets.get(b);
    if (!g) { g = []; buckets.set(b, g); }
    g.push(c);
  }
  const c1h = [];
  for (const [openTime, slice] of buckets.entries()) {
    c1h.push({ openTime, close: slice[slice.length - 1].close });
  }
  c1h.sort((a, b) => a.openTime - b.openTime);
  return c1h;
}

const sym15m = {};
const sym1h = {};

for (const sym of [...symbols, 'BTCUSDT']) {
  if (!datasets[sym]) continue;
  const c15 = datasets[sym];
  sym15m[sym] = { candles: c15, tech: calculateIndicators(c15) };

  const c1 = resampleTo1H(c15);
  const ema50 = calculateEMA(c1.map(c => c.close), 50);
  const map1 = new Map();
  c1.forEach((c, idx) => map1.set(c.openTime, idx));
  sym1h[sym] = { candles: c1, ema50, map1 };
}

console.log('Testing deep trap elimination configurations...');

const feeRate = 0.0010;
const slipRate = 0.0003;

// Configurations to test:
// We will test various combinations of traps:
// Trap 1: Compression breakdown
// Trap 2: Giant red bar (>= 1.5%)
// Trap 3: Falling knife (>= 4 consecutive red bars prior to re-entry)
// Trap 4: Oversold depth (minRSI <= 28 vs minRSI <= 32)
// Trap 5: High Volatility asset only (ATR% >= 0.70%)
// Trap 6: Bullish Reversal candle (Hammer or Bullish Engulfing or Upper Wick <= 25%)
// Trap 7: 1H Trend Confirmation (1H close > 1H EMA 50)
// Stop Loss: 1.0% vs Swing Low SL (capped at 1.5% or 2.0%)
// Exit: Immediate RSI 50 vs RSI 50 with profit lock

const testConfigs = [
  {
    name: 'A. Base (Traps 1 & 2 + 1% SL + 2h Cooldown)',
    trap1: true, trap2: true, cooldownHours: 2, slType: 'FIXED_1PCT'
  },
  {
    name: 'B. Swing Low SL (Dip Low - 0.2%, max 1.5%)',
    trap1: true, trap2: true, cooldownHours: 2, slType: 'SWING_LOW_1.5'
  },
  {
    name: 'C. Swing Low SL (Dip Low - 0.2%, max 2.0%)',
    trap1: true, trap2: true, cooldownHours: 2, slType: 'SWING_LOW_2.0'
  },
  {
    name: 'D. + Trap 3: Filter Falling Knives (>= 4 red bars in a row)',
    trap1: true, trap2: true, trap3FallingKnife: true, cooldownHours: 2, slType: 'SWING_LOW_2.0'
  },
  {
    name: 'E. + Trap 4: Deep Oversold Only (minRSI <= 28, true panic)',
    trap1: true, trap2: true, trap3FallingKnife: true, deepOversold: true, cooldownHours: 2, slType: 'SWING_LOW_2.0'
  },
  {
    name: 'F. + Trap 5: Active Volatile Coins Only (ATR% >= 0.65%)',
    trap1: true, trap2: true, trap3FallingKnife: true, deepOversold: true, activeVolatility: true, cooldownHours: 2, slType: 'SWING_LOW_2.0'
  },
  {
    name: 'G. + Trap 6: Strong Bullish Reversal Bar (Upper wick <= 25%)',
    trap1: true, trap2: true, trap3FallingKnife: true, deepOversold: true, activeVolatility: true, strongBar: true, cooldownHours: 2, slType: 'SWING_LOW_2.0'
  },
  {
    name: 'H. + Trap 7: Higher Timeframe 1H Trend Aligned (1H > EMA 50)',
    trap1: true, trap2: true, trap3FallingKnife: true, deepOversold: true, activeVolatility: true, strongBar: true, trend1H: true, cooldownHours: 2, slType: 'SWING_LOW_2.0'
  },
  {
    name: 'I. Master Formula (All Traps Filtered + Dynamic RSI 50 Exit)',
    trap1: true, trap2: true, trap3FallingKnife: true, deepOversold: true, activeVolatility: true, strongBar: true, trend1H: true, cooldownHours: 3, slType: 'SWING_LOW_2.0'
  }
];

const results = [];

for (const cfg of testConfigs) {
  let trades = 0, wins = 0, losses = 0, totalNet = 0, winSum = 0, lossSum = 0;

  for (const sym of symbols) {
    const s15 = sym15m[sym];
    const s1 = sym1h[sym];
    const { candles, tech } = s15;
    const { rsi14, rsiSMA14, volSMA20, ema50, ema200, atr14 } = tech;

    let inOversold = false;
    let minRSI = 100;
    let dipLowestPrice = Infinity;
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
          if (curRSI < minRSI) minRSI = curRSI;
          if (c.low < dipLowestPrice) dipLowestPrice = c.low;
        } else if (inOversold && prevRSI < 35 && curRSI >= 35) {
          const reqMinRSI = cfg.deepOversold ? 28 : 32;
          if (minRSI <= reqMinRSI && c.close >= c.open) {

            // TRAP 1 (Compression breakdown)
            if (cfg.trap1) {
              let smallCount = 0;
              for (let k = 1; k <= 24; k++) {
                if (((candles[i - k].high - candles[i - k].low) / candles[i - k].close) * 100 < 0.35) smallCount++;
              }
              if (smallCount / 24 >= 0.60) {
                inOversold = false; minRSI = 100; dipLowestPrice = Infinity; continue;
              }
            }

            // TRAP 2 (Giant Red Dump >= 1.5%)
            if (cfg.trap2) {
              let giantRed = false;
              for (let k = 1; k <= 4; k++) {
                const pb = candles[i - k];
                if (pb.close < pb.open && ((pb.open - pb.close) / pb.open) * 100 >= 1.5) { giantRed = true; break; }
              }
              if (giantRed) {
                inOversold = false; minRSI = 100; dipLowestPrice = Infinity; continue;
              }
            }

            // TRAP 3 (Falling Knives: 4 or more red bars in a row right before the bounce)
            if (cfg.trap3FallingKnife) {
              let redStreak = 0;
              for (let k = 1; k <= 5; k++) {
                if (candles[i - k].close < candles[i - k].open) redStreak++;
              }
              if (redStreak >= 4) {
                inOversold = false; minRSI = 100; dipLowestPrice = Infinity; continue;
              }
            }

            // TRAP 5 (Low Volatility coin)
            if (cfg.activeVolatility) {
              const atrPct = (atr14[i] / c.close) * 100;
              if (atrPct < 0.65) {
                inOversold = false; minRSI = 100; dipLowestPrice = Infinity; continue;
              }
            }

            // TRAP 6 (Weak Bar Close / Upper Wick Rejection)
            if (cfg.strongBar) {
              const range = c.high - c.low;
              const upperWick = c.high - Math.max(c.open, c.close);
              if (range > 0 && (upperWick / range) > 0.25) {
                inOversold = false; minRSI = 100; dipLowestPrice = Infinity; continue;
              }
            }

            // TRAP 7 (Higher Timeframe 1H Trend)
            if (cfg.trend1H && s1) {
              const b1 = (c.openTime - (c.openTime % (3600 * 1000))) - (3600 * 1000);
              const idx1 = s1.map1.get(b1);
              if (idx1 === undefined || s1.candles[idx1].close <= s1.ema50[idx1]) {
                inOversold = false; minRSI = 100; dipLowestPrice = Infinity; continue;
              }
            }

            // ALL TRAPS CLEARED -> ENTER
            inTrade = true;
            entryPrice = c.close * (1 + slipRate);
            entryIdx = i;

            if (cfg.slType === 'FIXED_1PCT') {
              stopLossPrice = entryPrice * 0.99;
            } else if (cfg.slType === 'SWING_LOW_1.5') {
              const swingSL = dipLowestPrice * 0.998;
              const maxSL = entryPrice * 0.985;
              stopLossPrice = Math.max(swingSL, maxSL);
            } else if (cfg.slType === 'SWING_LOW_2.0') {
              const swingSL = dipLowestPrice * 0.998;
              const maxSL = entryPrice * 0.980;
              stopLossPrice = Math.max(swingSL, maxSL);
            }
          }

          inOversold = false; minRSI = 100; dipLowestPrice = Infinity;
        }
      } else {
        let exitPrice = null;

        if (c.low <= stopLossPrice) {
          exitPrice = stopLossPrice * (1 - slipRate);
          cooldownUntilIdx = i + (cfg.cooldownHours * 4);
        } else if (curRSI >= 50) {
          exitPrice = c.close * (1 - slipRate);
        } else if (i - entryIdx >= 32) {
          exitPrice = c.close * (1 - slipRate);
        }

        if (exitPrice !== null) {
          const gross = ((exitPrice - entryPrice) / entryPrice) * 100;
          const net = gross - (feeRate * 2 * 100) - (slipRate * 100);

          trades++;
          if (net > 0) {
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

  results.push({
    Configuration: cfg.name,
    Trades: trades,
    Wins: wins,
    Losses: losses,
    'Win Rate': winRate.toFixed(1) + '%',
    'Avg Win': '+' + avgWin.toFixed(2) + '%',
    'Avg Loss': avgLoss.toFixed(2) + '%',
    'Avg Net/Trade': (avgNet >= 0 ? '+' : '') + avgNet.toFixed(2) + '%',
    'Total Net Gain': (totalNet >= 0 ? '+' : '') + totalNet.toFixed(1) + '%'
  });
}

console.log('\n========================================================================================');
console.log('   STEP-BY-STEP TRAP ELIMINATION & WIN RATE PROGRESSION');
console.log('========================================================================================\n');
console.table(results);
