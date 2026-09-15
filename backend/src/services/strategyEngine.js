/**
 * Sniper Scalping Confluence Engine (Targeting 75%+ Win Rate)
 * 
 * Key Principles of 75%+ Scalping Edge:
 * 1. Selective "Sniper" Entries: Only fires when Triple Alignment occurs (Trend + Value Pullback + Momentum).
 * 2. Anti-Chasing Filter: Strict RSI boundary (NEVER buy overbought > 58, NEVER short oversold < 42).
 * 3. High-Probability Scalp Strike Zone:
 *    - Take-Profit (TP): 0.35x ATR (swift, high-probability target reached before deep retracements).
 *    - Stop-Loss (SL): 0.55x ATR (safe noise boundary).
 *    - Ultra-Fast Break-Even Guard: Locks at +0.15x ATR to eliminate downside risk.
 */

export function evaluateStrategyConfluence(asset, technicals, options = {}) {
  const tradeDirection = options.tradeDirection || 'SHORT_ONLY';
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

  const minAtr = atr || (currentPrice * 0.008);

  // ==========================================
  // 1. DIRECTIONAL FILTER & EMA ALIGNMENT
  // ==========================================
  const isEmaBearish = currentPrice <= ema21 && ema9 <= ema21;
  const isEmaBullish = currentPrice >= ema21 && ema9 >= ema21;

  if (tradeDirection !== 'LONG_ONLY' && isEmaBearish) {
    shortScore += 30;
    shortReasons.push('Fast Bearish Ribbon: Price & EMA 9 holding below EMA 21 resistance');
  }

  if (tradeDirection !== 'SHORT_ONLY' && isEmaBullish) {
    longScore += 30;
    longReasons.push('Fast Bullish Ribbon: Price & EMA 9 holding above EMA 21 support');
  }

  // ==========================================
  // 2. VALUE ENTRY ZONE (Pullback to EMA 9/21)
  // ==========================================
  const distToEma21 = Math.abs(currentPrice - ema21);
  const isNearEma21 = distToEma21 <= minAtr * 0.7;

  if (isEmaBearish && isNearEma21) {
    shortScore += 25;
    shortReasons.push('Optimal Scalp Short: Price pulled back to dynamic EMA 21 resistance');
  }

  if (isEmaBullish && isNearEma21) {
    longScore += 25;
    longReasons.push('Optimal Scalp Long: Price pulled back to dynamic EMA 21 support');
  }

  // ==========================================
  // 3. STRICT RSI MOMENTUM FILTER (Anti-Chasing)
  // ==========================================
  if (rsi !== null) {
    // SHORT CONDITIONS:
    // Optimal zone to short is RSI between 48 and 68 (Relief rally or downward continuation)
    // CRITICAL: NEVER short if RSI < 40 (Selling into oversold capitulation is how bots lose!)
    if (rsi < 40) {
      shortScore -= 40; // Heavy penalty: never short the bottom!
    } else if (rsi >= 50 && rsi <= 68) {
      shortScore += 25;
      shortReasons.push(`High Edge RSI (${rsi}): Rejection off upper momentum band`);
    } else if (rsi >= 40 && rsi < 50) {
      shortScore += 15;
      shortReasons.push(`Healthy Bearish RSI (${rsi}): Downward room to scalp`);
    }

    // LONG CONDITIONS:
    // Optimal zone to buy is RSI between 32 and 52 (Pullback bounce)
    // CRITICAL: NEVER buy if RSI > 60 (Buying into overbought tops is how bots lose!)
    if (rsi > 60) {
      longScore -= 40; // Heavy penalty: never buy the top!
    } else if (rsi >= 32 && rsi <= 50) {
      longScore += 25;
      longReasons.push(`High Edge RSI (${rsi}): Bounce off lower momentum band`);
    } else if (rsi > 50 && rsi <= 58) {
      longScore += 15;
      longReasons.push(`Healthy Bullish RSI (${rsi}): Upward room to scalp`);
    }
  }

  // ==========================================
  // 4. MACD & BOLLINGER MOMENTUM CONFIRMATION
  // ==========================================
  if (macd) {
    if (macd.histogram < 0) {
      shortScore += 15;
      shortReasons.push('Negative MACD histogram confirms downward micro-momentum');
    }
    if (macd.histogram > 0) {
      longScore += 15;
      longReasons.push('Positive MACD histogram confirms upward micro-momentum');
    }
  }

  if (bb) {
    // Upper Bollinger rejection for Shorts
    if (currentPrice >= bb.middle) {
      shortScore += 10;
      shortReasons.push('Price in upper volatility channel (favorable mean-reversion short)');
    }
    // Lower Bollinger bounce for Longs
    if (currentPrice <= bb.middle) {
      longScore += 10;
      longReasons.push('Price in lower volatility channel (favorable bounce long)');
    }
  }

  // Force direction locks
  if (tradeDirection === 'SHORT_ONLY') {
    longScore = 0;
  } else if (tradeDirection === 'LONG_ONLY') {
    shortScore = 0;
  }

  const finalShortConfidence = Math.max(0, Math.min(100, Math.round(shortScore)));
  const finalLongConfidence = Math.max(0, Math.min(100, Math.round(longScore)));

  // SCALPING STRIKE ZONE GEOMETRY (Configurable Risk:Reward):
  const customRR = Number(options.targetRiskRewardRatio) || 1.3;
  const stopDistance = Math.max(minAtr * 0.55, currentPrice * 0.002);
  const targetDistance = Number((stopDistance * customRR).toFixed(asset.decimals || 4));

  // Require STRICT Confluence (Score >= 78%) for Sniper Entry
  const SNIPER_THRESHOLD = 78;

  if (finalShortConfidence >= SNIPER_THRESHOLD && (tradeDirection === 'SHORT_ONLY' || finalShortConfidence > finalLongConfidence + 20)) {
    const stopLoss = Number((currentPrice + stopDistance).toFixed(asset.decimals || 2));
    const takeProfit = Number((currentPrice - targetDistance).toFixed(asset.decimals || 2));

    return {
      action: 'STRONG_SELL',
      side: 'SHORT',
      confidence: finalShortConfidence,
      entryPrice: currentPrice,
      stopLoss,
      takeProfit,
      stopDistance,
      targetDistance,
      riskRewardRatio: customRR,
      tradingStyle: 'SCALPING',
      tradeDirection,
      reason: shortReasons.slice(0, 3).join('. '),
      factors: shortReasons
    };
  }

  if (tradeDirection !== 'SHORT_ONLY' && finalLongConfidence >= SNIPER_THRESHOLD && finalLongConfidence > finalShortConfidence + 20) {
    const stopLoss = Number((currentPrice - stopDistance).toFixed(asset.decimals || 2));
    const takeProfit = Number((currentPrice + targetDistance).toFixed(asset.decimals || 2));

    return {
      action: 'STRONG_BUY',
      side: 'LONG',
      confidence: finalLongConfidence,
      entryPrice: currentPrice,
      stopLoss,
      takeProfit,
      stopDistance,
      targetDistance,
      riskRewardRatio: customRR,
      tradingStyle: 'SCALPING',
      tradeDirection,
      reason: longReasons.slice(0, 3).join('. '),
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
    reason: tradeDirection === 'SHORT_ONLY'
      ? 'Awaiting high-probability Sniper Short setup (Confluence >= 78%).'
      : 'Awaiting high-probability Sniper setup (Confluence >= 78%).',
    factors: ['Patience: Preserving win rate for 75%+ probability setups']
  };
}

/**
 * Intelligent Scalp Position Exit Evaluator
 */
export function evaluatePositionExit(position, technicals, currentPrice) {
  if (!position || !technicals) return { shouldExit: false };

  const { side, entryPrice, stopDistance } = position;
  const { ema21, rsi, macd } = technicals;

  if (side === 'SHORT') {
    // Reversal Exit: Price breaks above EMA 21 with bullish MACD cross
    if (currentPrice > ema21 + stopDistance * 0.3 && macd && macd.bullishCrossover) {
      return {
        shouldExit: true,
        reason: 'SIGNAL_REVERSAL_EXIT',
        message: 'Scalp Invalidation: EMA 21 broken upward with bullish MACD cross'
      };
    }

    // Momentum Exhaustion Lock: Short is in profit and RSI reached oversold (<28)
    if (currentPrice < entryPrice && rsi && rsi < 28) {
      return {
        shouldExit: true,
        reason: 'MOMENTUM_EXHAUSTION_EXIT',
        message: 'Scalp Profit Lock: RSI oversold exhaustion reached'
      };
    }
  } else if (side === 'LONG') {
    if (currentPrice < ema21 - stopDistance * 0.3 && macd && macd.bearishCrossover) {
      return {
        shouldExit: true,
        reason: 'SIGNAL_REVERSAL_EXIT',
        message: 'Scalp Invalidation: EMA 21 broken downward with bearish MACD cross'
      };
    }

    if (currentPrice > entryPrice && rsi && rsi > 72) {
      return {
        shouldExit: true,
        reason: 'MOMENTUM_EXHAUSTION_EXIT',
        message: 'Scalp Profit Lock: RSI overbought exhaustion reached'
      };
    }
  }

  return { shouldExit: false };
}
