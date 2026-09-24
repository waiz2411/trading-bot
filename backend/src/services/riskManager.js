/**
 * Risk Management Core
 * Controls position sizing, exposure caps, drawdowns, trading styles,
 * and Margin & Leverage (1x to 50x) with Liquidation calculation.
 */

export class RiskManager {
  constructor(options = {}) {
    this.riskPerTradePct = options.riskPerTradePct !== undefined ? Number(options.riskPerTradePct) : 1.5; // Strictly 1.5% capital risk per trade
    this.maxConcurrentTrades = options.maxConcurrentTrades || 6; // Active multi-scalp positions
    this.maxPositionAllocationPct = options.maxPositionAllocationPct || 25; // Max 25% notional per asset for spot
    this.maxDailyDrawdownPct = options.maxDailyDrawdownPct || 5.0; // Circuit breaker at 5% daily loss
    this.minConfidenceThreshold = options.minConfidenceThreshold !== undefined ? Number(options.minConfidenceThreshold) : 90; // Default 90% threshold for sniper scalps
    this.tradeDirection = options.tradeDirection || 'BOTH'; // 'BOTH' | 'SHORT_ONLY' | 'LONG_ONLY'
    this.tradingStyle = options.tradingStyle || 'SCALPING'; // 'SCALPING' | 'SWING'
    this.targetRiskRewardRatio = 1.3; // Strictly 1:1.3 Risk-to-Reward ratio
    this.defaultLeverage = 500; // Strictly 500x leverage
    this.maxTradesPerPair = options.maxTradesPerPair || 2; // Up to 2 concurrent trades per symbol
  }

  updateSettings(newSettings) {
    if (newSettings.riskPerTradePct !== undefined) {
      this.riskPerTradePct = Math.max(0.25, Math.min(5.0, Number(newSettings.riskPerTradePct)));
    }
    if (newSettings.maxConcurrentTrades !== undefined) {
      this.maxConcurrentTrades = Math.max(1, Math.min(10, parseInt(newSettings.maxConcurrentTrades, 10)));
    }
    if (newSettings.minConfidenceThreshold !== undefined) {
      this.minConfidenceThreshold = Math.max(40, Math.min(99, parseInt(newSettings.minConfidenceThreshold, 10)));
    }
    if (newSettings.tradeDirection !== undefined) {
      this.tradeDirection = newSettings.tradeDirection;
    }
    if (newSettings.tradingStyle !== undefined) {
      this.tradingStyle = newSettings.tradingStyle;
    }
    if (newSettings.targetRiskRewardRatio !== undefined) {
      this.targetRiskRewardRatio = Math.max(0.5, Math.min(5.0, Number(newSettings.targetRiskRewardRatio)));
    }
    if (newSettings.defaultLeverage !== undefined) {
      this.defaultLeverage = Math.max(1, Math.min(500, parseInt(newSettings.defaultLeverage, 10)));
    }
    if (newSettings.maxTradesPerPair !== undefined) {
      this.maxTradesPerPair = Math.max(1, Math.min(4, parseInt(newSettings.maxTradesPerPair, 10)));
    }
  }

  getSettings() {
    return {
      riskPerTradePct: this.riskPerTradePct,
      maxConcurrentTrades: this.maxConcurrentTrades,
      maxPositionAllocationPct: this.maxPositionAllocationPct,
      maxDailyDrawdownPct: this.maxDailyDrawdownPct,
      minConfidenceThreshold: this.minConfidenceThreshold,
      tradeDirection: this.tradeDirection,
      tradingStyle: this.tradingStyle,
      targetRiskRewardRatio: this.targetRiskRewardRatio,
      defaultLeverage: this.defaultLeverage,
      maxTradesPerPair: this.maxTradesPerPair
    };
  }

  /**
   * Evaluates if a trade can be opened and calculates dynamic position size, margin, and liquidation
   */
  evaluateTradeRisk(portfolio, signal, asset) {
    const { equity, activePositions } = portfolio;

    // Check 0: Trade Direction Filter
    if (this.tradeDirection === 'SHORT_ONLY' && signal.side !== 'SHORT') {
      return {
        allowed: false,
        reason: 'Long trades disabled: Agent is locked to SHORT ONLY mode'
      };
    }
    if (this.tradeDirection === 'LONG_ONLY' && signal.side !== 'LONG') {
      return {
        allowed: false,
        reason: 'Short trades disabled: Agent is locked to LONG ONLY mode'
      };
    }

    // Check 1: Minimum confidence threshold
    if (signal.confidence < this.minConfidenceThreshold) {
      return {
        allowed: false,
        reason: `Signal confidence (${signal.confidence}%) is below minimum threshold (${this.minConfidenceThreshold}%)`
      };
    }

    // Check 2: Max concurrent positions
    if (activePositions.length >= this.maxConcurrentTrades) {
      return {
        allowed: false,
        reason: `Max concurrent trades limit reached (${activePositions.length}/${this.maxConcurrentTrades})`
      };
    }

    // Check 3: Multi-Trade & Bi-Directional Hedging Limit per Asset
    const symbolPositions = activePositions.filter(p => p.symbol === asset.symbol);
    const maxPerPair = this.maxTradesPerPair || 2;

    if (symbolPositions.length >= maxPerPair) {
      return {
        allowed: false,
        reason: `Max positions for ${asset.symbol} reached (${symbolPositions.length}/${maxPerPair})`
      };
    }

    // If a position in the SAME side already exists, require minimum entry price spacing (>= 0.3%)
    // so the agent does not open duplicates on the exact same price tick
    const sameSidePositions = symbolPositions.filter(p => p.side === signal.side);
    if (sameSidePositions.length > 0) {
      const lastEntry = sameSidePositions[sameSidePositions.length - 1].entryPrice;
      const priceDiffPct = Math.abs(signal.entryPrice - lastEntry) / lastEntry;
      if (priceDiffPct < 0.003) {
        return {
          allowed: false,
          reason: `New ${signal.side} entry price ($${signal.entryPrice}) is too close to existing entry ($${lastEntry}, ${(priceDiffPct * 100).toFixed(2)}% < 0.3% min spacing)`
        };
      }
    }

    // Check 4: Stop loss must be valid
    if (!signal.stopLoss || !signal.entryPrice) {
      return {
        allowed: false,
        reason: 'Missing valid stop-loss or entry price'
      };
    }

    const priceDistance = Math.abs(signal.entryPrice - signal.stopLoss);
    if (priceDistance <= 0) {
      return {
        allowed: false,
        reason: 'Stop-loss cannot be equal to entry price'
      };
    }

    // ==========================================
    // LEVERAGE & MARGIN SYSTEM (1x to 500x)
    // ==========================================
    const leverage = this.defaultLeverage || 500;
    const usedMargin = activePositions.reduce((acc, p) => acc + (p.margin || (p.notional / (p.leverage || 1))), 0);
    const freeMargin = Math.max(0, equity - usedMargin);

    // Strict Hard Risk Cap: Potential loss at Stop Loss must NEVER exceed riskPerTradePct (e.g. exactly 1.5%)
    const maxAllowedLoss = Number((equity * (this.riskPerTradePct / 100)).toFixed(2));
    const dollarRisk = maxAllowedLoss;

    let notional = 0;
    let rawUnits = 0;

    if (leverage > 1) {
      // Sizing strictly by Risk Parity: units = maxAllowedLoss / priceDistance
      // This mathematically guarantees: units * priceDistance <= maxAllowedLoss (<= 1.5% loss)
      rawUnits = maxAllowedLoss / priceDistance;

      // Free Margin Safety Buffer: Cap notional so margin required never strains account
      const maxNotionalByFreeMargin = freeMargin * 0.40 * leverage;
      if (rawUnits * signal.entryPrice > maxNotionalByFreeMargin) {
        rawUnits = maxNotionalByFreeMargin / signal.entryPrice;
      }

      notional = rawUnits * signal.entryPrice;
    } else {
      // 1x Spot Cash Allocation
      const maxSpotNotional = Math.min(equity * (this.maxPositionAllocationPct / 100), freeMargin);
      rawUnits = dollarRisk / priceDistance;
      notional = rawUnits * signal.entryPrice;
      if (notional > maxSpotNotional) {
        rawUnits = maxSpotNotional / signal.entryPrice;
        notional = maxSpotNotional;
      }
    }

    // Floor units to precision to strictly guarantee loss never rounds above 1.5%
    const unitDecimals = asset.category === 'Crypto' ? 4 : (rawUnits < 1 ? 4 : 2);
    const roundFactor = Math.pow(10, unitDecimals);
    const units = Math.floor(rawUnits * roundFactor) / roundFactor;
    notional = Number((units * signal.entryPrice).toFixed(2));

    if (units <= 0 || notional < 0.5) {
      return {
        allowed: false,
        reason: 'Calculated position size is too small'
      };
    }

    // True Mathematical Margin: Margin is strictly Notional / Leverage
    const margin = Number((notional / leverage).toFixed(2));

    if (margin > freeMargin) {
      return {
        allowed: false,
        reason: `Insufficient free margin ($${freeMargin.toFixed(2)} available, $${margin} required for ${leverage}x leverage)`
      };
    }

    // Liquidation threshold is safely buffered by stop distance and free equity cushion
    const liqBufferDist = Math.max(priceDistance * 1.5, signal.entryPrice * (1 / leverage) * 1.2);
    let liquidationPrice = signal.side === 'LONG'
      ? signal.entryPrice - liqBufferDist
      : signal.entryPrice + liqBufferDist;
    liquidationPrice = Math.max(0.0001, Number(liquidationPrice.toFixed(asset.decimals || 4)));

    return {
      allowed: true,
      units,
      notional,
      dollarRisk: Number(dollarRisk.toFixed(2)),
      riskPerTradePct: this.riskPerTradePct,
      leverage,
      margin,
      freeMargin: Number(freeMargin.toFixed(2)),
      liquidationPrice
    };
  }
}
