import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cacheDir = path.resolve(__dirname, '../data/binance_cache');

console.log('Loading 2026 15m Binance Altcoin Data...');
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
  const ema9 = new Float64Array(len);

  // EMA 9 (Orange line on user's chart)
  const k9 = 2 / 10;
  let e9 = closes[0];
  for (let i = 0; i < len; i++) {
    e9 = i === 0 ? closes[i] : closes[i] * k9 + e9 * (1 - k9);
    ema9[i] = e9;
  }

  // RSI 14
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

  // ATR 14
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

  return { rsi14, atr14, ema9 };
}

const symData = {};
for (const sym of symbols) {
  const c = datasets[sym];
  symData[sym] = { candles: c, tech: calculateIndicators(c), timeMap: new Map() };
  c.forEach((item, idx) => symData[sym].timeMap.set(item.openTime, idx));
}

// Master timeline from BTC or most liquid alt
const timeline = datasets['ETHUSDT'] ? datasets['ETHUSDT'].map(c => c.openTime) : datasets[symbols[0]].map(c => c.openTime);

const feeRate = 0.0010; // 0.10% each way = 0.20% round trip
const slipRate = 0.0003; // 0.03% execution slippage

// Run simulation with concurrent position management and monthly compounding
function runRefinedBacktest(slConfig) {
  const { slMode, maxSlPct } = slConfig;
  let balance = 100.0;
  let activeTrades = [];
  const closedTrades = [];
  const monthlyData = {};

  for (let tIdx = 50; tIdx < timeline.length; tIdx++) {
    const openTime = timeline[tIdx];
    const date = new Date(openTime);
    const monthKey = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

    if (!monthlyData[monthKey]) {
      monthlyData[monthKey] = {
        month: monthKey,
        startBalance: balance,
        trades: 0,
        wins: 0,
        losses: 0,
        netProfitDollar: 0
      };
    }

    // 1. Manage Active Positions
    for (let pIdx = activeTrades.length - 1; pIdx >= 0; pIdx--) {
      const pos = activeTrades[pIdx];
      const sObj = symData[pos.symbol];
      if (!sObj) continue;
      const cIdx = sObj.timeMap.get(openTime);
      if (cIdx === undefined) continue;

      const c = sObj.candles[cIdx];
      const curRSI = sObj.tech.rsi14[cIdx];
      pos.barsHeld++;

      let exitPrice = null;
      let exitReason = null;

      // Check Stop Loss on candle low
      if (c.low <= pos.stopLossPrice) {
        exitPrice = pos.stopLossPrice * (1 - slipRate);
        exitReason = 'STOP_LOSS';
      }
      // Check RSI Middle Dotted Line (50) Touch (User's Exact Exit)
      else if (curRSI >= 50) {
        exitPrice = c.close * (1 - slipRate);
        exitReason = 'RSI_50_MIDLINE';
      }
      // Safety hold limit (32 bars = 8 hours)
      else if (pos.barsHeld >= 32) {
        exitPrice = c.close * (1 - slipRate);
        exitReason = 'TIMEOUT_8H';
      }

      if (exitPrice !== null) {
        const notional = pos.notional;
        const grossReturn = (exitPrice - pos.entryPrice) / pos.entryPrice;
        const grossGain = notional * grossReturn;
        const fees = notional * feeRate * 2;
        const netPnL = grossGain - fees;

        balance = Number((balance + netPnL).toFixed(2));

        if (monthlyData[monthKey]) {
          monthlyData[monthKey].trades++;
          if (netPnL > 0) monthlyData[monthKey].wins++;
          else monthlyData[monthKey].losses++;
          monthlyData[monthKey].netProfitDollar += netPnL;
        }

        closedTrades.push({
          symbol: pos.symbol,
          entryTime: pos.entryTime,
          exitTime: c.time,
          entryPrice: pos.entryPrice,
          exitPrice,
          exitReason,
          grossReturnPct: grossReturn * 100,
          netReturnPct: (grossReturn * 100) - 0.23,
          netPnL,
          durationMin: pos.barsHeld * 15,
          balanceAfter: balance,
          monthKey
        });

        activeTrades.splice(pIdx, 1);
      }
    }

    // 2. Scan for New Entries (Hold up to 1 position with full compounding)
    if (activeTrades.length < 1) {
      let bestCand = null;
      let highestScore = -Infinity;

      for (const sym of symbols) {
        const sObj = symData[sym];
        const cIdx = sObj.timeMap.get(openTime);
        if (cIdx === undefined || cIdx < 25) continue;

        const c = sObj.candles[cIdx];
        const rsi = sObj.tech.rsi14;
        const atr = sObj.tech.atr14;
        const ema9 = sObj.tech.ema9;

        const curRSI = rsi[cIdx];
        const prevRSI = rsi[cIdx - 1];

        // Trigger: RSI crosses above 35 from below
        if (!(prevRSI < 35 && curRSI >= 35)) continue;

        // FLAW KILLER 1: Dead Coin Filter (15m ATR must be >= 0.50% of price)
        const atrPct = (atr[cIdx] / c.close) * 100;
        if (atrPct < 0.50) continue;

        // FLAW KILLER 2: Micro-Candle Killer (Candle range must be >= 0.50%)
        const curRange = c.high - c.low;
        const curRangePct = (curRange / c.close) * 100;
        if (curRangePct < 0.50) continue;

        // FLAW KILLER 3: Impulse Expansion (Current candle range >= 1.25x avg of past 5 candles)
        let past5Sum = 0;
        for (let k = 1; k <= 5; k++) past5Sum += (sObj.candles[cIdx - k].high - sObj.candles[cIdx - k].low);
        const avgPast5 = past5Sum / 5;
        if (avgPast5 > 0 && (curRange / avgPast5) < 1.25) continue;

        // FLAW KILLER 4: Reversal Confirmation (Green Candle & Close > EMA 9)
        if (c.close <= c.open || c.close <= ema9[cIdx]) continue;

        // Calculate dip lowest price while RSI was < 35
        let dipLow = c.low;
        for (let back = 1; back <= 10; back++) {
          if (rsi[cIdx - back] < 35) {
            if (sObj.candles[cIdx - back].low < dipLow) dipLow = sObj.candles[cIdx - back].low;
          } else break;
        }

        // Score based on oversold depth and candle strength
        const score = (50 - prevRSI) * 2 + (curRangePct * 10);
        if (score > highestScore) {
          highestScore = score;
          bestCand = {
            symbol: sym,
            candle: c,
            dipLow
          };
        }
      }

      if (bestCand) {
        const c = bestCand.candle;
        const entryPrice = c.close * (1 + slipRate);
        let slPrice = 0;

        if (slMode === 'swing_low') {
          // SL below dip low with 0.15% buffer, capped at maxSlPct
          const swingSL = bestCand.dipLow * 0.9985;
          const maxAllowedSL = entryPrice * (1 - maxSlPct / 100);
          slPrice = Math.max(swingSL, maxAllowedSL);
        } else {
          slPrice = entryPrice * (1 - maxSlPct / 100);
        }

        activeTrades.push({
          symbol: bestCand.symbol,
          entryPrice,
          entryTime: c.time,
          stopLossPrice: slPrice,
          notional: balance,
          barsHeld: 0
        });
      }
    }
  }

  const wins = closedTrades.filter(t => t.netPnL > 0);
  const losses = closedTrades.filter(t => t.netPnL <= 0);
  const winRate = closedTrades.length > 0 ? (wins.length / closedTrades.length) * 100 : 0;
  const avgWin = wins.length > 0 ? (wins.reduce((a, t) => a + t.netReturnPct, 0) / wins.length) : 0;
  const avgLoss = losses.length > 0 ? (losses.reduce((a, t) => a + t.netReturnPct, 0) / losses.length) : 0;
  const netROI = ((balance - 100) / 100) * 100;

  return {
    name: slConfig.name,
    finalBalance: balance,
    totalTrades: closedTrades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: winRate.toFixed(1) + '%',
    avgWin: '+' + avgWin.toFixed(2) + '%',
    avgLoss: avgLoss.toFixed(2) + '%',
    netROI: (netROI >= 0 ? '+' : '') + netROI.toFixed(1) + '%',
    closedTrades,
    monthlyData
  };
}

console.log('Running Refined Strategy with 1.0% Fixed SL...');
const resFixed1 = runRefinedBacktest({ name: 'Fixed 1.0% SL', slMode: 'fixed', maxSlPct: 1.0 });

console.log('Running Refined Strategy with Swing Low SL (max 1.2%)...');
const resSwing12 = runRefinedBacktest({ name: 'Swing Low SL (max 1.2%)', slMode: 'swing_low', maxSlPct: 1.2 });

console.log('Running Refined Strategy with Swing Low SL (max 1.5%)...');
const resSwing15 = runRefinedBacktest({ name: 'Swing Low SL (max 1.5%)', slMode: 'swing_low', maxSlPct: 1.5 });

console.log('\n========================================================================');
console.log('   REFINED USER STRATEGY: RSI 35 -> RSI 50 (SMALL CANDLE KILLER ACTIVE)');
console.log('========================================================================\n');

console.table([
  {
    Variant: resFixed1.name,
    Trades: resFixed1.totalTrades,
    Wins: resFixed1.wins,
    Losses: resFixed1.losses,
    'Win Rate': resFixed1.winRate,
    'Avg Win': resFixed1.avgWin,
    'Avg Loss': resFixed1.avgLoss,
    'Final Balance': '$' + resFixed1.finalBalance.toFixed(2),
    'Net ROI': resFixed1.netROI
  },
  {
    Variant: resSwing12.name,
    Trades: resSwing12.totalTrades,
    Wins: resSwing12.wins,
    Losses: resSwing12.losses,
    'Win Rate': resSwing12.winRate,
    'Avg Win': resSwing12.avgWin,
    'Avg Loss': resSwing12.avgLoss,
    'Final Balance': '$' + resSwing12.finalBalance.toFixed(2),
    'Net ROI': resSwing12.netROI
  },
  {
    Variant: resSwing15.name,
    Trades: resSwing15.totalTrades,
    Wins: resSwing15.wins,
    Losses: resSwing15.losses,
    'Win Rate': resSwing15.winRate,
    'Avg Win': resSwing15.avgWin,
    'Avg Loss': resSwing15.avgLoss,
    'Final Balance': '$' + resSwing15.finalBalance.toFixed(2),
    'Net ROI': resSwing15.netROI
  }
]);

// Pick the best variant for detailed export
const best = resSwing15;

console.log(`\nMonth-by-Month Compounding Breakdown for ${best.name}:`);
const monthlyArr = Object.values(best.monthlyData).map(m => {
  const mWinRate = m.trades > 0 ? ((m.wins / m.trades) * 100).toFixed(1) + '%' : '0%';
  const mReturn = m.startBalance > 0 ? ((m.netProfitDollar / m.startBalance) * 100).toFixed(2) + '%' : '0%';
  return {
    Month: m.month,
    'Start Capital': '$' + m.startBalance.toFixed(2),
    'Net Profit': (m.netProfitDollar >= 0 ? '+$' : '-$') + Math.abs(m.netProfitDollar).toFixed(2),
    'Monthly Return': (m.netProfitDollar >= 0 ? '+' : '') + mReturn,
    Trades: m.trades,
    'Win Rate': mWinRate
  };
});
console.table(monthlyArr);

// Export Excel Report
const wb = XLSX.utils.book_new();

// Sheet 1: Summary
const summaryRows = [
  ['NEXUS QUANT - USER REFINED RSI 35 RE-ENTRY -> RSI 50 EXIT AUDIT'],
  ['Indicator Settings', 'TradingView RSI(14) | Lower Band: 35 | Middle Band: 50 | Upper Band: 75'],
  ['Exit Condition', 'Market Exit immediately upon touching RSI 50 (NO fixed TP percentage)'],
  ['Stop Loss Mode', `${best.name}`],
  ['Small Candle Killer', 'ATR >= 0.50% | Range >= 0.50% | Impulse Ratio >= 1.25x | Close > EMA 9'],
  ['Fees & Slippage', '0.20% Round-trip Binance Spot Fee + 0.03% Slippage per trade'],
  ['Universe Tested', `${symbols.length} Binance Halal Altcoins (2026 Full Dataset)`],
  [],
  ['MONTHLY COMPOUNDING BREAKDOWN ($100 STARTING CAPITAL)'],
  ['Month', 'Start Capital ($)', 'Net Profit ($)', 'Monthly Return (%)', 'Trades', 'Win Rate (%)']
];

monthlyArr.forEach(m => {
  summaryRows.push([m.Month, m['Start Capital'], m['Net Profit'], m['Monthly Return'], m.Trades, m['Win Rate']]);
});

summaryRows.push([]);
summaryRows.push(['TOTAL COMPOUNDED RESULT', '$100.00', (best.finalBalance >= 100 ? '+$' : '-$') + Math.abs(best.finalBalance - 100).toFixed(2), best.netROI, best.totalTrades, best.winRate]);

XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), 'Strategy Summary');

// Sheet 2: Trade Log
const tradeHeaders = ['Trade #', 'Symbol', 'Entry Time', 'Exit Time', 'Duration (min)', 'Entry Price', 'Exit Price', 'Exit Reason', 'Net Return (%)', 'Net PnL ($)', 'Balance After'];
const tradeRows = [tradeHeaders];
best.closedTrades.forEach((t, idx) => {
  tradeRows.push([
    idx + 1,
    t.symbol,
    t.entryTime,
    t.exitTime,
    t.durationMin,
    t.entryPrice,
    t.exitPrice,
    t.exitReason,
    Number(t.netReturnPct.toFixed(2)),
    Number(t.netPnL.toFixed(2)),
    t.balanceAfter
  ]);
});
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(tradeRows), 'All Trades');

const outPath = path.resolve(__dirname, '../../nexus_quant_user_refined_rsi_50_report.xlsx');
XLSX.writeFile(wb, outPath);

// Copy to brain directory for user
const brainPath = 'C:\\Users\\waizt\\.gemini\\antigravity\\brain\\9240cc1b-f576-4996-a196-552f1f9e4603\\nexus_quant_user_refined_rsi_50_report.xlsx';
fs.copyFileSync(outPath, brainPath);
console.log(`\nExcel Report saved to: ${outPath}`);
console.log(`Copied to brain directory: ${brainPath}`);
