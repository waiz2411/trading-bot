import fs from 'fs';
import path from 'path';

const cacheDir = './backend/src/data/binance_cache';
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

function aggregate30m(candles15m) {
  const intervalMs = 30 * 60 * 1000;
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

const dataset30m = {};
const indicators30m = {};
for (const sym of symbols) {
  const agg = aggregate30m(raw15m[sym]);
  dataset30m[sym] = agg;
  indicators30m[sym] = calculateRSI14(agg);
}

const feeRate = 0.0010;
const slipRate = 0.00015;

function test30mRefinement(cfg) {
  let curBalance = 50.0;
  const initialBalance = 50.0;
  const maxDeals = 2;

  const allSignals = [];
  for (const sym of symbols) {
    const candles = dataset30m[sym];
    const rsi = indicators30m[sym];
    for (let i = 50; i < candles.length; i++) {
      const c = candles[i];
      if (cfg.greenOnly && c.close < c.open) continue;

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
    dataset30m[sym].forEach((c, idx) => candleMap[sym].set(c.openTime, idx));
  }

  const signalMap = new Map();
  for (const sig of allSignals) {
    if (!signalMap.has(sig.openTime)) signalMap.set(sig.openTime, []);
    signalMap.get(sig.openTime).push(sig);
  }

  const allTimestampsSet = new Set();
  for (const sym of symbols) {
    for (const c of dataset30m[sym]) allTimestampsSet.add(c.openTime);
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

      const bar = dataset30m[sym][idx];
      const rsiVal = indicators30m[sym][idx];

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

      const targetPrice = deal.avgPrice * (1 + cfg.tpTargetPct / 100);
      const curGainPct = ((bar.close - deal.avgPrice) / deal.avgPrice) * 100;

      if (bar.high >= targetPrice) {
        isExit = true;
        exitPrice = targetPrice * (1 - slipRate);
        exitReason = 'Target TP Hit';
      } else if (rsiVal >= (cfg.midline || 50) && curGainPct >= (cfg.minProfit || 1.0)) {
        isExit = true;
        exitPrice = bar.close * (1 - slipRate);
        exitReason = `RSI ${cfg.midline || 50} Midline Hit`;
      } else if (cfg.slPct && bar.low <= deal.avgPrice * (1 - cfg.slPct / 100)) {
        isExit = true;
        exitPrice = deal.avgPrice * (1 - cfg.slPct / 100) * (1 - slipRate);
        exitReason = 'Stop Loss Hit';
      } else if (idx - deal.startIdx >= (cfg.maxBars || 96)) {
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
        curBalance += netPnL;

        const durationHours = (bar.openTime - deal.openTime) / (3600 * 1000);

        completedTrades.push({
          symbol: sym,
          time: bar.time,
          netPnL,
          fees,
          durationHours,
          soFilled: deal.soFilled,
          outcome: netPnL > 0 ? 'WIN' : 'LOSS'
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
          so1TriggerPrice: sig.entryPrice * (1 - (cfg.soDev || 4.0) / 100),
          soFilled: 0
        });
      }
    }
  }

  const daysMap = new Map();
  for (const tr of completedTrades) {
    const d = tr.time.slice(0, 10);
    daysMap.set(d, (daysMap.get(d) || 0) + 1);
  }

  const wins = completedTrades.filter(t => t.outcome === 'WIN').length;
  const losses = completedTrades.filter(t => t.outcome === 'LOSS').length;
  const totalFees = completedTrades.reduce((sum, t) => sum + t.fees, 0).toFixed(2);
  const avgDurationH = completedTrades.length ? (completedTrades.reduce((sum, t) => sum + t.durationHours, 0) / completedTrades.length).toFixed(1) : '0';

  return {
    name: cfg.name,
    trades: completedTrades.length,
    wins,
    losses,
    winRate: completedTrades.length ? ((wins / completedTrades.length) * 100).toFixed(1) + '%' : '0%',
    avgDurationH: avgDurationH + ' hrs',
    activeDays: daysMap.size,
    tradesPerDay: daysMap.size ? (completedTrades.length / daysMap.size).toFixed(1) : '0',
    fees: '$' + totalFees,
    start: '$' + initialBalance.toFixed(2),
    end: '$' + curBalance.toFixed(2),
    returnPct: (((curBalance - initialBalance) / initialBalance) * 100).toFixed(2) + '%'
  };
}

console.log('--- REFINING 30M TO REDUCE LOSSES ---');

// Original 30m baseline
console.log('1. Baseline (RSI 50, SO -4.0%, SL 10%, TP 2.0%):', test30mRefinement({
  name: 'Baseline 30m', midline: 50, minProfit: 1.0, soDev: 4.0, slPct: 10.0, maxBars: 96, tpTargetPct: 2.0
}));

// Test user setting: RSI 55 Middle Limit
console.log('2. User RSI 55 Middle Limit:', test30mRefinement({
  name: 'RSI 55 Midline', midline: 55, minProfit: 1.0, soDev: 4.0, slPct: 10.0, maxBars: 96, tpTargetPct: 2.0
}));

// Test Green Candle Confirmation on 30m
console.log('3. RSI 55 + Green Candle Confirmation:', test30mRefinement({
  name: 'RSI 55 + Green Candle', midline: 55, greenOnly: true, minProfit: 1.0, soDev: 4.0, slPct: 10.0, maxBars: 96, tpTargetPct: 2.0
}));

// Test SO at -4.5% + SL 12%
console.log('4. RSI 55 + SO at -4.5% + SL 12%:', test30mRefinement({
  name: 'RSI 55 + SO -4.5%', midline: 55, greenOnly: true, minProfit: 1.0, soDev: 4.5, slPct: 12.0, maxBars: 96, tpTargetPct: 2.0
}));

// Test Min Profit 1.2% + TP 2.5%
console.log('5. RSI 55 + TP 2.5% + Min Profit 1.2%:', test30mRefinement({
  name: 'RSI 55 + TP 2.5%', midline: 55, greenOnly: true, minProfit: 1.2, soDev: 4.5, slPct: 12.0, maxBars: 96, tpTargetPct: 2.5
}));
