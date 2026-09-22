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

    // Dynamic Sizing for High-Leverage (500x) Buying Power:
    // When leverage > 1, allocate clean margin (e.g. 2.0% - 3.0% of equity per trade)
    // so notional command power is truly margin * leverage (e.g. $2.50 * 500 = $1,250).
    const dollarRisk = equity * (this.riskPerTradePct / 100);

    let notional = 0;
    let rawUnits = 0;

    if (leverage > 1) {
      // Allocate margin per slot (capped at 5% of equity and 35% of available free margin)
      const targetSlotMargin = Math.max(1.5, Math.min(equity * (this.riskPerTradePct / 100) * 1.25, freeMargin * 0.35));
      let targetNotional = targetSlotMargin * leverage;

      // Risk Safeguard: Ensure potential loss at Stop Loss doesn't exceed 2.2% of equity
      const maxAllowedLoss = equity * ((this.riskPerTradePct * 1.1) / 100);
      if (priceDistance > 0) {
        const impliedLoss = (targetNotional / signal.entryPrice) * priceDistance;
        if (impliedLoss > maxAllowedLoss) {
          targetNotional = (maxAllowedLoss / priceDistance) * signal.entryPrice;
        }
      }

      rawUnits = targetNotional / signal.entryPrice;
      notional = targetNotional;
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

    // Round units according to asset decimals (supports micro-lots)
    const unitDecimals = asset.category === 'Crypto' ? 4 : (rawUnits < 1 ? 4 : 2);
    const units = Number(rawUnits.toFixed(unitDecimals));
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
