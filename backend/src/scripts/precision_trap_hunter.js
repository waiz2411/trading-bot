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
  const ema20 = calculateEMA(closes, 20);
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

  return { rsi14, rsiSMA14, volSMA20, ema20, ema50, ema200 };
}

const symData = {};
for (const sym of symbols) {
  symData[sym] = { candles: datasets[sym], tech: calculateIndicators(datasets[sym]) };
}

console.log('Testing 70%–80% Win Rate Trap Elimination Combinations...');

const feeRate = 0.0010;
const slipRate = 0.0003;

// Let's test combinations of:
// - slPct: 1.0%, 1.5%, 2.0%, 2.5%, 3.0%
// - minRSI: <= 25, <= 28, <= 30, <= 32
// - maxBarsBelow: 1, 2, 3, 4
// - minReentryRSI: 35, 36, 37, 38
// - rsiYellowCross: true/false
// - volumeSpike: true/false (vol >= 1.2x SMA)
// - upperWickMax: 0.25 (strong close)
// - bullTrendOnly: close > ema200 on 15m (trading pullbacks in bull trend only!)

const experiments = [
  { name: '1. User Baseline (Traps 1&2, 1% SL, RSI 50 Exit)', slPct: 1.0, maxMinRSI: 32, maxBarsBelow: 99, minReentry: 35 },
  { name: '2. + Fast V-Bounce (Max 2 bars below 35) + 2% SL', slPct: 2.0, maxMinRSI: 32, maxBarsBelow: 2, minReentry: 35 },
  { name: '3. + Panic Dip Depth (minRSI <= 26) + 2% SL', slPct: 2.0, maxMinRSI: 26, maxBarsBelow: 2, minReentry: 35 },
  { name: '4. + Yellow Line Cross (Purple > Yellow)', slPct: 2.0, maxMinRSI: 26, maxBarsBelow: 2, minReentry: 35, yellowCross: true },
  { name: '5. + Bull Trend Only (15m Close > 15m EMA 200)', slPct: 2.0, maxMinRSI: 30, maxBarsBelow: 2, minReentry: 35, yellowCross: true, bullOnly: true },
  { name: '6. + Bull Trend Only + Deep Dip (minRSI <= 26)', slPct: 2.0, maxMinRSI: 26, maxBarsBelow: 2, minReentry: 35, yellowCross: true, bullOnly: true },
  { name: '7. Bull Trend + Deep Dip + 2.5% SL + RSI 50 Exit', slPct: 2.5, maxMinRSI: 26, maxBarsBelow: 2, minReentry: 35, yellowCross: true, bullOnly: true },
  { name: '8. Bull Trend + Deep Dip + 3.0% SL + RSI 50 Exit', slPct: 3.0, maxMinRSI: 26, maxBarsBelow: 2, minReentry: 35, yellowCross: true, bullOnly: true },
  { name: '9. Bull Trend + Fast V-Shape (1 bar) + 2.5% SL', slPct: 2.5, maxMinRSI: 28, maxBarsBelow: 1, minReentry: 36, yellowCross: true, bullOnly: true },
  { name: '10. Bull Trend + Fast V-Shape (1 bar) + 3.0% SL', slPct: 3.0, maxMinRSI: 28, maxBarsBelow: 1, minReentry: 36, yellowCross: true, bullOnly: true }
];

const results = [];

for (const exp of experiments) {
  let trades = 0, wins = 0, losses = 0, winSum = 0, lossSum = 0, totalNet = 0;

  for (const sym of symbols) {
    const { candles, tech } = symData[sym];
    const { rsi14, rsiSMA14, volSMA20, ema200 } = tech;

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
        } else if (inOversold && prevRSI < 35 && curRSI >= exp.minReentry) {
          if (minRSI <= exp.maxMinRSI && c.close >= c.open) {
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

            // Trap: Max bars below 35
            if (barsInOversold > exp.maxBarsBelow) {
              inOversold = false; minRSI = 100; barsInOversold = 0; continue;
            }

            // Trap: Yellow Line Cross
            if (exp.yellowCross && curRSI <= rsiSMA14[i]) {
              inOversold = false; minRSI = 100; barsInOversold = 0; continue;
            }

            // Trap: Bull Trend Only
            if (exp.bullOnly && c.close <= ema200[i]) {
              inOversold = false; minRSI = 100; barsInOversold = 0; continue;
            }

            // All traps passed -> Enter trade
            inTrade = true;
            entryPrice = c.close * (1 + slipRate);
            entryIdx = i;
            stopLossPrice = entryPrice * (1 - exp.slPct / 100);
          }

          inOversold = false;
          minRSI = 100;
          barsInOversold = 0;
        }
      } else {
        let exitPrice = null;

        if (c.low <= stopLossPrice) {
          exitPrice = stopLossPrice * (1 - slipRate);
          cooldownUntilIdx = i + 8; // 2 hour cooldown on SL
        } else if (curRSI >= 50) {
          exitPrice = c.close * (1 - slipRate);
        } else if (i - entryIdx >= 32) {
          exitPrice = c.close * (1 - slipRate);
        }

        if (exitPrice !== null) {
          const gross = ((exitPrice - entryPrice) / entryPrice) * 100;
          const net = gross - 0.23;

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
    Configuration: exp.name,
    Trades: trades,
    Wins: wins,
    Losses: losses,
    'Win Rate': winRate.toFixed(1) + '%',
    'Avg Win': '+' + avgWin.toFixed(2) + '%',
    'Avg Loss': avgLoss.toFixed(2) + '%',
    'Avg Net/Trade': (avgNet >= 0 ? '+' : '') + avgNet.toFixed(2) + '%',
    'Total Net': (totalNet >= 0 ? '+' : '') + totalNet.toFixed(1) + '%'
  });
}

console.log('\n========================================================================================');
console.log('   PRECISION TRAP HUNTER & WIN RATE MATRIX');
console.log('========================================================================================\n');
console.table(results);
