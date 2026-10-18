import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cacheDir = path.resolve(__dirname, '../data/binance_cache');

console.log('Loading 2026 Binance 15m historical candles...');
const files = fs.readdirSync(cacheDir).filter(f => f.endsWith('.json'));
const datasets = {};

for (const file of files) {
  const sym = file.split('_')[0];
  if (sym === 'BTCUSDT' || sym === 'PAXGUSDT' || sym === 'FDUSDUSDT' || sym === 'USDCUSDT') continue;
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

const symbols = Object.keys(datasets);
console.log(`Loaded ${symbols.length} altcoin datasets.`);

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

  let trSum = 0;
  for (let i = 1; i <= 14 && i < len; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    );
    trSum += tr;
  }
  let prevATR = trSum / 14;
  atr14[14] = prevATR;
  for (let i = 15; i < len; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    );
    prevATR = (prevATR * 13 + tr) / 14;
    atr14[i] = prevATR;
  }

  return { rsi14, atr14 };
}

const feeRate = 0.0010; // 0.10% each way = 0.20%
const slipRate = 0.0003;

function runStrategyWithTrapFilters(filterConfig) {
  const { killTrap1_Compression, killTrap2_GiantRed, trap2Threshold, trap1Period, slType, maxSlPct } = filterConfig;
  const allTrades = [];
  let totalGrossGain = 0;
  let totalNetGain = 0;
  let wins = 0;
  let losses = 0;
  let winAmounts = [];
  let lossAmounts = [];

  for (const sym of symbols) {
    const candles = datasets[sym];
    const { rsi14, atr14 } = calculateIndicators(candles);

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
          if (minRSI <= 32 && c.close >= c.open) {
            
            let skipTrade = false;

            // TRAP 1 KILLER: Coin was stuck in small candles (tight consolidation) for a long time and just started moving down!
            if (killTrap1_Compression) {
              // Check the previous 20-30 candles (before the dip began)
              const lookback = trap1Period || 24; // 6 hours of consolidation
              let smallCandleCount = 0;
              for (let k = 1; k <= lookback; k++) {
                const prevBar = candles[i - k];
                const prevRangePct = ((prevBar.high - prevBar.low) / prevBar.close) * 100;
                // If candle range was tiny (< 0.35%)
                if (prevRangePct < 0.35) smallCandleCount++;
              }
              // If more than 60% of past candles were dead micro-candles, coin is breaking out of compression!
              if (smallCandleCount / lookback >= 0.60) {
                skipTrade = true;
              }
            }

            // TRAP 2 KILLER: Placed order after a giant single red candle followed by a slight pump!
            if (!skipTrade && killTrap2_GiantRed) {
              const thresh = trap2Threshold || 1.8; // e.g. 1.8% single candle dump
              for (let k = 1; k <= 4; k++) {
                const pastBar = candles[i - k];
                const redDropPct = ((pastBar.open - pastBar.close) / pastBar.open) * 100;
                // Giant red liquidation dump detected!
                if (pastBar.close < pastBar.open && redDropPct >= thresh) {
                  skipTrade = true;
                  break;
                }
              }
            }

            if (!skipTrade) {
              inTrade = true;
              entryPrice = c.close * (1 + slipRate);
              entryIdx = i;

              if (slType === 'swing_low') {
                const swingSL = dipLowestPrice * 0.998;
                const maxSL = entryPrice * (1 - maxSlPct / 100);
                stopLossPrice = Math.max(swingSL, maxSL);
              } else {
                stopLossPrice = entryPrice * (1 - 0.01); // 1.0%
              }
            }
          }

          inOversold = false;
          minRSI = 100;
          dipLowestPrice = Infinity;
        }
      } else {
        let exitPrice = null;
        let exitReason = null;

        if (c.low <= stopLossPrice) {
          exitPrice = stopLossPrice * (1 - slipRate);
          exitReason = 'STOP_LOSS';
          cooldownUntilIdx = i + 8; // 2 hour cooldown after SL
        } else if (curRSI >= 50) {
          exitPrice = c.close * (1 - slipRate);
          exitReason = 'RSI_50_MIDLINE';
        } else if (i - entryIdx >= 32) {
          exitPrice = c.close * (1 - slipRate);
          exitReason = 'TIMEOUT_8H';
        }

        if (exitPrice !== null) {
          const grossGainPct = ((exitPrice - entryPrice) / entryPrice) * 100;
          const netGainPct = grossGainPct - (feeRate * 2 * 100) - (slipRate * 100);

          totalGrossGain += grossGainPct;
          totalNetGain += netGainPct;

          if (netGainPct > 0) {
            wins++;
            winAmounts.push(netGainPct);
          } else {
            losses++;
            lossAmounts.push(netGainPct);
          }

          allTrades.push({
            symbol: sym,
            entryTime: candles[entryIdx].time,
            exitTime: c.time,
            entryPrice,
            exitPrice,
            exitReason,
            grossGainPct,
            netGainPct,
            durationMin: (i - entryIdx) * 15
          });

          inTrade = false;
          inOversold = false;
          minRSI = 100;
          dipLowestPrice = Infinity;
        }
      }
    }
  }

  const totalTrades = allTrades.length;
  const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
  const avgWin = wins > 0 ? (winAmounts.reduce((a, b) => a + b, 0) / wins) : 0;
  const avgLoss = losses > 0 ? (lossAmounts.reduce((a, b) => a + b, 0) / losses) : 0;
  const avgNet = totalTrades > 0 ? totalNetGain / totalTrades : 0;

  return {
    name: filterConfig.name,
    totalTrades,
    wins,
    losses,
    winRate: winRate.toFixed(1) + '%',
    avgWin: '+' + avgWin.toFixed(2) + '%',
    avgLoss: avgLoss.toFixed(2) + '%',
    avgNet: (avgNet >= 0 ? '+' : '') + avgNet.toFixed(2) + '%',
    totalNetGain: (totalNetGain >= 0 ? '+' : '') + totalNetGain.toFixed(1) + '%',
    allTrades
  };
}

console.log('Testing impact of Trap 1 (Stuck in small candles) and Trap 2 (Giant Red Dump)...');

const tests = [
  {
    name: '1. Baseline (With 2h Cooldown, No Trap Filters)',
    killTrap1_Compression: false,
    killTrap2_GiantRed: false,
    slType: 'swing_low',
    maxSlPct: 1.5
  },
  {
    name: '2. + Kill Trap 1 (Filter Breakout from Small-Candle Consolidation)',
    killTrap1_Compression: true,
    killTrap2_GiantRed: false,
    trap1Period: 24,
    slType: 'swing_low',
    maxSlPct: 1.5
  },
  {
    name: '3. + Kill Trap 2 (Filter Giant Red Candle >= 1.8% Flash Dump)',
    killTrap1_Compression: false,
    killTrap2_GiantRed: true,
    trap2Threshold: 1.8,
    slType: 'swing_low',
    maxSlPct: 1.5
  },
  {
    name: '4. + Kill BOTH Trap 1 & Trap 2 (Conservative: Giant Red >= 1.5%)',
    killTrap1_Compression: true,
    killTrap2_GiantRed: true,
    trap1Period: 24,
    trap2Threshold: 1.5,
    slType: 'swing_low',
    maxSlPct: 1.5
  },
  {
    name: '5. + Kill BOTH Trap 1 & Trap 2 (Strict: Giant Red >= 1.2%)',
    killTrap1_Compression: true,
    killTrap2_GiantRed: true,
    trap1Period: 24,
    trap2Threshold: 1.2,
    slType: 'swing_low',
    maxSlPct: 1.5
  }
];

const results = tests.map(runStrategyWithTrapFilters);

console.log('\n========================================================================================');
console.log('   AUDIT: KILLING THE 2 SPECIFIC TRAPS IDENTIFIED BY USER (FULL 2026 DATASET)');
console.log('   Trap 1: Coin stuck between small candles for long time, then starts moving');
console.log('   Trap 2: One giant red candle followed by a slight pump');
console.log('========================================================================================\n');

console.table(results.map(r => ({
  Configuration: r.name,
  Trades: r.totalTrades,
  Wins: r.wins,
  Losses: r.losses,
  'Win Rate': r.winRate,
  'Avg Win': r.avgWin,
  'Avg Loss': r.avgLoss,
  'Avg Net/Trade': r.avgNet,
  'Total Net Gain': r.totalNetGain
})));

// Export Excel report
const wb = XLSX.utils.book_new();

const summaryRows = [
  ['NEXUS QUANT - ELIMINATING THE 2 SPECIFIC TRAPS (2026 FULL YEAR AUDIT)'],
  ['Trap 1 Identified by User', 'Coins stuck in small micro-candles for a long time that break down into a new trend'],
  ['Trap 2 Identified by User', 'One massive red liquidation candle followed by a slight pump'],
  ['Cooldown Rule', '2-Hour Lockout on any coin hitting Stop Loss'],
  ['Fees & Slippage', '0.20% Round-trip Binance Spot Fee + 0.03% Slippage per trade'],
  [],
  ['TRAP FILTER COMPARISON SUMMARY'],
  ['Configuration', 'Total Trades', 'Wins', 'Losses', 'Win Rate (%)', 'Avg Win (Net)', 'Avg Loss (Net)', 'Avg Net / Trade', 'Total Net Gain (%)']
];

results.forEach(r => {
  summaryRows.push([r.name, r.totalTrades, r.wins, r.losses, r.winRate, r.avgWin, r.avgLoss, r.avgNet, r.totalNetGain]);
});

XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), 'Trap Filters Summary');

const outPath = path.resolve(__dirname, '../../nexus_quant_trap_filters_audit.xlsx');
XLSX.writeFile(wb, outPath);

// Copy to brain directory for user
const brainPath = 'C:\\Users\\waizt\\.gemini\\antigravity\\brain\\9240cc1b-f576-4996-a196-552f1f9e4603\\nexus_quant_trap_filters_audit.xlsx';
fs.copyFileSync(outPath, brainPath);
console.log(`\nExcel Report saved to: ${outPath}`);
console.log(`Copied to brain directory: ${brainPath}`);
