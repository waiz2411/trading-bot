import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';

const cacheDir = './src/data/binance_cache';
const outDir = 'C:/Users/waizt/.gemini/antigravity/brain/9240cc1b-f576-4996-a196-552f1f9e4603';

console.log('=== GENERATING DEDICATED MODEL C & MODEL D BACKTEST WORKBOOK ===');

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

function runDetailedSimulation(cfg) {
  const deals = [];
  const dailyPnL = new Map();
  const coinStats = new Map();

  for (const sym of Object.keys(rawDatasets)) {
    const candles = rawDatasets[sym];
    const rsi = coinIndicators[sym].rsi14;
    const len = candles.length;

    let inDeal = false;
    let entries = [];
    let avgEntryPrice = 0;
    let totalSize = 0;
    let totalCost = 0;
    let dealStartTime = '';
    let dealStartIdx = 0;
    let nextSOPrice = 0;
    let soCount = 0;
    let emergencySLPrice = 0;
    let cooldownUntil = 0;

    for (let i = 50; i < len; i++) {
      const c = candles[i];
      if (i < cooldownUntil) continue;

      if (!inDeal) {
        // BTC Market Guard
        if (cfg.btcGuard) {
          const btcIdx = btcMap.get(c.openTime);
          if (btcIdx !== undefined) {
            if (btcRSI[btcIdx] < 35 || btc15[btcIdx].close < btcEMA200[btcIdx]) continue;
          }
        }

        // Deal Entry Trigger: RSI < 32 and green candle
        if (rsi[i - 1] < 32 && rsi[i] >= 30 && c.close >= c.open) {
          inDeal = true;
          dealStartTime = c.time;
          dealStartIdx = i;
          soCount = 0;

          const basePrice = c.close * (1 + slipRate);
          const baseCost = 100;
          const baseSize = baseCost / basePrice;

          entries = [{ price: basePrice, size: baseSize, cost: baseCost }];
          totalCost = baseCost;
          totalSize = baseSize;
          avgEntryPrice = basePrice;

          nextSOPrice = basePrice * (1 - cfg.soStepPct / 100);
          if (cfg.emergencySL) emergencySLPrice = basePrice * (1 - cfg.emergencySL / 100);
        }
      } else {
        let dealExitPrice = null;
        let dealExitReason = '';

        // Check TP target
        const targetPrice = avgEntryPrice * (1 + cfg.tpPct / 100);
        if (c.high >= targetPrice) {
          dealExitPrice = targetPrice * (1 - slipRate);
          dealExitReason = `Take Profit Target Hit (+${cfg.tpPct}%)`;
        }
        // Check Emergency SL
        else if (cfg.emergencySL && c.low <= emergencySLPrice) {
          dealExitPrice = emergencySLPrice * (1 - slipRate);
          dealExitReason = `Emergency Stop Loss Hit (-${cfg.emergencySL}%)`;
          cooldownUntil = i + 12;
        }
        // Check Safety Order fill
        else if (soCount < cfg.maxSO && c.low <= nextSOPrice) {
          soCount++;
          const fillPrice = nextSOPrice * (1 + slipRate);
          const nextCost = 100 * Math.pow(cfg.soVolumeScale, soCount);
          const nextSize = nextCost / fillPrice;

          entries.push({ price: fillPrice, size: nextSize, cost: nextCost });
          totalCost += nextCost;
          totalSize += nextSize;
          avgEntryPrice = totalCost / totalSize;

          const nextStep = cfg.soStepPct * Math.pow(cfg.soStepScale || 1.2, soCount);
          nextSOPrice = fillPrice * (1 - nextStep / 100);

          if (cfg.emergencySL) {
            emergencySLPrice = avgEntryPrice * (1 - (cfg.emergencySL / 100));
          }
        }
        // Max Time Horizon
        else if (i - dealStartIdx >= (cfg.maxBars || 480)) {
          dealExitPrice = c.close * (1 - slipRate);
          dealExitReason = 'Max Time Horizon Exit (5 Days)';
        }

        if (dealExitPrice !== null) {
          const grossProceeds = totalSize * dealExitPrice;
          const feePaid = (totalCost * feeRate) + (grossProceeds * feeRate);
          const netPnLDollar = grossProceeds - totalCost - feePaid;
          const netReturnPct = (netPnLDollar / totalCost) * 100;
          const grossReturnPct = ((grossProceeds - totalCost) / totalCost) * 100;

          const durationHours = ((c.openTime - candles[dealStartIdx].openTime) / (3600 * 1000)).toFixed(1);
          const day = c.time.split('T')[0];

          deals.push({
            symbol: sym,
            startTime: dealStartTime,
            exitTime: c.time,
            safetyOrdersFilled: soCount,
            totalInvestedUSD: Number(totalCost.toFixed(2)),
            avgEntryPrice: Number(avgEntryPrice.toFixed(4)),
            exitPrice: Number(dealExitPrice.toFixed(4)),
            grossReturnPct: Number(grossReturnPct.toFixed(2)),
            feesPaidUSD: Number(feePaid.toFixed(2)),
            netPnLDollar: Number(netPnLDollar.toFixed(2)),
            netReturnPct: Number(netReturnPct.toFixed(2)),
            durationHours: Number(durationHours),
            outcome: netPnLDollar > 0 ? 'WIN' : 'LOSS',
            exitReason: dealExitReason
          });

          // Daily stats
          if (!dailyPnL.has(day)) dailyPnL.set(day, { deals: 0, wins: 0, losses: 0, netUSD: 0 });
          const dStat = dailyPnL.get(day);
          dStat.deals++;
          if (netPnLDollar > 0) dStat.wins++; else dStat.losses++;
          dStat.netUSD += netPnLDollar;

          // Coin stats
          if (!coinStats.has(sym)) coinStats.set(sym, { deals: 0, wins: 0, losses: 0, netUSD: 0 });
          const cStat = coinStats.get(sym);
          cStat.deals++;
          if (netPnLDollar > 0) cStat.wins++; else cStat.losses++;
          cStat.netUSD += netPnLDollar;

          inDeal = false;
        }
      }
    }
  }

  deals.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  let running = 0;
  for (let d of deals) {
    running += d.netPnLDollar;
    d.cumDollar = Number(running.toFixed(2));
  }

  const total = deals.length;
  const wins = deals.filter(d => d.outcome === 'WIN').length;
  const losses = deals.filter(d => d.outcome === 'LOSS').length;
  const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : '0.0';
  const totalNetUSD = deals.reduce((acc, d) => acc + d.netPnLDollar, 0);
  const winSum = deals.filter(d => d.netPnLDollar > 0).reduce((acc, d) => acc + d.netPnLDollar, 0);
  const lossSum = Math.abs(deals.filter(d => d.netPnLDollar < 0).reduce((acc, d) => acc + d.netPnLDollar, 0));
  const pf = lossSum > 0 ? (winSum / lossSum).toFixed(2) : (winSum > 0 ? '999.00' : '0.00');

  const days = Array.from(dailyPnL.keys()).sort();
  let posDays = 0;
  for (const d of days) {
    if (dailyPnL.get(d).netUSD > 0) posDays++;
  }
  const dayWinRate = days.length > 0 ? ((posDays / days.length) * 100).toFixed(1) : '0.0';

  const avgWinUSD = wins > 0 ? (winSum / wins).toFixed(2) : '0.00';
  const avgLossUSD = losses > 0 ? (lossSum / losses).toFixed(2) : '0.00';
  const avgNetPct = total > 0 ? (deals.reduce((acc, d) => acc + d.netReturnPct, 0) / total).toFixed(2) : '0.00';

  return {
    name: cfg.name,
    deals: total,
    dealsPerDay: days.length > 0 ? (total / days.length).toFixed(1) : '0.0',
    wins,
    losses,
    winRate: winRate + '%',
    avgNetPct: (avgNetPct > 0 ? '+' : '') + avgNetPct + '%',
    avgWinUSD: '+$' + avgWinUSD,
    avgLossUSD: '-$' + avgLossUSD,
    profitFactor: pf,
    activeDays: days.length,
    profitableDays: `${posDays}/${days.length} (${dayWinRate}%)`,
    totalNetUSD: (totalNetUSD > 0 ? '+$' : '-$') + Math.abs(totalNetUSD).toFixed(2),
    dealList: deals,
    dailyPnL,
    coinStats
  };
}

// Run Model C
const cfgC = {
  name: 'Model C: Target +1.2% TP (3 SOs, 10% Emergency SL)',
  tpPct: 1.2,
  soStepPct: 2.0,
  maxSO: 3,
  soVolumeScale: 1.5,
  emergencySL: 10.0,
  btcGuard: true
};
const resC = runDetailedSimulation(cfgC);

// Run Model D
const cfgD = {
  name: 'Model D: Micro-Target +0.7% TP (3 SOs, 5-day horizon)',
  tpPct: 0.7,
  soStepPct: 1.5,
  maxSO: 3,
  soVolumeScale: 1.5,
  emergencySL: null,
  btcGuard: true,
  maxBars: 480
};
const resD = runDetailedSimulation(cfgD);

console.log('Model C Deals:', resC.deals, 'Win Rate:', resC.winRate, 'Net:', resC.totalNetUSD);
console.log('Model D Deals:', resD.deals, 'Win Rate:', resD.winRate, 'Net:', resD.totalNetUSD);

// Build Excel Workbook
const wb = XLSX.utils.book_new();

// Sheet 1: Executive Comparison
const summaryData = [
  { 'STRATEGY SPECIFICATION': 'Strategy Engine', 'MODEL C': 'Top 10 Spot DCA (+1.2% TP)', 'MODEL D': 'Top 10 Spot DCA (+0.7% Micro-TP)' },
  { 'STRATEGY SPECIFICATION': 'Target Coin Universe', 'MODEL C': 'Top 10 Liquid Coins (SOL, ETH, BNB, AVAX, NEAR, SUI, DOGE, XRP, LTC, LINK)', 'MODEL D': 'Top 10 Liquid Coins (SOL, ETH, BNB, AVAX, NEAR, SUI, DOGE, XRP, LTC, LINK)' },
  { 'STRATEGY SPECIFICATION': 'Base Order Size', 'MODEL C': '$100.00', 'MODEL D': '$100.00' },
  { 'STRATEGY SPECIFICATION': 'Safety Orders (Max)', 'MODEL C': '3 Safety Orders (1.5x Volume Multiplier)', 'MODEL D': '3 Safety Orders (1.5x Volume Multiplier)' },
  { 'STRATEGY SPECIFICATION': 'Safety Order Step', 'MODEL C': '2.0% Initial Step (1.2x Step Scale)', 'MODEL D': '1.5% Initial Step (1.2x Step Scale)' },
  { 'STRATEGY SPECIFICATION': 'Take Profit Target', 'MODEL C': '+1.20% from Average Entry Price', 'MODEL D': '+0.70% from Average Entry Price' },
  { 'STRATEGY SPECIFICATION': 'Risk Management / SL', 'MODEL C': '-10.0% Emergency Stop Loss', 'MODEL D': 'No Hard SL (5-Day Max Time Horizon Recovery)' },
  { 'STRATEGY SPECIFICATION': 'BTC Market Shield', 'MODEL C': 'Pause new deals if BTC RSI < 35 or Close < EMA 200', 'MODEL D': 'Pause new deals if BTC RSI < 35 or Close < EMA 200' },
  { 'STRATEGY SPECIFICATION': 'Binance Spot Fees Applied', 'MODEL C': '0.10% Buy + 0.10% Sell + 0.03% Slippage', 'MODEL D': '0.10% Buy + 0.10% Sell + 0.03% Slippage' },
  {},
  { 'STRATEGY SPECIFICATION': 'AUDIT PERFORMANCE METRICS (2026 BINANCE DATA)' },
  { 'STRATEGY SPECIFICATION': 'Completed Deals', 'MODEL C': resC.deals, 'MODEL D': resD.deals },
  { 'STRATEGY SPECIFICATION': 'Trading Frequency (Deals/Day)', 'MODEL C': resC.dealsPerDay, 'MODEL D': resD.dealsPerDay },
  { 'STRATEGY SPECIFICATION': 'Winning Deals', 'MODEL C': resC.wins, 'MODEL D': resD.wins },
  { 'STRATEGY SPECIFICATION': 'Losing Deals', 'MODEL C': resC.losses, 'MODEL D': resD.losses },
  { 'STRATEGY SPECIFICATION': 'Win Rate (%)', 'MODEL C': resC.winRate, 'MODEL D': resD.winRate },
  { 'STRATEGY SPECIFICATION': 'Average Net Return per Deal (%)', 'MODEL C': resC.avgNetPct, 'MODEL D': resD.avgNetPct },
  { 'STRATEGY SPECIFICATION': 'Average Win ($)', 'MODEL C': resC.avgWinUSD, 'MODEL D': resD.avgWinUSD },
  { 'STRATEGY SPECIFICATION': 'Average Loss ($)', 'MODEL C': resC.avgLossUSD, 'MODEL D': resD.avgLossUSD },
  { 'STRATEGY SPECIFICATION': 'Profit Factor', 'MODEL C': resC.profitFactor, 'MODEL D': resD.profitFactor },
  { 'STRATEGY SPECIFICATION': 'Profitable Active Days (%)', 'MODEL C': resC.profitableDays, 'MODEL D': resD.profitableDays },
  { 'STRATEGY SPECIFICATION': 'Total Cumulative Net Profit ($)', 'MODEL C': resC.totalNetUSD, 'MODEL D': resD.totalNetUSD }
];
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryData), 'Summary Comparison');

// Sheet 2: Model C Complete Deal Log
const dealRowsC = resC.dealList.map((d, idx) => ({
  'Deal #': idx + 1,
  'Symbol': d.symbol,
  'Start Time (UTC)': d.startTime,
  'Exit Time (UTC)': d.exitTime,
  'Safety Orders Filled': d.safetyOrdersFilled,
  'Total Capital Invested ($)': d.totalInvestedUSD,
  'Average Entry Price ($)': d.avgEntryPrice,
  'Exit Price ($)': d.exitPrice,
  'Holding Duration (Hours)': d.durationHours,
  'Gross Return (%)': d.grossReturnPct,
  'Binance Fees Paid ($)': d.feesPaidUSD,
  'Net Profit ($)': d.netPnLDollar,
  'Net Return (%)': d.netReturnPct,
  'Cumulative Profit ($)': d.cumDollar,
  'Outcome': d.outcome,
  'Exit Reason': d.exitReason
}));
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dealRowsC), 'Model C - Deal Log');

// Sheet 3: Model D Complete Deal Log
const dealRowsD = resD.dealList.map((d, idx) => ({
  'Deal #': idx + 1,
  'Symbol': d.symbol,
  'Start Time (UTC)': d.startTime,
  'Exit Time (UTC)': d.exitTime,
  'Safety Orders Filled': d.safetyOrdersFilled,
  'Total Capital Invested ($)': d.totalInvestedUSD,
  'Average Entry Price ($)': d.avgEntryPrice,
  'Exit Price ($)': d.exitPrice,
  'Holding Duration (Hours)': d.durationHours,
  'Gross Return (%)': d.grossReturnPct,
  'Binance Fees Paid ($)': d.feesPaidUSD,
  'Net Profit ($)': d.netPnLDollar,
  'Net Return (%)': d.netReturnPct,
  'Cumulative Profit ($)': d.cumDollar,
  'Outcome': d.outcome,
  'Exit Reason': d.exitReason
}));
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dealRowsD), 'Model D - Deal Log');

// Sheet 4: Model C Daily PnL
const dailyRowsC = [];
const daysC = Array.from(resC.dailyPnL.keys()).sort();
for (const day of daysC) {
  const st = resC.dailyPnL.get(day);
  dailyRowsC.push({
    'Date': day,
    'Deals Completed': st.deals,
    'Wins': st.wins,
    'Losses': st.losses,
    'Daily Net Profit ($)': Number(st.netUSD.toFixed(2)),
    'Status': st.netUSD > 0 ? 'PROFITABLE DAY' : (st.netUSD === 0 ? 'BREAK-EVEN' : 'LOSS DAY')
  });
}
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dailyRowsC), 'Model C - Daily PnL');

// Sheet 5: Model D Daily PnL
const dailyRowsD = [];
const daysD = Array.from(resD.dailyPnL.keys()).sort();
for (const day of daysD) {
  const st = resD.dailyPnL.get(day);
  dailyRowsD.push({
    'Date': day,
    'Deals Completed': st.deals,
    'Wins': st.wins,
    'Losses': st.losses,
    'Daily Net Profit ($)': Number(st.netUSD.toFixed(2)),
    'Status': st.netUSD > 0 ? 'PROFITABLE DAY' : (st.netUSD === 0 ? 'BREAK-EVEN' : 'LOSS DAY')
  });
}
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dailyRowsD), 'Model D - Daily PnL');

// Sheet 6: Coin Breakdown
const coinRows = [];
top10Symbols.forEach(sym => {
  const cStat = resC.coinStats.get(sym) || { deals: 0, wins: 0, losses: 0, netUSD: 0 };
  const dStat = resD.coinStats.get(sym) || { deals: 0, wins: 0, losses: 0, netUSD: 0 };
  coinRows.push({
    'Symbol': sym,
    'Model C Deals': cStat.deals,
    'Model C Win Rate': cStat.deals > 0 ? ((cStat.wins / cStat.deals) * 100).toFixed(1) + '%' : '0%',
    'Model C Net PnL ($)': Number(cStat.netUSD.toFixed(2)),
    'Model D Deals': dStat.deals,
    'Model D Win Rate': dStat.deals > 0 ? ((dStat.wins / dStat.deals) * 100).toFixed(1) + '%' : '0%',
    'Model D Net PnL ($)': Number(dStat.netUSD.toFixed(2))
  });
});
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(coinRows), 'Coin Breakdown');

const finalPath = path.join(outDir, 'nexus_quant_model_c_and_d_complete_backtest.xlsx');
XLSX.writeFile(wb, finalPath);
console.log('Saved dedicated workbook to:', finalPath);
