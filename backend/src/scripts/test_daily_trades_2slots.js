import fs from 'fs';
import path from 'path';

const cacheDir = './backend/src/data/binance_cache';

// Top liquid Binance Spot pairs
const topLiquidSymbols = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
  'DOGEUSDT', 'AVAXUSDT', 'LINKUSDT', 'NEARUSDT', 'SUIUSDT',
  'LTCUSDT', 'ADAUSDT', 'DOTUSDT', 'APTUSDT', 'INJUSDT',
  'FETUSDT', 'RENDERUSDT', 'PEPEUSDT', 'SHIBUSDT', 'TIAUSDT'
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

function runSimultaneous2Slots(cfg) {
  const initialBalance = cfg.startBalance || 50.0;
  let curBalance = initialBalance;
  const maxDeals = cfg.maxDeals || 2;

  // Gather signals
  const allSignals = [];
  for (const sym of Object.keys(rawDatasets)) {
    if (sym === 'BTCUSDT') continue; // Trade altcoins, use BTC for macro filter
    const candles = rawDatasets[sym];
    const rsi = coinIndicators[sym].rsi14;

    for (let i = 50; i < candles.length; i++) {
      const c = candles[i];
      const btcIdx = btcMap.get(c.openTime);
      if (btcIdx !== undefined && (btcRSI[btcIdx] < 36 || btc15[btcIdx].close < btcEMA200[btcIdx])) continue;

      // Purple zone entry: was < 32, crosses >= 30, green candle
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

  // Pre-index candle data
  const candleMap = {};
  for (const sym of Object.keys(rawDatasets)) {
    candleMap[sym] = new Map();
    rawDatasets[sym].forEach((c, idx) => candleMap[sym].set(c.openTime, idx));
  }

  // Pre-index signals by timestamp
  const signalMap = new Map();
  for (const sig of allSignals) {
    if (!signalMap.has(sig.openTime)) signalMap.set(sig.openTime, []);
    signalMap.get(sig.openTime).push(sig);
  }

  // Collect all unique timestamps sorted
  const allTimestampsSet = new Set();
  for (const sym of Object.keys(rawDatasets)) {
    for (const c of rawDatasets[sym]) allTimestampsSet.add(c.openTime);
  }
  const allTimestamps = Array.from(allTimestampsSet).sort((a, b) => a - b);

  const completedTrades = [];
  const activeDeals = [];

  for (const t of allTimestamps) {
    // 1. Check existing active deals
    for (let d = activeDeals.length - 1; d >= 0; d--) {
      const deal = activeDeals[d];
      const sym = deal.symbol;
      const idx = candleMap[sym].get(t);
      if (idx === undefined) continue;

      const bar = rawDatasets[sym][idx];
      const rsiVal = coinIndicators[sym].rsi14[idx];

      // Check SO fill
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
        exitReason = `TP Target Hit (+${cfg.tpPct}%)`;
      } else if (cfg.useRsi50 && rsiVal >= 50 && curGainPct >= cfg.minProfitBuffer) {
        isExit = true;
        exitPrice = bar.close * (1 - slipRate);
        exitReason = `RSI 50 Midline Exit (+${curGainPct.toFixed(2)}%)`;
      } else if (cfg.slPct && bar.low <= deal.avgPrice * (1 - cfg.slPct / 100)) {
        isExit = true;
        exitPrice = deal.avgPrice * (1 - cfg.slPct / 100) * (1 - slipRate);
        exitReason = `Stop Loss Hit (-${cfg.slPct}%)`;
      } else if (idx - deal.startIdx >= (cfg.maxBars || 288)) {
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
        curBalance += netPnL;

        completedTrades.push({
          symbol: sym,
          entryTime: deal.entryTime,
          exitTime: bar.time,
          soFilled: deal.soFilled,
          investedUSD: deal.totalInvestedUSD,
          netPnL,
          curBalance,
          exitReason,
          openTime: deal.openTime,
          closeTime: bar.openTime
        });

        activeDeals.splice(d, 1);
      }
    }

    // 2. Open new deals if slots available
    if (activeDeals.length < maxDeals && signalMap.has(t)) {
      const sigs = signalMap.get(t);
      for (const sig of sigs) {
        if (activeDeals.length >= maxDeals) break;
        if (activeDeals.some(a => a.symbol === sig.symbol)) continue;

        // Slot sizing: Divide current balance evenly across available slots
        const remainingSlots = maxDeals - activeDeals.length;
        const slotCapital = curBalance / maxDeals;

        // Base 40%, SO 60%
        let baseUSD = Math.max(10, slotCapital * cfg.baseRatio);
        let so1USD = Math.max(10, slotCapital * (1 - cfg.baseRatio));

        // If balance is tight, ensure at least $10
        if (baseUSD + so1USD > curBalance) {
          baseUSD = Math.max(10, curBalance * 0.4);
          so1USD = Math.max(10, curBalance * 0.6);
        }

        const entryPrice = sig.entryPrice;
        const so1TriggerPrice = entryPrice * (1 - cfg.soDev / 100);

        activeDeals.push({
          symbol: sig.symbol,
          openTime: sig.openTime,
          entryTime: sig.time,
          startIdx: sig.candleIdx,
          entryPrice,
          baseUSD,
          so1USD,
          totalInvestedUSD: baseUSD,
          totalCoins: baseUSD / entryPrice,
          avgPrice: entryPrice,
          so1TriggerPrice,
          soFilled: 0
        });
      }
    }
  }

  // Calculate daily statistics
  const daysMap = new Map();
  for (const tr of completedTrades) {
    const day = tr.exitTime.slice(0, 10);
    if (!daysMap.has(day)) daysMap.set(day, { trades: 0, wins: 0, profit: 0 });
    const d = daysMap.get(day);
    d.trades++;
    if (tr.netPnL > 0) d.wins++;
    d.profit += tr.netPnL;
  }

  const tradingDays = daysMap.size;
  const profitableDays = Array.from(daysMap.values()).filter(d => d.profit > 0).length;

  const wins = completedTrades.filter(t => t.netPnL > 0).length;
  const losses = completedTrades.filter(t => t.netPnL <= 0).length;
  const winRate = completedTrades.length ? ((wins / completedTrades.length) * 100).toFixed(1) + '%' : '0%';

  return {
    name: cfg.name,
    totalTrades: completedTrades.length,
    wins,
    losses,
    winRate,
    tradingDays,
    profitableDays,
    dailyWinRate: tradingDays ? ((profitableDays / tradingDays) * 100).toFixed(1) + '%' : '0%',
    tradesPerDay: tradingDays ? (completedTrades.length / tradingDays).toFixed(1) : '0',
    startBalance: '$' + initialBalance.toFixed(2),
    endBalance: '$' + curBalance.toFixed(2),
    netGainUSD: (curBalance - initialBalance).toFixed(2),
    netGainPct: (((curBalance - initialBalance) / initialBalance) * 100).toFixed(2) + '%'
  };
}

console.log('=== 2 ACTIVE SLOTS SIMULTANEOUS TRADING (DAILY FREQUENCY AUDIT) ===');

console.log('Config 1 ($50 Start, 2 Slots, 40% Base / 60% SO at -3.0%, TP +1.2%, RSI 50 min +0.8%, SL 8%):');
console.log(runSimultaneous2Slots({
  name: '$50 Start - 2 Slots - TP 1.2% / Midline 0.8%',
  startBalance: 50.0,
  maxDeals: 2,
  baseRatio: 0.40,
  soDev: 3.0,
  tpPct: 1.2,
  useRsi50: true,
  minProfitBuffer: 0.8,
  slPct: 8.0,
  maxBars: 288
}));

console.log('\nConfig 2 ($50 Start, 2 Slots, 40% Base / 60% SO at -3.5%, TP +1.5%, RSI 50 min +1.0%, SL 10%):');
console.log(runSimultaneous2Slots({
  name: '$50 Start - 2 Slots - TP 1.5% / Midline 1.0%',
  startBalance: 50.0,
  maxDeals: 2,
  baseRatio: 0.40,
  soDev: 3.5,
  tpPct: 1.5,
  useRsi50: true,
  minProfitBuffer: 1.0,
  slPct: 10.0,
  maxBars: 288
}));

console.log('\nConfig 3 ($100 Start, 2 Slots, 35% Base / 65% SO at -3.0%, TP +1.2%, RSI 50 min +0.8%, SL 8%):');
console.log(runSimultaneous2Slots({
  name: '$100 Start - 2 Slots - TP 1.2% / Midline 0.8%',
  startBalance: 100.0,
  maxDeals: 2,
  baseRatio: 0.35,
  soDev: 3.0,
  tpPct: 1.2,
  useRsi50: true,
  minProfitBuffer: 0.8,
  slPct: 8.0,
  maxBars: 288
}));
