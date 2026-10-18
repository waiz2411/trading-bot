import fs from 'fs';
import path from 'path';

const cacheDir = './backend/src/data/binance_cache';

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

// Let's test Pure RSI Re-entry (cross >= 30) + Pure Middle Line Exit (RSI >= 50)
// Across ALL 94 coins with 2 active slots on $50 capital:
function runPureRSI2Slots(soDev = 3.5, slPct = 8.0, maxBars = 96) {
  let curBalance = 50.0;
  const initialBalance = 50.0;
  const maxDeals = 2;

  // Gather all signals across all 94 coins
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
    // 1. Check existing deals
    for (let d = activeDeals.length - 1; d >= 0; d--) {
      const deal = activeDeals[d];
      const sym = deal.symbol;
      const idx = candleMap[sym].get(t);
      if (idx === undefined) continue;

      const bar = rawDatasets[sym][idx];
      const rsiVal = coinRSI[sym][idx];

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
        exitReason = 'Stop Loss';
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
        curBalance += netPnL;

        completedTrades.push({
          symbol: sym,
          netPnL,
          exitReason,
          soFilled: deal.soFilled,
          time: bar.time,
          durationBars: idx - deal.startIdx
        });
        activeDeals.splice(d, 1);
      }
    }

    // 2. Open new deals
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

  const daysMap = new Map();
  for (const tr of completedTrades) {
    const day = tr.time.slice(0, 10);
    if (!daysMap.has(day)) daysMap.set(day, { trades: 0, wins: 0, profit: 0 });
    const d = daysMap.get(day);
    d.trades++;
    if (tr.netPnL > 0) d.wins++;
    d.profit += tr.netPnL;
  }

  const wins = completedTrades.filter(t => t.netPnL > 0).length;
  return {
    soDev,
    slPct,
    maxBars,
    totalTrades: completedTrades.length,
    wins,
    losses: completedTrades.length - wins,
    winRate: completedTrades.length ? ((wins / completedTrades.length) * 100).toFixed(1) + '%' : '0%',
    tradingDays: daysMap.size,
    profitableDays: Array.from(daysMap.values()).filter(d => d.profit > 0).length,
    tradesPerDay: daysMap.size ? (completedTrades.length / daysMap.size).toFixed(1) : '0',
    start: '$' + initialBalance.toFixed(2),
    end: '$' + curBalance.toFixed(2),
    gain: (((curBalance - initialBalance) / initialBalance) * 100).toFixed(2) + '%'
  };
}

console.log('Testing Pure RSI 2-slot with fast rotation across all 94 coins:');
console.log('Test 1 (SO at -3.5%, SL 8%, Max 24h timeout):', runPureRSI2Slots(3.5, 8.0, 96));
console.log('Test 2 (SO at -3.5%, SL 10%, Max 48h timeout):', runPureRSI2Slots(3.5, 10.0, 192));
console.log('Test 3 (SO at -4.0%, SL 10%, Max 24h timeout):', runPureRSI2Slots(4.0, 10.0, 96));
console.log('Test 4 (SO at -3.0%, SL 6%, Max 24h timeout):', runPureRSI2Slots(3.0, 6.0, 96));
