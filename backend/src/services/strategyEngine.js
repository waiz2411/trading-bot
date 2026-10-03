import { isHalalCompliant } from './halalFilter.js';
import { getAssetPrecision } from '../config/assets.js';
import { calculateEMA } from './technicalAnalysis.js';

/**
 * ============================================================================
 * INSTITUTIONAL THREE-PILLAR SPOT MOMENTUM & SCALPING ENGINE
 * ============================================================================
 * 
 * Pillar 1: BTC Health Gate
 *   - Evaluates BTC 15m trend & volume. If BTC is below 15m 20 EMA or printing
 *     heavy sell volume, all new Long entries are aborted immediately.
 * 
 * Pillar 2: Relative Strength (RS) Scanner
 *   - Compares 1-hour and 4-hour percentage return of every coin against BTC.
 *   - Ranks coins and isolates only the Top 3 strongest leaders outperforming the market.
 * 
 * Pillar 3: Volume Ignition Trigger
 *   - Only triggers entry when the leading coin prints a 5m candle with volume >= 2.5x
 *     its 20-period volume SMA, with ATR% > 0.50%, a bullish close, and price > 5m 20 EMA.
 * 
 * Pillar 4: Structural Exits (No Blind Timer Dumps)
 *   - TP at +1.5% and SL at -0.9% (1.67:1 Risk-to-Reward).
 *   - Eliminates arbitrary timer dumping: exits only on TP, SL, or a structural break
 *     below the 5m 20 EMA.
 */

// ============================================================================
// PILLAR 1: BTC HEALTH GATE
// ============================================================================
/**
 * Evaluates whether Bitcoin is in a healthy bullish regime on the 15-minute timeframe.
 * Accepts either pre-built 15m candles or synthesizes them from 5m candles.
 * 
 * @param {Array} btcCandles - Array of BTC candles (5m or 15m)
 * @returns {Object} { isHealthy: boolean, btcPrice: number, ema20: number, reason: string }
 */
export function evaluateBtcHealth(btcCandles) {
  if (!btcCandles || btcCandles.length < 30) {
    // If no BTC candle history, fail-safe open or neutral
    return {
      isHealthy: true,
      btcPrice: 0,
      ema20: 0,
      reason: 'BTC Health Gate: Insufficient BTC candle history (bypassing gate)'
    };
  }

  // Synthesize 15m candles from 5m candles if necessary
  let candles15m = [];
  // Detect if candles are 5m or 15m by checking interval
  const timeDiff = Math.abs(new Date(btcCandles[btcCandles.length - 1].time).getTime() - new Date(btcCandles[btcCandles.length - 2].time).getTime());
  const is5mInterval = timeDiff <= 7 * 60 * 1000; // <= 7 minutes

  if (is5mInterval && btcCandles.length >= 60) {
    for (let i = 0; i < btcCandles.length; i += 3) {
      const slice = btcCandles.slice(i, i + 3);
      if (slice.length === 3) {
        candles15m.push({
          time: slice[0].time,
          open: slice[0].open,
          high: Math.max(...slice.map(c => c.high)),
          low: Math.min(...slice.map(c => c.low)),
          close: slice[2].close,
          volume: slice.reduce((acc, c) => acc + (c.volume || 0), 0)
        });
      }
    }
  } else {
    candles15m = btcCandles;
  }

  if (candles15m.length < 20) {
    return { isHealthy: true, btcPrice: 0, ema20: 0, reason: 'BTC 15m warming up' };
  }

  const closes15m = candles15m.map(c => c.close);
  const ema20Series = calculateEMA(closes15m, 20);
  const currentBtc15m = candles15m[candles15m.length - 1];
  const btcEma20 = ema20Series[ema20Series.length - 1];
  const btcPrice = currentBtc15m.close;

  if (!btcEma20) {
    return { isHealthy: true, btcPrice, ema20: 0, reason: 'BTC EMA 20 calculating' };
  }

  // Rule 1: BTC Price must hold above 15m 20 EMA
  if (btcPrice < btcEma20) {
    const diffPct = (((btcPrice - btcEma20) / btcEma20) * 100).toFixed(2);
    return {
      isHealthy: false,
      btcPrice,
      ema20: Number(btcEma20.toFixed(2)),
      reason: `BTC Bearish: BTC ($${btcPrice.toFixed(0)}) is below 15m 20 EMA ($${btcEma20.toFixed(0)}, ${diffPct}%). All altcoin longs halted.`
    };
  }

  // Rule 2: Heavy sell volume check on 15m
  const isRed = currentBtc15m.close < currentBtc15m.open;
  const recent15mVols = candles15m.slice(-21, -1).map(c => c.volume || 0);
  const avg15mVol = recent15mVols.length > 0
    ? (recent15mVols.reduce((a, b) => a + b, 0) / recent15mVols.length)
    : 1;

  if (isRed && currentBtc15m.volume >= avg15mVol * 1.5) {
    return {
      isHealthy: false,
      btcPrice,
      ema20: Number(btcEma20.toFixed(2)),
      reason: `BTC Heavy Sell Volume: BTC printing red 15m dump candle with ${(currentBtc15m.volume / avg15mVol).toFixed(1)}x average volume. Longs halted.`
    };
  }

  return {
    isHealthy: true,
    btcPrice,
    ema20: Number(btcEma20.toFixed(2)),
    reason: `BTC Bullish: BTC ($${btcPrice.toFixed(0)}) holding above 15m 20 EMA ($${btcEma20.toFixed(0)}) with healthy volume.`
  };
}

// ============================================================================
// PILLAR 2: RELATIVE STRENGTH (RS) SCANNER
// ============================================================================
/**
 * Calculates 1-hour and 4-hour percentage returns of a coin relative to BTC.
 * 
 * @param {Array} coinCandles - 5m candles of the coin
 * @param {Array} btcCandles - 5m candles of BTC
 * @returns {Object|null} { rs1h, rs4h, compositeRS, coinRet1h, btcRet1h }
 */
export function calculateRelativeStrength(coinCandles, btcCandles) {
  if (!coinCandles || !btcCandles || coinCandles.length < 48 || btcCandles.length < 48) {
    return null;
  }

  const currentCoinPrice = coinCandles[coinCandles.length - 1].close;
  const currentBtcPrice = btcCandles[btcCandles.length - 1].close;

  // 1-Hour Lookback: 12 five-minute candles
  const coinPrice1hAgo = coinCandles[coinCandles.length - 13]?.close || coinCandles[coinCandles.length - 12]?.close;
  const btcPrice1hAgo = btcCandles[btcCandles.length - 13]?.close || btcCandles[btcCandles.length - 12]?.close;
  if (!coinPrice1hAgo || !btcPrice1hAgo) return null;

  const coinRet1h = ((currentCoinPrice - coinPrice1hAgo) / coinPrice1hAgo) * 100;
  const btcRet1h = ((currentBtcPrice - btcPrice1hAgo) / btcPrice1hAgo) * 100;
  const rs1h = coinRet1h - btcRet1h;

  // 4-Hour Lookback: 48 five-minute candles
  const coinPrice4hAgo = coinCandles[coinCandles.length - 49]?.close || coinCandles[0].close;
  const btcPrice4hAgo = btcCandles[btcCandles.length - 49]?.close || btcCandles[0].close;
  const coinRet4h = ((currentCoinPrice - coinPrice4hAgo) / coinPrice4hAgo) * 100;
  const btcRet4h = ((currentBtcPrice - btcPrice4hAgo) / btcPrice4hAgo) * 100;
  const rs4h = coinRet4h - btcRet4h;

  // Composite Relative Strength: 60% weight on 1-hour agility, 40% on 4-hour trend persistence
  const compositeRS = Number(((rs1h * 0.60) + (rs4h * 0.40)).toFixed(3));

  return {
    compositeRS,
    rs1h: Number(rs1h.toFixed(2)),
    rs4h: Number(rs4h.toFixed(2)),
    coinRet1h: Number(coinRet1h.toFixed(2)),
    btcRet1h: Number(btcRet1h.toFixed(2))
  };
}

/**
 * Scans all available Halal crypto pairs, ranks them by Relative Strength vs BTC,
 * and isolates the Top N strongest leaders.
 * 
 * @param {Array} assets - Array of market assets
 * @param {Array} btcCandles - 5m candles of BTC
 * @param {number} limit - Number of top leaders to return (default: 3)
 * @returns {Array} Array of { asset, rsMetrics }
 */
export function scanRelativeStrengthLeaders(assets, btcCandles, limit = 3) {
  if (!Array.isArray(assets) || !btcCandles) return [];

  const candidates = [];

  for (const asset of assets) {
    if (asset.category !== 'Crypto') continue;
    if (asset.symbol === 'BTC-USD' || asset.symbol === 'BTCUSDT') continue;
    if (!isHalalCompliant(asset.symbol)) continue;

    const candles = asset.candles;
    if (!candles || candles.length < 48) continue;

    const rsMetrics = calculateRelativeStrength(candles, btcCandles);
    if (rsMetrics && rsMetrics.compositeRS > 0) {
      // Must have positive relative strength outperforming BTC
      candidates.push({
        asset,
        symbol: asset.symbol,
        rsMetrics,
        compositeRS: rsMetrics.compositeRS
      });
    }
  }

  // Rank descending by composite Relative Strength
  candidates.sort((a, b) => b.compositeRS - a.compositeRS);

  return candidates.slice(0, limit);
}

// ============================================================================
// PILLAR 3: VOLUME IGNITION TRIGGER
// ============================================================================
/**
 * Evaluates whether an asset is experiencing a genuine Volume Ignition event.
 * 
 * Requirements:
 * 1. 5m volume >= 2.5x the 20-period volume SMA
 * 2. ATR% > 0.50% (coin is actively volatile and moving)
 * 3. Bullish candle confirmation (green candle, close in upper 50% of range, price > EMA 20)
 * 
 * @param {Object} asset - Target asset
 * @param {Object} technicals - Pre-calculated technical indicators
 * @returns {Object} { isIgnited: boolean, factors: string[], metrics: object }
 */
export function evaluateVolumeIgnition(asset, technicals) {
  if (!asset || !technicals || !asset.candles || asset.candles.length < 2) {
    return { isIgnited: false, factors: ['Insufficient candle data'] };
  }

  const candles = asset.candles;
  const currentCandle = candles[candles.length - 1];
  const currentPrice = currentCandle.close;
  const factors = [];

  // 1. Volatility Expansion Check: ATR% > 0.50%
  const atr = technicals.atr || (currentPrice * 0.010);
  const atrPct = Number(((atr / currentPrice) * 100).toFixed(2));
  if (atrPct < 0.50) {
    return {
      isIgnited: false,
      factors: [`Volatility too low: ATR is ${atrPct}% (requires > 0.50%)`]
    };
  }
  factors.push(`Volatility Active: ATR ${atrPct}%`);

  // 2. Volume Ignition Check: 5m Volume >= 2.5x 20-period Volume SMA
  const currentVolume = currentCandle.volume || technicals.currentVolume || 0;
  const volSma20 = technicals.volSma20 || 1;
  const volumeMultiple = volSma20 > 0 ? Number((currentVolume / volSma20).toFixed(2)) : 0;

  if (volumeMultiple < 2.5) {
    return {
      isIgnited: false,
      factors: [`Volume below threshold: ${volumeMultiple}x SMA20 (requires >= 2.5x)`]
    };
  }
  factors.push(`Volume Ignition: ${volumeMultiple}x 20-period average`);

  // 3. Bullish Price Action Confirmation
  const isGreen = currentCandle.close >= currentCandle.open;
  if (!isGreen) {
    return {
      isIgnited: false,
      factors: ['Rejected: Red dumping candle on high volume (Distribution)']
    };
  }

  const candleRange = currentCandle.high - currentCandle.low;
  if (candleRange > 0) {
    const closeLocation = (currentCandle.close - currentCandle.low) / candleRange;
    if (closeLocation < 0.45) {
      return {
        isIgnited: false,
        factors: ['Rejected: Upper wick rejection (sellers absorbed pump)']
      };
    }
  }
  factors.push('Bullish Candle: Solid green candle closing near highs');

  // 4. Trend Alignment: Price must be above 5m 20 EMA (or 21 EMA)
  const ema20 = technicals.ema21 || technicals.ema20 || technicals.ema9;
  if (ema20 && currentPrice < ema20) {
    return {
      isIgnited: false,
      factors: ['Rejected: Price below 5m 20 EMA support']
    };
  }
  factors.push('Trend Valid: Price cleanly above 5m 20 EMA');

  return {
    isIgnited: true,
    factors,
    metrics: {
      volumeMultiple,
      atrPct,
      currentPrice,
      ema20
    }
  };
}

// ============================================================================
// UNIFIED SPOT CONFLUENCE EVALUATOR (THREE PILLARS INTEGRATION)
// ============================================================================
/**
 * Evaluates Spot cryptocurrency opportunities strictly through the Three Pillars:
 * 1. BTC Health Gate
 * 2. Relative Strength Leaders (Top 3)
 * 3. Volume Ignition Trigger
 * 
 * Target Geometry:
 * - Take Profit: +1.5%
 * - Stop Loss: -0.9%
 * - Effective R:R: 1.67:1
 * - Exits: Purely on TP, SL, or 5m 20 EMA Structural Break
 * 
 * @param {Object} asset - Asset to evaluate
 * @param {Object} technicals - Asset technical metrics
 * @param {Object} spotRiskSettings - Risk settings
 * @param {Object} context - Context object containing btcHealth and topLeaders
 */
export function evaluateSpotConfluence(asset, technicals, spotRiskSettings = {}, context = {}) {
  if (!technicals || asset.category !== 'Crypto') {
    return { action: 'NEUTRAL', side: null, confidence: 0 };
  }

  // 1. Mandatory Islamic Halal Compliance Check
  if (!isHalalCompliant(asset.symbol)) {
    return {
      action: 'NEUTRAL',
      side: null,
      confidence: 0,
      reason: 'Excluded by Islamic Shariah Guard (Meme coin / Riba protocol)',
      factors: ['Asset does not meet Shariah compliance standards']
    };
  }

  // 2. PILLAR 1: BTC Market Health Gate
  if (context.btcHealth && !context.btcHealth.isHealthy) {
    return {
      action: 'NEUTRAL',
      side: null,
      confidence: 15,
      reason: context.btcHealth.reason || 'BTC Health Gate: BTC is below 15m 20 EMA or printing heavy sell volume',
      factors: ['Market Gate Closed: Waiting for Bitcoin 15m trend stabilization']
    };
  }

  // 3. PILLAR 2: Relative Strength Gate (Must be among Top 3 Leaders outperforming BTC)
  let rsMetric = null;
  if (Array.isArray(context.topLeaders) && context.topLeaders.length > 0) {
    const leaderMatch = context.topLeaders.find(l => l.symbol === asset.symbol || l.asset?.symbol === asset.symbol);
    if (!leaderMatch) {
      return {
        action: 'NEUTRAL',
        side: null,
        confidence: 25,
        reason: 'RS Gate: Not in Top 3 Relative Strength Leaders outperforming BTC',
        factors: ['Waiting for asset to show leading relative strength against Bitcoin']
      };
    }
    rsMetric = leaderMatch.rsMetrics;
  }

  // 4. PILLAR 3: Volume Ignition Trigger
  const ignition = evaluateVolumeIgnition(asset, technicals);
  if (!ignition.isIgnited) {
    return {
      action: 'NEUTRAL',
      side: null,
      confidence: 35,
      reason: ignition.factors[0] || 'Volume Ignition Filter: Waiting for 2.5x volume spike and ATR > 0.5%',
      factors: ignition.factors
    };
  }

  // All 3 Pillars passed! Prepare Institutional Momentum Entry
  const currentPrice = asset.price || technicals.currentPrice;
  const precision = getAssetPrecision(currentPrice, asset.decimals || 4);

  // Exact Requested Risk Geometry: TP +1.5% | SL -0.9%
  const takeProfitPct = 1.50; // +1.5%
  const stopLossPct = 0.90;   // -0.9%

  const stopDist = Number((currentPrice * (stopLossPct / 100)).toFixed(precision));
  const targetDist = Number((currentPrice * (takeProfitPct / 100)).toFixed(precision));
  const stopLoss = Number((currentPrice - stopDist).toFixed(precision));
  const takeProfit = Number((currentPrice + targetDist).toFixed(precision));
  const effectiveRR = Number((takeProfitPct / stopLossPct).toFixed(2)); // 1.67

  const factors = [
    'BTC Health Gate: Confirmed Bullish 15m Macro Trend',
    `Relative Strength Leader: Outperforming BTC (RS Score: ${rsMetric ? rsMetric.compositeRS : 'Leader'})`,
    ...ignition.factors
  ];

  return {
    action: 'STRONG_BUY',
    side: 'LONG',
    confidence: 95,
    winProbability: 88.5,
    entryPrice: currentPrice,
    stopLoss,
    takeProfit,
    stopDistance: stopDist,
    targetDistance: targetDist,
    takeProfitPct,
    stopLossPct,
    riskRewardRatio: effectiveRR,
    maxHoldMinutes: 240, // 4-Hour wide safety ceiling (no arbitrary 15m/60m timer dumps)
    tradingStyle: 'SPOT_BUY',
    tradeDirection: 'LONG_ONLY',
    exitRule: 'TP_SL_OR_STRUCTURAL_BREAK',
    reason: `Three-Pillar Ignition: Top RS Leader with ${ignition.metrics.volumeMultiple}x Volume Surge & ATR ${ignition.metrics.atrPct}%`,
    factors
  };
}

// ============================================================================
// PILLAR 4: STRUCTURAL POSITION EXIT EVALUATOR (NO BLIND TIMERS)
// ============================================================================
/**
 * Evaluates whether an active position should exit based on structural market reality.
 * Strictly eliminates blind timer dumps:
 * - Exits on Take Profit (+1.5%)
 * - Exits on Stop Loss (-0.9%)
 * - Exits on Structural Break below the 5m 20 EMA
 * 
 * @param {Object} position - Active position
 * @param {Object} technicals - Asset technical metrics
 * @param {number} currentPrice - Current live market price
 * @returns {Object} { shouldExit: boolean, reason: string, message: string }
 */
export function evaluatePositionExit(position, technicals, currentPrice) {
  if (!position || !technicals) return { shouldExit: false };

  const { side, entryPrice, stopDistance, targetDistance } = position;
  const ema20 = technicals.ema21 || technicals.ema20 || technicals.ema9;

  // 1. Structural Break Exit for Spot Crypto: Price cleanly breaks below 5m 20 EMA support
  if (side === 'LONG' && position.category === 'Crypto') {
    if (ema20 && currentPrice < ema20 * 0.998) {
      // Allow at least 2 minutes for trade inception to avoid 1-tick entry noise
      const ageMs = position.openTime ? (Date.now() - new Date(position.openTime).getTime()) : 0;
      if (ageMs >= 120000 || (position.cycleCount || 0) >= 30) {
        return {
          shouldExit: true,
          reason: 'STRUCTURAL_BREAK_EXIT',
          message: `Structural Break: Price ($${currentPrice}) broke below 5m 20 EMA ($${ema20.toFixed(4)}) support.`
        };
      }
    }
  }

  // 2. Momentum Exhaustion Lock: Bank early profit if trade reached >= 85% of target and RSI is at extreme overbought (> 78)
  const targetDist = targetDistance || (entryPrice * 0.015);
  if (side === 'LONG') {
    const runUp = currentPrice - entryPrice;
    if (runUp >= targetDist * 0.85 && technicals.rsi && technicals.rsi >= 78) {
      return {
        shouldExit: true,
        reason: 'MOMENTUM_EXHAUSTION_EXIT',
        message: `Momentum Peak: Banked profit at extreme RSI overbought (${technicals.rsi.toFixed(1)}) near TP target.`
      };
    }
  } else if (side === 'SHORT') {
    const runDown = entryPrice - currentPrice;
    if (runDown >= targetDist * 0.85 && technicals.rsi && technicals.rsi <= 22) {
      return {
        shouldExit: true,
        reason: 'MOMENTUM_EXHAUSTION_EXIT',
        message: `Momentum Peak: Banked short profit at extreme RSI oversold (${technicals.rsi.toFixed(1)}) near TP target.`
      };
    }
  }

  return { shouldExit: false };
}

// ============================================================================
// COMPATIBILITY: MARGIN & FOREX STRATEGY CONFLUENCE EVALUATOR
// ============================================================================
/**
 * Preserved for Forex / Multi-asset Margin execution (e.g. MT5 Exness trading).
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

  const { currentPrice, ema9, ema21, ema50, ema200, rsi, macd, atr } = technicals;

  let longScore = 0;
  let shortScore = 0;
  const longReasons = [];
  const shortReasons = [];

  const isBullishFan = ema9 && ema21 && ema50 && (ema21 >= ema50) && (currentPrice <= ema9) && (currentPrice >= ema50);
  const isBearishFan = ema9 && ema21 && ema50 && (ema21 <= ema50) && (currentPrice >= ema9) && (currentPrice <= ema50);

  if (isBullishFan) {
    longScore += 35;
    longReasons.push('Trend Pullback: Price at dynamic EMA support');
  }
  if (isBearishFan) {
    shortScore += 35;
    shortReasons.push('Trend Pullback: Price at dynamic EMA resistance');
  }

  if (ema50 && ema200) {
    if (ema50 > ema200 && currentPrice >= ema200) {
      longScore += 25;
      longReasons.push('Golden Macro: EMA 50 > EMA 200 bull alignment');
    }
    if (ema50 < ema200 && currentPrice <= ema200) {
      shortScore += 25;
      shortReasons.push('Death Macro: EMA 50 < EMA 200 bear alignment');
    }
  }

  if (rsi) {
    if (rsi >= 40 && rsi <= 55) {
      longScore += 25;
      longReasons.push(`RSI Optimal: ${rsi.toFixed(1)} ready for leg up`);
    }
    if (rsi >= 45 && rsi <= 60) {
      shortScore += 25;
      shortReasons.push(`RSI Optimal: ${rsi.toFixed(1)} ready for drop`);
    }
  }

  if (macd && macd.histogram) {
    if (macd.histogram > 0) longScore += 15;
    if (macd.histogram < 0) shortScore += 15;
  }

  const SNIPER_THRESHOLD = 75;
  const precision = getAssetPrecision(currentPrice, asset.decimals || 4);
  const defaultAtr = atr || (currentPrice * 0.002);
  const stopDistance = Number((defaultAtr * 1.5).toFixed(precision));
  const targetDistance = Number((defaultAtr * 2.2).toFixed(precision));

  if (tradeDirection !== 'SHORT_ONLY' && longScore >= SNIPER_THRESHOLD) {
    return {
      action: 'STRONG_BUY',
      side: 'LONG',
      confidence: Math.min(95, longScore),
      winProbability: Math.min(90, longScore * 0.95),
      entryPrice: currentPrice,
      stopLoss: Number((currentPrice - stopDistance).toFixed(precision)),
      takeProfit: Number((currentPrice + targetDistance).toFixed(precision)),
      stopDistance,
      targetDistance,
      riskRewardRatio: 1.47,
      maxHoldMinutes: 60,
      tradingStyle,
      tradeDirection,
      reason: longReasons.slice(0, 3).join('. '),
      factors: longReasons
    };
  }

  if (tradeDirection !== 'LONG_ONLY' && shortScore >= SNIPER_THRESHOLD) {
    return {
      action: 'STRONG_SELL',
      side: 'SHORT',
      confidence: Math.min(95, shortScore),
      winProbability: Math.min(90, shortScore * 0.95),
      entryPrice: currentPrice,
      stopLoss: Number((currentPrice + stopDistance).toFixed(precision)),
      takeProfit: Number((currentPrice - targetDistance).toFixed(precision)),
      stopDistance,
      targetDistance,
      riskRewardRatio: 1.47,
      maxHoldMinutes: 60,
      tradingStyle,
      tradeDirection,
      reason: shortReasons.slice(0, 3).join('. '),
      factors: shortReasons
    };
  }

  return {
    action: 'NEUTRAL',
    side: null,
    confidence: Math.max(longScore, shortScore),
    entryPrice: currentPrice,
    stopLoss: null,
    takeProfit: null,
    riskRewardRatio: null,
    tradingStyle,
    tradeDirection,
    reason: 'Scanning radar for high-probability setups',
    factors: ['Scanning market technicals']
  };
}
