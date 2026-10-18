import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cacheDir = path.resolve(__dirname, '../data/binance_cache');

console.log('Testing RSI-Conditioned Smart Trailing & Risk Engineering...');

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
  const ema9 = new Float64Array(len);
  const ema200 = new Float64Array(len);

  const k9 = 2 / 10;
  const k200 = 2 / 201;
  let e9 = closes[0], e200 = closes[0];
  for (let i = 0; i < len; i++) {
    e9 = i === 0 ? closes[i] : closes[i] * k9 + e9 * (1 - k9);
    e200 = i === 0 ? closes[i] : closes[i] * k200 + e200 * (1 - k200);
    ema9[i] = e9;
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

  return { rsi14, rsiSMA14, ema9, ema200 };
}

const symData = {};
for (const sym of symbols) {
  symData[sym] = { candles: datasets[sym], tech: calculateIndicators(datasets[sym]) };
}

const feeRate = 0.0010;
const slipRate = 0.0003;

// What if we test:
// Config 1: Pure User Baseline (Exit at RSI 50, 2% SL)
// Config 2: Intelligent Break-Even on RSI 48 (If RSI reaches 48+, move SL to Break-Even)
// Config 3: Dynamic Two-Stage Harvest:
//           - At RSI 50: Lock 50% profit immediately. Move remaining SL to Break-Even +0.25% net.
//           - For remaining 50%: Trail with EMA 9 or Exit at RSI 70.
// Config 4: Config 3 with Bull Trend filter (Close > EMA 200).
// Config 5: Dynamic Two-Stage with 70% locked at RSI 50 and 30% runner to RSI 70.

const testModels = [
  { name: '1. User Baseline (Full Exit at RSI 50, 2% SL)', type: 'BASELINE' },
  { name: '2. RSI-48 Smart Break-Even (Move SL to BE at RSI 48)', type: 'RSI48_BE' },
  { name: '3. 50% Profit at RSI 50 + Move SL to BE + Trail Runner (EMA 9)', type: 'SCALE_50_EMA9' },
  { name: '4. 70% Profit at RSI 50 + Move SL to BE + Trail Runner (RSI 70)', type: 'SCALE_70_RSI70' },
  { name: '5. Bull-Trend + 50% at RSI 50 + Trail Runner (EMA 9)', type: 'SCALE_50_EMA9', bullOnly: true },
  { name: '6. Bull-Trend + Full Exit at RSI 50 (70% Win Rate baseline)', type: 'BASELINE', bullOnly: true }
];

const results = [];

for (const tm of testModels) {
  let trades = 0, wins = 0, losses = 0, breakEvens = 0;
  let winSum = 0, lossSum = 0, totalNet = 0;

  for (const sym of symbols) {
    const { candles, tech } = symData[sym];
    const { rsi14, rsiSMA14, ema9, ema200 } = tech;

    let inOversold = false;
    let minRSI = 100;
    let barsInOversold = 0;
    let inTrade = false;
    let entryPrice = 0;
    let entryIdx = 0;
    let currentSL = 0;
    let cooldownUntilIdx = -1;
    let rsi50Reached = false;
    let partialSold = false;
    let partialProfitNet = 0;

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
          const reqMinRSI = tm.bullOnly ? 30 : 32;
          const reqMaxBars = tm.bullOnly ? 2 : 3;

          if (minRSI <= reqMinRSI && c.close >= c.open) {
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

            // V-Shape: Max bars below 35
            if (barsInOversold > reqMaxBars) {
              inOversold = false; minRSI = 100; barsInOversold = 0; continue;
            }

            // Purple RSI > Yellow SMA 14
            if (curRSI <= rsiSMA14[i]) {
              inOversold = false; minRSI = 100; barsInOversold = 0; continue;
            }

            // Bull Trend filter
            if (tm.bullOnly && c.close <= ema200[i]) {
              inOversold = false; minRSI = 100; barsInOversold = 0; continue;
            }

            // Enter Trade
            inTrade = true;
            entryPrice = c.close * (1 + slipRate);
            entryIdx = i;
            currentSL = entryPrice * 0.98; // 2.0% SL
            rsi50Reached = false;
            partialSold = false;
            partialProfitNet = 0;
          }

          inOversold = false;
          minRSI = 100;
          barsInOversold = 0;
        }
      } else {
        // --- IN-TRADE LOGIC ---
        // RSI-48 Smart Break-Even
        if (tm.type === 'RSI48_BE' && !rsi50Reached && curRSI >= 48) {
          const beSL = entryPrice * 1.0020;
          if (beSL > currentSL) currentSL = beSL;
        }

        let exitPrice = null;

        // Check SL
        if (c.low <= currentSL) {
          exitPrice = currentSL * (1 - slipRate);
          if (!partialSold && currentSL < entryPrice) cooldownUntilIdx = i + 8;
        }
        // Baseline Model: Full exit at RSI 50
        else if (tm.type === 'BASELINE' || tm.type === 'RSI48_BE') {
          if (curRSI >= 50) exitPrice = c.close * (1 - slipRate);
          else if (i - entryIdx >= 32) exitPrice = c.close * (1 - slipRate);
        }
        // Two-Stage Scaling Models
        else if (tm.type === 'SCALE_50_EMA9' || tm.type === 'SCALE_70_RSI70') {
          const lockPortion = tm.type === 'SCALE_70_RSI70' ? 0.70 : 0.50;

          if (!rsi50Reached && curRSI >= 50) {
            rsi50Reached = true;
            partialSold = true;
            const gross50 = ((c.close * (1 - slipRate) - entryPrice) / entryPrice) * 100;
            partialProfitNet = (gross50 - 0.23) * lockPortion;
            // Move SL to Break-Even for remaining position
            currentSL = entryPrice * 1.0020;
          } else if (partialSold) {
            if (tm.type === 'SCALE_70_RSI70' && curRSI >= 68) {
              exitPrice = c.close * (1 - slipRate);
            } else if (tm.type === 'SCALE_50_EMA9' && c.close < ema9[i]) {
              exitPrice = c.close * (1 - slipRate);
            } else if (i - entryIdx >= 32) {
              exitPrice = c.close * (1 - slipRate);
            }
          } else if (i - entryIdx >= 32) {
            exitPrice = c.close * (1 - slipRate);
          }
        }

        if (exitPrice !== null) {
          const gross = ((exitPrice - entryPrice) / entryPrice) * 100;
          const remainPortion = partialSold ? (1.0 - (tm.type === 'SCALE_70_RSI70' ? 0.70 : 0.50)) : 1.0;
          const net = partialProfitNet + ((gross - 0.23) * remainPortion);

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

  results.push({
    Model: tm.name,
    Trades: trades,
    Wins: wins,
    BreakEvens: breakEvens,
    Losses: losses,
    'Win Rate': winRate.toFixed(1) + '%',
    'Avg Win': '+' + avgWin.toFixed(2) + '%',
    'Avg Loss': avgLoss.toFixed(2) + '%',
    'Profit Factor': profitFactor.toFixed(2),
    'Avg Net/Trade': (avgNet >= 0 ? '+' : '') + avgNet.toFixed(2) + '%',
    'Total Net': (totalNet >= 0 ? '+' : '') + totalNet.toFixed(1) + '%'
  });
}

console.log('\n========================================================================================');
console.log('   RSI-CONDITIONED SMART TRAILING & BREAK-EVEN RESULTS');
console.log('========================================================================================\n');
console.table(results);
