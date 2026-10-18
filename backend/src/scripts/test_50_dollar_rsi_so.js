import fs from 'fs';
import path from 'path';

const cacheDir = './backend/src/data/binance_cache';
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

const feeRate = 0.0010; // Binance 0.1% spot fee
const slipRate = 0.00015;

// Let's test the user's EXACT strategy with $50 capital:
// Entry: RSI < 32 then crosses >= 30 (re-enters purple zone) & green candle & BTC safe
// Exit:
// Option A: When RSI crosses >= 50 (middle line touched)
// Option B: Take profit % target (e.g. +1.0% or +1.2%) OR RSI 50
// Safety Orders:
// Model 1: 1 deal at a time: Base = 30% ($15), SO1 = 30% ($15) at -3%, SO2 = 40% ($20) at -6%
// Model 2: 1 deal at a time: Base = 40% ($20), SO1 = 60% ($30) at -3.5%
// Model 3: 2 simultaneous deals ($25 each): Base = $10 (40%), SO1 = $15 (60%) at -3.5%
function run50DollarSimulation(cfg) {
  let balance = 50.0;
  const initialBalance = 50.0;

  // Gather all valid signals
  const allSignals = [];
  for (const sym of Object.keys(rawDatasets)) {
    const candles = rawDatasets[sym];
    const rsi = coinIndicators[sym].rsi14;

    for (let i = 50; i < candles.length; i++) {
      const c = candles[i];
      const btcIdx = btcMap.get(c.openTime);
      if (btcIdx !== undefined && (btcRSI[btcIdx] < 35 || btc15[btcIdx].close < btcEMA200[btcIdx])) continue;

      // Re-enter purple zone (RSI was < 32 and crosses >= 30)
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

  allSignals.sort((a, b) => a.openTime - b.openTime);

  // Track active deals (up to maxActiveDeals)
  const maxDeals = cfg.maxActiveDeals || 1;
  const activeDeals = [];
  const completedTrades = [];

  for (const sig of allSignals) {
    // First, close any deals that finished before this signal
    // To handle simultaneous simulation properly, let's process chronologically candle by candle or signal by signal
  }

  // Chronological candle-by-candle simulation
  const allTimestampsSet = new Set();
  for (const sym of Object.keys(rawDatasets)) {
    for (const c of rawDatasets[sym]) allTimestampsSet.add(c.openTime);
  }
  const allTimestamps = Array.from(allTimestampsSet).sort((a, b) => a - b);

  // Map candles by symbol and openTime
  const candleMap = {};
  for (const sym of Object.keys(rawDatasets)) {
    candleMap[sym] = new Map();
    rawDatasets[sym].forEach((c, idx) => candleMap[sym].set(c.openTime, idx));
  }

  // Pre-index signals by openTime
  const signalMap = new Map();
  for (const sig of allSignals) {
    if (!signalMap.has(sig.openTime)) signalMap.set(sig.openTime, []);
    signalMap.get(sig.openTime).push(sig);
  }

  let curBalance = 50.0;
  const activeSlots = []; // active deals

  for (const t of allTimestamps) {
    // 1. Update existing active deals
    for (let d = activeSlots.length - 1; d >= 0; d--) {
      const deal = activeSlots[d];
      const sym = deal.symbol;
      const idx = candleMap[sym].get(t);
      if (idx === undefined) continue;

      const bar = rawDatasets[sym][idx];
      const rsiVal = coinIndicators[sym].rsi14[idx];

      // Check Safety Order 1 fill
      if (deal.soFilled === 0 && bar.low <= deal.so1TriggerPrice) {
        const fillPrice = deal.so1TriggerPrice;
        const boughtCoins = deal.so1USD / fillPrice;
        deal.totalInvestedUSD += deal.so1USD;
        deal.totalCoins += boughtCoins;
        deal.avgPrice = deal.totalInvestedUSD / deal.totalCoins;
        deal.soFilled = 1;
      }

      // Check Safety Order 2 fill
      if (cfg.soCount === 2 && deal.soFilled === 1 && bar.low <= deal.so2TriggerPrice) {
        const fillPrice = deal.so2TriggerPrice;
        const boughtCoins = deal.so2USD / fillPrice;
        deal.totalInvestedUSD += deal.so2USD;
        deal.totalCoins += boughtCoins;
        deal.avgPrice = deal.totalInvestedUSD / deal.totalCoins;
        deal.soFilled = 2;
      }

      // Check Exits
      let isExit = false;
      let exitPrice = 0;
      let exitReason = '';

      // Exit Condition 1: Take Profit (fixed TP % or Middle Line RSI >= 50)
      const tpTarget = deal.avgPrice * (1 + (cfg.tpPct || 1.2) / 100);
      const isRsi50 = cfg.useRsi50Exit && rsiVal >= 50 && (bar.close > deal.avgPrice); // only exit at RSI 50 if in profit!

      if (bar.high >= tpTarget) {
        isExit = true;
        exitPrice = tpTarget * (1 - slipRate);
        exitReason = `Take Profit Target (+${cfg.tpPct}%)`;
      } else if (isRsi50) {
        isExit = true;
        exitPrice = bar.close * (1 - slipRate);
        exitReason = 'Middle Line RSI 50 Crossed in Profit';
      } else if (cfg.emergencySL && bar.low <= deal.avgPrice * (1 - cfg.emergencySL / 100)) {
        isExit = true;
        exitPrice = deal.avgPrice * (1 - cfg.emergencySL / 100) * (1 - slipRate);
        exitReason = `Emergency Stop Loss (-${cfg.emergencySL}%)`;
      } else if (idx - deal.startIdx >= (cfg.maxBars || 480)) {
        isExit = true;
        exitPrice = bar.close * (1 - slipRate);
        exitReason = 'Time Horizon Exit (5 Days)';
      }

      if (isExit) {
        const grossReturn = deal.totalCoins * exitPrice;
        const fees = (deal.totalInvestedUSD * feeRate) + (grossReturn * feeRate);
        const netPnL = grossReturn - deal.totalInvestedUSD - fees;
        curBalance += netPnL;

        completedTrades.push({
          symbol: sym,
          entryTime: deal.entryTime,
          exitTime: bar.time,
          soFilled: deal.soFilled,
          investedUSD: deal.totalInvestedUSD,
          netPnL,
          exitReason,
          curBalance
        });

        activeSlots.splice(d, 1);
      }
    }

    // 2. Open new deals if slots available
    if (activeSlots.length < maxDeals && signalMap.has(t)) {
      const sigs = signalMap.get(t);
      for (const sig of sigs) {
        if (activeSlots.length >= maxDeals) break;
        // Don't open duplicate symbol
        if (activeSlots.some(a => a.symbol === sig.symbol)) continue;

        // Allocate capital for this deal slot
        // With maxDeals = 1, dealCapital = curBalance
        // With maxDeals = 2, dealCapital = curBalance / 2
        const slotCapital = curBalance / (maxDeals - activeSlots.length);
        
        let baseUSD, so1USD, so2USD;
        if (cfg.soCount === 2) {
          baseUSD = Math.max(10, slotCapital * 0.30);
          so1USD = Math.max(10, slotCapital * 0.30);
          so2USD = Math.max(10, slotCapital * 0.40);
        } else {
          // 1 SO
          baseUSD = Math.max(10, slotCapital * 0.40);
          so1USD = Math.max(10, slotCapital * 0.60);
          so2USD = 0;
        }

        const entryPrice = sig.entryPrice;
        const so1TriggerPrice = entryPrice * (1 - cfg.soDev / 100);
        const so2TriggerPrice = entryPrice * (1 - (cfg.soDev * 2) / 100);

        activeSlots.push({
          symbol: sig.symbol,
          entryTime: sig.time,
          startIdx: sig.candleIdx,
          entryPrice,
          baseUSD,
          so1USD,
          so2USD,
          totalInvestedUSD: baseUSD,
          totalCoins: baseUSD / entryPrice,
          avgPrice: entryPrice,
          so1TriggerPrice,
          so2TriggerPrice,
          soFilled: 0
        });
      }
    }
  }

  const wins = completedTrades.filter(t => t.netPnL > 0).length;
  const losses = completedTrades.filter(t => t.netPnL <= 0).length;
  return {
    name: cfg.name,
    trades: completedTrades.length,
    wins,
    losses,
    winRate: completedTrades.length ? ((wins / completedTrades.length) * 100).toFixed(1) + '%' : '0%',
    startBalance: '$' + initialBalance.toFixed(2),
    endBalance: '$' + curBalance.toFixed(2),
    netProfitUSD: (curBalance - initialBalance).toFixed(2),
    netReturnPct: (((curBalance - initialBalance) / initialBalance) * 100).toFixed(2) + '%'
  };
}

console.log('=== $50 CAPITAL RSI + SAFETY ORDER SIMULATIONS ===');

// Setup A: 1 Deal at a time, Middle Line RSI 50 Exit + 1.2% TP, 1 SO at -3.5%, No hard SL (5 day horizon)
console.log('Setup A (1 SO at -3.5%, TP +1.0% or RSI 50, 5-Day Horizon):', run50DollarSimulation({
  name: 'Setup A: 1 SO, RSI 50 or 1.0% TP, 5-Day Horizon',
  maxActiveDeals: 1,
  soCount: 1,
  soDev: 3.5,
  tpPct: 1.0,
  useRsi50Exit: true,
  emergencySL: null
}));

// Setup B: 1 Deal at a time, Fixed 1.2% TP, 2 SOs (-2.5%, -5.0%), 8% SL
console.log('Setup B (2 SOs at -2.5%/-5.0%, Fixed 1.2% TP, 8% SL):', run50DollarSimulation({
  name: 'Setup B: 2 SOs, Fixed 1.2% TP, 8% SL',
  maxActiveDeals: 1,
  soCount: 2,
  soDev: 2.5,
  tpPct: 1.2,
  useRsi50Exit: false,
  emergencySL: 8.0
}));

// Setup C: 1 Deal at a time, Fixed 0.8% TP or RSI 50, 1 SO at -3.0%, 6% SL
console.log('Setup C (1 SO at -3.0%, TP +0.8% or RSI 50, 6% SL):', run50DollarSimulation({
  name: 'Setup C: 1 SO, TP 0.8% or RSI 50, 6% SL',
  maxActiveDeals: 1,
  soCount: 1,
  soDev: 3.0,
  tpPct: 0.8,
  useRsi50Exit: true,
  emergencySL: 6.0
}));

// Setup D: 2 Concurrent Deals ($25 each), 1 SO at -3.5%, TP +1.0% or RSI 50
console.log('Setup D (2 Concurrent Deals, 1 SO, TP 1.0% or RSI 50):', run50DollarSimulation({
  name: 'Setup D: 2 Deals, 1 SO, TP 1.0% or RSI 50',
  maxActiveDeals: 2,
  soCount: 1,
  soDev: 3.5,
  tpPct: 1.0,
  useRsi50Exit: true,
  emergencySL: null
}));
