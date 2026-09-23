/**
 * High-Frequency Scalping Confluence Engine
 * 
 * Key Principles:
 * 1. Active Scalp Confluence: Constructive multi-factor scoring across Trend (EMA 9/21/50/200),
 *    Value Pullbacks (EMA 21), RSI Momentum (35-60 Sweet Zone), Candlestick Impulses, and MACD.
 * 2. Strict 1:1.3 Risk-to-Reward Ratio: Take-Profit distance is strictly 1.3x Stop-Loss distance.
 * 3. Strict 5-Minute Maximum Trade Cap: All scalps are designed to complete within 5 minutes.
 * 4. High-Frequency Opportunity: Generates 50%+ confidence signals reliably across 78 global pairs.
 */

export function evaluateStrategyConfluence(asset, technicals, options = {}) {
  const tradeDirection = options.tradeDirection || 'BOTH';
  const tradingStyle = options.tradingStyle || 'SCALPING';

  if (!technicals) {
    return {
      action: 'NEUTRAL',
      confidence: 0,
      reason: 'Insufficient historical candle data',
      factors: []
    };
  }

  const { currentPrice, ema9, ema21, ema50, ema200, rsi, macd, atr, bb } = technicals;

  // Constructive baseline score (active market participation)
  let longScore = 32;
  let shortScore = 32;
  const longReasons = [];
  const shortReasons = [];

  const minAtr = atr || (currentPrice * (asset.category === 'Forex' ? 0.0025 : 0.005));

  // ==========================================
  // 1. TREND ALIGNMENT (EMA 9, 21, 50, 200)
  // ==========================================
  const isAboveEma50 = ema50 ? currentPrice >= ema50 : true;
  const isAboveEma200 = ema200 ? currentPrice >= ema200 : true;
  const isBelowEma50 = ema50 ? currentPrice <= ema50 : true;
  const isBelowEma200 = ema200 ? currentPrice <= ema200 : true;

  const isEmaBullish = ema9 && ema21 ? currentPrice >= ema21 && ema9 >= ema21 : false;
  const isEmaBearish = ema9 && ema21 ? currentPrice <= ema21 && ema9 <= ema21 : false;

  if (isEmaBullish) {
    longScore += 16;
    longReasons.push('Micro Trend: EMA 9 leading above EMA 21');
  }
  if (isEmaBearish) {
    shortScore += 16;
    shortReasons.push('Micro Trend: EMA 9 trailing below EMA 21');
  }

  if (isAboveEma50) {
    longScore += 12;
    if (isAboveEma200) {
      longScore += 6;
      longReasons.push('Macro Trend: Price trading above EMA 50 & 200');
    }
  } else {
    longScore -= 8;
  }

  if (isBelowEma50) {
    shortScore += 12;
    if (isBelowEma200) {
      shortScore += 6;
      shortReasons.push('Macro Trend: Price trading below EMA 50 & 200');
    }
  } else {
    shortScore -= 8;
  }

  // ==========================================
  // 2. VALUE PULLBACK ZONE (EMA 21 Dynamic Bounce/Rejection)
  // ==========================================
  const distToEma21 = ema21 ? Math.abs(currentPrice - ema21) : 0;
  if (distToEma21 <= minAtr * 1.2) {
    if (isEmaBullish) {
      longScore += 14;
      longReasons.push('Value Entry: Dip pullback bouncing off dynamic EMA 21 support');
    }
    if (isEmaBearish) {
      shortScore += 14;
      shortReasons.push('Value Entry: Rally pullback rejecting at dynamic EMA 21 resistance');
    }
  }

  // ==========================================
  // 3. BOLLINGER BAND VOLATILITY SWEET SPOT
  // ==========================================
  if (bb) {
    if (currentPrice <= bb.middle) {
      longScore += 10;
      longReasons.push('Bollinger Channel: Favorable risk/reward entry in lower half');
    }
    if (currentPrice >= bb.middle) {
      shortScore += 10;
      shortReasons.push('Bollinger Channel: Favorable risk/reward entry in upper half');
    }
    if (currentPrice >= bb.upper) {
      longScore -= 12;
      shortScore += 10;
      shortReasons.push('Upper Band Rejection: Potential mean-reversion short');
    }
    if (currentPrice <= bb.lower) {
      shortScore -= 12;
      longScore += 10;
      longReasons.push('Lower Band Absorption: Potential mean-reversion long');
    }
  }

  // ==========================================
  // 4. RSI MOMENTUM & REVERSAL SWEET SPOT
  // ==========================================
  if (rsi !== null && rsi !== undefined) {
    if (rsi >= 35 && rsi <= 58) {
      longScore += 16;
      longReasons.push(`Optimal Long RSI (${rsi.toFixed(1)}): Healthy momentum runway`);
    } else if (rsi < 32) {
      longScore += 14;
      longReasons.push(`Oversold RSI Dip (${rsi.toFixed(1)}): Micro rebound potential`);
    } else if (rsi > 70) {
      longScore -= 15;
    }

    if (rsi >= 42 && rsi <= 65) {
      shortScore += 16;
      shortReasons.push(`Optimal Short RSI (${rsi.toFixed(1)}): Bearish momentum active`);
    } else if (rsi > 68) {
      shortScore += 14;
      shortReasons.push(`Overbought RSI Pop (${rsi.toFixed(1)}): Micro rejection potential`);
    } else if (rsi < 30) {
      shortScore -= 15;
    }
  }

  // ==========================================
  // 5. CANDLESTICK CONFIRMATION
  // ==========================================
  if (asset.candles && asset.candles.length >= 2) {
    const lastCandle = asset.candles[asset.candles.length - 1];
    const isGreen = lastCandle.close >= lastCandle.open;
    const body = Math.abs(lastCandle.close - lastCandle.open);
    const lowerWick = Math.min(lastCandle.open, lastCandle.close) - lastCandle.low;
    const upperWick = lastCandle.high - Math.max(lastCandle.open, lastCandle.close);

    if (isGreen) {
      longScore += 12;
      longReasons.push('Bullish Candle Impulse: Micro buyer pressure');
      if (lowerWick >= body * 0.25) longScore += 6;
      shortScore -= 6;
    } else {
      shortScore += 12;
      shortReasons.push('Bearish Candle Impulse: Micro seller pressure');
      if (upperWick >= body * 0.25) shortScore += 6;
      longScore -= 6;
    }
  }

  // ==========================================
  // 6. MACD MOMENTUM CONFIRMATION
  // ==========================================
  if (macd) {
    if (macd.histogram > 0) {
      longScore += 10;
      longReasons.push('MACD: Positive bullish momentum');
    }
    if (macd.histogram < 0) {
      shortScore += 10;
      shortReasons.push('MACD: Negative bearish momentum');
    }
  }

  // ==========================================
  // 7. PRIME SCALP ASSET PRIORITY
  // ==========================================
  const PRIME_SCALP_SYMBOLS = ['GC=F', 'EURUSD=X', 'GBPUSD=X', 'USDJPY=X', 'GBPJPY=X', 'EURJPY=X', 'AUDUSD=X', 'BTC-USD', 'BTCUSD', 'SOL-USD', 'DOGE-USD'];
  if (PRIME_SCALP_SYMBOLS.includes(asset.symbol)) {
    if (longScore >= shortScore) longScore += 8;
    if (shortScore >= longScore) shortScore += 8;
  }

  // Directional filter
  if (tradeDirection === 'SHORT_ONLY') {
    longScore = 0;
  } else if (tradeDirection === 'LONG_ONLY') {
    shortScore = 0;
  }

  const finalShortConfidence = Math.max(0, Math.min(100, Math.round(shortScore)));
  const finalLongConfidence = Math.max(0, Math.min(100, Math.round(longScore)));

  // SCALPING STRIKE ZONE GEOMETRY (Strict 1:1.3 Risk-to-Reward Ratio):
  let stopPct = 0.0025; // 0.25% baseline
  const targetRR = 1.30; // Strictly 1:1.3 Risk-to-Reward ratio

  if (asset.category === 'Crypto') {
    stopPct = 0.0035; // 0.35% for fast crypto micro-scalps
  } else if (asset.category === 'Forex') {
    stopPct = 0.0015; // 0.15% for forex (15 pips)
  } else if (asset.category === 'Commodities' || asset.category === 'Indices') {
    stopPct = 0.0020; // 0.20% for commodities & indices
  }

  const baseStopDist = Number((currentPrice * stopPct).toFixed(asset.decimals || 4));
  const atrStopDist = atr ? Number((atr * 0.85).toFixed(asset.decimals || 4)) : baseStopDist;
  const stopDistance = Math.max(baseStopDist, atrStopDist);
  const targetDistance = Number((stopDistance * targetRR).toFixed(asset.decimals || 4));
  const effectiveRR = Number((targetDistance / stopDistance).toFixed(2));

  // Active Scalping Threshold (Default 50% for fast, frequent executions across 78 pairs)
  const SNIPER_THRESHOLD = options.minConfidenceThreshold !== undefined ? Number(options.minConfidenceThreshold) : 50;

  // 1. Check SHORT Scalp Setup
  if (tradeDirection !== 'LONG_ONLY' && finalShortConfidence >= SNIPER_THRESHOLD && finalShortConfidence >= finalLongConfidence) {
    const stopLoss = Number((currentPrice + stopDistance).toFixed(asset.decimals || 4));
    const takeProfit = Number((currentPrice - targetDistance).toFixed(asset.decimals || 4));

    return {
      action: 'STRONG_SELL',
      side: 'SHORT',
      confidence: finalShortConfidence,
      entryPrice: currentPrice,
      stopLoss,
      takeProfit,
      stopDistance,
      targetDistance,
      riskRewardRatio: effectiveRR,
      maxHoldMinutes: 5,
      tradingStyle: 'SCALPING',
      tradeDirection,
      reason: shortReasons.slice(0, 3).join('. ') || 'High-probability Bearish Scalp Confluence',
      factors: shortReasons
    };
  }

  // 2. Check LONG Scalp Setup
  if (tradeDirection !== 'SHORT_ONLY' && finalLongConfidence >= SNIPER_THRESHOLD && finalLongConfidence >= finalShortConfidence) {
    const stopLoss = Number((currentPrice - stopDistance).toFixed(asset.decimals || 4));
    const takeProfit = Number((currentPrice + targetDistance).toFixed(asset.decimals || 4));

    return {
      action: 'STRONG_BUY',
      side: 'LONG',
      confidence: finalLongConfidence,
      entryPrice: currentPrice,
      stopLoss,
      takeProfit,
      stopDistance,
      targetDistance,
      riskRewardRatio: effectiveRR,
      maxHoldMinutes: 5,
      tradingStyle: 'SCALPING',
      tradeDirection,
      reason: longReasons.slice(0, 3).join('. ') || 'High-probability Bullish Scalp Confluence',
      factors: longReasons
    };
  }

  return {
    action: 'NEUTRAL',
    side: null,
    confidence: Math.max(finalLongConfidence, finalShortConfidence),
    entryPrice: currentPrice,
    stopLoss: null,
    takeProfit: null,
    riskRewardRatio: null,
    tradingStyle: 'SCALPING',
    tradeDirection,
    reason: `Scanning micro-scalp setup (Confidence: ${Math.max(finalLongConfidence, finalShortConfidence)}% / ${SNIPER_THRESHOLD}%).`,
    factors: ['Scanning active 78-pair radar for 1:1.3 R:R micro-scalps']
  };
}

/**
 * Intelligent Scalp Position Exit Evaluator
 * Safely banks deep-profit exhaustion while eliminating premature 1-tick chops
 */
export function evaluatePositionExit(position, technicals, currentPrice) {
  if (!position || !technicals) return { shouldExit: false };

  const { side, entryPrice, stopDistance, targetDistance } = position;
  const { rsi } = technicals;
  const targetDist = targetDistance || stopDistance * 1.3;

  if (side === 'SHORT') {
    // Momentum Exhaustion Lock: Short is in deep profit (>= 80% of target) and RSI reached extreme oversold (< 24)
    const runDown = entryPrice - currentPrice;
    if (runDown >= targetDist * 0.80 && rsi && rsi < 24) {
      return {
        shouldExit: true,
        reason: 'MOMENTUM_EXHAUSTION_EXIT',
        message: 'Scalp Profit Banked: Extreme RSI oversold exhaustion reached'
      };
    }
  } else if (side === 'LONG') {
    // Momentum Exhaustion Lock: Long is in deep profit (>= 80% of target) and RSI reached extreme overbought (> 76)
    const runUp = currentPrice - entryPrice;
    if (runUp >= targetDist * 0.80 && rsi && rsi > 76) {
      return {
        shouldExit: true,
        reason: 'MOMENTUM_EXHAUSTION_EXIT',
        message: 'Scalp Profit Banked: Extreme RSI overbought exhaustion reached'
      };
    }
  }

  return { shouldExit: false };
}

/**
 * High-Precision Pure Spot Crypto Confluence Engine
 * - Strictly Long-Only Crypto Buy evaluation
 * - Constructive scoring with 50% default threshold
 * - Strict 1:1.3 Risk-to-Reward ratio
 * - Strict 5-minute maximum holding cap
 */
export function evaluateSpotConfluence(asset, technicals, spotRiskSettings = {}) {
  if (!technicals || asset.category !== 'Crypto') {
    return { action: 'NEUTRAL', side: null, confidence: 0 };
  }

  const currentPrice = asset.price || technicals.currentPrice;
  const { ema9, ema21, ema50, ema200, rsi, macd, bollingerBands: bb } = technicals;

  const baseStopLossPct = Math.max(0.3, Number(spotRiskSettings.stopLossPct) || 0.6);
  // Strict 1:1.3 R:R: takeProfitPct is strictly 1.3 * stopLossPct
  const baseTakeProfitPct = Number((baseStopLossPct * 1.30).toFixed(2));
  const minThreshold = Number(spotRiskSettings.minConfidenceThreshold) || 50;
  const maxHoldMinutes = 5; // Strict 5-minute cap

  // Adapt geometry to coin's volatility
  const isVolatileCoin = asset.isHighVolatility || (asset.minVolatility && asset.minVolatility >= 1.4);
  const volFactor = isVolatileCoin ? Math.min(1.25, (asset.minVolatility || 1.3) / 1.2) : 1.0;
  const stopLossPct = Number((baseStopLossPct * volFactor).toFixed(2));
  const takeProfitPct = Number((baseTakeProfitPct * volFactor).toFixed(2));

  let score = 32; // Constructive baseline
  const factors = [];

  // 1. TREND STRUCTURE
  const isAboveEma50 = ema50 ? currentPrice >= ema50 : true;
  const isAboveEma200 = ema200 ? currentPrice >= ema200 : true;
  const isEmaBullish = ema9 && ema21 ? ema9 >= ema21 : false;

  if (isEmaBullish) {
    score += 18;
    factors.push('Micro Bull Trend: EMA 9 crossed above EMA 21');
  }
  if (isAboveEma50) {
    score += 12;
    if (isAboveEma200) {
      score += 8;
      factors.push('Macro Bull Trend: Price above EMA 50 & 200');
    }
  }

  // 2. VALUE ENTRY ZONE (Pullback to EMA Support)
  if (ema21) {
    const distToEma21Pct = Math.abs(currentPrice - ema21) / currentPrice;
    if (distToEma21Pct <= 0.012 && currentPrice >= ema21) {
      score += 15;
      factors.push('Value Entry: Dip pullback bouncing off dynamic EMA 21 support');
    }
  }

  // 3. RSI VALUE FILTER
  if (rsi !== null && rsi !== undefined) {
    if (rsi >= 35 && rsi <= 58) {
      score += 16;
      factors.push(`Optimal Buy RSI (${rsi.toFixed(1)}): Healthy momentum runway`);
    } else if (rsi < 35) {
      score += 14;
      factors.push(`Oversold Rebound RSI (${rsi.toFixed(1)}): Deep dip buyer interest`);
    } else if (rsi > 70) {
      score -= 12;
    }
  }

  // 4. MACD MOMENTUM
  if (macd) {
    if (macd.histogram > 0) {
      score += 12;
      factors.push('Positive MACD: Micro momentum expanding upwards');
    } else if (macd.histogram > -0.0005) {
      score += 8;
      factors.push('MACD Turning Bullish: Bearish momentum exhausted');
    }
  }

  // 5. BOLLINGER BAND
  if (bb) {
    if (currentPrice <= bb.middle) {
      score += 10;
      factors.push('Lower Bollinger Band: Buying in value half of channel');
    }
    if (currentPrice >= bb.upper) {
      score -= 10;
    }
  }

  // 6. CANDLESTICK CONFIRMATION
  if (asset.candles && asset.candles.length >= 2) {
    const lastCandle = asset.candles[asset.candles.length - 1];
    const isGreen = lastCandle.close >= lastCandle.open;
    const bodySize = Math.abs(lastCandle.close - lastCandle.open);
    const lowerWick = Math.min(lastCandle.open, lastCandle.close) - lastCandle.low;

    if (isGreen) {
      score += 12;
      factors.push('Bullish Candle Confirmation: Upward micro-impulse');
      if (lowerWick >= bodySize * 0.25) score += 6;
    }
  }

  // 7. VOLATILITY BONUS
  if (isVolatileCoin) {
    score += 12;
    factors.push(`High-Volatility Momentum (${asset.symbol})`);
  }

  const finalConfidence = Math.max(0, Math.min(100, Math.round(score)));

  // Calculate Geometry (Strict 1:1.3 R:R)
  const stopDist = Number((currentPrice * (stopLossPct / 100)).toFixed(asset.decimals || 4));
  const targetDist = Number((currentPrice * (takeProfitPct / 100)).toFixed(asset.decimals || 4));
  const stopLoss = Number((currentPrice - stopDist).toFixed(asset.decimals || 4));
  const takeProfit = Number((currentPrice + targetDist).toFixed(asset.decimals || 4));
  const effectiveRR = 1.30;

  if (finalConfidence >= minThreshold) {
    return {
      action: 'STRONG_BUY',
      side: 'LONG',
      confidence: finalConfidence,
      volatilityMultiplier: asset.minVolatility || 1.0,
      isHighVolatility: Boolean(isVolatileCoin),
      entryPrice: currentPrice,
      stopLoss,
      takeProfit,
      stopDistance: stopDist,
      targetDistance: targetDist,
      riskRewardRatio: effectiveRR,
      maxHoldMinutes,
      tradingStyle: 'SPOT_BUY',
      tradeDirection: 'LONG_ONLY',
      reason: factors.slice(0, 3).join('. ') || 'Bullish Spot Scalp Confluence',
      factors
    };
  }

  return {
    action: 'NEUTRAL',
    side: null,
    confidence: finalConfidence,
    entryPrice: currentPrice,
    stopLoss: null,
    takeProfit: null,
    riskRewardRatio: effectiveRR,
    maxHoldMinutes,
    tradingStyle: 'SPOT_BUY',
    tradeDirection: 'LONG_ONLY',
    reason: `Scanning spot setup (Confidence: ${finalConfidence}% / ${minThreshold}%).`,
    factors: ['Scanning active crypto markets for 1:1.3 R:R spot scalps']
  };
}
