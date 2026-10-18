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

function calculateIndicators(candles) {
  const len = candles.length;
  const closes = candles.map(c => c.close);
  const rsi14 = new Float64Array(len);
  const rsiSMA14 = new Float64Array(len);

  // EMA 50 and EMA 200 on 15m
  const ema50 = new Float64Array(len);
  const ema200 = new Float64Array(len);
  const k50 = 2 / 51;
  const k200 = 2 / 201;
  let e50 = closes[0], e200 = closes[0];
  for (let i = 0; i < len; i++) {
    e50 = i === 0 ? closes[i] : closes[i] * k50 + e50 * (1 - k50);
    e200 = i === 0 ? closes[i] : closes[i] * k200 + e200 * (1 - k200);
    ema50[i] = e50;
    ema200[i] = e200;
  }

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

  return { rsi14, rsiSMA14, ema50, ema200 };
}

const symData = {};
for (const sym of symbols) {
  symData[sym] = { candles: datasets[sym], tech: calculateIndicators(datasets[sym]) };
}

console.log('Searching parameter space for 70%–80% Win Rate configurations...');

const feeRate = 0.0010;
const slipRate = 0.0003;

// We will systematically test:
// 1. Trap 1 (Compression) & Trap 2 (Giant Red Bar) always active.
// 2. Cooldown = 2h or 3h.
// 3. Max Bars Below 35 (V-shape recovery filter: max 2, 3, or 4 bars).
// 4. Min Re-entry RSI (36, 37, 38).
// 5. Purple RSI > Yellow SMA 14.
// 6. Stop Loss distance: 1.5%, 2.0%, 2.5%, 3.0%.
// 7. Profit Target / Exit:
//    - Pure RSI 50
//    - RSI 50 OR +1.2% TP
//    - Dynamic: Exit at RSI 50 or trailing stop

const testCombos = [
  // Test variations of V-shape bounce + SL distance
  { name: 'Combo 1: V-Shape (Max 3 bars below 35) + 1.5% SL + RSI 50 Exit', maxBarsBelow: 3, slPct: 1.5, minReentry: 35, rsiYellow: false, tpPct: 0 },
  { name: 'Combo 2: V-Shape (Max 3 bars below 35) + 2.0% SL + RSI 50 Exit', maxBarsBelow: 3, slPct: 2.0, minReentry: 35, rsiYellow: false, tpPct: 0 },
  { name: 'Combo 3: V-Shape + Yellow Line Cross + 2.0% SL + RSI 50 Exit', maxBarsBelow: 3, slPct: 2.0, minReentry: 35, rsiYellow: true, tpPct: 0 },
  { name: 'Combo 4: V-Shape + Strong Momentum (Re-entry >= 38) + 2.0% SL', maxBarsBelow: 3, slPct: 2.0, minReentry: 38, rsiYellow: false, tpPct: 0 },
  { name: 'Combo 5: V-Shape + Re-entry >= 38 + Yellow Cross + 2.0% SL', maxBarsBelow: 3, slPct: 2.0, minReentry: 38, rsiYellow: true, tpPct: 0 },
  { name: 'Combo 6: Fast V-Shape (Max 2 bars below 35) + 2.5% SL + RSI 50', maxBarsBelow: 2, slPct: 2.5, minReentry: 36, rsiYellow: true, tpPct: 0 },
  { name: 'Combo 7: Fast V-Shape + 3.0% SL + RSI 50 Exit', maxBarsBelow: 2, slPct: 3.0, minReentry: 36, rsiYellow: true, tpPct: 0 },
  { name: 'Combo 8: Fast V-Shape + 3.0% SL + Dual Exit (RSI 50 or +1.5% TP)', maxBarsBelow: 2, slPct: 3.0, minReentry: 36, rsiYellow: true, tpPct: 1.5 },
  { name: 'Combo 9: Fast V-Shape + 2.5% SL + Dual Exit (RSI 50 or +1.2% TP)', maxBarsBelow: 2, slPct: 2.5, minReentry: 36, rsiYellow: true, tpPct: 1.2 },
  { name: 'Combo 10: Elite V-Shape (Max 1 bar dip) + 2.5% SL + RSI 50 Exit', maxBarsBelow: 1, slPct: 2.5, minReentry: 36, rsiYellow: true, tpPct: 0 },
  { name: 'Combo 11: Elite V-Shape (Max 1 bar dip) + 3.0% SL + RSI 50 Exit', maxBarsBelow: 1, slPct: 3.0, minReentry: 36, rsiYellow: true, tpPct: 0 }
];

const results = [];

for (const tc of testCombos) {
  let trades = 0, wins = 0, losses = 0, winSum = 0, lossSum = 0, totalNet = 0;

  for (const sym of symbols) {
    const { candles, tech } = symData[sym];
    const { rsi14, rsiSMA14 } = tech;

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
        } else if (inOversold && prevRSI < 35 && curRSI >= tc.minReentry) {
          if (minRSI <= 32 && c.close >= c.open) {
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

            // V-Shape Recovery Trap filter: max bars below 35
            if (tc.maxBarsBelow && barsInOversold > tc.maxBarsBelow) {
              inOversold = false; minRSI = 100; barsInOversold = 0; continue;
            }

            // RSI Yellow SMA Cross filter
            if (tc.rsiYellow && curRSI <= rsiSMA14[i]) {
              inOversold = false; minRSI = 100; barsInOversold = 0; continue;
            }

            // Enter Trade
            inTrade = true;
            entryPrice = c.close * (1 + slipRate);
            entryIdx = i;
            stopLossPrice = entryPrice * (1 - tc.slPct / 100);
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
        } else if (tc.tpPct > 0 && c.high >= entryPrice * (1 + tc.tpPct / 100)) {
          exitPrice = entryPrice * (1 + tc.tpPct / 100) * (1 - slipRate);
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
    Configuration: tc.name,
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
console.log('   SYSTEMATIC TRAP REMOVAL & WIN RATE OPTIMIZATION MATRIX');
console.log('========================================================================================\n');
console.table(results);
