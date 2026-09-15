/**
 * Technical Analysis Engine
 * Computes Moving Averages, RSI, MACD, Bollinger Bands, ATR, and Pivot Support/Resistance.
 */

export function calculateSMA(data, period) {
  const result = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(null);
      continue;
    }
    const sum = data.slice(i - period + 1, i + 1).reduce((acc, val) => acc + val, 0);
    result.push(sum / period);
  }
  return result;
}

export function calculateEMA(data, period) {
  const result = [];
  const multiplier = 2 / (period + 1);
  let prevEma = null;

  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(null);
      continue;
    }
    if (prevEma === null) {
      const sum = data.slice(0, period).reduce((acc, val) => acc + val, 0);
      prevEma = sum / period;
      result.push(prevEma);
    } else {
      const currentEma = (data[i] - prevEma) * multiplier + prevEma;
      result.push(currentEma);
      prevEma = currentEma;
    }
  }
  return result;
}

export function calculateRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const currentGain = diff > 0 ? diff : 0;
    const currentLoss = diff < 0 ? Math.abs(diff) : 0;

    avgGain = (avgGain * (period - 1) + currentGain) / period;
    avgLoss = (avgLoss * (period - 1) + currentLoss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Number((100 - (100 / (1 + rs))).toFixed(2));
}

export function calculateMACD(closes, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  if (closes.length < slowPeriod + signalPeriod) return null;

  const fastEMA = calculateEMA(closes, fastPeriod);
  const slowEMA = calculateEMA(closes, slowPeriod);

  const macdLine = [];
  for (let i = 0; i < closes.length; i++) {
    if (fastEMA[i] !== null && slowEMA[i] !== null) {
      macdLine.push(fastEMA[i] - slowEMA[i]);
    } else {
      macdLine.push(null);
    }
  }

  const validMacdValues = macdLine.filter(v => v !== null);
  const signalLineValues = calculateEMA(validMacdValues, signalPeriod);

  const latestMacd = validMacdValues[validMacdValues.length - 1];
  const latestSignal = signalLineValues[signalLineValues.length - 1];
  const prevMacd = validMacdValues[validMacdValues.length - 2] || latestMacd;
  const prevSignal = signalLineValues[signalLineValues.length - 2] || latestSignal;

  const histogram = latestMacd - latestSignal;
  const prevHistogram = prevMacd - prevSignal;

  return {
    macd: Number(latestMacd.toFixed(4)),
    signal: Number(latestSignal.toFixed(4)),
    histogram: Number(histogram.toFixed(4)),
    histogramExpanding: Math.abs(histogram) > Math.abs(prevHistogram),
    bullishCrossover: prevMacd <= prevSignal && latestMacd > latestSignal,
    bearishCrossover: prevMacd >= prevSignal && latestMacd < latestSignal
  };
}

export function calculateATR(highs, lows, closes, period = 14) {
  if (closes.length < period + 1) return null;

  const trueRanges = [];
  for (let i = 1; i < closes.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    trueRanges.push(tr);
  }

  let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
  }

  return Number(atr.toFixed(4));
}

export function calculateBollingerBands(closes, period = 20, stdDev = 2) {
  if (closes.length < period) return null;

  const slice = closes.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
  const std = Math.sqrt(variance);

  return {
    upper: Number((mean + std * stdDev).toFixed(4)),
    middle: Number(mean.toFixed(4)),
    lower: Number((mean - std * stdDev).toFixed(4)),
    bandwidth: Number((((mean + std * stdDev) - (mean - std * stdDev)) / mean * 100).toFixed(2))
  };
}

export function calculateTechnicalMetrics(candles) {
  if (!candles || candles.length < 30) {
    return null;
  }

  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const volumes = candles.map(c => c.volume || 0);

  const currentPrice = closes[closes.length - 1];

  const ema9Series = calculateEMA(closes, 9);
  const ema21Series = calculateEMA(closes, 21);
  const ema50Series = calculateEMA(closes, 50);
  const ema200Series = calculateEMA(closes, Math.min(200, closes.length));

  const ema9 = ema9Series[ema9Series.length - 1];
  const ema21 = ema21Series[ema21Series.length - 1];
  const ema50 = ema50Series[ema50Series.length - 1];
  const ema200 = ema200Series[ema200Series.length - 1];

  const rsi = calculateRSI(closes, 14);
  const macd = calculateMACD(closes, 12, 26, 9);
  const atr = calculateATR(highs, lows, closes, 14) || (currentPrice * 0.015);
  const bb = calculateBollingerBands(closes, 20, 2);

  // Support and Resistance based on recent 20-candle swings
  const recentHighs = highs.slice(-20);
  const recentLows = lows.slice(-20);
  const resistance = Math.max(...recentHighs);
  const support = Math.min(...recentLows);

  return {
    currentPrice,
    ema9: ema9 ? Number(ema9.toFixed(4)) : currentPrice,
    ema21: ema21 ? Number(ema21.toFixed(4)) : currentPrice,
    ema50: ema50 ? Number(ema50.toFixed(4)) : currentPrice,
    ema200: ema200 ? Number(ema200.toFixed(4)) : currentPrice,
    rsi,
    macd,
    atr,
    bb,
    resistance: Number(resistance.toFixed(4)),
    support: Number(support.toFixed(4)),
    candleCount: candles.length
  };
}
