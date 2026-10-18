import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';

const cacheDir = './src/data/binance_cache';
const outDir = 'C:/Users/waizt/.gemini/antigravity/brain/9240cc1b-f576-4996-a196-552f1f9e4603';

console.log('=== TESTING TRUE ZERO-SAFETY-ORDER MODEL C & MODEL D COMPOUNDING ===');

const top10Symbols = ['ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'AVAXUSDT', 'LINKUSDT', 'NEARUSDT', 'SUIUSDT', 'LTCUSDT'];
const rawDatasets = {};

for (const sym of top10Symbols) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(cacheDir, `${sym}_15m_60d.json`), 'utf8'));
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
    rawDatasets[sym] = parsed;
  } catch (_) {}
}

const rawBTC = JSON.parse(fs.readFileSync(path.join(cacheDir, 'BTCUSDT_15m_60d.json'), 'utf8'));
const btc15 = rawBTC.map(c => ({
  openTime: c.openTime || c[0],
  close: Number(c.close || c[4])
})).filter(c => c.openTime >= 1767225600000 && !isNaN(c.close));
btc15.sort((a, b) => a.openTime - b.openTime);

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

function calculateRSI14(candles) {
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
  return rsi14;
}

const btcEMA200 = calculateEMA(btc15.map(c => c.close), 200);
const btcRSI = calculateRSI14(btc15);
const btcMap = new Map();
btc15.forEach((c, idx) => btcMap.set(c.openTime, idx));

const coinIndicators = {};
for (const sym of Object.keys(rawDatasets)) {
  coinIndicators[sym] = {
    rsi14: calculateRSI14(rawDatasets[sym])
  };
}

const feeRate = 0.0010;
const slipRate = 0.00015;

function runTrueZeroSOCompounding(cfg) {
  const initialBalance = cfg.startBalance || 100.0;
  let currentBalance = initialBalance;

  // Gather all valid signals
  const allSignals = [];
  for (const sym of Object.keys(rawDatasets)) {
    const candles = rawDatasets[sym];
    const rsi = coinIndicators[sym].rsi14;
    const len = candles.length;

    for (let i = 50; i < len; i++) {
      const c = candles[i];
      if (cfg.btcGuard) {
        const btcIdx = btcMap.get(c.openTime);
        if (btcIdx !== undefined && (btcRSI[btcIdx] < 35 || btc15[btcIdx].close < btcEMA200[btcIdx])) continue;
      }

      if (rsi[i - 1] < 32 && rsi[i] >= 30 && c.close >= c.open) {
        allSignals.push({
          symbol: sym,
          candleIdx: i,
          openTime: c.openTime,
          time: c.time,
          entryPrice: c.close * (1 + slipRate)
        });
      }
    }
  }

  allSignals.sort((a, b) => a.openTime - b.openTime);

  const completedTrades = [];
  let nextAvailableTime = 0;

  for (const sig of allSignals) {
    if (sig.openTime < nextAvailableTime) continue;

    const sym = sig.symbol;
    const candles = rawDatasets[sym];
    const startIdx = sig.candleIdx;
    const entryPrice = sig.entryPrice;
    const tpPrice = entryPrice * (1 + cfg.tpPct / 100);
    const slPrice = cfg.emergencySL ? entryPrice * (1 - cfg.emergencySL / 100) : null;

    let exitPrice = null;
    let exitTime = '';
    let exitReason = '';
    let exitOpenTime = 0;

    for (let j = startIdx + 1; j < candles.length && j <= startIdx + (cfg.maxBars || 480); j++) {
      const bar = candles[j];

      // Check Take Profit Target
      if (bar.high >= tpPrice) {
        exitPrice = tpPrice * (1 - slipRate);
        exitTime = bar.time;
        exitOpenTime = bar.openTime;
        exitReason = `Take Profit Target Hit (+${cfg.tpPct}%)`;
        break;
      }
      // Check Emergency Stop Loss
      else if (slPrice !== null && bar.low <= slPrice) {
        exitPrice = slPrice * (1 - slipRate);
        exitTime = bar.time;
        exitOpenTime = bar.openTime;
        exitReason = `Emergency Stop Loss Hit (-${cfg.emergencySL}%)`;
        break;
      }
    }

    // Time horizon exit if not hit
    if (exitPrice === null) {
      const lastBar = candles[Math.min(candles.length - 1, startIdx + (cfg.maxBars || 480))];
      exitPrice = lastBar.close * (1 - slipRate);
      exitTime = lastBar.time;
      exitOpenTime = lastBar.openTime;
      exitReason = 'Max Time Horizon Exit (5 Days)';
    }

    // Compounding logic
    const tradeCapital = currentBalance;
    const coinUnits = tradeCapital / entryPrice;
    const grossExitUSD = coinUnits * exitPrice;
    const buyFee = tradeCapital * feeRate;
    const sellFee = grossExitUSD * feeRate;
    const totalFees = buyFee + sellFee;
    const netPnLUSD = grossExitUSD - tradeCapital - totalFees;
    const netReturnPct = (netPnLUSD / tradeCapital) * 100;
    const grossReturnPct = ((grossExitUSD - tradeCapital) / tradeCapital) * 100;

    const startBalanceBeforeTrade = currentBalance;
    currentBalance = currentBalance + netPnLUSD;

    const durationHours = ((exitOpenTime - sig.openTime) / (3600 * 1000)).toFixed(1);

    completedTrades.push({
      'Trade #': completedTrades.length + 1,
      'Symbol': sym,
      'Entry Time (UTC)': sig.time,
      'Exit Time (UTC)': exitTime,
      'Duration (Hours)': Number(durationHours),
      'Entry Price ($)': Number(entryPrice.toFixed(4)),
      'Exit Price ($)': Number(exitPrice.toFixed(4)),
      'Starting Capital ($)': Number(startBalanceBeforeTrade.toFixed(2)),
      'Position Size ($)': Number(tradeCapital.toFixed(2)),
      'Gross Return (%)': Number(grossReturnPct.toFixed(2)),
      'Binance Fees ($)': Number(totalFees.toFixed(2)),
      'Net Profit/Loss ($)': Number(netPnLUSD.toFixed(2)),
      'Net Return (%)': Number(netReturnPct.toFixed(2)),
      'Compounded Balance ($)': Number(currentBalance.toFixed(2)),
      'Cumulative Gain (%)': Number((((currentBalance - initialBalance) / initialBalance) * 100).toFixed(2)),
      'Outcome': netPnLUSD > 0 ? 'WIN' : 'LOSS',
      'Execution Details': exitReason
    });

    nextAvailableTime = exitOpenTime;
  }

  const total = completedTrades.length;
  const wins = completedTrades.filter(t => t.Outcome === 'WIN').length;
  const losses = completedTrades.filter(t => t.Outcome === 'LOSS').length;
  const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : '0.0';
  const totalNetUSD = currentBalance - initialBalance;
  const totalNetPct = ((currentBalance - initialBalance) / initialBalance) * 100;

  return {
    name: cfg.name,
    trades: total,
    wins,
    losses,
    winRate: winRate + '%',
    startBalance: '$' + initialBalance.toFixed(2),
    endBalance: '$' + currentBalance.toFixed(2),
    netGainUSD: (totalNetUSD > 0 ? '+$' : '-$') + Math.abs(totalNetUSD).toFixed(2),
    netGainPct: (totalNetPct > 0 ? '+' : '') + totalNetPct.toFixed(2) + '%',
    completedTrades
  };
}

// 1. Model C True Zero-SO (1.2% TP, 10% Emergency SL, Zero SOs)
const resC_zeroSO = runTrueZeroSOCompounding({
  name: 'Model C (Zero SOs): +1.2% TP, 10% Emergency SL',
  tpPct: 1.2,
  emergencySL: 10.0,
  btcGuard: true,
  maxBars: 480
});

// 2. Model D True Zero-SO (0.7% Micro-TP, 5-Day Horizon, Zero SOs)
const resD_zeroSO = runTrueZeroSOCompounding({
  name: 'Model D (Zero SOs): +0.7% TP, 5-Day Time Horizon, Zero SOs',
  tpPct: 0.7,
  emergencySL: null,
  btcGuard: true,
  maxBars: 480
});

console.log('\n--- TRUE ZERO SAFETY ORDER RESULTS ---');
console.log('Model C (Zero SOs):', {
  Trades: resC_zeroSO.trades,
  Wins: resC_zeroSO.wins,
  Losses: resC_zeroSO.losses,
  WinRate: resC_zeroSO.winRate,
  Start: resC_zeroSO.startBalance,
  End: resC_zeroSO.endBalance,
  NetGain: resC_zeroSO.netGainPct
});

console.log('Model D (Zero SOs):', {
  Trades: resD_zeroSO.trades,
  Wins: resD_zeroSO.wins,
  Losses: resD_zeroSO.losses,
  WinRate: resD_zeroSO.winRate,
  Start: resD_zeroSO.startBalance,
  End: resD_zeroSO.endBalance,
  NetGain: resD_zeroSO.netGainPct
});

// Also what if all simultaneous trades are taken (like in Model C & D)?
// Let's create the workbook with BOTH sequential compounding AND all-trades tracking!
const wb = XLSX.utils.book_new();

const summaryRows = [
  { 'TRUE ZERO SAFETY ORDER AUDIT': 'Configuration', 'MODEL C (ZERO SO)': 'Model C Parameters (+1.2% TP, 10% SL)', 'MODEL D (ZERO SO)': 'Model D Parameters (+0.7% TP, 5-Day Horizon)' },
  { 'TRUE ZERO SAFETY ORDER AUDIT': 'Safety Orders Allowed', 'MODEL C (ZERO SO)': '0 (ZERO Safety Orders)', 'MODEL D (ZERO SO)': '0 (ZERO Safety Orders)' },
  { 'TRUE ZERO SAFETY ORDER AUDIT': 'Starting Capital', 'MODEL C (ZERO SO)': '$100.00', 'MODEL D (ZERO SO)': '$100.00' },
  { 'TRUE ZERO SAFETY ORDER AUDIT': 'Compounding Formula', 'MODEL C (ZERO SO)': '100% of Balance Reinvested Sequentially', 'MODEL D (ZERO SO)': '100% of Balance Reinvested Sequentially' },
  { 'TRUE ZERO SAFETY ORDER AUDIT': 'Binance Spot Fees', 'MODEL C (ZERO SO)': '0.10% Buy + 0.10% Sell + 0.03% Slippage', 'MODEL D (ZERO SO)': '0.10% Buy + 0.10% Sell + 0.03% Slippage' },
  {},
  { 'TRUE ZERO SAFETY ORDER AUDIT': 'COMPOUNDED PERFORMANCE METRICS' },
  { 'TRUE ZERO SAFETY ORDER AUDIT': 'Total Trades', 'MODEL C (ZERO SO)': resC_zeroSO.trades, 'MODEL D (ZERO SO)': resD_zeroSO.trades },
  { 'TRUE ZERO SAFETY ORDER AUDIT': 'Winning Trades', 'MODEL C (ZERO SO)': resC_zeroSO.wins, 'MODEL D (ZERO SO)': resD_zeroSO.wins },
  { 'TRUE ZERO SAFETY ORDER AUDIT': 'Losing Trades', 'MODEL C (ZERO SO)': resC_zeroSO.losses, 'MODEL D (ZERO SO)': resD_zeroSO.losses },
  { 'TRUE ZERO SAFETY ORDER AUDIT': 'Win Rate (%)', 'MODEL C (ZERO SO)': resC_zeroSO.winRate, 'MODEL D (ZERO SO)': resD_zeroSO.winRate },
  { 'TRUE ZERO SAFETY ORDER AUDIT': 'Starting Balance ($)', 'MODEL C (ZERO SO)': resC_zeroSO.startBalance, 'MODEL D (ZERO SO)': resD_zeroSO.startBalance },
  { 'TRUE ZERO SAFETY ORDER AUDIT': 'Ending Balance ($)', 'MODEL C (ZERO SO)': resC_zeroSO.endBalance, 'MODEL D (ZERO SO)': resD_zeroSO.endBalance },
  { 'TRUE ZERO SAFETY ORDER AUDIT': 'Net Dollar Profit ($)', 'MODEL C (ZERO SO)': resC_zeroSO.netGainUSD, 'MODEL D (ZERO SO)': resD_zeroSO.netGainUSD },
  { 'TRUE ZERO SAFETY ORDER AUDIT': 'Compounded Return (%)', 'MODEL C (ZERO SO)': resC_zeroSO.netGainPct, 'MODEL D (ZERO SO)': resD_zeroSO.netGainPct }
];

XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), 'Compounding Summary');
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resC_zeroSO.completedTrades), 'Model C (Zero SO Compounded)');
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resD_zeroSO.completedTrades), 'Model D (Zero SO Compounded)');

const finalPath = path.join(outDir, 'nexus_quant_model_c_and_d_TRUE_ZERO_SO_compounding.xlsx');
XLSX.writeFile(wb, finalPath);
console.log('Saved workbook to:', finalPath);
