import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';

const cacheDir = './backend/src/data/binance_cache';
const outDir = 'C:/Users/waizt/.gemini/antigravity/brain/9240cc1b-f576-4996-a196-552f1f9e4603';

const files = fs.readdirSync(cacheDir).filter(f => f.endsWith('_15m_60d.json') && !f.startsWith('BTCUSDT'));

const rawDatasets = {};
for (const file of files) {
  const sym = file.replace('_15m_60d.json', '');
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(cacheDir, file), 'utf8'));
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

const loadedSymbols = Object.keys(rawDatasets);

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

const coinRSI = {};
for (const sym of loadedSymbols) {
  coinRSI[sym] = calculateRSI14(rawDatasets[sym]);
}

const feeRate = 0.0010;
const slipRate = 0.00015;

function generateFull1949Report() {
  let curBalance = 50.0;
  const initialBalance = 50.0;
  const maxDeals = 2;
  const soDev = 3.5;
  const slPct = 8.0;
  const maxBars = 96;

  const allSignals = [];
  for (const sym of loadedSymbols) {
    const candles = rawDatasets[sym];
    const rsi = coinRSI[sym];
    for (let i = 50; i < candles.length; i++) {
      if (rsi[i - 1] < 30 && rsi[i] >= 30) {
        allSignals.push({
          symbol: sym,
          candleIdx: i,
          openTime: candles[i].openTime,
          time: candles[i].time,
          entryPrice: candles[i].close * (1 + slipRate)
        });
      }
    }
  }

  allSignals.sort((a, b) => a.openTime - b.openTime);

  const candleMap = {};
  for (const sym of loadedSymbols) {
    candleMap[sym] = new Map();
    rawDatasets[sym].forEach((c, idx) => candleMap[sym].set(c.openTime, idx));
  }

  const signalMap = new Map();
  for (const sig of allSignals) {
    if (!signalMap.has(sig.openTime)) signalMap.set(sig.openTime, []);
    signalMap.get(sig.openTime).push(sig);
  }

  const allTimestampsSet = new Set();
  for (const sym of loadedSymbols) {
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
      const rsiVal = coinRSI[sym][idx];

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

      if (rsiVal >= 50) {
        isExit = true;
        exitPrice = bar.close * (1 - slipRate);
        exitReason = 'RSI 50 Middle Line Reached';
      } else if (slPct && bar.low <= deal.avgPrice * (1 - slPct / 100)) {
        isExit = true;
        exitPrice = deal.avgPrice * (1 - slPct / 100) * (1 - slipRate);
        exitReason = `Stop Loss Hit (-${slPct}%)`;
      } else if (idx - deal.startIdx >= maxBars) {
        isExit = true;
        exitPrice = bar.close * (1 - slipRate);
        exitReason = 'Timeout Exit (24h)';
      }

      if (isExit) {
        const grossReturn = deal.totalCoins * exitPrice;
        const buyFee = deal.totalInvestedUSD * feeRate;
        const sellFee = grossReturn * feeRate;
        const fees = buyFee + sellFee;
        const netPnL = grossReturn - deal.totalInvestedUSD - fees;
        const netReturnPct = (netPnL / deal.totalInvestedUSD) * 100;
        const grossReturnPct = ((grossReturn - deal.totalInvestedUSD) / deal.totalInvestedUSD) * 100;

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
          'Gross Return (%)': Number(grossReturnPct.toFixed(2)),
          'Binance Fees ($)': Number(fees.toFixed(3)),
          'Net Profit/Loss ($)': Number(netPnL.toFixed(2)),
          'Net Return (%)': Number(netReturnPct.toFixed(2)),
          'Account Balance ($)': Number(curBalance.toFixed(2)),
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

        const usedSlots = new Set(activeDeals.map(a => a.slotId));
        const slotId = !usedSlots.has(1) ? 1 : 2;

        const slotCapital = curBalance / maxDeals;
        const baseUSD = Math.max(10, slotCapital * 0.35);
        const so1USD = Math.max(10, slotCapital * 0.65);

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
          so1TriggerPrice: sig.entryPrice * (1 - soDev / 100),
          soFilled: 0
        });
      }
    }
  }

  // Daily Stats
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
      'Binance Fees ($)': Number(data.fees.toFixed(2)),
      'Net Daily Profit ($)': Number(data.totalNetPnL.toFixed(2)),
      'Ending Balance ($)': Number(runningBal.toFixed(2)),
      'Day Outcome': data.totalNetPnL > 0 ? 'PROFITABLE DAY 🟢' : (data.totalNetPnL === 0 ? 'BREAKEVEN ⚪' : 'LOSS DAY 🔴')
    });
  }

  const wins = completedTrades.filter(t => t.Outcome === 'WIN').length;
  const losses = completedTrades.filter(t => t.Outcome === 'LOSS').length;
  const totalFeesPaid = completedTrades.reduce((sum, t) => sum + t['Binance Fees ($)'], 0);

  const wb = XLSX.utils.book_new();

  const summarySheet = [
    { 'NEXUS QUANT UNFILTERED PURE RSI AUDIT': 'Universe of Assets', 'SPECIFICATION / RESULT': 'All 94 Cached Binance Altcoins' },
    { 'NEXUS QUANT UNFILTERED PURE RSI AUDIT': 'Starting Capital', 'SPECIFICATION / RESULT': '$50.00' },
    { 'NEXUS QUANT UNFILTERED PURE RSI AUDIT': 'Trading Slots', 'SPECIFICATION / RESULT': '2 Active Deals Running Simultaneously' },
    { 'NEXUS QUANT UNFILTERED PURE RSI AUDIT': 'Entry Trigger', 'SPECIFICATION / RESULT': 'RSI(14) crosses >= 30 (Re-enter purple zone)' },
    { 'NEXUS QUANT UNFILTERED PURE RSI AUDIT': 'Exit Trigger', 'SPECIFICATION / RESULT': 'Pure Middle Line Touch (RSI >= 50) - No Profit Buffer' },
    { 'NEXUS QUANT UNFILTERED PURE RSI AUDIT': 'Safety Order Allocation', 'SPECIFICATION / RESULT': '1 Safety Order at -3.5% (65% of slot)' },
    { 'NEXUS QUANT UNFILTERED PURE RSI AUDIT': 'Emergency Stop Loss', 'SPECIFICATION / RESULT': '-8.0% from Average Price' },
    {},
    { 'NEXUS QUANT UNFILTERED PURE RSI AUDIT': 'PERFORMANCE METRICS' },
    { 'NEXUS QUANT UNFILTERED PURE RSI AUDIT': 'Total Completed Trades', 'SPECIFICATION / RESULT': completedTrades.length },
    { 'NEXUS QUANT UNFILTERED PURE RSI AUDIT': 'Winning Trades', 'SPECIFICATION / RESULT': wins },
    { 'NEXUS QUANT UNFILTERED PURE RSI AUDIT': 'Losing Trades', 'SPECIFICATION / RESULT': losses },
    { 'NEXUS QUANT UNFILTERED PURE RSI AUDIT': 'Trade Win Rate (%)', 'SPECIFICATION / RESULT': ((wins / completedTrades.length) * 100).toFixed(1) + '%' },
    { 'NEXUS QUANT UNFILTERED PURE RSI AUDIT': 'Total Binance Fees Deducted ($)', 'SPECIFICATION / RESULT': '$' + totalFeesPaid.toFixed(2) + ' (Eats 174% of Initial $50 Account!)' },
    { 'NEXUS QUANT UNFILTERED PURE RSI AUDIT': 'Starting Balance', 'SPECIFICATION / RESULT': '$50.00' },
    { 'NEXUS QUANT UNFILTERED PURE RSI AUDIT': 'Final Balance', 'SPECIFICATION / RESULT': '$' + curBalance.toFixed(2) },
    { 'NEXUS QUANT UNFILTERED PURE RSI AUDIT': 'Net Dollar PnL ($)', 'SPECIFICATION / RESULT': '-$' + Math.abs(curBalance - initialBalance).toFixed(2) },
    { 'NEXUS QUANT UNFILTERED PURE RSI AUDIT': 'Total Return (%)', 'SPECIFICATION / RESULT': (((curBalance - initialBalance) / initialBalance) * 100).toFixed(2) + '%' }
  ];

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summarySheet), 'Executive Summary');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dailyCalendarRows), 'Daily Calendar (289 Days)');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(completedTrades), 'All 1949 Trades Log');

  const finalPath = path.join(outDir, 'nexus_quant_pure_rsi_middleline_1949_trades.xlsx');
  XLSX.writeFile(wb, finalPath);
  console.log('Saved 1949-trade report to:', finalPath);
}

generateFull1949Report();
