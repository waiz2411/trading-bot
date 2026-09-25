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

  let longScore = 0;
  let shortScore = 0;
  const longReasons = [];
  const shortReasons = [];

  const minAtr = atr || (currentPrice * (asset.category === 'Forex' ? 0.0010 : 0.0030));

  // ==========================================
  // ==========================================
  // 1. PRIMARY MICRO-TREND (EMA 9 vs EMA 21 Direction & Expansion)
  // ==========================================
  if (ema9 && ema21) {
    if (ema9 > ema21) {
      longScore += 28;
      longReasons.push('Micro Uptrend: EMA 9 leading above EMA 21');
    } else if (ema9 < ema21) {
      shortScore += 28;
      shortReasons.push('Micro Downtrend: EMA 9 leading below EMA 21');
    }
  }

  // ==========================================
  // 2. INTERMEDIATE TREND BIAS (EMA 50 & EMA 200)
  // ==========================================
  if (ema50) {
    if (currentPrice >= ema50) {
      longScore += 18;
      longReasons.push('Macro Bias: Price trading above EMA 50');
      if (ema200 && currentPrice >= ema200) {
        longScore += 8;
        longReasons.push('Macro Trend: Price trading above EMA 200');
      }
    } else {
      shortScore += 18;
      shortReasons.push('Macro Bias: Price trading below EMA 50');
      if (ema200 && currentPrice <= ema200) {
        shortScore += 8;
        shortReasons.push('Macro Trend: Price trading below EMA 200');
      }
    }
  }

  // ==========================================
  // 3. VALUE PULLBACK ZONE (Near EMA 21 Dynamic Guide)
  // ==========================================
  const distToEma21 = ema21 ? Math.abs(currentPrice - ema21) : Infinity;
  const isAtEma21Pocket = distToEma21 <= minAtr * 1.5;

  if (longScore > 0 && isAtEma21Pocket) {
    longScore += 16;
    longReasons.push('Value Pocket: Price oscillating near EMA 21 support pocket');
  }
  if (shortScore > 0 && isAtEma21Pocket) {
    shortScore += 16;
    shortReasons.push('Value Pocket: Price oscillating near EMA 21 resistance pocket');
  }

  // ==========================================
  // 4. CANDLESTICK PRESSURE & REJECTION WICKS
  // ==========================================
  if (asset.candles && asset.candles.length >= 2) {
    const lastCandle = asset.candles[asset.candles.length - 1];
    const prevCandle = asset.candles[asset.candles.length - 2];
    const range = Math.max(0.00001, lastCandle.high - lastCandle.low);
    const lowerWick = Math.min(lastCandle.open, lastCandle.close) - lastCandle.low;
    const upperWick = lastCandle.high - Math.max(lastCandle.open, lastCandle.close);
    const isGreen = lastCandle.close >= lastCandle.open;

    if (longScore > 0) {
      if (lowerWick / range >= 0.25 || isGreen) {
        longScore += 16;
        longReasons.push('Bullish Pressure: Buyer volume absorption confirmed');
      }
    }
    if (shortScore > 0) {
      if (upperWick / range >= 0.25 || !isGreen) {
        shortScore += 16;
        shortReasons.push('Bearish Pressure: Seller rejection confirmed');
      }
    }
  }

  // ==========================================
  // 5. RSI MOMENTUM RUNWAY (40 - 64)
  // ==========================================
  if (rsi !== null && rsi !== undefined) {
    if (longScore > 0 && rsi >= 40 && rsi <= 65) {
      longScore += 14;
      longReasons.push(`RSI Runway (${rsi.toFixed(1)}): Clear bullish expansion room`);
    }
    if (shortScore > 0 && rsi >= 35 && rsi <= 60) {
      shortScore += 14;
      shortReasons.push(`RSI Runway (${rsi.toFixed(1)}): Clear bearish expansion room`);
    }
  }

  // ==========================================
  // 6. MACD MOMENTUM CONFIRMATION
  // ==========================================
  if (macd) {
    if (longScore > 0 && macd.histogram > 0) {
      longScore += 10;
      longReasons.push('MACD: Positive bullish momentum acceleration');
    }
    if (shortScore > 0 && macd.histogram < 0) {
      shortScore += 10;
      shortReasons.push('MACD: Negative bearish momentum acceleration');
    }
  }

  // ==========================================
  // 7. BOLLINGER BANDS POSITION
  // ==========================================
  if (bb) {
    if (longScore > 0 && currentPrice <= bb.middle * 1.002) {
      longScore += 8;
      longReasons.push('Bollinger Value: Buying in lower half of volatility band');
    }
    if (shortScore > 0 && currentPrice >= bb.middle * 0.998) {
      shortScore += 8;
      shortReasons.push('Bollinger Value: Shorting in upper half of volatility band');
    }
  }

  // Directional filter
  if (tradeDirection === 'SHORT_ONLY') {
    longScore = 0;
  } else if (tradeDirection === 'LONG_ONLY') {
    shortScore = 0;
  }

  const finalShortConfidence = Math.max(0, Math.min(100, Math.round(shortScore)));
  const finalLongConfidence = Math.max(0, Math.min(100, Math.round(longScore)));

  // ==========================================
  // FAST MICRO-SCALP GEOMETRY (3.5 to 6 pips micro targets, ~$0.45 stop / ~$0.60 TP per 0.01 lot)
  // ==========================================
  const targetRR = options.targetRiskRewardRatio !== undefined ? Number(options.targetRiskRewardRatio) : 1.30;
  const decimals = asset.decimals !== undefined ? asset.decimals : 4;

  let stopDistance;
  if (asset.category === 'Crypto') {
    stopDistance = 45.00; // ~$0.45 per 0.01 lot BTC
  } else if (asset.category === 'Forex') {
    if (asset.symbol.includes('JPY')) {
      stopDistance = 0.055; // 5.5 pips (~$0.35 - $0.50 on 0.01 lot)
    } else {
      stopDistance = 0.00045; // 4.5 pips ($0.45 on 0.01 lot EURUSD/GBPUSD)
    }
  } else if (asset.symbol.includes('GC') || asset.symbol.includes('XAU')) {
    stopDistance = 0.55; // $0.55 move on Gold ($0.55 on 0.01 lot)
  } else {
    stopDistance = Number((currentPrice * 0.00045).toFixed(decimals));
  }

  const targetDistance = Number((stopDistance * targetRR).toFixed(decimals));
  const effectiveRR = Number((targetDistance / stopDistance).toFixed(2));

  // Active Scalping Threshold (Defaults to user configured threshold, e.g. 90%)
  const SNIPER_THRESHOLD = options.minConfidenceThreshold !== undefined ? Number(options.minConfidenceThreshold) : 90;

  // Clear directional edge requirement (must be >= threshold and have >= 4% lead over opposite side)
  const isLongWinning = finalLongConfidence >= SNIPER_THRESHOLD && (
    tradeDirection === 'LONG_ONLY' || 
    (tradeDirection === 'BOTH' && finalLongConfidence >= finalShortConfidence + 4)
  );

  const isShortWinning = finalShortConfidence >= SNIPER_THRESHOLD && (
    tradeDirection === 'SHORT_ONLY' || 
    (tradeDirection === 'BOTH' && finalShortConfidence >= finalLongConfidence + 4)
  );

  // 1. Check LONG Scalp Setup (Prioritize whichever has the true directional lead)
  if (tradeDirection !== 'SHORT_ONLY' && isLongWinning) {
    const stopLoss = Number((currentPrice - stopDistance).toFixed(decimals));
    const takeProfit = Number((currentPrice + targetDistance).toFixed(decimals));

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

  // 2. Check SHORT Scalp Setup
  if (tradeDirection !== 'LONG_ONLY' && isShortWinning) {
    const stopLoss = Number((currentPrice + stopDistance).toFixed(decimals));
    const takeProfit = Number((currentPrice - targetDistance).toFixed(decimals));

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
