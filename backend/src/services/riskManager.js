/**
 * Risk Management Core
 * Controls position sizing, exposure caps, drawdowns, trading styles,
 * and Margin & Leverage (1x to 50x) with Liquidation calculation.
 */

export class RiskManager {
  constructor(options = {}) {
    this.riskPerTradePct = options.riskPerTradePct || 2.0; // Risk 2.0% of total equity per trade
    this.maxConcurrentTrades = options.maxConcurrentTrades || 2; // Default 2 sniper positions max
    this.maxPositionAllocationPct = options.maxPositionAllocationPct || 25; // Max 25% notional per asset for spot
    this.maxDailyDrawdownPct = options.maxDailyDrawdownPct || 5.0; // Circuit breaker at 5% daily loss
    this.minConfidenceThreshold = options.minConfidenceThreshold || 82; // 82% for sniper scalps
    this.tradeDirection = options.tradeDirection || 'BOTH'; // 'BOTH' | 'SHORT_ONLY' | 'LONG_ONLY'
    this.tradingStyle = options.tradingStyle || 'SCALPING'; // 'SCALPING' | 'SWING'
    this.targetRiskRewardRatio = options.targetRiskRewardRatio || 1.3; // 1:1.3 R:R for 75%-85% scalp hit rate
    this.defaultLeverage = options.defaultLeverage || 500; // 500x leverage with real buying power
  }

  updateSettings(newSettings) {
    if (newSettings.riskPerTradePct !== undefined) {
      this.riskPerTradePct = Math.max(0.25, Math.min(5.0, Number(newSettings.riskPerTradePct)));
    }
    if (newSettings.maxConcurrentTrades !== undefined) {
      this.maxConcurrentTrades = Math.max(1, Math.min(10, parseInt(newSettings.maxConcurrentTrades, 10)));
    }
    if (newSettings.minConfidenceThreshold !== undefined) {
      this.minConfidenceThreshold = Math.max(50, Math.min(95, parseInt(newSettings.minConfidenceThreshold, 10)));
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
      defaultLeverage: this.defaultLeverage
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

    // Check 3: Do not open duplicate positions on the same asset
    const alreadyOpen = activePositions.some(p => p.symbol === asset.symbol);
    if (alreadyOpen) {
      return {
        allowed: false,
        reason: `An active position for ${asset.symbol} is already open`
      };
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

    // Risk Dollar Amount: e.g. 2.0% of equity
    const dollarRisk = equity * (this.riskPerTradePct / 100);

    // Position Size Units = DollarRisk / (Price - StopLoss)
    let rawUnits = dollarRisk / priceDistance;

    // Dollar Notional Value of Position
    let notional = rawUnits * signal.entryPrice;

    // Leveraged Position Sizing:
    // When leverage > 1x, allow notional exposure to scale with leverage so 500x has real buying power.
    // Cap allocated margin to at most 10% of equity (e.g. $50 on $500) and at most 60% of free margin.
    const maxMarginAllowed = leverage > 1
      ? Math.min(equity * 0.10, freeMargin * 0.6)
      : equity * (this.maxPositionAllocationPct / 100);

    const maxNotional = maxMarginAllowed * leverage;
    if (notional > maxNotional) {
      rawUnits = maxNotional / signal.entryPrice;
      notional = maxNotional;
    }

    // Round units according to asset decimals (supports micro-lots for $5 - $10 accounts)
    const unitDecimals = asset.category === 'Crypto' ? 4 : (rawUnits < 1 ? 4 : 2);
    const units = Number(rawUnits.toFixed(unitDecimals));

    if (units <= 0 || notional < 0.5) {
      return {
        allowed: false,
        reason: 'Calculated position size is too small'
      };
    }

    // Allocate margin with safety buffer so liquidation threshold is strictly beyond stop loss
    const minMarginForRisk = Number((dollarRisk * 1.5).toFixed(2));
    const baseMargin = Number((notional / leverage).toFixed(2));
    const margin = Math.max(baseMargin, minMarginForRisk);

    if (margin > freeMargin) {
      return {
        allowed: false,
        reason: `Insufficient free margin ($${freeMargin.toFixed(2)} available, $${margin} required for ${leverage}x leverage)`
      };
    }

    // Liquidation threshold is safely buffered beyond stop-loss distance
    const liqBufferDist = Math.max(priceDistance * 1.4, signal.entryPrice * (1 / leverage) * 0.9);
    let liquidationPrice = signal.side === 'LONG'
      ? signal.entryPrice - liqBufferDist
      : signal.entryPrice + liqBufferDist;
    liquidationPrice = Math.max(0.0001, Number(liquidationPrice.toFixed(asset.decimals || 4)));

    return {
      allowed: true,
      units,
      notional: Number(notional.toFixed(2)),
      dollarRisk: Number(dollarRisk.toFixed(2)),
      riskPerTradePct: this.riskPerTradePct,
      leverage,
      margin,
      freeMargin: Number(freeMargin.toFixed(2)),
      liquidationPrice
    };
  }
}
