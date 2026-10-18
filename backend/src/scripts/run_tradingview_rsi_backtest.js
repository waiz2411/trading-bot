import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cacheDir = path.resolve(__dirname, '../data/binance_cache');

console.log('Loading candle datasets for TradingView RSI Re-Entry Backtest...');

const files = fs.readdirSync(cacheDir).filter(f => f.endsWith('.json'));
const datasets = {};

for (const file of files) {
  const sym = file.split('_')[0];
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
      if (parsed.length > 1000) datasets[sym] = parsed;
    }
  } catch (_) {}
}

const symbols = Object.keys(datasets).filter(s => s !== 'BTCUSDT' && s !== 'PAXGUSDT');
console.log(`Loaded ${symbols.length} altcoin datasets.`);

// TradingView Wilder RSI calculation
function calculateRSI(candles, length = 14) {
  const len = candles.length;
  const closes = candles.map(c => c.close);
  const rsi = new Float64Array(len);

  let avgG = 0, avgL = 0;
  for (let i = 1; i <= length && i < len; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) avgG += d; else avgL += Math.abs(d);
  }
  avgG /= length; avgL /= length;
  rsi[length] = avgL === 0 ? 100 : 100 - (100 / (1 + avgG / avgL));

  for (let i = length + 1; i < len; i++) {
    const d = closes[i] - closes[i - 1];
    const gain = d > 0 ? d : 0;
    const loss = d < 0 ? Math.abs(d) : 0;
    avgG = (avgG * (length - 1) + gain) / length;
    avgL = (avgL * (length - 1) + loss) / length;
    rsi[i] = avgL === 0 ? 100 : 100 - (100 / (1 + avgG / avgL));
  }
  return rsi;
}

const timeSource = datasets['ETHUSDT'] || datasets[symbols[0]];

function runTradingViewRSIBacktest(rsiLength = 14, lowerBand = 30, tp = 0.5, sl = 2.0, maxSlots = 3) {
  const symRSI = {};
  for (const sym of symbols) {
    const c = datasets[sym];
    symRSI[sym] = {
      candles: c,
      rsi: calculateRSI(c, rsiLength),
      timeMap: new Map()
    };
    c.forEach((bar, idx) => symRSI[sym].timeMap.set(bar.openTime, idx));
  }

  let balance = 100.0;
  let peakBalance = balance;
  let maxDD = 0;
  const activeTrades = [];
  const closedTrades = [];
  const dailyPnL = {};

  const feeRate = 0.0010; // 0.10% buy + 0.10% sell = 0.20% round trip
  const slipRate = 0.0003; // Conservative 0.03% slippage

  for (let tIdx = 50; tIdx < timeSource.length; tIdx++) {
    const bar = timeSource[tIdx];
    const openTime = bar.openTime;
    const dateStr = bar.time.split('T')[0];

    // 1. Manage active positions
    for (let pIdx = activeTrades.length - 1; pIdx >= 0; pIdx--) {
      const pos = activeTrades[pIdx];
      const sObj = symRSI[pos.symbol];
      if (!sObj) continue;
      const cIdx = sObj.timeMap.get(openTime);
      if (cIdx === undefined) continue;

      const c = sObj.candles[cIdx];
      pos.barsHeld++;

      let exitPrice = null;
      let exitReason = null;

      // Stop Loss check
      if (c.low <= pos.entryPrice * (1 - sl / 100)) {
        exitPrice = pos.entryPrice * (1 - sl / 100) * (1 - slipRate);
        exitReason = 'STOP_LOSS';
      }
      // Take Profit check
      else if (c.high >= pos.entryPrice * (1 + tp / 100)) {
        exitPrice = pos.entryPrice * (1 + tp / 100) * (1 - slipRate);
        exitReason = 'TAKE_PROFIT';
      }
      // Max hold (after 32 bars / 8 hours exit at market to avoid being stuck)
      else if (pos.barsHeld >= 32) {
        exitPrice = c.close * (1 - slipRate);
        exitReason = 'TIME_LIMIT';
      }

      if (exitPrice !== null) {
        const notional = pos.notional;
        const grossReturnPct = ((exitPrice - pos.entryPrice) / pos.entryPrice) * 100;
        const grossGain = notional * (grossReturnPct / 100);
        const fees = notional * feeRate * 2;
        const netPnL = grossGain - fees;

        balance = Number((balance + netPnL).toFixed(2));
        if (balance > peakBalance) peakBalance = balance;
        const dd = peakBalance > 0 ? ((peakBalance - balance) / peakBalance) * 100 : 0;
        if (dd > maxDD) maxDD = dd;

        dailyPnL[dateStr] = (dailyPnL[dateStr] || 0) + netPnL;

        closedTrades.push({
          id: closedTrades.length + 1,
          symbol: pos.symbol,
          entryTime: pos.entryTime,
          exitTime: c.time,
          entryPrice: pos.entryPrice,
          exitPrice,
          grossGain,
          fees,
          netPnL,
          returnPct: (netPnL / notional) * 100,
          exitReason,
          barsHeld: pos.barsHeld,
          balanceAfter: balance
        });

        activeTrades.splice(pIdx, 1);
      }
    }

    // 2. Scan for TradingView RSI Re-Entry:
    // "buy when the line re enters purple block":
    // Previous bar RSI <= lowerBand (outside purple block in oversold),
    // Current bar RSI > lowerBand (crosses up into purple block)!
    if (activeTrades.length < maxSlots) {
      for (const sym of symbols) {
        if (activeTrades.length >= maxSlots) break;
        if (activeTrades.some(t => t.symbol === sym)) continue;

        const sObj = symRSI[sym];
        if (!sObj) continue;
        const idx = sObj.timeMap.get(openTime);
        if (idx === undefined || idx < 20) continue;

        const prevRsi = sObj.rsi[idx - 1];
        const currRsi = sObj.rsi[idx];

        // Signal: Re-entering the purple block (crosses above 30 from below)
        const reEnteredPurple = prevRsi <= lowerBand && currRsi > lowerBand;

        if (reEnteredPurple) {
          const c = sObj.candles[idx];
          const slotSize = Math.max(5.0, balance / maxSlots);

          activeTrades.push({
            symbol: sym,
            entryPrice: c.close * (1 + slipRate),
            entryTime: c.time,
            notional: slotSize,
            barsHeld: 0
          });
        }
      }
    }
  }

  const totalTrades = closedTrades.length;
  const wins = closedTrades.filter(t => t.netPnL > 0.001);
  const losses = closedTrades.filter(t => t.netPnL < -0.001);
  const winRate = totalTrades > 0 ? (wins.length / totalTrades) * 100 : 0;
  const totalFees = closedTrades.reduce((acc, t) => acc + t.fees, 0);
  const totalGrossGain = closedTrades.reduce((acc, t) => acc + t.grossGain, 0);
  const tradedDays = Object.keys(dailyPnL).length;

  return {
    configName: `TradingView RSI(${rsiLength}) Re-enter > ${lowerBand} [TP ${tp}% / SL ${sl}% / ${maxSlots} Slots]`,
    totalTrades,
    tradedDays,
    totalDays: 290,
    winRate: Number(winRate.toFixed(1)),
    winsCount: wins.length,
    lossesCount: losses.length,
    takeProfitHits: closedTrades.filter(t => t.exitReason === 'TAKE_PROFIT').length,
    stopLossHits: closedTrades.filter(t => t.exitReason === 'STOP_LOSS').length,
    totalGrossGain: Number(totalGrossGain.toFixed(2)),
    totalFeesPaid: Number(totalFees.toFixed(2)),
    finalBalance: Number(balance.toFixed(2)),
    netROI: Number(((balance - 100) / 100 * 100).toFixed(2)),
    maxDrawdownPct: Number(maxDD.toFixed(1)),
    closedTrades,
    dailyPnL
  };
}

console.log('\n--- Running Backtest: TradingView RSI Re-Entering Purple Block (TP 0.5% / SL 2.0%) ---');

// Test standard TradingView (RSI 14, lower band 30)
const test1 = runTradingViewRSIBacktest(14, 30, 0.5, 2.0, 3);
// Test fast RSI (RSI 7, lower band 30)
const test2 = runTradingViewRSIBacktest(7, 30, 0.5, 2.0, 3);
// Test single slot 100% compounding (RSI 14, lower band 30)
const test3 = runTradingViewRSIBacktest(14, 30, 0.5, 2.0, 1);

const summaryTable = [test1, test2, test3].map(t => ({
  'Configuration': t.configName,
  'Total Trades': t.totalTrades,
  'Days Traded': `${t.tradedDays} / ${t.totalDays}`,
  'Win Rate': `${t.winRate}%`,
  'Wins / Losses': `${t.winsCount} / ${t.lossesCount}`,
  'TP Hits': t.takeProfitHits,
  'SL Hits': t.stopLossHits,
  'Gross Gain': `$${t.totalGrossGain}`,
  'Binance Fees': `$${t.totalFeesPaid}`,
  'Final Balance': `$${t.finalBalance}`,
  'Net ROI': `${t.netROI}%`,
  'Max DD': `${t.maxDrawdownPct}%`
}));

console.table(summaryTable);

// Export the user test1 to Excel
const wb = XLSX.utils.book_new();

const wsSummary = XLSX.utils.json_to_sheet(summaryTable);
XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

const dailyList = Object.keys(test1.dailyPnL).sort().map(dt => ({
  'Date': dt,
  'Daily Net PnL ($)': Number(test1.dailyPnL[dt].toFixed(2)),
  'Status': test1.dailyPnL[dt] > 0 ? 'PROFIT 🟢' : (test1.dailyPnL[dt] < 0 ? 'LOSS 🔴' : 'BREAKEVEN ⚪')
}));
const wsDaily = XLSX.utils.json_to_sheet(dailyList);
XLSX.utils.book_append_sheet(wb, wsDaily, 'Daily Performance');

const tradeList = test1.closedTrades.map(t => ({
  'Trade #': t.id,
  'Symbol': t.symbol,
  'Entry Time': t.entryTime,
  'Exit Time': t.exitTime,
  'Entry Price': t.entryPrice,
  'Exit Price': t.exitPrice,
  'Return (%)': `${t.returnPct.toFixed(2)}%`,
  'Gross PnL ($)': Number(t.grossGain.toFixed(3)),
  'Binance Fee ($)': Number(t.fees.toFixed(3)),
  'Net PnL ($)': Number(t.netPnL.toFixed(3)),
  'Exit Reason': t.exitReason,
  'Balance After ($)': t.balanceAfter
}));
const wsTrades = XLSX.utils.json_to_sheet(tradeList);
XLSX.utils.book_append_sheet(wb, wsTrades, 'All Executed Trades');

const outPath = path.resolve(__dirname, '../../../nexus_quant_tradingview_rsi_reentry_report.xlsx');
XLSX.writeFile(wb, outPath);

const brainDest = 'C:\\Users\\waizt\\.gemini\\antigravity\\brain\\9240cc1b-f576-4996-a196-552f1f9e4603\\nexus_quant_tradingview_rsi_reentry_report.xlsx';
try {
  fs.copyFileSync(outPath, brainDest);
} catch (_) {}

console.log('Report saved at: ' + outPath);
