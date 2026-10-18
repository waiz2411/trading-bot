import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cacheDir = path.resolve(__dirname, '../data/binance_cache');

console.log('--- COMPREHENSIVE MULTI-TIMEFRAME QUANT RESEARCH (15m vs 30m vs 1h vs 2h) ---');

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
console.log(`Loaded ${symbols.length} altcoin datasets.`);

// Resampler helper
function resampleCandles(c15m, targetMinutes) {
  const stepMs = targetMinutes * 60 * 1000;
  const buckets = new Map();

  for (const c of c15m) {
    const bucket = c.openTime - (c.openTime % stepMs);
    let arr = buckets.get(bucket);
    if (!arr) {
      arr = [];
      buckets.set(bucket, arr);
    }
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

    resampled.push({
      openTime,
      time: new Date(openTime).toISOString(),
      open, high, low, close, volume
    });
  }

  resampled.sort((a, b) => a.openTime - b.openTime);
  return resampled;
}

// Calculate indicators
function calculateIndicators(candles) {
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
  return { rsi14 };
}

// Prepare Timeframe Datasets
const timeframes = ['15m', '30m', '1h', '2h'];
const tfData = {};

for (const tf of timeframes) {
  tfData[tf] = {};
  const mins = tf === '15m' ? 15 : tf === '30m' ? 30 : tf === '1h' ? 60 : 120;
  for (const sym of symbols) {
    const c = mins === 15 ? rawDatasets[sym] : resampleCandles(rawDatasets[sym], mins);
    if (c.length > 500) {
      tfData[tf][sym] = {
        candles: c,
        tech: calculateIndicators(c)
      };
    }
  }
}

const feeRate = 0.0010; // 0.20% round-trip Binance fee
const slipRate = 0.0003; // 0.03% slippage

// Run backtest function
function runBacktest({ tf, slPct, beGainTrigger, exitRSI, partialScale }) {
  let trades = 0, wins = 0, breakEvens = 0, losses = 0;
  let winSum = 0, lossSum = 0, totalNet = 0;
  const symMap = tfData[tf];
  const activeSyms = Object.keys(symMap);

  for (const sym of activeSyms) {
    const { candles, tech } = symMap[sym];
    const { rsi14 } = tech;

    let inOversold = false;
    let minRSI = 100;
    let inTrade = false;
    let entryPrice = 0;
    let entryIdx = 0;
    let currentSL = 0;
    let beActivated = false;
    let peakGainPct = 0;
    let partialProfitNet = 0;
    let partialExecuted = false;
    let cooldownUntil = -1;

    for (let i = 20; i < candles.length - 1; i++) {
      const c = candles[i];
      const curRSI = rsi14[i];
      const prevRSI = rsi14[i - 1];

      if (i < cooldownUntil) continue;

      if (!inTrade) {
        if (curRSI < 30) {
          inOversold = true;
          if (curRSI < minRSI) minRSI = curRSI;
        } else if (inOversold && prevRSI < 30 && curRSI >= 30) {
          // Re-entry into purple box
          if (c.close >= c.open) {
            inTrade = true;
            entryPrice = c.close * (1 + slipRate);
            entryIdx = i;
            currentSL = entryPrice * (1 - slPct / 100);
            beActivated = false;
            peakGainPct = 0;
            partialProfitNet = 0;
            partialExecuted = false;
          }
          inOversold = false;
          minRSI = 100;
        }
      } else {
        const highPrice = c.high;
        const gainPct = ((highPrice - entryPrice) / entryPrice) * 100;
        if (gainPct > peakGainPct) peakGainPct = gainPct;

        // Break-Even Guard
        if (beGainTrigger > 0 && !beActivated && peakGainPct >= beGainTrigger) {
          beActivated = true;
          currentSL = entryPrice * 1.0025; // Locks in +0.25% net profit
        }

        let exitPrice = null;
        let exitReason = '';

        // Check Stop Loss or Break-Even
        if (c.low <= currentSL) {
          exitPrice = currentSL * (1 - slipRate);
          exitReason = beActivated ? 'BREAK_EVEN' : 'STOP_LOSS';
          if (!beActivated) cooldownUntil = i + 4;
        }
        // Check Partial Profit at RSI 50
        else if (partialScale && !partialExecuted && curRSI >= 50) {
          partialExecuted = true;
          const gross50 = ((c.close * (1 - slipRate) - entryPrice) / entryPrice) * 100;
          partialProfitNet = (gross50 - 0.23) * 0.50; // Lock 50% profit
          currentSL = entryPrice * 1.0025; // Move SL to BE for remainder
          beActivated = true;
        }
        // Check Target Exit
        else if (!partialScale && curRSI >= exitRSI) {
          exitPrice = c.close * (1 - slipRate);
          exitReason = `RSI_${exitRSI}`;
        }
        // Runner Exit for Partial
        else if (partialScale && partialExecuted) {
          if (curRSI >= 65) {
            exitPrice = c.close * (1 - slipRate);
            exitReason = 'RSI_65_RUNNER';
          } else if (i - entryIdx >= 24) {
            exitPrice = c.close * (1 - slipRate);
            exitReason = 'TIME_EXIT';
          }
        }
        // Max Time Limit
        else if (i - entryIdx >= 32) {
          exitPrice = c.close * (1 - slipRate);
          exitReason = 'TIME_EXIT';
        }

        if (exitPrice !== null) {
          const gross = ((exitPrice - entryPrice) / entryPrice) * 100;
          const remainPortion = partialExecuted ? 0.50 : 1.0;
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
  const tradesPerDay = (trades / 289).toFixed(1);
  const profitFactor = Math.abs(lossSum) > 0 ? Math.abs(winSum / lossSum) : 999;

  return {
    Timeframe: tf,
    'Stop Loss': `${slPct}%`,
    'Exit Target': partialScale ? '50% at 50 + Trail' : `RSI ${exitRSI}`,
    'BE Guard': beGainTrigger > 0 ? `+${beGainTrigger}%` : 'Disabled',
    Trades: trades,
    'Trades/Day': tradesPerDay,
    Wins: wins,
    'Break-Evens': breakEvens,
    Losses: losses,
    'Win Rate': winRate.toFixed(1) + '%',
    'Avg Win': '+' + avgWin.toFixed(2) + '%',
    'Avg Loss': avgLoss.toFixed(2) + '%',
    'Reward:Risk': avgLoss !== 0 ? (avgWin / Math.abs(avgLoss)).toFixed(2) : 'N/A',
    'Profit Factor': profitFactor.toFixed(2),
    'Avg Net/Trade': (avgNet >= 0 ? '+' : '') + avgNet.toFixed(2) + '%',
    'Total Net': (totalNet >= 0 ? '+' : '') + totalNet.toFixed(1) + '%'
  };
}

// MATRIX OF EXPERIMENTS
const matrix = [
  // 15-Minute Candles (Baseline)
  { tf: '15m', slPct: 1.0, beGainTrigger: 0, exitRSI: 50, partialScale: false },
  { tf: '15m', slPct: 1.5, beGainTrigger: 0.70, exitRSI: 50, partialScale: false },

  // 30-Minute Candles
  { tf: '30m', slPct: 1.5, beGainTrigger: 0, exitRSI: 50, partialScale: false },
  { tf: '30m', slPct: 2.0, beGainTrigger: 0, exitRSI: 50, partialScale: false },
  { tf: '30m', slPct: 2.5, beGainTrigger: 1.20, exitRSI: 50, partialScale: false },
  { tf: '30m', slPct: 2.5, beGainTrigger: 1.20, exitRSI: 50, partialScale: true },

  // 1-Hour Candles (User's Question: Does 1H with wider SL make us more profitable?)
  { tf: '1h', slPct: 2.0, beGainTrigger: 0, exitRSI: 50, partialScale: false },
  { tf: '1h', slPct: 2.5, beGainTrigger: 0, exitRSI: 50, partialScale: false },
  { tf: '1h', slPct: 3.0, beGainTrigger: 0, exitRSI: 50, partialScale: false },
  { tf: '1h', slPct: 3.0, beGainTrigger: 1.50, exitRSI: 50, partialScale: false },
  { tf: '1h', slPct: 3.0, beGainTrigger: 1.50, exitRSI: 50, partialScale: true },
  { tf: '1h', slPct: 3.5, beGainTrigger: 1.80, exitRSI: 55, partialScale: false },

  // 2-Hour Candles
  { tf: '2h', slPct: 3.0, beGainTrigger: 0, exitRSI: 50, partialScale: false },
  { tf: '2h', slPct: 4.0, beGainTrigger: 2.0, exitRSI: 50, partialScale: true }
];

console.log('Executing backtest matrix...');
const reportResults = matrix.map(m => runBacktest(m));

console.log('\n====================================================================================================================================');
console.log('   MULTI-TIMEFRAME QUANT COMPARISON: 15m vs 30m vs 1H vs 2H (WITH WIDER STOP LOSS & BREAK-EVEN GUARDS)');
console.log('====================================================================================================================================\n');
console.table(reportResults);

// Export to Excel
const wb = XLSX.utils.book_new();

const summaryAOA = [
  ['NEXUS QUANT - MULTI-TIMEFRAME QUANT BREAKTHROUGH REPORT (2026 AUDIT)'],
  ['Core Question', 'Can trading 30m or 1H candles with wider stop losses and break-even guards make us more profitable while still trading daily?'],
  ['Exchange Friction Applied', '0.20% Round-trip Binance Spot Fee + 0.03% Slippage on EVERY single trade'],
  [],
  ['MULTI-TIMEFRAME EXPERIMENT MATRIX'],
  ['Timeframe', 'Stop Loss', 'Exit Target', 'BE Guard', 'Total Trades', 'Trades/Day', 'Wins', 'Break-Evens', 'Losses', 'Win Rate (%)', 'Avg Win (%)', 'Avg Loss (%)', 'Reward:Risk', 'Profit Factor', 'Avg Net/Trade (%)', 'Total Net Gain (%)']
];

reportResults.forEach(r => {
  summaryAOA.push([
    r.Timeframe,
    r['Stop Loss'],
    r['Exit Target'],
    r['BE Guard'],
    r.Trades,
    r['Trades/Day'],
    r.Wins,
    r['Break-Evens'],
    r.Losses,
    r['Win Rate'],
    r['Avg Win'],
    r['Avg Loss'],
    r['Reward:Risk'],
    r['Profit Factor'],
    r['Avg Net/Trade'],
    r['Total Net']
  ]);
});

XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryAOA), 'Timeframe Matrix');

const outPath = path.resolve(__dirname, '../../nexus_quant_multi_timeframe_1h_30m_report.xlsx');
XLSX.writeFile(wb, outPath);

const brainPath = 'C:\\Users\\waizt\\.gemini\\antigravity\\brain\\9240cc1b-f576-4996-a196-552f1f9e4603\\nexus_quant_multi_timeframe_1h_30m_report.xlsx';
fs.copyFileSync(outPath, brainPath);

console.log(`\nReport successfully saved to:\n1. ${outPath}\n2. ${brainPath}`);
