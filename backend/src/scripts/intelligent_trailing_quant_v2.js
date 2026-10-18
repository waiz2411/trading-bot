import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cacheDir = path.resolve(__dirname, '../data/binance_cache');

console.log('Testing Intelligent Wide-Buffer Trailing & Target Scaling Engine...');

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

  // EMA 9 & EMA 200
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

// Configurations testing:
// Strategy A: BE Trigger at +1.2% (wide buffer so trade isn't suffocated)
// Strategy B: BE Trigger when RSI touches 50 (take 50% profit at RSI 50, move rest to BE)
// Strategy C: Dynamic Two-Stage Exit: 
//             - Stage 1: Sell 60% at RSI 50
//             - Stage 2: Trail remaining 40% with 2-candle lowest low or RSI 70
// Strategy D: Bull-Trend Only + Two-Stage Trailing Profit
// Strategy E: High Momentum Only + Two-Stage Trailing Profit

const strategies = [
  { name: 'A. Wide BE (+1.2% Trigger -> SL to Entry + 0.2%)', beTrigger: 1.2, scaleAtRSI50: false, bullOnly: false },
  { name: 'B. At RSI 50: Sell 50% Profit + Move SL to BE', beTrigger: 0, scaleAtRSI50: true, trailMethod: 'SWING_LOW', bullOnly: false },
  { name: 'C. At RSI 50: Sell 70% Profit + Trail 30% to RSI 70', beTrigger: 0, scaleAtRSI50: true, takePct: 0.70, trailMethod: 'RSI_70', bullOnly: false },
  { name: 'D. Bull Trend (Close > EMA200) + 50% at RSI 50 + Trail 50%', beTrigger: 0, scaleAtRSI50: true, bullOnly: true, trailMethod: 'EMA9' },
  { name: 'E. Bull Trend + Wide BE (+1.2%) + Full RSI 50 Exit', beTrigger: 1.2, scaleAtRSI50: false, bullOnly: true }
];

const results = [];

for (const strat of strategies) {
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
    let peakGainPct = 0;
    let beActivated = false;
    let partialProfitNet = 0;
    let partialExecuted = false;

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

            // V-Shape: Max 3 bars below 35
            if (barsInOversold > 3) {
              inOversold = false; minRSI = 100; barsInOversold = 0; continue;
            }

            // Purple RSI > Yellow SMA 14
            if (curRSI <= rsiSMA14[i]) {
              inOversold = false; minRSI = 100; barsInOversold = 0; continue;
            }

            // Bull Trend filter if requested
            if (strat.bullOnly && c.close <= ema200[i]) {
              inOversold = false; minRSI = 100; barsInOversold = 0; continue;
            }

            // Enter Trade
            inTrade = true;
            entryPrice = c.close * (1 + slipRate);
            entryIdx = i;
            currentSL = entryPrice * 0.985; // 1.5% Initial SL
            peakGainPct = 0;
            beActivated = false;
            partialProfitNet = 0;
            partialExecuted = false;
          }

          inOversold = false;
          minRSI = 100;
          barsInOversold = 0;
        }
      } else {
        const highPrice = c.high;
        const candleGainPct = ((highPrice - entryPrice) / entryPrice) * 100;
        if (candleGainPct > peakGainPct) peakGainPct = candleGainPct;

        // Wide BE Trigger (+1.2%)
        if (strat.beTrigger > 0 && !beActivated && peakGainPct >= strat.beTrigger) {
          beActivated = true;
          const beSL = entryPrice * 1.0020; // Lock Entry + fees
          if (beSL > currentSL) currentSL = beSL;
        }

        let exitPrice = null;
        let exitReason = '';

        // Check SL
        if (c.low <= currentSL) {
          exitPrice = currentSL * (1 - slipRate);
          exitReason = beActivated ? 'BREAK_EVEN_EXIT' : 'STOP_LOSS';
          if (!beActivated) cooldownUntilIdx = i + 8;
        }
        // Partial scale at RSI 50
        else if (strat.scaleAtRSI50 && !partialExecuted && curRSI >= 50) {
          partialExecuted = true;
          const takePortion = strat.takePct || 0.50;
          const gross50 = ((c.close * (1 - slipRate) - entryPrice) / entryPrice) * 100;
          partialProfitNet = (gross50 - 0.23) * takePortion;
          // Set SL to break-even for remaining position
          currentSL = entryPrice * 1.0020;
          beActivated = true;
        }
        // Full exit at RSI 50 for non-scaling
        else if (!strat.scaleAtRSI50 && curRSI >= 50) {
          exitPrice = c.close * (1 - slipRate);
          exitReason = 'RSI_50';
        }
        // Runner exit for scaling models
        else if (strat.scaleAtRSI50 && partialExecuted) {
          if (strat.trailMethod === 'RSI_70' && curRSI >= 68) {
            exitPrice = c.close * (1 - slipRate);
            exitReason = 'RSI_70_OVERBOUGHT';
          } else if (strat.trailMethod === 'EMA9' && c.close < ema9[i] && peakGainPct >= 1.5) {
            exitPrice = c.close * (1 - slipRate);
            exitReason = 'TRAIL_EMA9';
          } else if (strat.trailMethod === 'SWING_LOW') {
            const swingLow = Math.min(candles[i - 1].low, candles[i - 2].low);
            if (swingLow > currentSL) currentSL = swingLow;
          }
        }
        // Max time stop
        else if (i - entryIdx >= 32) {
          exitPrice = c.close * (1 - slipRate);
          exitReason = 'TIME_EXIT';
        }

        if (exitPrice !== null) {
          const gross = ((exitPrice - entryPrice) / entryPrice) * 100;
          const remainPortion = partialExecuted ? (1.0 - (strat.takePct || 0.50)) : 1.0;
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
    Strategy: strat.name,
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
console.log('   INTELLIGENT TRAILING & SCALING RESULTS');
console.log('========================================================================================\n');
console.table(results);
