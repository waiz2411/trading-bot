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

  // Balanced base score (requires genuine confluence to reach 80%–90%+)
  let longScore = 15;
  let shortScore = 15;
  const longReasons = [];
  const shortReasons = [];

  const minAtr = atr || (currentPrice * (asset.category === 'Forex' ? 0.0025 : 0.005));

  // ==========================================
  // 1. TREND ALIGNMENT (EMA 9, 21, 50, 200)
  // ==========================================
  const isEmaBullish = ema9 && ema21 ? (currentPrice >= ema21 && ema9 >= ema21) : false;
  const isEmaBearish = ema9 && ema21 ? (currentPrice <= ema21 && ema9 <= ema21) : false;

  if (isEmaBullish) {
    longScore += 20;
    shortScore -= 12;
    longReasons.push('Micro Trend: Price & EMA 9 leading above EMA 21');
  } else if (isEmaBearish) {
    shortScore += 20;
    longScore -= 12;
    shortReasons.push('Micro Trend: Price & EMA 9 trailing below EMA 21');
  }

  if (ema50) {
    if (currentPrice >= ema50) {
      longScore += 10;
      shortScore -= 8;
      if (ema200 && currentPrice >= ema200) {
        longScore += 5;
        shortScore -= 5;
        longReasons.push('Macro Trend: Price trading above EMA 50 & 200');
      }
    } else {
      shortScore += 10;
      longScore -= 8;
      if (ema200 && currentPrice <= ema200) {
        shortScore += 5;
        longScore -= 5;
        shortReasons.push('Macro Trend: Price trading below EMA 50 & 200');
      }
    }
  }

  // ==========================================
  // 2. VALUE PULLBACK ZONE (EMA 21 Dynamic Bounce/Rejection)
  // ==========================================
  const distToEma21 = ema21 ? Math.abs(currentPrice - ema21) : Infinity;
  if (distToEma21 <= minAtr * 1.3) {
    if (isEmaBullish && currentPrice >= ema21) {
      longScore += 18;
      longReasons.push('Value Entry: Bullish pullback bouncing off EMA 21 dynamic support');
    }
    if (isEmaBearish && currentPrice <= ema21) {
      shortScore += 18;
      shortReasons.push('Value Entry: Bearish rally rejecting at EMA 21 dynamic resistance');
    }
  } else if (distToEma21 > minAtr * 3.0) {
    // Overextended away from moving average: penalize chasing
    longScore -= 12;
    shortScore -= 12;
  }

  // ==========================================
  // 3. BOLLINGER BAND VOLATILITY & MEAN REVERSION
  // ==========================================
  if (bb) {
    // Upper Band Touch: Overbought Exhaustion -> High-probability SHORT reversal!
    if (currentPrice >= bb.upper) {
      shortScore += 18;
      longScore -= 22; // Prevent buying at the absolute ceiling
      shortReasons.push('Bollinger Reversal: Price touching Upper Band (Overbought exhaustion zone)');
    // Lower Band Touch: Oversold Discount -> High-probability LONG bounce!
    } else if (currentPrice <= bb.lower) {
      longScore += 18;
      shortScore -= 22; // Prevent shorting at the absolute floor
      longReasons.push('Bollinger Reversal: Price touching Lower Band (Oversold bounce zone)');
    // Mid-Band Channel Alignment
    } else if (currentPrice > bb.middle && isEmaBullish) {
      longScore += 8;
      longReasons.push('Bollinger Channel: Bullish expansion in upper half of band');
    } else if (currentPrice < bb.middle && isEmaBearish) {
      shortScore += 8;
      shortReasons.push('Bollinger Channel: Bearish expansion in lower half of band');
    }
  }

  // ==========================================
  // 4. RSI MOMENTUM & MEAN REVERSION (Sweet Spot & Overbought/Oversold)
  // ==========================================
  if (rsi !== null && rsi !== undefined) {
    // Overbought (>68): Mean-reversion SHORT scalp, heavy penalty for LONG
    if (rsi >= 68) {
      shortScore += 18;
      longScore -= 25; // Never buy into overbought ceiling!
      shortReasons.push(`RSI Overbought (${rsi.toFixed(1)}): Exhaustion pullback favorable for short`);
    // Oversold (<32): Mean-reversion LONG bounce, heavy penalty for SHORT
    } else if (rsi <= 32) {
      longScore += 18;
      shortScore -= 25; // Never short into oversold floor!
      longReasons.push(`RSI Oversold (${rsi.toFixed(1)}): Discount bounce favorable for long`);
    // Bullish momentum runway (42 - 62): Optimal high-probability scalp zone
    } else if (rsi >= 42 && rsi <= 62) {
      longScore += 18;
      longReasons.push(`RSI Sweet Zone (${rsi.toFixed(1)}): High-probability momentum runway`);
    // Bearish momentum runway (38 - 58): Optimal short scalp zone
    } else if (rsi >= 38 && rsi <= 58) {
      shortScore += 18;
      shortReasons.push(`RSI Sweet Zone (${rsi.toFixed(1)}): High-probability downward runway`);
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
      longScore += 10;
      shortScore -= 8;
      longReasons.push('Bullish Candle Impulse: Active buyer pressure');
      if (lowerWick >= body * 0.25) longScore += 5;
      if (prevIsGreen) {
        longScore += 5;
        shortScore -= 4;
        longReasons.push('Consecutive Bullish Candles: Sustained buying momentum');
      }
    } else {
      shortScore += 10;
      longScore -= 8;
      shortReasons.push('Bearish Candle Impulse: Active seller pressure');
      if (upperWick >= body * 0.25) shortScore += 5;
      if (!prevIsGreen) {
        shortScore += 5;
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
      longScore += 10;
      shortScore -= 8;
      longReasons.push('MACD: Positive bullish momentum acceleration');
    } else if (macd.histogram < 0) {
      shortScore += 10;
      longScore -= 8;
      shortReasons.push('MACD: Negative bearish momentum acceleration');
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
  // SCALPING STRIKE ZONE GEOMETRY (Strict 1.5% Balance Risk & 1:1.3 R:R Ratio)
  // ==========================================
  const targetRR = options.targetRiskRewardRatio !== undefined ? Number(options.targetRiskRewardRatio) : 1.30;
  const riskPct = options.riskPerTradePct !== undefined ? Number(options.riskPerTradePct) : 1.5;
  const balance = Number(options.balance || options.accountBalance || 51.68);
  const dollarRisk = Number((balance * (riskPct / 100)).toFixed(2)); // exactly 1.5% of balance (e.g. $0.78 on $51.68)
  const decimals = asset.decimals !== undefined ? asset.decimals : 4;

  let stopDistance;
  if (asset.category === 'Crypto') {
    // 0.01 lot of BTC has contract size 1 -> 0.01 * priceDistance = dollarRisk -> priceDistance = dollarRisk / 0.01
    stopDistance = Number((dollarRisk / 0.01).toFixed(2));
  } else if (asset.category === 'Forex') {
    if (asset.symbol.includes('JPY')) {
      // 0.01 lot (1000 units), 1 pip = 0.01 JPY -> priceDistance = (dollarRisk / 1000) * currentPrice
      stopDistance = Number(((dollarRisk / 1000) * currentPrice).toFixed(3));
    } else {
      // 0.01 lot (1000 units), 1 pip = 0.0001 -> priceDistance = dollarRisk / 1000
      stopDistance = Number((dollarRisk / 1000).toFixed(5));
    }
  } else if (asset.symbol.includes('GC') || asset.symbol.includes('XAU')) {
    // Gold: 0.01 lot = 1 oz. $1 move = $1.00
    stopDistance = Number((dollarRisk / 1.0).toFixed(2));
  } else {
    // Fallback: 0.20% default or dollar risk
    stopDistance = Number((currentPrice * 0.0020).toFixed(decimals));
  }

  // Ensure minimum tick distance so broker doesn't reject as zero distance
  const minPipDist = currentPrice * 0.0004;
  if (stopDistance < minPipDist) {
    stopDistance = Number(minPipDist.toFixed(decimals));
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
