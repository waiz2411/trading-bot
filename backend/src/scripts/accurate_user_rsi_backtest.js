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
  if (sym === 'BTCUSDT' || sym === 'PAXGUSDT') continue;
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

  // ATR (14)
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

const feeRate = 0.0010; // 0.10% each way = 0.20% round trip
const slipRate = 0.0003; // 0.03% execution slippage

// Run clean backtest on every coin without artificial bottlenecks
function backtestTrueUserStrategy(slOption) {
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

    for (let i = 25; i < candles.length - 1; i++) {
      const c = candles[i];
      const curRSI = rsi14[i];
      const prevRSI = rsi14[i - 1];

      if (!inTrade) {
        // Track the dip when purple line goes below 35
        if (curRSI < 35) {
          inOversold = true;
          if (curRSI < minRSI) minRSI = curRSI;
          if (c.low < dipLowestPrice) dipLowestPrice = c.low;
        } 
        // Re-entry into purple area (crosses >= 35)
        else if (inOversold && prevRSI < 35 && curRSI >= 35) {
          // Rule 1: Must have been a real dip (RSI dropped below 32, not a micro wiggle)
          if (minRSI <= 32) {
            // Rule 2: Killer of Screenshot 2 (No tiny dead candles!)
            const candleRangePct = ((c.high - c.low) / c.close) * 100;
            const atrPct = (atr14[i] / c.close) * 100;

            // Active coin and real candle body (not a dead doji)
            if (candleRangePct >= 0.40 && atrPct >= 0.40 && c.close >= c.open) {
              inTrade = true;
              entryPrice = c.close * (1 + slipRate);
              entryIdx = i;

              // Stop Loss logic
              if (slOption.type === 'swing_low') {
                const swingSL = dipLowestPrice * 0.998; // 0.2% below lowest wick
                const maxSL = entryPrice * (1 - slOption.maxPct / 100);
                stopLossPrice = Math.max(swingSL, maxSL);
              } else {
                stopLossPrice = entryPrice * (1 - slOption.fixedPct / 100);
              }
            }
          }

          // Reset oversold tracking
          inOversold = false;
          minRSI = 100;
          dipLowestPrice = Infinity;
        }
      } else {
        // We are IN TRADE
        let exitPrice = null;
        let exitReason = null;

        // 1. Check Stop Loss
        if (c.low <= stopLossPrice) {
          exitPrice = stopLossPrice * (1 - slipRate);
          exitReason = 'STOP_LOSS';
        }
        // 2. Check RSI Middle Dotted Line (50) Touch (Take Profit!)
        else if (curRSI >= 50) {
          exitPrice = c.close * (1 - slipRate);
          exitReason = 'RSI_50_MIDLINE';
        }
        // 3. Max hold timeout (32 bars = 8h)
        else if (i - entryIdx >= 32) {
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
            durationMin: (i - entryIdx) * 15,
            monthKey: candles[entryIdx].time.slice(0, 7)
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
    name: slOption.name,
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

console.log('Testing Variant A: Swing Low SL (max 1.5% cap)...');
const resSwing15 = backtestTrueUserStrategy({ name: 'Swing Low SL (max 1.5% cap)', type: 'swing_low', maxPct: 1.5 });

console.log('Testing Variant B: Swing Low SL (max 2.0% cap)...');
const resSwing20 = backtestTrueUserStrategy({ name: 'Swing Low SL (max 2.0% cap)', type: 'swing_low', maxPct: 2.0 });

console.log('Testing Variant C: Fixed 1.0% SL...');
const resFixed10 = backtestTrueUserStrategy({ name: 'Fixed 1.0% SL', type: 'fixed', fixedPct: 1.0 });

console.log('\n========================================================================================');
console.log('   ACCURATE UNBOTTLENECKED AUDIT: USER RSI 35 RE-ENTRY -> 50 MIDLINE EXIT');
console.log('   Testing across 93 Binance Altcoins (Full 2026 History)');
console.log('========================================================================================\n');

console.table([
  {
    Variant: resSwing15.name,
    Trades: resSwing15.totalTrades,
    Wins: resSwing15.wins,
    Losses: resSwing15.losses,
    'Win Rate': resSwing15.winRate,
    'Avg Win': resSwing15.avgWin,
    'Avg Loss': resSwing15.avgLoss,
    'Avg Net/Trade': resSwing15.avgNet,
    'Total Net ROI': resSwing15.totalNetGain
  },
  {
    Variant: resSwing20.name,
    Trades: resSwing20.totalTrades,
    Wins: resSwing20.wins,
    Losses: resSwing20.losses,
    'Win Rate': resSwing20.winRate,
    'Avg Win': resSwing20.avgWin,
    'Avg Loss': resSwing20.avgLoss,
    'Avg Net/Trade': resSwing20.avgNet,
    'Total Net ROI': resSwing20.totalNetGain
  },
  {
    Variant: resFixed10.name,
    Trades: resFixed10.totalTrades,
    Wins: resFixed10.wins,
    Losses: resFixed10.losses,
    'Win Rate': resFixed10.winRate,
    'Avg Win': resFixed10.avgWin,
    'Avg Loss': resFixed10.avgLoss,
    'Avg Net/Trade': resFixed10.avgNet,
    'Total Net ROI': resFixed10.totalNetGain
  }
]);

// Check ZKUSDT trades in the accurate results
const zkTrades = resSwing15.allTrades.filter(t => t.symbol === 'ZKUSDT');
console.log('\nSample ZKUSDT Trades in Accurate Engine:');
console.table(zkTrades.slice(-5));

// Export clean Excel report
const wb = XLSX.utils.book_new();

const best = resSwing15;
const summaryRows = [
  ['NEXUS QUANT - ACCURATE USER RSI 35 RE-ENTRY -> RSI 50 MIDLINE AUDIT'],
  ['Strategy Rules', '15m RSI(14) dips < 32 then re-enters >= 35 | Exit on RSI 50 Midline touch'],
  ['Small Candle Killer', 'ATR >= 0.40% | Range >= 0.40% | Green Bullish Candle'],
  ['Friction Modeled', '0.20% Round-trip Binance Spot Fee + 0.03% Slippage per trade'],
  ['Universe', `${symbols.length} Binance Halal Altcoins (Full 2026 Year)`],
  [],
  ['PERFORMANCE COMPARISON ACROSS STOP LOSS MODES'],
  ['Variant', 'Total Trades', 'Wins', 'Losses', 'Win Rate', 'Avg Win (Net)', 'Avg Loss (Net)', 'Avg Net / Trade', 'Total Net Return (%)'],
  [resSwing15.name, resSwing15.totalTrades, resSwing15.wins, resSwing15.losses, resSwing15.winRate, resSwing15.avgWin, resSwing15.avgLoss, resSwing15.avgNet, resSwing15.totalNetGain],
  [resSwing20.name, resSwing20.totalTrades, resSwing20.wins, resSwing20.losses, resSwing20.winRate, resSwing20.avgWin, resSwing20.avgLoss, resSwing20.avgNet, resSwing20.totalNetGain],
  [resFixed10.name, resFixed10.totalTrades, resFixed10.wins, resFixed10.losses, resFixed10.winRate, resFixed10.avgWin, resFixed10.avgLoss, resFixed10.avgNet, resFixed10.totalNetGain]
];

XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), 'Overview');

// Trade Log
const tradeHeaders = ['Trade #', 'Symbol', 'Entry Time (UTC)', 'Exit Time (UTC)', 'Duration (min)', 'Entry Price', 'Exit Price', 'Exit Reason', 'Gross Return (%)', 'Net Return (%)'];
const tradeRows = [tradeHeaders];
best.allTrades.forEach((t, i) => {
  tradeRows.push([
    i + 1,
    t.symbol,
    t.entryTime,
    t.exitTime,
    t.durationMin,
    t.entryPrice,
    t.exitPrice,
    t.exitReason,
    Number(t.grossGainPct.toFixed(2)),
    Number(t.netGainPct.toFixed(2))
  ]);
});
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(tradeRows), 'Accurate Trades Log');

const outPath = path.resolve(__dirname, '../../nexus_quant_accurate_user_rsi_audit.xlsx');
XLSX.writeFile(wb, outPath);

// Copy to brain directory
const brainPath = 'C:\\Users\\waizt\\.gemini\\antigravity\\brain\\9240cc1b-f576-4996-a196-552f1f9e4603\\nexus_quant_accurate_user_rsi_audit.xlsx';
fs.copyFileSync(outPath, brainPath);
console.log(`\nExcel Report saved to: ${outPath}`);
console.log(`Copied to brain directory: ${brainPath}`);
