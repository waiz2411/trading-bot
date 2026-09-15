/**
 * Risk Management Core
 * Controls position sizing, exposure caps, drawdowns, trading styles,
 * and Margin & Leverage (1x to 50x) with Liquidation calculation.
 */

export class RiskManager {
  constructor(options = {}) {
    this.riskPerTradePct = options.riskPerTradePct || 1.5; // Risk 1.5% of total equity per trade
    this.maxConcurrentTrades = options.maxConcurrentTrades || 4; // Max 4 simultaneous positions
    this.maxPositionAllocationPct = options.maxPositionAllocationPct || 25; // Max 25% notional per asset
    this.maxDailyDrawdownPct = options.maxDailyDrawdownPct || 5.0; // Circuit breaker at 5% daily loss
    this.minConfidenceThreshold = options.minConfidenceThreshold || 78; // 78% for sniper scalps
    this.tradeDirection = options.tradeDirection || 'SHORT_ONLY'; // 'SHORT_ONLY' | 'BOTH' | 'LONG_ONLY'
    this.tradingStyle = options.tradingStyle || 'SCALPING'; // 'SCALPING' | 'SWING'
    this.targetRiskRewardRatio = options.targetRiskRewardRatio || 1.3; // Default 1:1.3 R:R
    this.defaultLeverage = options.defaultLeverage || 10; // Default 10x leverage for scalping
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
      this.defaultLeverage = Math.max(1, Math.min(50, parseInt(newSettings.defaultLeverage, 10)));
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

    // Risk Dollar Amount: e.g. 1.5% of equity
    const dollarRisk = equity * (this.riskPerTradePct / 100);

    // Position Size Units = DollarRisk / (Price - StopLoss)
    let rawUnits = dollarRisk / priceDistance;

    // Dollar Notional Value of Position
    let notional = rawUnits * signal.entryPrice;

    // Cap notional value to max allocation (e.g. 25% of equity) to avoid over-exposure
    const maxNotional = equity * (this.maxPositionAllocationPct / 100);
    if (notional > maxNotional) {
      rawUnits = maxNotional / signal.entryPrice;
      notional = maxNotional;
    }

    // Round units according to asset decimals
    const units = Number(rawUnits.toFixed(asset.category === 'Crypto' ? 4 : 2));

    if (units <= 0 || notional < 5) {
      return {
        allowed: false,
        reason: 'Calculated position size is too small'
      };
    }

    // ==========================================
    // LEVERAGE & MARGIN SYSTEM (1x to 50x)
    // ==========================================
    const leverage = this.defaultLeverage || 10;
    const margin = Number((notional / leverage).toFixed(2));

    // Calculate currently used margin across open positions
    const usedMargin = activePositions.reduce((acc, p) => acc + (p.margin || (p.notional / (p.leverage || 1))), 0);
    const freeMargin = Math.max(0, equity - usedMargin);

    if (margin > freeMargin) {
      return {
        allowed: false,
        reason: `Insufficient free margin ($${freeMargin.toFixed(2)} available, $${margin} required for ${leverage}x leverage)`
      };
    }

    // Calculate Liquidation Price (MMR = 0.5% maintenance margin)
    const mmr = 0.005;
    let liquidationPrice = 0;
    if (signal.side === 'LONG') {
      liquidationPrice = signal.entryPrice * (1 - (1 / leverage) + mmr);
    } else {
      liquidationPrice = signal.entryPrice * (1 + (1 / leverage) - mmr);
    }
    liquidationPrice = Math.max(0.0001, Number(liquidationPrice.toFixed(asset.decimals || 2)));

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
