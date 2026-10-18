import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';

const cacheDir = './backend/src/data/binance_cache';
const outDir = 'C:/Users/waizt/.gemini/antigravity/brain/9240cc1b-f576-4996-a196-552f1f9e4603';

const files = fs.readdirSync(cacheDir).filter(f => f.endsWith('_15m_60d.json') && !f.startsWith('BTCUSDT'));

const raw15m = {};
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
    if (parsed.length > 500) raw15m[sym] = parsed;
  } catch (_) {}
}

const symbols = Object.keys(raw15m);

function aggregateCandles(candles15m, intervalMinutes) {
  const intervalMs = intervalMinutes * 60 * 1000;
  const result = [];
  let cur = null;

  for (const c of candles15m) {
    const bucketTime = Math.floor(c.openTime / intervalMs) * intervalMs;
    if (!cur || cur.openTime !== bucketTime) {
      if (cur) result.push(cur);
      cur = {
        openTime: bucketTime,
        time: new Date(bucketTime).toISOString(),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume
      };
    } else {
      cur.high = Math.max(cur.high, c.high);
      cur.low = Math.min(cur.low, c.low);
      cur.close = c.close;
      cur.volume += c.volume;
    }
  }
  if (cur) result.push(cur);
  return result;
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

const feeRate = 0.0010;
const slipRate = 0.00015;

function runTimeframeEngine(intervalMinutes, intervalName, soDevPct, slPct, maxBars, tpTargetPct) {
  const dataset = {};
  const indicators = {};
  for (const sym of symbols) {
    const agg = intervalMinutes === 15 ? raw15m[sym] : aggregateCandles(raw15m[sym], intervalMinutes);
    dataset[sym] = agg;
    indicators[sym] = calculateRSI14(agg);
  }

  const allSignals = [];
  for (const sym of symbols) {
    const candles = dataset[sym];
    const rsi = indicators[sym];
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
  for (const sym of symbols) {
    candleMap[sym] = new Map();
    dataset[sym].forEach((c, idx) => candleMap[sym].set(c.openTime, idx));
  }

  const signalMap = new Map();
  for (const sig of allSignals) {
    if (!signalMap.has(sig.openTime)) signalMap.set(sig.openTime, []);
    signalMap.get(sig.openTime).push(sig);
  }

  const allTimestampsSet = new Set();
  for (const sym of symbols) {
    for (const c of dataset[sym]) allTimestampsSet.add(c.openTime);
  }
  const allTimestamps = Array.from(allTimestampsSet).sort((a, b) => a - b);

  let curBalance = 50.0;
  const initialBalance = 50.0;
  const maxDeals = 2;
  const completedTrades = [];
  const activeDeals = [];

  for (const t of allTimestamps) {
    for (let d = activeDeals.length - 1; d >= 0; d--) {
      const deal = activeDeals[d];
      const sym = deal.symbol;
      const idx = candleMap[sym].get(t);
      if (idx === undefined) continue;

      const bar = dataset[sym][idx];
      const rsiVal = indicators[sym][idx];

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

      const targetPrice = deal.avgPrice * (1 + tpTargetPct / 100);
      const curGainPct = ((bar.close - deal.avgPrice) / deal.avgPrice) * 100;

      if (bar.high >= targetPrice) {
        isExit = true;
        exitPrice = targetPrice * (1 - slipRate);
        exitReason = `Target TP (+${tpTargetPct}%)`;
      } else if (rsiVal >= 50 && curGainPct >= 1.0) {
        isExit = true;
        exitPrice = bar.close * (1 - slipRate);
        exitReason = `Middle Line RSI 50 (+${curGainPct.toFixed(2)}%)`;
      } else if (slPct && bar.low <= deal.avgPrice * (1 - slPct / 100)) {
        isExit = true;
        exitPrice = deal.avgPrice * (1 - slPct / 100) * (1 - slipRate);
        exitReason = `Stop Loss Hit (-${slPct}%)`;
      } else if (idx - deal.startIdx >= maxBars) {
        isExit = true;
        exitPrice = bar.close * (1 - slipRate);
        exitReason = 'Timeout Exit';
      }

      if (isExit) {
        const grossReturn = deal.totalCoins * exitPrice;
        const buyFee = deal.totalInvestedUSD * feeRate;
        const sellFee = grossReturn * feeRate;
        const fees = buyFee + sellFee;
        const netPnL = grossReturn - deal.totalInvestedUSD - fees;
        const netReturnPct = (netPnL / deal.totalInvestedUSD) * 100;
        const grossReturnPct = ((grossReturn - deal.totalInvestedUSD) / deal.totalInvestedUSD) * 100;

        curBalance += netPnL;
        const durationHours = ((bar.openTime - deal.openTime) / (3600 * 1000));

        completedTrades.push({
          'Trade #': completedTrades.length + 1,
          'Symbol': sym,
          'Timeframe': intervalName,
          'Entry Time (UTC)': deal.entryTime,
          'Exit Time (UTC)': bar.time,
          'Duration (Hours)': Number(durationHours.toFixed(1)),
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

        const slotCapital = curBalance / maxDeals;
        const baseUSD = Math.max(10, slotCapital * 0.35);
        const so1USD = Math.max(10, slotCapital * 0.65);

        activeDeals.push({
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
          so1TriggerPrice: sig.entryPrice * (1 - soDevPct / 100),
          soFilled: 0
        });
      }
    }
  }

  const total = completedTrades.length;
  const wins = completedTrades.filter(t => t.Outcome === 'WIN').length;
  const losses = completedTrades.filter(t => t.Outcome === 'LOSS').length;
  const winRate = total ? ((wins / total) * 100).toFixed(1) + '%' : '0%';
  const avgDurationHours = total ? (completedTrades.reduce((sum, t) => sum + t['Duration (Hours)'], 0) / total).toFixed(1) : '0';
  const totalFees = completedTrades.reduce((sum, t) => sum + t['Binance Fees ($)'], 0).toFixed(2);
  const netProfitUSD = (curBalance - initialBalance).toFixed(2);
  const netReturnPct = (((curBalance - initialBalance) / initialBalance) * 100).toFixed(2) + '%';

  const daysMap = new Map();
  for (const tr of completedTrades) {
    const d = tr['Exit Time (UTC)'].slice(0, 10);
    daysMap.set(d, (daysMap.get(d) || 0) + 1);
  }
  const totalTradingDays = daysMap.size;
  const tradesPerDay = totalTradingDays ? (total / totalTradingDays).toFixed(1) : '0';

  return {
    timeframe: intervalName,
    totalTrades: total,
    wins,
    losses,
    winRate,
    avgDurationHours: Number(avgDurationHours),
    avgDurationDays: (Number(avgDurationHours) / 24).toFixed(1) + ' days',
    tradesPerDay,
    totalTradingDays,
    totalFeesPaid: '$' + totalFees,
    startBalance: '$' + initialBalance.toFixed(2),
    endBalance: '$' + curBalance.toFixed(2),
    netProfitUSD: (curBalance >= initialBalance ? '+$' : '-$') + Math.abs(curBalance - initialBalance).toFixed(2),
    netReturnPct,
    completedTrades
  };
}

// Generate the 4-timeframe comparisons
const res15 = runTimeframeEngine(15, '15-Minute (15m)', 3.5, 8.0, 96, 1.5);
const res30 = runTimeframeEngine(30, '30-Minute (30m)', 4.0, 10.0, 96, 2.0);
const res60 = runTimeframeEngine(60, '1-Hour (1h)', 5.0, 12.0, 96, 2.5);
const res120 = runTimeframeEngine(120, '2-Hour (2h)', 6.0, 15.0, 96, 3.5);

// Build multi-sheet Excel file
const wb = XLSX.utils.book_new();

const summaryRows = [
  {
    'MULTI-TIMEFRAME RSI AUDIT': 'Metric',
    '15-MINUTE (15m)': '15-Minute Candles',
    '30-MINUTE (30m)': '30-Minute Candles',
    '1-HOUR (1h)': '1-Hour Candles',
    '2-HOUR (2h)': '2-Hour Candles'
  },
  {
    'MULTI-TIMEFRAME RSI AUDIT': 'Total Trades Completed',
    '15-MINUTE (15m)': res15.totalTrades,
    '30-MINUTE (30m)': res30.totalTrades,
    '1-HOUR (1h)': res60.totalTrades,
    '2-HOUR (2h)': res120.totalTrades
  },
  {
    'MULTI-TIMEFRAME RSI AUDIT': 'Winning Trades',
    '15-MINUTE (15m)': res15.wins,
    '30-MINUTE (30m)': res30.wins,
    '1-HOUR (1h)': res60.wins,
    '2-HOUR (2h)': res120.wins
  },
  {
    'MULTI-TIMEFRAME RSI AUDIT': 'Losing Trades',
    '15-MINUTE (15m)': res15.losses,
    '30-MINUTE (30m)': res30.losses,
    '1-HOUR (1h)': res60.losses,
    '2-HOUR (2h)': res120.losses
  },
  {
    'MULTI-TIMEFRAME RSI AUDIT': 'Win Rate (%)',
    '15-MINUTE (15m)': res15.winRate,
    '30-MINUTE (30m)': res30.winRate,
    '1-HOUR (1h)': res60.winRate,
    '2-HOUR (2h)': res120.winRate
  },
  {
    'MULTI-TIMEFRAME RSI AUDIT': 'Average Trade Duration (Hours)',
    '15-MINUTE (15m)': res15.avgDurationHours + ' hrs',
    '30-MINUTE (30m)': res30.avgDurationHours + ' hrs',
    '1-HOUR (1h)': res60.avgDurationHours + ' hrs',
    '2-HOUR (2h)': res120.avgDurationHours + ' hrs'
  },
  {
    'MULTI-TIMEFRAME RSI AUDIT': 'Average Trade Duration (Days)',
    '15-MINUTE (15m)': res15.avgDurationDays,
    '30-MINUTE (30m)': res30.avgDurationDays,
    '1-HOUR (1h)': res60.avgDurationDays,
    '2-HOUR (2h)': res120.avgDurationDays
  },
  {
    'MULTI-TIMEFRAME RSI AUDIT': 'Trades Per Active Day',
    '15-MINUTE (15m)': res15.tradesPerDay + ' trades/day',
    '30-MINUTE (30m)': res30.tradesPerDay + ' trades/day',
    '1-HOUR (1h)': res60.tradesPerDay + ' trades/day',
    '2-HOUR (2h)': res120.tradesPerDay + ' trades/day'
  },
  {
    'MULTI-TIMEFRAME RSI AUDIT': 'Total Exchange Fees Paid ($)',
    '15-MINUTE (15m)': res15.totalFeesPaid,
    '30-MINUTE (30m)': res30.totalFeesPaid,
    '1-HOUR (1h)': res60.totalFeesPaid,
    '2-HOUR (2h)': res120.totalFeesPaid
  },
  {
    'MULTI-TIMEFRAME RSI AUDIT': 'Starting Capital ($)',
    '15-MINUTE (15m)': res15.startBalance,
    '30-MINUTE (30m)': res30.startBalance,
    '1-HOUR (1h)': res60.startBalance,
    '2-HOUR (2h)': res120.startBalance
  },
  {
    'MULTI-TIMEFRAME RSI AUDIT': 'Ending Balance ($)',
    '15-MINUTE (15m)': res15.endBalance,
    '30-MINUTE (30m)': res30.endBalance,
    '1-HOUR (1h)': res60.endBalance,
    '2-HOUR (2h)': res120.endBalance
  },
  {
    'MULTI-TIMEFRAME RSI AUDIT': 'Net Dollar Profit ($)',
    '15-MINUTE (15m)': res15.netProfitUSD,
    '30-MINUTE (30m)': res30.netProfitUSD,
    '1-HOUR (1h)': res60.netProfitUSD,
    '2-HOUR (2h)': res120.netProfitUSD
  },
  {
    'MULTI-TIMEFRAME RSI AUDIT': 'Net Compounded Return (%)',
    '15-MINUTE (15m)': res15.netReturnPct,
    '30-MINUTE (30m)': res30.netReturnPct,
    '1-HOUR (1h)': res60.netReturnPct,
    '2-HOUR (2h)': res120.netReturnPct
  }
];

XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), 'Timeframe Comparison');
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(res15.completedTrades), '15-Minute Deals Log');
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(res30.completedTrades), '30-Minute Deals Log');
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(res60.completedTrades), '1-Hour Deals Log');
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(res120.completedTrades), '2-Hour Deals Log');

const finalPath = path.join(outDir, 'nexus_quant_multitimeframe_rsi_audit.xlsx');
XLSX.writeFile(wb, finalPath);
console.log('Saved multi-timeframe comparison workbook to:', finalPath);
