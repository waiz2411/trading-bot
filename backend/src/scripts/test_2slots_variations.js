import fs from 'fs';
import path from 'path';

const cacheDir = './backend/src/data/binance_cache';
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

function test2SlotsVariations(cfg) {
  let curBalance = cfg.startBalance || 50.0;
  const initialBalance = curBalance;
  const maxDeals = 2;

  const allSignals = [];
  for (const sym of Object.keys(rawDatasets)) {
    if (sym === 'BTCUSDT') continue;
    const candles = rawDatasets[sym];
    const rsi = coinIndicators[sym].rsi14;

    for (let i = 50; i < candles.length; i++) {
      const c = candles[i];
      const btcIdx = btcMap.get(c.openTime);
      if (btcIdx !== undefined && (btcRSI[btcIdx] < (cfg.btcHurdle || 38) || btc15[btcIdx].close < btcEMA200[btcIdx])) continue;

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

      const tpTarget = deal.avgPrice * (1 + cfg.tpPct / 100);
      const curGainPct = ((bar.close - deal.avgPrice) / deal.avgPrice) * 100;

      if (bar.high >= tpTarget) {
        isExit = true;
        exitPrice = tpTarget * (1 - slipRate);
        exitReason = 'TP';
      } else if (cfg.useRsi50 && rsiVal >= 50 && curGainPct >= cfg.minProfit) {
        isExit = true;
        exitPrice = bar.close * (1 - slipRate);
        exitReason = 'RSI50';
      } else if (cfg.slPct && bar.low <= deal.avgPrice * (1 - cfg.slPct / 100)) {
        isExit = true;
        exitPrice = deal.avgPrice * (1 - cfg.slPct / 100) * (1 - slipRate);
        exitReason = 'SL';
      } else if (idx - deal.startIdx >= 288) {
        isExit = true;
        exitPrice = bar.close * (1 - slipRate);
        exitReason = 'TIMEOUT';
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
          exitTime: bar.time
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
        const baseUSD = Math.max(10, slotCapital * (cfg.baseRatio || 0.35));
        const so1USD = Math.max(10, slotCapital * (1 - (cfg.baseRatio || 0.35)));

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
          so1TriggerPrice: sig.entryPrice * (1 - cfg.soDev / 100),
          soFilled: 0
        });
      }
    }
  }

  const daysMap = new Map();
  for (const tr of completedTrades) {
    const day = tr.exitTime.slice(0, 10);
    if (!daysMap.has(day)) daysMap.set(day, { trades: 0, wins: 0, profit: 0 });
    const d = daysMap.get(day);
    d.trades++;
    if (tr.netPnL > 0) d.wins++;
    d.profit += tr.netPnL;
  }

  const wins = completedTrades.filter(t => t.netPnL > 0).length;
  return {
    name: cfg.name,
    trades: completedTrades.length,
    wins,
    losses: completedTrades.length - wins,
    winRate: completedTrades.length ? ((wins / completedTrades.length) * 100).toFixed(1) + '%' : '0%',
    tradingDays: daysMap.size,
    profitableDays: Array.from(daysMap.values()).filter(d => d.profit > 0).length,
    start: '$' + initialBalance.toFixed(2),
    end: '$' + curBalance.toFixed(2),
    netGain: (((curBalance - initialBalance) / initialBalance) * 100).toFixed(2) + '%'
  };
}

console.log('--- 2 SLOTS VARIATIONS ---');
console.log('Var 1: SO at -3.5%, TP 1.5%, RSI50 min 1.0%, SL 10%, BTC Hurdle 40:', test2SlotsVariations({
  name: 'Var 1', startBalance: 50, baseRatio: 0.30, soDev: 3.5, tpPct: 1.5, useRsi50: true, minProfit: 1.0, slPct: 10.0, btcHurdle: 40
}));
console.log('Var 2: SO at -4.0%, TP 1.8%, RSI50 min 1.2%, SL 10%, BTC Hurdle 40:', test2SlotsVariations({
  name: 'Var 2', startBalance: 50, baseRatio: 0.30, soDev: 4.0, tpPct: 1.8, useRsi50: true, minProfit: 1.2, slPct: 10.0, btcHurdle: 40
}));
console.log('Var 3: SO at -3.5%, TP 1.5%, RSI50 min 1.0%, No SL (Timeout 3d), BTC Hurdle 40:', test2SlotsVariations({
  name: 'Var 3', startBalance: 50, baseRatio: 0.30, soDev: 3.5, tpPct: 1.5, useRsi50: true, minProfit: 1.0, slPct: null, btcHurdle: 40
}));
console.log('Var 4 ($100 Start): SO at -3.5%, TP 1.5%, RSI50 min 1.0%, SL 10%, BTC Hurdle 40:', test2SlotsVariations({
  name: 'Var 4 ($100)', startBalance: 100, baseRatio: 0.30, soDev: 3.5, tpPct: 1.5, useRsi50: true, minProfit: 1.0, slPct: 10.0, btcHurdle: 40
}));
