import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_CACHE_DIR = path.join(__dirname, 'binance_cache');

function loadAllCachedData() {
  const files = fs.readdirSync(DATA_CACHE_DIR).filter(f => f.endsWith('_15m_60d.json'));
  const allData = {};
  for (const f of files) {
    const sym = f.split('_')[0];
    const data = JSON.parse(fs.readFileSync(path.join(DATA_CACHE_DIR, f), 'utf8'));
    allData[sym] = data;
  }
  return allData;
}

const allData = loadAllCachedData();
console.log(`Loaded ${Object.keys(allData).length} halal coins from Binance 60-day cache.`);

function calcEMA(values, period) {
  const k = 2 / (period + 1);
  const ema = new Array(values.length);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  ema[period - 1] = sum / period;
  for (let i = period; i < values.length; i++) {
    ema[i] = values[i] * k + ema[i - 1] * (1 - k);
  }
  return ema;
}

function calcRSI(candles, period = 14) {
  const rsi = new Array(candles.length).fill(null);
  if (candles.length <= period) return rsi;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    if (diff >= 0) gains += diff; else losses += -diff;
  }
  let avgGain = gains / period, avgLoss = losses / period;
  rsi[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));
  for (let i = period + 1; i < candles.length; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
    rsi[i] = avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));
  }
  return rsi;
}

// Pre-compute indicators for all coins
const indicators = {};
for (const [sym, candles] of Object.entries(allData)) {
  const closes = candles.map(c => c.close);
  indicators[sym] = {
    ema9: calcEMA(closes, 9),
    ema21: calcEMA(closes, 21),
    ema50: calcEMA(closes, 50),
    rsi14: calcRSI(candles, 14)
  };
}

/**
 * Universal trade simulator with fee, slippage, break-even lock, and trailing stop
 */
function simulateTrade(entryBarIdx, entryPrice, candles, params) {
  const {
    takeProfitPct = 1.10,
    stopLossPct = 0.55,
    breakEvenTriggerPct = 0.50,
    breakEvenLockPct = 0.20,
    trailingTriggerPct = 0.85,
    trailingDistancePct = 0.20,
    maxHoldBars = 6, // 6 x 15m = 90 mins
    feeRate = 0.00075, // 0.075% per side with BNB
    slippagePct = 0.05
  } = params;

  let currentSL = entryPrice * (1 - stopLossPct / 100);
  let highestHigh = entryPrice;
  let beLocked = false;
  let exitPrice = null;
  let exitReason = null;
  let barsHeld = 0;

  for (let i = entryBarIdx + 1; i < Math.min(candles.length, entryBarIdx + 1 + maxHoldBars); i++) {
    const c = candles[i];
    barsHeld++;

    if (c.high > highestHigh) highestHigh = c.high;
    const maxGainPct = ((highestHigh - entryPrice) / entryPrice) * 100;

    // Check Trailing Stop
    if (trailingTriggerPct && maxGainPct >= trailingTriggerPct) {
      const trailLevel = highestHigh * (1 - trailingDistancePct / 100);
      if (trailLevel > currentSL) currentSL = trailLevel;
    }
    // Check Break-Even Lock
    else if (breakEvenTriggerPct && !beLocked && maxGainPct >= breakEvenTriggerPct) {
      const beLevel = entryPrice * (1 + breakEvenLockPct / 100);
      if (beLevel > currentSL) {
        currentSL = beLevel;
        beLocked = true;
      }
    }

    // Check Stop Loss hit
    if (c.low <= currentSL) {
      exitPrice = currentSL;
      exitReason = beLocked ? 'BE_LOCK_PROFIT' : 'STOP_LOSS';
      break;
    }

    // Check Take Profit hit
    const targetPrice = entryPrice * (1 + takeProfitPct / 100);
    if (c.high >= targetPrice) {
      exitPrice = targetPrice;
      exitReason = 'TAKE_PROFIT';
      break;
    }
  }

  // Time exit
  if (!exitPrice) {
    const lastBar = candles[Math.min(candles.length - 1, entryBarIdx + maxHoldBars)];
    exitPrice = lastBar.close;
    exitReason = 'TIMEOUT';
  }

  const grossReturnPct = ((exitPrice - entryPrice) / entryPrice) * 100;
  const totalCostPct = (feeRate * 2 * 100) + slippagePct; // 0.15% fee + 0.05% slippage = 0.20%
  const netReturnPct = grossReturnPct - totalCostPct;

  return {
    entryPrice,
    exitPrice,
    grossReturnPct,
    netReturnPct,
    exitReason,
    barsHeld,
    durationMins: barsHeld * 15,
    isWin: netReturnPct > 0
  };
}

/**
 * STRATEGY 1: Momentum Volume Spike Breakout (Pumping Leader)
 */
function testStrategy1_VolumeBreakout(params) {
  const { rvolThreshold = 1.8, minExpansion = 0.8, maxExpansion = 3.5 } = params;
  const trades = [];

  for (const [sym, candles] of Object.entries(allData)) {
    const ind = indicators[sym];
    for (let i = 50; i < candles.length - 10; i++) {
      const c = candles[i];
      const prev = candles[i - 1];

      // Volume spike check
      let volSum = 0;
      for (let j = i - 20; j < i; j++) volSum += candles[j].volume;
      const avgVol = volSum / 20;
      const rvol = c.volume / avgVol;
      if (rvol < rvolThreshold) continue;

      // Candle expansion %
      const expPct = ((c.close - prev.close) / prev.close) * 100;
      if (expPct < minExpansion || expPct > maxExpansion) continue;

      // Trend check: close > EMA 50
      if (c.close <= ind.ema50[i]) continue;

      // Candle body strong
      const range = c.high - c.low;
      if (range > 0 && (c.close - c.open) / range < 0.60) continue;

      const result = simulateTrade(i, c.close, candles, params);
      trades.push({ sym, ...result });
      i += result.barsHeld; // Skip held bars
    }
  }
  return evaluate(trades, 'Strategy 1: Momentum Volume Breakout');
}

/**
 * STRATEGY 2: 9/21 EMA Trend-Pullback Scalper
 */
function testStrategy2_EmaPullback(params) {
  const trades = [];

  for (const [sym, candles] of Object.entries(allData)) {
    const ind = indicators[sym];
    for (let i = 50; i < candles.length - 10; i++) {
      const c = candles[i];
      const prev = candles[i - 1];

      // Strong trend: EMA 9 > EMA 21 > EMA 50
      if (!(ind.ema9[i] > ind.ema21[i] && ind.ema21[i] > ind.ema50[i])) continue;

      // Pullback condition: low touched or dipped near EMA 21/9, but closed above EMA 9
      const pulledBack = prev.low <= ind.ema21[i - 1] * 1.003 || c.low <= ind.ema9[i] * 1.002;
      const closedStrong = c.close > ind.ema9[i] && c.close > c.open;
      if (!pulledBack || !closedStrong) continue;

      // Volume confirmation
      let volSum = 0;
      for (let j = i - 10; j < i; j++) volSum += candles[j].volume;
      if (c.volume < (volSum / 10) * 1.2) continue;

      const result = simulateTrade(i, c.close, candles, params);
      trades.push({ sym, ...result });
      i += result.barsHeld;
    }
  }
  return evaluate(trades, 'Strategy 2: 9/21 EMA Trend Pullback');
}

/**
 * STRATEGY 3: RSI Momentum Surge (RSI crosses > 55 with Volume in Uptrend)
 */
function testStrategy3_RsiMomentumSurge(params) {
  const trades = [];

  for (const [sym, candles] of Object.entries(allData)) {
    const ind = indicators[sym];
    for (let i = 50; i < candles.length - 10; i++) {
      const c = candles[i];
      const rsiNow = ind.rsi14[i];
      const rsiPrev = ind.rsi14[i - 1];

      // RSI crosses above 55 (entering strong bullish zone)
      if (!(rsiPrev < 55 && rsiNow >= 55 && rsiNow <= 72)) continue;

      // Trend: Price > EMA 50
      if (c.close <= ind.ema50[i]) continue;

      // Volume confirmation
      let volSum = 0;
      for (let j = i - 15; j < i; j++) volSum += candles[j].volume;
      if (c.volume < (volSum / 15) * 1.3) continue;

      const result = simulateTrade(i, c.close, candles, params);
      trades.push({ sym, ...result });
      i += result.barsHeld;
    }
  }
  return evaluate(trades, 'Strategy 3: RSI Momentum Surge (55-Cross)');
}

/**
 * STRATEGY 4: Resistance Breakout + Volume Expansion
 */
function testStrategy4_ResistanceBreakout(params) {
  const trades = [];

  for (const [sym, candles] of Object.entries(allData)) {
    const ind = indicators[sym];
    for (let i = 50; i < candles.length - 10; i++) {
      const c = candles[i];

      // Find 20-bar highest high prior to this candle
      let highest20 = 0;
      for (let j = i - 20; j < i; j++) {
        if (candles[j].high > highest20) highest20 = candles[j].high;
      }

      // Close must break cleanly above 20-bar resistance
      if (c.close <= highest20) continue;

      // Volume confirmation: RVOL >= 2.0x
      let volSum = 0;
      for (let j = i - 20; j < i; j++) volSum += candles[j].volume;
      if (c.volume < (volSum / 20) * 2.0) continue;

      if (c.close <= ind.ema50[i]) continue;

      const result = simulateTrade(i, c.close, candles, params);
      trades.push({ sym, ...result });
      i += result.barsHeld;
    }
  }
  return evaluate(trades, 'Strategy 4: 20-Bar Resistance Breakout');
}

/**
 * STRATEGY 5: High-Precision Confluence Scalp (3-Pillar Setup with Asymmetric Lock)
 */
function testStrategy5_PrecisionConfluence(params) {
  const trades = [];

  for (const [sym, candles] of Object.entries(allData)) {
    const ind = indicators[sym];
    for (let i = 50; i < candles.length - 10; i++) {
      const c = candles[i];
      const prev = candles[i - 1];

      // 1. Moving Average Alignment
      const trendOk = ind.ema9[i] > ind.ema21[i] && c.close > ind.ema50[i];
      if (!trendOk) continue;

      // 2. Relative Volume Spike >= 1.8x
      let volSum = 0;
      for (let j = i - 20; j < i; j++) volSum += candles[j].volume;
      const rvol = c.volume / (volSum / 20);
      if (rvol < 1.8) continue;

      // 3. RSI between 52 and 68 (Strong momentum, not yet overbought exhaustion)
      const rsiVal = ind.rsi14[i];
      if (rsiVal < 52 || rsiVal > 68) continue;

      // 4. Strong Bullish Candle (> 65% body)
      const range = c.high - c.low;
      if (range > 0 && (c.close - c.open) / range < 0.65) continue;

      const result = simulateTrade(i, c.close, candles, params);
      trades.push({ sym, ...result });
      i += result.barsHeld;
    }
  }
  return evaluate(trades, 'Strategy 5: Precision 3-Pillar Confluence');
}

function evaluate(trades, name) {
  const wins = trades.filter(t => t.isWin);
  const losses = trades.filter(t => !t.isWin);
  const winRate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;
  const totalNetPct = trades.reduce((acc, t) => acc + t.netReturnPct, 0);
  const avgWin = wins.length > 0 ? wins.reduce((acc, t) => acc + t.netReturnPct, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((acc, t) => acc + t.netReturnPct, 0) / losses.length : 0;
  const avgDuration = trades.length > 0 ? trades.reduce((acc, t) => acc + t.durationMins, 0) / trades.length : 0;
  
  const totalGrossWon = wins.reduce((acc, t) => acc + t.netReturnPct, 0);
  const totalGrossLost = Math.abs(losses.reduce((acc, t) => acc + t.netReturnPct, 0));
  const profitFactor = totalGrossLost > 0 ? totalGrossWon / totalGrossLost : 99;

  return {
    Strategy: name,
    TotalTrades: trades.length,
    WinRate: winRate.toFixed(1) + '%',
    CombinedNetReturn: (totalNetPct >= 0 ? '+' : '') + totalNetPct.toFixed(2) + '%',
    AvgWin: '+' + avgWin.toFixed(2) + '%',
    AvgLoss: avgLoss.toFixed(2) + '%',
    ProfitFactor: profitFactor.toFixed(2),
    AvgDuration: avgDuration.toFixed(1) + ' mins'
  };
}

async function runAll() {
  console.log('\n===============================================================');
  console.log('🔬 TESTING 5 MAJOR SCALPING STRATEGIES (Binance 60-Day 15m Data)');
  console.log('Parameters: TP +1.10% | SL -0.55% | BE Lock at +0.50% (Locks +0.20%) | Fee 0.15%');
  console.log('===============================================================');

  const defaultParams = {
    takeProfitPct: 1.10,
    stopLossPct: 0.55,
    breakEvenTriggerPct: 0.50,
    breakEvenLockPct: 0.20,
    trailingTriggerPct: 0.90,
    trailingDistancePct: 0.20,
    maxHoldBars: 6
  };

  const results = [
    testStrategy1_VolumeBreakout(defaultParams),
    testStrategy2_EmaPullback(defaultParams),
    testStrategy3_RsiMomentumSurge(defaultParams),
    testStrategy4_ResistanceBreakout(defaultParams),
    testStrategy5_PrecisionConfluence(defaultParams)
  ];

  console.table(results);

  // Now optimize Strategy 5 to hit >= 80% Win Rate
  console.log('\n===============================================================');
  console.log('🎯 OPTIMIZING GEOMETRY FOR MAXIMUM WIN RATE (Target >= 80%)');
  console.log('===============================================================');

  const geometries = [
    { name: 'Opt 1: TP +0.90%, SL -0.60%, BE at +0.45% (Lock +0.20%)', tp: 0.90, sl: 0.60, beTrig: 0.45, beLock: 0.20 },
    { name: 'Opt 2: TP +1.00%, SL -0.50%, BE at +0.45% (Lock +0.20%)', tp: 1.00, sl: 0.50, beTrig: 0.45, beLock: 0.20 },
    { name: 'Opt 3: TP +0.80%, SL -0.50%, BE at +0.40% (Lock +0.18%)', tp: 0.80, sl: 0.50, beTrig: 0.40, beLock: 0.18 },
    { name: 'Opt 4: TP +1.20%, SL -0.55%, BE at +0.50% (Lock +0.22%)', tp: 1.20, sl: 0.55, beTrig: 0.50, beLock: 0.22 },
    { name: 'Opt 5: Ultra-Quick Pip: TP +0.70%, SL -0.45%, BE at +0.35% (Lock +0.15%)', tp: 0.70, sl: 0.45, beTrig: 0.35, beLock: 0.15 }
  ];

  const optResults = [];
  for (const g of geometries) {
    const p = {
      takeProfitPct: g.tp,
      stopLossPct: g.sl,
      breakEvenTriggerPct: g.beTrig,
      breakEvenLockPct: g.beLock,
      trailingTriggerPct: g.tp * 0.85,
      trailingDistancePct: 0.18,
      maxHoldBars: 6
    };
    const res = testStrategy5_PrecisionConfluence(p);
    res.Strategy = g.name;
    optResults.push(res);
  }

  console.table(optResults);

  fs.writeFileSync(path.join(__dirname, 'strategy_comparison_80wr.json'), JSON.stringify({ results, optResults }, null, 2));
}

runAll().catch(console.error);
