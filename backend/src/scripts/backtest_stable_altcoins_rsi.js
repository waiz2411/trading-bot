import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cacheDir = path.resolve(__dirname, '../data/binance_cache');

// Definitive list of stable, high-liquidity, institutional-grade altcoins (low ATR, smooth price action)
const STABLE_ALTCOINS = [
  'ETHUSDT',
  'BNBUSDT',
  'SOLUSDT',
  'XRPUSDT',
  'LTCUSDT',
  'BCHUSDT',
  'LINKUSDT',
  'ADAUSDT',
  'DOTUSDT',
  'AVAXUSDT',
  'XLMUSDT',
  'NEARUSDT'
];

console.log('Loading 2026 data for Stable Blue-Chip Altcoins...');
const datasets = {};

for (const sym of STABLE_ALTCOINS) {
  const p = path.join(cacheDir, `${sym}_15m_60d.json`);
  if (!fs.existsSync(p)) continue;
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
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
  } catch(e) {}
}

const activeSymbols = Object.keys(datasets);
console.log(`Loaded ${activeSymbols.length} stable altcoins:`, activeSymbols.join(', '));

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

function runStableBacktest(opts) {
  const { slType, maxSlPct, fixedSlPct, cooldownBars } = opts;
  const allTrades = [];
  const perCoinStats = {};
  let totalGrossGain = 0;
  let totalNetGain = 0;
  let wins = 0;
  let losses = 0;
  let winAmounts = [];
  let lossAmounts = [];

  for (const sym of activeSymbols) {
    const candles = datasets[sym];
    const { rsi14 } = calculateIndicators(candles);

    perCoinStats[sym] = { trades: 0, wins: 0, losses: 0, netSum: 0 };

    let inOversold = false;
    let minRSI = 100;
    let dipLowestPrice = Infinity;
    let inTrade = false;
    let entryPrice = 0;
    let entryIdx = 0;
    let stopLossPrice = 0;
    let cooldownUntilIdx = -1;

    for (let i = 25; i < candles.length - 1; i++) {
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
            inTrade = true;
            entryPrice = c.close * (1 + slipRate);
            entryIdx = i;

            if (slType === 'swing_low') {
              const swingSL = dipLowestPrice * 0.998;
              const maxSL = entryPrice * (1 - maxSlPct / 100);
              stopLossPrice = Math.max(swingSL, maxSL);
            } else {
              stopLossPrice = entryPrice * (1 - fixedSlPct / 100);
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
          cooldownUntilIdx = i + cooldownBars;
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
          perCoinStats[sym].trades++;
          perCoinStats[sym].netSum += netGainPct;

          if (netGainPct > 0) {
            wins++;
            perCoinStats[sym].wins++;
            winAmounts.push(netGainPct);
          } else {
            losses++;
            perCoinStats[sym].losses++;
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
    name: opts.name,
    totalTrades,
    wins,
    losses,
    winRate: winRate.toFixed(1) + '%',
    avgWin: '+' + avgWin.toFixed(2) + '%',
    avgLoss: avgLoss.toFixed(2) + '%',
    avgNet: (avgNet >= 0 ? '+' : '') + avgNet.toFixed(2) + '%',
    totalNetGain: (totalNetGain >= 0 ? '+' : '') + totalNetGain.toFixed(1) + '%',
    allTrades,
    perCoinStats
  };
}

const variants = [
  { name: 'Stable Altcoins: Swing Low SL (max 1.5%) + 2h Cooldown', slType: 'swing_low', maxSlPct: 1.5, cooldownBars: 8 },
  { name: 'Stable Altcoins: Swing Low SL (max 2.0%) + 2h Cooldown', slType: 'swing_low', maxSlPct: 2.0, cooldownBars: 8 },
  { name: 'Stable Altcoins: Fixed 1.0% SL + 2h Cooldown', slType: 'fixed', fixedSlPct: 1.0, cooldownBars: 8 }
];

const results = variants.map(runStableBacktest);

console.log('\n========================================================================================');
console.log('   STABLE BLUE-CHIP ALTCOINS AUDIT (ETH, BNB, SOL, XRP, LTC, BCH, LINK, ADA, etc.)');
console.log('   Strategy: RSI 35 Re-Entry -> RSI 50 Midline Exit | 2-Hour Cooldown | Full 2026 Year');
console.log('========================================================================================\n');

console.table(results.map(r => ({
  Variant: r.name,
  Trades: r.totalTrades,
  Wins: r.wins,
  Losses: r.losses,
  'Win Rate': r.winRate,
  'Avg Win': r.avgWin,
  'Avg Loss': r.avgLoss,
  'Avg Net/Trade': r.avgNet,
  'Total Net ROI': r.totalNetGain
})));

// Detailed per-coin table for Variant 1
const best = results[0];
console.log('\n--- PERFORMANCE BREAKDOWN BY STABLE ALTCOIN ---');
const coinTable = activeSymbols.map(s => {
  const st = best.perCoinStats[s] || { trades: 0, wins: 0, losses: 0, netSum: 0 };
  const wr = st.trades > 0 ? ((st.wins / st.trades) * 100).toFixed(1) + '%' : 'N/A';
  return {
    Coin: s,
    Trades: st.trades,
    Wins: st.wins,
    Losses: st.losses,
    'Win Rate': wr,
    'Net Gain (%)': (st.netSum >= 0 ? '+' : '') + st.netSum.toFixed(1) + '%'
  };
});
console.table(coinTable);

// Export Excel report
const wb = XLSX.utils.book_new();

const summaryRows = [
  ['NEXUS QUANT - STABLE BLUE-CHIP ALTCOIN AUDIT (2026 FULL YEAR)'],
  ['Selected Stable Universe', activeSymbols.join(', ')],
  ['Strategy Rules', 'RSI 14 dips < 32 then re-enters >= 35 | Exit on RSI 50 Midline touch'],
  ['Cooldown Rule', '2-Hour Lockout on any coin that hits Stop Loss'],
  ['Friction Modeled', '0.20% Round-trip Binance Spot Fee + 0.03% Slippage per trade'],
  [],
  ['PERFORMANCE SUMMARY'],
  ['Variant', 'Total Trades', 'Wins', 'Losses', 'Win Rate (%)', 'Avg Win (Net)', 'Avg Loss (Net)', 'Avg Net / Trade', 'Total Net Return (%)']
];

results.forEach(r => {
  summaryRows.push([r.name, r.totalTrades, r.wins, r.losses, r.winRate, r.avgWin, r.avgLoss, r.avgNet, r.totalNetGain]);
});

summaryRows.push([]);
summaryRows.push(['INDIVIDUAL STABLE ALTCOIN BREAKDOWN']);
summaryRows.push(['Coin', 'Trades', 'Wins', 'Losses', 'Win Rate (%)', 'Net Gain (%)']);
coinTable.forEach(c => {
  summaryRows.push([c.Coin, c.Trades, c.Wins, c.Losses, c['Win Rate'], c['Net Gain (%)']]);
});

XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), 'Stable Altcoins Summary');

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
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(tradeRows), 'Stable Coin Trades');

const outPath = path.resolve(__dirname, '../../nexus_quant_stable_altcoins_rsi_report.xlsx');
XLSX.writeFile(wb, outPath);

// Copy to brain directory
const brainPath = 'C:\\Users\\waizt\\.gemini\\antigravity\\brain\\9240cc1b-f576-4996-a196-552f1f9e4603\\nexus_quant_stable_altcoins_rsi_report.xlsx';
fs.copyFileSync(outPath, brainPath);
console.log(`\nExcel Report saved to: ${outPath}`);
console.log(`Copied to brain directory: ${brainPath}`);
