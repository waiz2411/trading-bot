import fs from 'fs';
import path from 'path';

const cacheDir = './backend/src/data/binance_cache';

const top25Halal = [
  'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'AVAXUSDT',
  'SUIUSDT', 'NEARUSDT', 'LINKUSDT', 'APTUSDT', 'ADAUSDT',
  'DOTUSDT', 'LTCUSDT', 'INJUSDT', 'RENDERUSDT', 'FETUSDT',
  'TIAUSDT', 'SEIUSDT', 'FILUSDT', 'ATOMUSDT', 'ARBUSDT',
  'OPUSDT', 'HBARUSDT', 'ICPUSDT', 'XLMUSDT', 'VETUSDT'
];

const raw15m = {};
for (const sym of top25Halal) {
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
    if (parsed.length > 500) raw15m[sym] = parsed;
  } catch (_) {}
}

const symbols = Object.keys(raw15m);
console.log(`Loaded ${symbols.length} top liquid halal coins.`);

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
for (const sym of symbols) {
  coinIndicators[sym] = {
    rsi14: calculateRSI14(raw15m[sym])
  };
}

const feeRate = 0.0010;
const slipRate = 0.00015;

function testTop25(cfg) {
  let curBalance = 50.0;
  const initialBalance = 50.0;
  const maxDeals = 2;

  const allSignals = [];
  for (const sym of symbols) {
    const candles = raw15m[sym];
    const ind = coinIndicators[sym];

    for (let i = 50; i < candles.length; i++) {
      const c = candles[i];
      const btcIdx = btcMap.get(c.openTime);
      if (cfg.btcGuard && btcIdx !== undefined) {
        if (btcRSI[btcIdx] < (cfg.btcHurdle || 38) || btc15[btcIdx].close < btcEMA200[btcIdx]) continue;
      }

      if (ind.rsi14[i - 1] < 30 && ind.rsi14[i] >= 30 && c.close >= c.open) {
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

  const candleMap = {};
  for (const sym of symbols) {
    candleMap[sym] = new Map();
    raw15m[sym].forEach((c, idx) => candleMap[sym].set(c.openTime, idx));
  }

  const signalMap = new Map();
  for (const sig of allSignals) {
    if (!signalMap.has(sig.openTime)) signalMap.set(sig.openTime, []);
    signalMap.get(sig.openTime).push(sig);
  }

  const allTimestampsSet = new Set();
  for (const sym of symbols) {
    for (const c of raw15m[sym]) allTimestampsSet.add(c.openTime);
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

      const bar = raw15m[sym][idx];
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

      const targetTP = deal.avgPrice * (1 + (cfg.tpPct || 1.5) / 100);
      const curGainPct = ((bar.close - deal.avgPrice) / deal.avgPrice) * 100;

      if (bar.high >= targetTP) {
        isExit = true;
        exitPrice = targetTP * (1 - slipRate);
        exitReason = 'TP Target Hit';
      } else if (rsiVal >= 55 && curGainPct >= (cfg.minProfit || 0.8)) {
        isExit = true;
        exitPrice = bar.close * (1 - slipRate);
        exitReason = 'RSI 55 Exit';
      } else if (bar.low <= deal.avgPrice * (1 - (cfg.slPct || 10.0) / 100)) {
        isExit = true;
        exitPrice = deal.avgPrice * (1 - (cfg.slPct || 10.0) / 100) * (1 - slipRate);
        exitReason = 'SL Hit';
      } else if (idx - deal.startIdx >= 288) {
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

        const durationH = (bar.openTime - deal.openTime) / (3600 * 1000);

        completedTrades.push({
          symbol: sym,
          netPnL,
          fees,
          durationH,
          time: bar.time,
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
        const baseUSD = Math.max(10, slotCapital * 0.30);
        const so1USD = Math.max(10, slotCapital * 0.70);

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
          so1TriggerPrice: sig.entryPrice * (1 - (cfg.soDev || 3.5) / 100),
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
  const avgDurationH = completedTrades.length ? (completedTrades.reduce((sum, t) => sum + t.durationH, 0) / completedTrades.length).toFixed(1) : '0';

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

console.log('\n--- TOP 25 LIQUID HALAL COINS (15M RSI 55) ---');
console.log('Test 1 (BTC 38 Hurdle, TP 1.5%, Min Profit 0.8%):', testTop25({
  name: 'Top 25 Halal (BTC 38)',
  btcGuard: true,
  btcHurdle: 38,
  tpPct: 1.5,
  minProfit: 0.8,
  slPct: 10.0,
  soDev: 3.5
}));

console.log('Test 2 (BTC 36 Hurdle, TP 1.5%, Min Profit 0.8%):', testTop25({
  name: 'Top 25 Halal (BTC 36)',
  btcGuard: true,
  btcHurdle: 36,
  tpPct: 1.5,
  minProfit: 0.8,
  slPct: 10.0,
  soDev: 3.5
}));

console.log('Test 3 (BTC 38 Hurdle, TP 1.8%, Min Profit 1.0%):', testTop25({
  name: 'Top 25 Halal (TP 1.8% / Profit 1.0%)',
  btcGuard: true,
  btcHurdle: 38,
  tpPct: 1.8,
  minProfit: 1.0,
  slPct: 10.0,
  soDev: 3.5
}));
