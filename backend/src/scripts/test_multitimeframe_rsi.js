import fs from 'fs';
import path from 'path';

const cacheDir = './backend/src/data/binance_cache';
const files = fs.readdirSync(cacheDir).filter(f => f.endsWith('_15m_60d.json') && !f.startsWith('BTCUSDT'));

console.log(`Loading ${files.length} altcoin data files...`);

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
console.log(`Loaded ${symbols.length} pairs.`);

// Function to aggregate 15m candles to any interval (in minutes: 30, 60, 120)
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

function runTimeframeSimulation(intervalMinutes, intervalName, soDevPct, slPct, maxBars) {
  // 1. Build aggregated candles and RSI
  const dataset = {};
  const indicators = {};
  for (const sym of symbols) {
    const agg = intervalMinutes === 15 ? raw15m[sym] : aggregateCandles(raw15m[sym], intervalMinutes);
    dataset[sym] = agg;
    indicators[sym] = calculateRSI14(agg);
  }

  // 2. Gather signals
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
    // Check existing deals
    for (let d = activeDeals.length - 1; d >= 0; d--) {
      const deal = activeDeals[d];
      const sym = deal.symbol;
      const idx = candleMap[sym].get(t);
      if (idx === undefined) continue;

      const bar = dataset[sym][idx];
      const rsiVal = indicators[sym][idx];

      // Safety order check
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

      // Pure RSI exit: touches middle line (RSI >= 50)
      if (rsiVal >= 50) {
        isExit = true;
        exitPrice = bar.close * (1 - slipRate);
        exitReason = 'RSI 50 Middle Line';
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
          symbol: sym,
          entryTime: deal.entryTime,
          exitTime: bar.time,
          durationHours,
          soFilled: deal.soFilled,
          baseUSD: deal.baseUSD,
          investedUSD: deal.totalInvestedUSD,
          avgPrice: deal.avgPrice,
          exitPrice,
          grossReturnPct,
          fees,
          netPnL,
          netReturnPct,
          curBalance,
          exitReason
        });
        activeDeals.splice(d, 1);
      }
    }

    // Open new deals
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

  // Calculate statistics
  const total = completedTrades.length;
  const wins = completedTrades.filter(t => t.netPnL > 0).length;
  const losses = completedTrades.filter(t => t.netPnL <= 0).length;
  const winRate = total ? ((wins / total) * 100).toFixed(1) + '%' : '0%';
  const avgDurationHours = total ? (completedTrades.reduce((sum, t) => sum + t.durationHours, 0) / total).toFixed(1) : '0';
  const totalFees = completedTrades.reduce((sum, t) => sum + t.fees, 0).toFixed(2);
  const netProfitUSD = (curBalance - initialBalance).toFixed(2);
  const netReturnPct = (((curBalance - initialBalance) / initialBalance) * 100).toFixed(2) + '%';

  // Day stats
  const daysMap = new Map();
  for (const tr of completedTrades) {
    const d = tr.exitTime.slice(0, 10);
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
    totalFeesPaid: '$' + totalFees,
    startBalance: '$' + initialBalance.toFixed(2),
    endBalance: '$' + curBalance.toFixed(2),
    netProfitUSD: (curBalance >= initialBalance ? '+$' : '-$') + Math.abs(curBalance - initialBalance).toFixed(2),
    netReturnPct,
    completedTrades
  };
}

console.log('=== MULTI-TIMEFRAME RSI MIDDLE LINE COMPARISON ($50 START, 2 SLOTS) ===');

const res15m = runTimeframeSimulation(15, '15-Minute (15m)', 3.5, 8.0, 96);
console.log('15-Minute:', {
  Trades: res15m.totalTrades,
  WinRate: res15m.winRate,
  AvgTimeHours: res15m.avgDurationHours,
  AvgTimeDays: res15m.avgDurationDays,
  TradesPerDay: res15m.tradesPerDay,
  Fees: res15m.totalFeesPaid,
  EndBal: res15m.endBalance,
  Return: res15m.netReturnPct
});

const res30m = runTimeframeSimulation(30, '30-Minute (30m)', 4.0, 10.0, 96);
console.log('30-Minute:', {
  Trades: res30m.totalTrades,
  WinRate: res30m.winRate,
  AvgTimeHours: res30m.avgDurationHours,
  AvgTimeDays: res30m.avgDurationDays,
  TradesPerDay: res30m.tradesPerDay,
  Fees: res30m.totalFeesPaid,
  EndBal: res30m.endBalance,
  Return: res30m.netReturnPct
});

const res1h = runTimeframeSimulation(60, '1-Hour (1h)', 5.0, 12.0, 96);
console.log('1-Hour:', {
  Trades: res1h.totalTrades,
  WinRate: res1h.winRate,
  AvgTimeHours: res1h.avgDurationHours,
  AvgTimeDays: res1h.avgDurationDays,
  TradesPerDay: res1h.tradesPerDay,
  Fees: res1h.totalFeesPaid,
  EndBal: res1h.endBalance,
  Return: res1h.netReturnPct
});

const res2h = runTimeframeSimulation(120, '2-Hour (2h)', 6.0, 15.0, 96);
console.log('2-Hour:', {
  Trades: res2h.totalTrades,
  WinRate: res2h.winRate,
  AvgTimeHours: res2h.avgDurationHours,
  AvgTimeDays: res2h.avgDurationDays,
  TradesPerDay: res2h.tradesPerDay,
  Fees: res2h.totalFeesPaid,
  EndBal: res2h.endBalance,
  Return: res2h.netReturnPct
});
