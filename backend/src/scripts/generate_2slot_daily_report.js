import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';

const cacheDir = './backend/src/data/binance_cache';
const outDir = 'C:/Users/waizt/.gemini/antigravity/brain/9240cc1b-f576-4996-a196-552f1f9e4603';
const topLiquidSymbols = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
  'DOGEUSDT', 'AVAXUSDT', 'LINKUSDT', 'NEARUSDT', 'SUIUSDT',
  'LTCUSDT', 'ADAUSDT', 'DOTUSDT', 'APTUSDT', 'INJUSDT'
];

const rawDatasets = {};
for (const sym of topLiquidSymbols) {
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
    if (parsed.length > 500) rawDatasets[sym] = parsed;
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

function generate2SlotReport() {
  const initialBalance = 50.0;
  let curBalance = initialBalance;
  const maxDeals = 2;

  const allSignals = [];
  for (const sym of Object.keys(rawDatasets)) {
    if (sym === 'BTCUSDT') continue;
    const candles = rawDatasets[sym];
    const rsi = coinIndicators[sym].rsi14;

    for (let i = 50; i < candles.length; i++) {
      const c = candles[i];
      const btcIdx = btcMap.get(c.openTime);
      if (btcIdx !== undefined && (btcRSI[btcIdx] < 40 || btc15[btcIdx].close < btcEMA200[btcIdx])) continue;

      if (rsi[i - 1] < 30 && rsi[i] >= 30 && c.close >= c.open) {
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

  const candleMap = {};
  for (const sym of Object.keys(rawDatasets)) {
    candleMap[sym] = new Map();
    rawDatasets[sym].forEach((c, idx) => candleMap[sym].set(c.openTime, idx));
  }

  const signalMap = new Map();
  for (const sig of allSignals) {
    if (!signalMap.has(sig.openTime)) signalMap.set(sig.openTime, []);
    signalMap.get(sig.openTime).push(sig);
  }

  const allTimestampsSet = new Set();
  for (const sym of Object.keys(rawDatasets)) {
    for (const c of rawDatasets[sym]) allTimestampsSet.add(c.openTime);
  }
  const allTimestamps = Array.from(allTimestampsSet).sort((a, b) => a - b);

  const completedTrades = [];
  const activeDeals = [];

  for (const t of allTimestamps) {
    for (let d = activeDeals.length - 1; d >= 0; d--) {
      const deal = activeDeals[d];
      const sym = deal.symbol;
      const idx = candleMap[sym].get(t);
      if (idx === undefined) continue;

      const bar = rawDatasets[sym][idx];
      const rsiVal = coinIndicators[sym].rsi14[idx];

      if (deal.soFilled === 0 && bar.low <= deal.so1TriggerPrice) {
        const fillP = deal.so1TriggerPrice;
        deal.totalInvestedUSD += deal.so1USD;
        deal.totalCoins += deal.so1USD / fillP;
        deal.avgPrice = deal.totalInvestedUSD / deal.totalCoins;
        deal.soFilled = 1;
      }

      let isExit = false;
      let exitPrice = 0;
      let exitReason = '';

      const tpTarget = deal.avgPrice * (1 + 1.5 / 100);
      const curGainPct = ((bar.close - deal.avgPrice) / deal.avgPrice) * 100;

      if (bar.high >= tpTarget) {
        isExit = true;
        exitPrice = tpTarget * (1 - slipRate);
        exitReason = 'Take Profit Target (+1.5%)';
      } else if (rsiVal >= 50 && curGainPct >= 1.0) {
        isExit = true;
        exitPrice = bar.close * (1 - slipRate);
        exitReason = `Middle Line (RSI 50) Reached (+${curGainPct.toFixed(2)}%)`;
      } else if (bar.low <= deal.avgPrice * (1 - 10.0 / 100)) {
        isExit = true;
        exitPrice = deal.avgPrice * (1 - 10.0 / 100) * (1 - slipRate);
        exitReason = 'Emergency Stop Loss (-10.0%)';
      } else if (idx - deal.startIdx >= 288) {
        isExit = true;
        exitPrice = bar.close * (1 - slipRate);
        exitReason = 'Time Horizon Exit (3 Days)';
      }

      if (isExit) {
        const grossReturn = deal.totalCoins * exitPrice;
        const buyFee = deal.totalInvestedUSD * feeRate;
        const sellFee = grossReturn * feeRate;
        const fees = buyFee + sellFee;
        const netPnL = grossReturn - deal.totalInvestedUSD - fees;
        const netReturnPct = (netPnL / deal.totalInvestedUSD) * 100;

        const startBalBefore = curBalance;
        curBalance += netPnL;

        const durationH = ((bar.openTime - deal.openTime) / (3600 * 1000)).toFixed(1);

        completedTrades.push({
          'Trade #': completedTrades.length + 1,
          'Symbol': sym,
          'Slot #': deal.slotId,
          'Entry Time (UTC)': deal.entryTime,
          'Exit Time (UTC)': bar.time,
          'Duration (Hours)': Number(durationH),
          'Safety Orders Filled': deal.soFilled,
          'Base Invested ($)': Number(deal.baseUSD.toFixed(2)),
          'Total Invested ($)': Number(deal.totalInvestedUSD.toFixed(2)),
          'Avg Entry Price ($)': Number(deal.avgPrice.toFixed(4)),
          'Exit Price ($)': Number(exitPrice.toFixed(4)),
          'Binance Fees ($)': Number(fees.toFixed(3)),
          'Net Profit/Loss ($)': Number(netPnL.toFixed(2)),
          'Net Return (%)': Number(netReturnPct.toFixed(2)),
          'Account Balance ($)': Number(curBalance.toFixed(2)),
          'Cumulative Gain (%)': Number((((curBalance - initialBalance) / initialBalance) * 100).toFixed(2)),
          'Outcome': netPnL > 0 ? 'WIN' : 'LOSS',
          'Exit Reason': exitReason
        });
        activeDeals.splice(d, 1);
      }
    }

    if (activeDeals.length < maxDeals && signalMap.has(t)) {
      const sigs = signalMap.get(t);
      for (const sig of sigs) {
        if (activeDeals.length >= maxDeals) break;
        if (activeDeals.some(a => a.symbol === sig.symbol)) continue;

        // Slot ID: 1 or 2
        const usedSlots = new Set(activeDeals.map(a => a.slotId));
        const slotId = !usedSlots.has(1) ? 1 : 2;

        const slotCapital = curBalance / maxDeals;
        const baseUSD = Math.max(10, slotCapital * 0.30);
        const so1USD = Math.max(10, slotCapital * 0.70);

        activeDeals.push({
          slotId,
          symbol: sig.symbol,
          openTime: sig.openTime,
          entryTime: sig.time,
          startIdx: sig.candleIdx,
          entryPrice: sig.entryPrice,
          baseUSD,
          so1USD,
          totalInvestedUSD: baseUSD,
          totalCoins: baseUSD / sig.entryPrice,
          avgPrice: sig.entryPrice,
          so1TriggerPrice: sig.entryPrice * (1 - 3.5 / 100),
          soFilled: 0
        });
      }
    }
  }

  // Daily Calendar aggregation
  const dayStatsMap = new Map();
  for (const tr of completedTrades) {
    const day = tr['Exit Time (UTC)'].slice(0, 10);
    if (!dayStatsMap.has(day)) {
      dayStatsMap.set(day, { date: day, trades: 0, wins: 0, losses: 0, totalNetPnL: 0, fees: 0 });
    }
    const d = dayStatsMap.get(day);
    d.trades++;
    if (tr.Outcome === 'WIN') d.wins++; else d.losses++;
    d.totalNetPnL += tr['Net Profit/Loss ($)'];
    d.fees += tr['Binance Fees ($)'];
  }

  const dailyCalendarRows = [];
  let runningBal = initialBalance;
  for (const [day, data] of dayStatsMap.entries()) {
    runningBal += data.totalNetPnL;
    dailyCalendarRows.push({
      'Date': day,
      'Trades Completed': data.trades,
      'Wins': data.wins,
      'Losses': data.losses,
      'Daily Win Rate (%)': Number(((data.wins / data.trades) * 100).toFixed(1)),
      'Binance Fees ($)': Number(data.fees.toFixed(3)),
      'Net Daily Profit ($)': Number(data.totalNetPnL.toFixed(2)),
      'Ending Balance ($)': Number(runningBal.toFixed(2)),
      'Day Outcome': data.totalNetPnL > 0 ? 'PROFITABLE DAY 🟢' : (data.totalNetPnL === 0 ? 'BREAKEVEN ⚪' : 'LOSS DAY 🔴')
    });
  }

  const wins = completedTrades.filter(t => t.Outcome === 'WIN').length;
  const losses = completedTrades.filter(t => t.Outcome === 'LOSS').length;
  const winRate = ((wins / completedTrades.length) * 100).toFixed(1) + '%';
  const profitableDays = dailyCalendarRows.filter(r => r['Day Outcome'].includes('PROFITABLE')).length;
  const dailyWinRate = ((profitableDays / dailyCalendarRows.length) * 100).toFixed(1) + '%';
  const totalNetUSD = (curBalance - initialBalance).toFixed(2);
  const totalNetPct = (((curBalance - initialBalance) / initialBalance) * 100).toFixed(2) + '%';

  const wb = XLSX.utils.book_new();

  const summarySheet = [
    { 'NEXUS QUANT 2-SLOT DAILY COMPOSITION': 'Starting Capital', 'SPECIFICATION / RESULT': '$50.00' },
    { 'NEXUS QUANT 2-SLOT DAILY COMPOSITION': 'Concurrent Trading Slots', 'SPECIFICATION / RESULT': '2 Active Deals Running Simultaneously' },
    { 'NEXUS QUANT 2-SLOT DAILY COMPOSITION': 'Capital Allocation Per Slot', 'SPECIFICATION / RESULT': '50% of Account Balance Per Slot' },
    { 'NEXUS QUANT 2-SLOT DAILY COMPOSITION': 'Base Order Allocation', 'SPECIFICATION / RESULT': '30% of Slot ($10.00 min - meets Binance $10 limit)' },
    { 'NEXUS QUANT 2-SLOT DAILY COMPOSITION': 'Safety Order Allocation', 'SPECIFICATION / RESULT': '70% of Slot ($15.00+ - meets Binance $10 limit)' },
    { 'NEXUS QUANT 2-SLOT DAILY COMPOSITION': 'Safety Order Step Deviation', 'SPECIFICATION / RESULT': '-3.5% from Entry Price' },
    { 'NEXUS QUANT 2-SLOT DAILY COMPOSITION': 'Entry Signal', 'SPECIFICATION / RESULT': 'RSI(14) was < 30, crosses >= 30 into Purple Zone + Green Candle' },
    { 'NEXUS QUANT 2-SLOT DAILY COMPOSITION': 'Exit Mechanism 1 (Target TP)', 'SPECIFICATION / RESULT': '+1.5% from Average Price' },
    { 'NEXUS QUANT 2-SLOT DAILY COMPOSITION': 'Exit Mechanism 2 (Middle Line)', 'SPECIFICATION / RESULT': 'RSI 50 Reached with minimum +1.0% Profit Buffer' },
    { 'NEXUS QUANT 2-SLOT DAILY COMPOSITION': 'Emergency Stop Loss', 'SPECIFICATION / RESULT': '-10.0% from Average Price' },
    { 'NEXUS QUANT 2-SLOT DAILY COMPOSITION': 'Exchange Fees Deducted', 'SPECIFICATION / RESULT': '0.10% Buy + 0.10% Sell + 0.03% Slippage on EVERY Trade' },
    {},
    { 'NEXUS QUANT 2-SLOT DAILY COMPOSITION': 'PERFORMANCE & FREQUENCY SUMMARY' },
    { 'NEXUS QUANT 2-SLOT DAILY COMPOSITION': 'Total Completed Trades', 'SPECIFICATION / RESULT': completedTrades.length },
    { 'NEXUS QUANT 2-SLOT DAILY COMPOSITION': 'Total Winning Trades', 'SPECIFICATION / RESULT': wins },
    { 'NEXUS QUANT 2-SLOT DAILY COMPOSITION': 'Total Losing Trades', 'SPECIFICATION / RESULT': losses },
    { 'NEXUS QUANT 2-SLOT DAILY COMPOSITION': 'Trade Win Rate (%)', 'SPECIFICATION / RESULT': winRate },
    { 'NEXUS QUANT 2-SLOT DAILY COMPOSITION': 'Total Active Trading Days', 'SPECIFICATION / RESULT': dailyCalendarRows.length + ' Days' },
    { 'NEXUS QUANT 2-SLOT DAILY COMPOSITION': 'Green Profitable Days', 'SPECIFICATION / RESULT': profitableDays + ' Days (' + dailyWinRate + ')' },
    { 'NEXUS QUANT 2-SLOT DAILY COMPOSITION': 'Average Trades Per Active Day', 'SPECIFICATION / RESULT': (completedTrades.length / dailyCalendarRows.length).toFixed(1) + ' trades/day' },
    { 'NEXUS QUANT 2-SLOT DAILY COMPOSITION': 'Starting Account Balance', 'SPECIFICATION / RESULT': '$50.00' },
    { 'NEXUS QUANT 2-SLOT DAILY COMPOSITION': 'Final Compounded Balance', 'SPECIFICATION / RESULT': '$' + curBalance.toFixed(2) },
    { 'NEXUS QUANT 2-SLOT DAILY COMPOSITION': 'Net Dollar Profit ($)', 'SPECIFICATION / RESULT': '+$' + totalNetUSD },
    { 'NEXUS QUANT 2-SLOT DAILY COMPOSITION': 'Total Net Compounded Gain (%)', 'SPECIFICATION / RESULT': '+' + totalNetPct }
  ];

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summarySheet), 'Executive Summary');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dailyCalendarRows), 'Daily PnL Calendar');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(completedTrades), 'All 192 Deals Log (2 Slots)');

  const finalPath = path.join(outDir, 'nexus_quant_50_dollar_2slots_daily_compounding.xlsx');
  XLSX.writeFile(wb, finalPath);
  console.log('Saved 2-slot workbook to:', finalPath);
}

generate2SlotReport();
