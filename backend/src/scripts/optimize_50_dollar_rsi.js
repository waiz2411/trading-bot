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
  const closes = rawDatasets[sym].map(c => c.close);
  coinIndicators[sym] = {
    rsi14: calculateRSI14(rawDatasets[sym]),
    ema50: calculateEMA(closes, 50),
    ema100: calculateEMA(closes, 100)
  };
}

const feeRate = 0.0010;
const slipRate = 0.00015;

function testRefined50(cfg) {
  let curBalance = 50.0;
  const initialBalance = 50.0;

  const allSignals = [];
  for (const sym of Object.keys(rawDatasets)) {
    const candles = rawDatasets[sym];
    const rsi = coinIndicators[sym].rsi14;
    const ema50 = coinIndicators[sym].ema50;

    for (let i = 50; i < candles.length; i++) {
      const c = candles[i];
      const btcIdx = btcMap.get(c.openTime);
      if (btcIdx !== undefined && (btcRSI[btcIdx] < 38 || btc15[btcIdx].close < btcEMA200[btcIdx])) continue;

      // Trend filter if enabled
      if (cfg.useTrend && c.close < ema50[i]) continue;

      // Re-enter purple zone
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

  allSignals.sort((a, b) => a.openTime - b.openTime);

  const completedTrades = [];
  let nextFreeTime = 0;

  for (const sig of allSignals) {
    if (sig.openTime < nextFreeTime) continue;

    const sym = sig.symbol;
    const candles = rawDatasets[sym];
    const startIdx = sig.candleIdx;

    // Allocate $50: Base order $15, SO1 $35 (or Base $20, SO1 $30)
    const baseUSD = curBalance * cfg.baseRatio;
    const so1USD = curBalance * (1 - cfg.baseRatio);

    let totalInvestedUSD = baseUSD;
    let totalCoins = baseUSD / sig.entryPrice;
    let avgPrice = sig.entryPrice;
    let soFilled = 0;

    const so1Price = sig.entryPrice * (1 - cfg.soDev / 100);

    let exitPrice = null;
    let exitTime = '';
    let exitReason = '';
    let exitOpenTime = 0;

    for (let j = startIdx + 1; j < candles.length && j <= startIdx + 300; j++) {
      const bar = candles[j];
      const rsiVal = coinIndicators[sym].rsi14[j];

      // Fill SO1
      if (soFilled === 0 && bar.low <= so1Price) {
        const fillP = so1Price;
        totalInvestedUSD += so1USD;
        totalCoins += so1USD / fillP;
        avgPrice = totalInvestedUSD / totalCoins;
        soFilled = 1;
      }

      const tpTarget = avgPrice * (1 + cfg.tpPct / 100);
      const curGainPct = ((bar.close - avgPrice) / avgPrice) * 100;

      // Exit Condition: Hit target TP OR (Middle line RSI 50 touched AND gain >= minGain)
      if (bar.high >= tpTarget) {
        exitPrice = tpTarget * (1 - slipRate);
        exitTime = bar.time;
        exitOpenTime = bar.openTime;
        exitReason = 'TP Target Hit';
        break;
      } else if (cfg.useRsi50 && rsiVal >= 50 && curGainPct >= cfg.minGain) {
        exitPrice = bar.close * (1 - slipRate);
        exitTime = bar.time;
        exitOpenTime = bar.openTime;
        exitReason = 'RSI 50 Midline Exit in Profit';
        break;
      } else if (cfg.slPct && bar.low <= avgPrice * (1 - cfg.slPct / 100)) {
        exitPrice = avgPrice * (1 - cfg.slPct / 100) * (1 - slipRate);
        exitTime = bar.time;
        exitOpenTime = bar.openTime;
        exitReason = 'Stop Loss Hit';
        break;
      }
    }

    if (!exitPrice) {
      const lastBar = candles[Math.min(candles.length - 1, startIdx + 300)];
      exitPrice = lastBar.close * (1 - slipRate);
      exitTime = lastBar.time;
      exitOpenTime = lastBar.openTime;
      exitReason = 'Timeout Exit';
    }

    const gross = totalCoins * exitPrice;
    const fees = (totalInvestedUSD * feeRate) + (gross * feeRate);
    const netPnL = gross - totalInvestedUSD - fees;
    curBalance += netPnL;
    nextFreeTime = exitOpenTime;

    completedTrades.push({
      symbol: sym,
      entryTime: sig.time,
      exitTime,
      soFilled,
      netPnL,
      curBalance,
      exitReason
    });
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
    netGainUSD: (curBalance - initialBalance).toFixed(2),
    netGainPct: (((curBalance - initialBalance) / initialBalance) * 100).toFixed(2) + '%'
  };
}

console.log('--- REFINED $50 PARAMETER SWEEPS ---');
console.log('Opt 1 (Base 30%, SO 70% at -3.0%, TP 1.2%, RSI 50 min 0.8%, SL 8%):', testRefined50({
  name: 'Opt 1', baseRatio: 0.30, soDev: 3.0, tpPct: 1.2, useRsi50: true, minGain: 0.8, slPct: 8.0, useTrend: false
}));
console.log('Opt 2 (Base 30%, SO 70% at -3.5%, TP 1.5%, RSI 50 min 1.0%, SL 10%):', testRefined50({
  name: 'Opt 2', baseRatio: 0.30, soDev: 3.5, tpPct: 1.5, useRsi50: true, minGain: 1.0, slPct: 10.0, useTrend: false
}));
console.log('Opt 3 (Base 30%, SO 70% at -3.0%, TP 1.2%, RSI 50 min 0.8%, with 15m Trend Close > EMA50):', testRefined50({
  name: 'Opt 3', baseRatio: 0.30, soDev: 3.0, tpPct: 1.2, useRsi50: true, minGain: 0.8, slPct: 8.0, useTrend: true
}));
console.log('Opt 4 (Base 35%, SO 65% at -2.5%, TP 1.0%, No SL, 3-Day Horizon):', testRefined50({
  name: 'Opt 4', baseRatio: 0.35, soDev: 2.5, tpPct: 1.0, useRsi50: false, minGain: 0, slPct: null, useTrend: false
}));
console.log('Opt 5 (Base 30%, SO 70% at -4.0%, TP 1.8%, RSI 50 min 1.2%, SL 10%):', testRefined50({
  name: 'Opt 5', baseRatio: 0.30, soDev: 4.0, tpPct: 1.8, useRsi50: true, minGain: 1.2, slPct: 10.0, useTrend: false
}));
