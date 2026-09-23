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
  let longScore = 25;
  let shortScore = 25;
  const longReasons = [];
  const shortReasons = [];

  const minAtr = atr || (currentPrice * (asset.category === 'Forex' ? 0.0025 : 0.005));

  // ==========================================
  // 1. TREND ALIGNMENT (EMA 9, 21, 50, 200)
  // ==========================================
  const isEmaBullish = ema9 && ema21 ? (currentPrice >= ema21 && ema9 >= ema21) : false;
  const isEmaBearish = ema9 && ema21 ? (currentPrice <= ema21 && ema9 <= ema21) : false;

  if (isEmaBullish) {
    longScore += 16;
    shortScore -= 10;
    longReasons.push('Micro Trend: Price & EMA 9 leading above EMA 21');
  } else if (isEmaBearish) {
    shortScore += 16;
    longScore -= 10;
    shortReasons.push('Micro Trend: Price & EMA 9 trailing below EMA 21');
  }

  if (ema50) {
    if (currentPrice >= ema50) {
      longScore += 12;
      shortScore -= 8;
      if (ema200 && currentPrice >= ema200) {
        longScore += 6;
        shortScore -= 6;
        longReasons.push('Macro Trend: Price trading above EMA 50 & 200');
      }
    } else {
      shortScore += 12;
      longScore -= 8;
      if (ema200 && currentPrice <= ema200) {
        shortScore += 6;
        longScore -= 6;
        shortReasons.push('Macro Trend: Price trading below EMA 50 & 200');
      }
    }
  }

  // ==========================================
  // 2. VALUE PULLBACK ZONE (EMA 21 Dynamic Bounce/Rejection)
  // ==========================================
  const distToEma21 = ema21 ? Math.abs(currentPrice - ema21) : Infinity;
  if (distToEma21 <= minAtr * 1.2) {
    if (isEmaBullish && currentPrice >= ema21) {
      longScore += 12;
      longReasons.push('Value Entry: Bullish pullback bouncing off EMA 21 dynamic support');
    }
    if (isEmaBearish && currentPrice <= ema21) {
      shortScore += 12;
      shortReasons.push('Value Entry: Bearish rally rejecting at EMA 21 dynamic resistance');
    }
  }

  // ==========================================
  // 3. BOLLINGER BAND VOLATILITY (Trend & Momentum Following)
  // ==========================================
  if (bb) {
    // Upper half = Bullish channel expansion; Lower half = Bearish channel expansion
    if (currentPrice > bb.middle) {
      longScore += 12;
      shortScore -= 10;
      longReasons.push('Bollinger Channel: Bullish expansion in upper half of band');
    } else if (currentPrice < bb.middle) {
      shortScore += 12;
      longScore -= 10;
      shortReasons.push('Bollinger Channel: Bearish expansion in lower half of band');
    }

    // Walking the bands: Breakouts / Thrusts (Trend momentum, NEVER counter-trade)
    if (currentPrice >= bb.upper) {
      longScore += 12;
      shortScore -= 18; // NEVER short an upper band breakout
      longReasons.push('Upper Band Breakout: Strong bullish volatility thrust');
    } else if (currentPrice <= bb.lower) {
      shortScore += 12;
      longScore -= 18; // NEVER buy a lower band breakdown
      shortReasons.push('Lower Band Breakdown: Strong bearish volatility cascade');
    }
  }

  // ==========================================
  // 4. RSI MOMENTUM & DIRECTIONAL SWEET SPOT
  // ==========================================
  if (rsi !== null && rsi !== undefined) {
    if (rsi >= 50 && rsi <= 68) {
      longScore += 18;
      shortScore -= 12;
      longReasons.push(`RSI Bullish Momentum (${rsi.toFixed(1)}): Healthy upward runway`);
    } else if (rsi > 68) {
      // Strong bullish velocity: support long, strictly forbid counter-trend shorting
      longScore += 14;
      shortScore -= 20;
      longReasons.push(`RSI High Velocity (${rsi.toFixed(1)}): Strong bullish power`);
    } else if (rsi >= 32 && rsi < 50) {
      shortScore += 18;
      longScore -= 12;
      shortReasons.push(`RSI Bearish Momentum (${rsi.toFixed(1)}): Active downward pressure`);
    } else if (rsi < 32) {
      // Strong bearish cascade: support short, strictly forbid counter-trend buying
      shortScore += 14;
      longScore -= 20;
      shortReasons.push(`RSI Downward Cascade (${rsi.toFixed(1)}): Strong bearish selling`);
    }
  }

  // ==========================================
  // 5. CANDLESTICK CONFIRMATION
  // ==========================================
  if (asset.candles && asset.candles.length >= 2) {
    const lastCandle = asset.candles[asset.candles.length - 1];
    const prevCandle = asset.candles[asset.candles.length - 2];
    const isGreen = lastCandle.close >= lastCandle.open;
    const prevIsGreen = prevCandle ? prevCandle.close >= prevCandle.open : isGreen;
    const body = Math.abs(lastCandle.close - lastCandle.open);
    const lowerWick = Math.min(lastCandle.open, lastCandle.close) - lastCandle.low;
    const upperWick = lastCandle.high - Math.max(lastCandle.open, lastCandle.close);

    if (isGreen) {
      longScore += 14;
      shortScore -= 10;
      longReasons.push('Bullish Candle Impulse: Active buyer pressure');
      if (lowerWick >= body * 0.25) longScore += 5;
      if (prevIsGreen) {
        longScore += 6;
        shortScore -= 4;
        longReasons.push('Consecutive Bullish Candles: Sustained buying momentum');
      }
    } else {
      shortScore += 14;
      longScore -= 10;
      shortReasons.push('Bearish Candle Impulse: Active seller pressure');
      if (upperWick >= body * 0.25) shortScore += 5;
      if (!prevIsGreen) {
        shortScore += 6;
        longScore -= 4;
        shortReasons.push('Consecutive Bearish Candles: Sustained selling momentum');
      }
    }
  }

  // ==========================================
  // 6. MACD MOMENTUM CONFIRMATION
  // ==========================================
  if (macd) {
    if (macd.histogram > 0) {
      longScore += 12;
      shortScore -= 10;
      longReasons.push('MACD: Positive bullish momentum acceleration');
    } else if (macd.histogram < 0) {
      shortScore += 12;
      longScore -= 10;
      shortReasons.push('MACD: Negative bearish momentum acceleration');
    }
  }

  // ==========================================
  // 7. PRIME SCALP ASSET PRIORITY
  // ==========================================
  const PRIME_SCALP_SYMBOLS = ['GC=F', 'EURUSD=X', 'GBPUSD=X', 'USDJPY=X', 'GBPJPY=X', 'EURJPY=X', 'AUDUSD=X', 'BTC-USD', 'BTCUSD', 'SOL-USD', 'DOGE-USD'];
  if (PRIME_SCALP_SYMBOLS.includes(asset.symbol)) {
    if (longScore > shortScore) longScore += 6;
    else if (shortScore > longScore) shortScore += 6;
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

  // Clear directional edge requirement (prevent coin-flipping or taking conflicting signals)
  const isLongWinning = finalLongConfidence >= SNIPER_THRESHOLD && (
    tradeDirection === 'LONG_ONLY' || 
    (tradeDirection === 'BOTH' && finalLongConfidence > finalShortConfidence)
  );

  const isShortWinning = finalShortConfidence >= SNIPER_THRESHOLD && (
    tradeDirection === 'SHORT_ONLY' || 
    (tradeDirection === 'BOTH' && finalShortConfidence > finalLongConfidence)
  );

  // 1. Check LONG Scalp Setup (Prioritize whichever has the true directional lead)
  if (tradeDirection !== 'SHORT_ONLY' && isLongWinning) {
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

  // 2. Check SHORT Scalp Setup
  if (tradeDirection !== 'LONG_ONLY' && isShortWinning) {
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
