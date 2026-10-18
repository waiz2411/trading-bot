import fs from 'fs';
import path from 'path';

const cacheDir = './backend/src/data/binance_cache';
const top10Symbols = ['ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'AVAXUSDT', 'LINKUSDT', 'NEARUSDT', 'SUIUSDT', 'LTCUSDT'];

// Load 15m and aggregate to 1h
const rawDatasets15m = {};
const rawDatasets1h = {};

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
    rawDatasets15m[sym] = parsed;

    // Aggregate to 1h
    const h1 = [];
    let curH = null;
    for (const c of parsed) {
      const hTime = Math.floor(c.openTime / 3600000) * 3600000;
      if (!curH || curH.openTime !== hTime) {
        if (curH) h1.push(curH);
        curH = { openTime: hTime, time: new Date(hTime).toISOString(), open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume };
      } else {
        curH.high = Math.max(curH.high, c.high);
        curH.low = Math.min(curH.low, c.low);
        curH.close = c.close;
        curH.volume += c.volume;
      }
    }
    if (curH) h1.push(curH);
    rawDatasets1h[sym] = h1;
  } catch (_) {}
}

const feeRate = 0.0010; // 0.1% buy + 0.1% sell
const slipRate = 0.00015;

function calcEMA(arr, p) {
  const ema = new Float64Array(arr.length);
  const k = 2 / (p + 1);
  let e = arr[0];
  for (let i = 0; i < arr.length; i++) {
    e = i === 0 ? arr[i] : arr[i] * k + e * (1 - k);
    ema[i] = e;
  }
  return ema;
}

function calcATR(candles, period = 14) {
  const tr = new Float64Array(candles.length);
  for (let i = 1; i < candles.length; i++) {
    const h = candles[i].high, l = candles[i].low, prevC = candles[i - 1].close;
    tr[i] = Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC));
  }
  const atr = new Float64Array(candles.length);
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr[i];
  atr[period] = sum / period;
  for (let i = period + 1; i < candles.length; i++) {
    atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
  }
  return atr;
}

// Test Strategy: Asymmetric Risk-Reward on 1H Candles (Top 10 Altcoins)
// Logic:
// 1. Trend: Close > EMA 50 > EMA 200
// 2. Pullback: Low touched EMA 50 or dipped below EMA 20, then closed green (Bullish Rejection)
// 3. Risk-Reward: Stop Loss = 1.5 * ATR (approx 1.5% - 2.5%), Take Profit = 2.5 * Risk (1:2.5 Risk-Reward)
function testAsymmetricTrend1H(rrRatio = 2.0, slAtrMult = 1.5) {
  let balance = 100.0;
  const allSignals = [];

  for (const sym of Object.keys(rawDatasets1h)) {
    const candles = rawDatasets1h[sym];
    if (candles.length < 250) continue;
    const closes = candles.map(c => c.close);
    const ema20 = calcEMA(closes, 20);
    const ema50 = calcEMA(closes, 50);
    const ema200 = calcEMA(closes, 200);
    const atr = calcATR(candles, 14);

    for (let i = 200; i < candles.length; i++) {
      const c = candles[i];
      const prev = candles[i - 1];

      // Strong Bullish Trend
      const uptrend = c.close > ema50[i] && ema50[i] > ema200[i];
      if (!uptrend) continue;

      // Pullback & Rejection: Previous bar dipped below EMA20, Current bar closes above EMA20 and is Green
      const pullback = prev.low < ema20[i - 1] && c.close > ema20[i] && c.close > c.open;
      if (pullback) {
        const entryPrice = c.close * (1 + slipRate);
        const slDist = Math.max(entryPrice * 0.015, atr[i] * slAtrMult); // minimum 1.5% SL
        const slPrice = entryPrice - slDist;
        const tpPrice = entryPrice + (slDist * rrRatio);

        allSignals.push({
          symbol: sym,
          candleIdx: i,
          openTime: c.openTime,
          time: c.time,
          entryPrice,
          slPrice,
          tpPrice,
          slDistPct: (slDist / entryPrice) * 100,
          tpDistPct: ((tpPrice - entryPrice) / entryPrice) * 100
        });
      }
    }
  }

  allSignals.sort((a, b) => a.openTime - b.openTime);

  let nextFree = 0;
  const trades = [];

  for (const sig of allSignals) {
    if (sig.openTime < nextFree) continue;

    const candles = rawDatasets1h[sig.symbol];
    let exitPrice = null;
    let exitTime = '';
    let exitReason = '';
    let exitOpenTime = 0;

    for (let j = sig.candleIdx + 1; j < candles.length && j <= sig.candleIdx + 120; j++) {
      const bar = candles[j];

      // Check TP first (or High)
      if (bar.high >= sig.tpPrice) {
        exitPrice = sig.tpPrice * (1 - slipRate);
        exitTime = bar.time;
        exitOpenTime = bar.openTime;
        exitReason = 'TP';
        break;
      }
      if (bar.low <= sig.slPrice) {
        exitPrice = sig.slPrice * (1 - slipRate);
        exitTime = bar.time;
        exitOpenTime = bar.openTime;
        exitReason = 'SL';
        break;
      }
    }

    if (!exitPrice) {
      const last = candles[Math.min(candles.length - 1, sig.candleIdx + 120)];
      exitPrice = last.close * (1 - slipRate);
      exitTime = last.time;
      exitOpenTime = last.openTime;
      exitReason = 'TIMEOUT';
    }

    // Trade math: 100% of capital reinvested
    const tradeSize = balance;
    const coins = tradeSize / sig.entryPrice;
    const grossReturn = coins * exitPrice;
    const fees = (tradeSize * feeRate) + (grossReturn * feeRate);
    const netPnL = grossReturn - tradeSize - fees;
    balance += netPnL;
    nextFree = exitOpenTime;

    trades.push({
      symbol: sig.symbol,
      entryTime: sig.time,
      exitTime,
      exitReason,
      netPnL,
      balance,
      outcome: netPnL > 0 ? 'WIN' : 'LOSS'
    });
  }

  const wins = trades.filter(t => t.outcome === 'WIN').length;
  const losses = trades.filter(t => t.outcome === 'LOSS').length;
  return {
    rrRatio,
    slAtrMult,
    trades: trades.length,
    wins,
    losses,
    winRate: trades.length ? ((wins / trades.length) * 100).toFixed(1) + '%' : '0%',
    startBalance: '$100.00',
    endBalance: '$' + balance.toFixed(2),
    netGainPct: trades.length ? (((balance - 100) / 100) * 100).toFixed(2) + '%' : '0%'
  };
}

console.log('--- ASYMMETRIC RISK-REWARD 1H TESTS ($100 START) ---');
console.log('1:1.5 R:R:', testAsymmetricTrend1H(1.5, 1.2));
console.log('1:2.0 R:R:', testAsymmetricTrend1H(2.0, 1.2));
console.log('1:2.5 R:R:', testAsymmetricTrend1H(2.5, 1.2));
console.log('1:3.0 R:R:', testAsymmetricTrend1H(3.0, 1.2));
console.log('1:2.0 R:R with 1.5 ATR SL:', testAsymmetricTrend1H(2.0, 1.5));
