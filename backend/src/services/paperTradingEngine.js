import { evaluatePositionExit } from './strategyEngine.js';

/**
 * Intelligent Paper Trading Engine (Pro Scalp & Leveraged Execution)
 * - Custom Balance Management (Increase/Decrease to any amount)
 * - 1x to 50x Margin & Leverage System
 * - Return on Equity (ROE%) & Liquidation Price Safeguards
 * - Dynamic Break-Even & Trailing Stops
 * - Early Signal Reversal & Momentum Exhaustion Auto-Exits
 * - Complete Win/Loss Performance Ledger
 */

export class PaperTradingEngine {
  constructor(initialBalance = 10000, accountType = 'MARGIN') {
    this.accountType = accountType; // 'MARGIN' | 'SPOT'
    this.initialBalance = initialBalance;
    this.balance = initialBalance;
    this.activePositions = [];
    this.closedTrades = [];
    this.winCount = 0;
    this.lossCount = 0;
    this.breakEvenCount = 0;
    this.totalGrossProfit = 0;
    this.totalGrossLoss = 0;
    this.trailingStopsEnabled = true;
    this.reversalExitsEnabled = true;
    this.scalpModeEnabled = true;
  }

  getPortfolioState() {
    const unrealizedPnL = this.activePositions.reduce((acc, pos) => acc + (pos.unrealizedPnL || 0), 0);

    // Calculate trade performance metrics dynamically from closed trades ledger
    const totalTrades = this.closedTrades.length;
    let winCount = 0;
    let lossCount = 0;
    let breakEvenCount = 0;
    let grossProfit = 0;
    let grossLoss = 0;

    for (const trade of this.closedTrades) {
      const pnl = Number(trade.finalPnL || 0);
      const isBE = trade.exitReason === 'BREAKEVEN_STOP_TRIGGER' || Math.abs(pnl) <= 0.08;
      if (isBE) {
        breakEvenCount++;
        if (pnl > 0) grossProfit += pnl;
        else if (pnl < 0) grossLoss += Math.abs(pnl);
      } else if (pnl > 0.08) {
        winCount++;
        grossProfit += pnl;
      } else if (pnl < -0.08) {
        lossCount++;
        grossLoss += Math.abs(pnl);
      }
    }

    this.winCount = winCount;
    this.lossCount = lossCount;
    this.breakEvenCount = breakEvenCount;
    this.totalGrossProfit = Number(grossProfit.toFixed(2));
    this.totalGrossLoss = Number(grossLoss.toFixed(2));

    const decisiveTrades = winCount + lossCount;
    const winRate = decisiveTrades > 0
      ? Number(((winCount / decisiveTrades) * 100).toFixed(1))
      : (lossCount === 0 && (winCount > 0 || breakEvenCount > 0) ? 100 : 0);
    const profitFactor = grossLoss > 0
      ? Number((grossProfit / grossLoss).toFixed(2))
      : (grossProfit > 0 ? 99.9 : 0);

    // Cumulative Realized PnL strictly from ledger
    const cumulativeRealizedPnL = Number((grossProfit - grossLoss).toFixed(2));
    const equity = Number((this.balance + unrealizedPnL).toFixed(2));
    const totalPnL = Number((equity - this.initialBalance).toFixed(2));
    const totalPnLPct = this.initialBalance > 0 ? Number(((totalPnL / this.initialBalance) * 100).toFixed(2)) : 0;

    // Spot vs Margin Specific Portfolio Analytics
    const isSpot = this.accountType === 'SPOT';
    const usedMargin = isSpot
      ? Number(this.activePositions.reduce((acc, pos) => acc + (pos.notional || 0), 0).toFixed(2))
      : Number(this.activePositions.reduce((acc, pos) => acc + (pos.margin || (pos.notional / (pos.leverage || 1))), 0).toFixed(2));

    const freeMargin = Number(Math.max(0, equity - usedMargin).toFixed(2));
    const freeCash = isSpot ? Number(Math.max(0, this.balance - usedMargin).toFixed(2)) : freeMargin;
    const holdingValue = isSpot
      ? Number(this.activePositions.reduce((acc, pos) => acc + (pos.notional || 0) + (pos.unrealizedPnL || 0), 0).toFixed(2))
      : 0;
    const marginLevelPercent = usedMargin > 0 ? Number(((equity / usedMargin) * 100).toFixed(1)) : 999;

    return {
      accountType: this.accountType,
      initialBalance: this.initialBalance,
      balance: Number(this.balance.toFixed(2)),
      equity,
      usedMargin,
      freeMargin,
      freeCash,
      holdingValue,
      marginLevelPercent,
      unrealizedPnL: Number(unrealizedPnL.toFixed(2)),
      realizedPnL: cumulativeRealizedPnL,
      totalPnL,
      totalPnLPct,
      winCount,
      lossCount,
      breakEvenCount,
      totalTrades,
      winRate,
      profitFactor,
      scalpModeEnabled: this.scalpModeEnabled,
      activePositions: this.activePositions,
      closedTrades: this.closedTrades.slice(-200).reverse()
    };
  }

  /**
   * Set Custom Demo Account Balance
   */
  setBalance(newBalance, closeOpenPositions = false) {
    const validBalance = Math.max(1, Number(newBalance) || 5);

    if (closeOpenPositions) {
      this.activePositions = [];
    }

    this.balance = validBalance;
    this.initialBalance = validBalance;
    this.closedTrades = [];
    this.winCount = 0;
    this.lossCount = 0;
    this.breakEvenCount = 0;
    this.totalGrossProfit = 0;
    this.totalGrossLoss = 0;
    return this.getPortfolioState();
  }

  /**
   * Quick balance increase / decrease
   */
  adjustBalance(delta) {
    const newBal = Math.max(1, this.balance + Number(delta));
    this.balance = newBal;
    this.initialBalance = newBal;
    return this.getPortfolioState();
  }

  openPosition(orderData) {
    const {
      symbol,
      name,
      category,
      side,
      entryPrice,
      stopLoss,
      takeProfit,
      stopDistance,
      targetDistance,
      units,
      notional,
      confidence,
      reason,
      riskRewardRatio,
      tradingStyle,
      leverage = 10,
      margin,
      liquidationPrice
    } = orderData;

    const calcStopDist = stopDistance || Math.abs(entryPrice - stopLoss);
    const calcTargetDist = targetDistance || Math.abs(takeProfit - entryPrice);
    const posMargin = margin || Number((notional / leverage).toFixed(2));

    // Fallback liquidation calculation if not supplied (scales up to 500x leverage)
    let liqPrice = liquidationPrice;
    if (!liqPrice) {
      const imr = 1 / leverage;
      const mmr = Math.min(0.005, imr * 0.2);
      liqPrice = side === 'LONG'
        ? entryPrice * (1 - imr + mmr)
        : entryPrice * (1 + imr - mmr);
      liqPrice = Number(liqPrice.toFixed(4));
    }

    const position = {
      id: `TRD-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
      symbol,
      name,
      category,
      decimals: orderData.decimals !== undefined ? orderData.decimals : 4,
      side, // 'SHORT' or 'LONG'
      entryPrice,
      currentPrice: entryPrice,
      initialStopLoss: stopLoss,
      stopLoss,
      takeProfit,
      stopDistance: calcStopDist,
      targetDistance: calcTargetDist,
      trailingStopActive: false,
      breakEvenLocked: false,
      tradingStyle: tradingStyle || 'SCALPING',
      leverage,
      margin: posMargin,
      liquidationPrice: liqPrice,
      roePercent: 0,
      units,
      notional,
      confidence,
      reason,
      riskRewardRatio: riskRewardRatio || 1.3,
      maxHoldMinutes: orderData.maxHoldMinutes || 5,
      openTime: new Date().toISOString(),
      cycleCount: 0,
      unrealizedPnL: 0,
      pnlPercent: 0,
      highestPrice: entryPrice,
      lowestPrice: entryPrice
    };

    this.activePositions.push(position);
    return position;
  }

  closePosition(tradeId, exitPrice, exitReason = 'MANUAL_EXIT', exitNote = '') {
    const index = this.activePositions.findIndex(p => p.id === tradeId);
    if (index === -1) return null;

    const pos = this.activePositions[index];
    const finalExitPrice = exitPrice || pos.currentPrice;

    let pnl = 0;
    if (pos.side === 'LONG') {
      pnl = (finalExitPrice - pos.entryPrice) * pos.units;
    } else {
      pnl = (pos.entryPrice - finalExitPrice) * pos.units;
    }

    // Cap loss to allocated margin in case of liquidation
    if (exitReason === 'LIQUIDATION_TRIGGER' && pnl < -pos.margin) {
      pnl = -pos.margin;
    }

    // Preserve micro-cents for tiny balances ($5 - $10 accounts)
    const pnlRounded = Math.abs(pnl) < 0.01 && pnl !== 0
      ? Number(pnl.toFixed(4))
      : Number(pnl.toFixed(2));
    const pnlPercent = Number(((pnl / pos.notional) * 100).toFixed(2));
    const roePercent = Number(((pnl / pos.margin) * 100).toFixed(2));

    this.balance += pnlRounded;

    const isWin = pnlRounded > 0;
    const isLoss = pnlRounded < 0;
    const isBreakEven = pnlRounded === 0;

    if (isBreakEven) {
      this.breakEvenCount++;
    } else if (isWin) {
      this.winCount++;
      this.totalGrossProfit += pnlRounded;
    } else if (isLoss) {
      this.lossCount++;
      this.totalGrossLoss += Math.abs(pnlRounded);
    }

    const closedRecord = {
      ...pos,
      exitPrice: finalExitPrice,
      exitReason,
      exitNote: exitNote || exitReason,
      closeTime: new Date().toISOString(),
      finalPnL: pnlRounded,
      finalPnLPercent: pnlPercent,
      roePercent,
      isBreakEven,
      isWin,
      isLoss
    };

    this.closedTrades.push(closedRecord);
    this.activePositions.splice(index, 1);

    return closedRecord;
  }

  /**
   * Evaluates all open positions against live market prices and technicals.
   * Auto-manages Scalp Trailing Stops, Liquidation Triggers, and Profit Locks.
   */
  updatePricesAndCheckTriggers(priceMap, technicalsMap = {}) {
    const closedTriggers = [];

    for (let i = this.activePositions.length - 1; i >= 0; i--) {
      const pos = this.activePositions[i];
      const livePrice = priceMap[pos.symbol];
      if (!livePrice) continue;

      pos.cycleCount = (pos.cycleCount || 0) + 1;
      pos.currentPrice = livePrice;
      pos.highestPrice = Math.max(pos.highestPrice, livePrice);
      pos.lowestPrice = Math.min(pos.lowestPrice, livePrice);

      let pnl = 0;
      if (pos.side === 'LONG') {
        pnl = (livePrice - pos.entryPrice) * pos.units;
      } else {
        pnl = (pos.entryPrice - livePrice) * pos.units;
      }

      pos.unrealizedPnL = Number(pnl.toFixed(2));
      pos.pnlPercent = Number(((pnl / pos.notional) * 100).toFixed(2));
      pos.roePercent = Number(((pnl / pos.margin) * 100).toFixed(2));

      // ====================================================
      // 0. LIQUIDATION TRIGGER SAFETY
      // ====================================================
      if (pos.side === 'LONG' && pos.liquidationPrice && livePrice <= pos.liquidationPrice) {
        const closed = this.closePosition(pos.id, pos.liquidationPrice, 'LIQUIDATION_TRIGGER', 'Position liquidated on margin call');
        if (closed) {
          closedTriggers.push(closed);
          continue;
        }
      } else if (pos.side === 'SHORT' && pos.liquidationPrice && livePrice >= pos.liquidationPrice) {
        const closed = this.closePosition(pos.id, pos.liquidationPrice, 'LIQUIDATION_TRIGGER', 'Position liquidated on margin call');
        if (closed) {
          closedTriggers.push(closed);
          continue;
        }
      }

      // ====================================================
      // 1. SCALPING DYNAMIC TRAILING STOP & BREAK-EVEN (30% & 55% Zones)
      // ====================================================
      if (this.trailingStopsEnabled) {
        const dec = pos.decimals !== undefined ? pos.decimals : 4;
        if (pos.side === 'SHORT') {
          const runDown = pos.entryPrice - pos.lowestPrice;

          // Scalp Break-Even: Price moved 25% of target distance -> Lock in Break-Even ($0 loss)!
          if (!pos.breakEvenLocked && runDown >= pos.targetDistance * 0.25) {
            pos.stopLoss = Number((pos.entryPrice - pos.stopDistance * 0.05).toFixed(dec));
            pos.breakEvenLocked = true;
          }

          // Scalp Trailing Stop: Price reached 50% of target distance -> Trail closely behind lowest price!
          if (runDown >= pos.targetDistance * 0.50) {
            const newTrailStop = Number((pos.lowestPrice + pos.stopDistance * 0.18).toFixed(dec));
            if (newTrailStop < pos.stopLoss) {
              pos.stopLoss = newTrailStop;
              pos.trailingStopActive = true;
            }
          }
        } else if (pos.side === 'LONG') {
          const runUp = pos.highestPrice - pos.entryPrice;

          // Scalp Break-Even: Price gained 25% of target distance -> Lock in Break-Even ($0 loss)!
          if (!pos.breakEvenLocked && runUp >= pos.targetDistance * 0.25) {
            pos.stopLoss = Number((pos.entryPrice + pos.stopDistance * 0.05).toFixed(dec));
            pos.breakEvenLocked = true;
          }

          // Scalp Trailing Stop: Price reached 50% of target distance -> Trail closely behind highest price!
          if (runUp >= pos.targetDistance * 0.50) {
            const newTrailStop = Number((pos.highestPrice - pos.stopDistance * 0.18).toFixed(dec));
            if (newTrailStop > pos.stopLoss) {
              pos.stopLoss = newTrailStop;
              pos.trailingStopActive = true;
            }
          }
        }
      }

      // ====================================================
      // 2. SCALP TIME-LIMIT (15m for Margin, 5m for Spot)
      // ====================================================
      const openTimeMs = pos.openTime ? new Date(pos.openTime).getTime() : 0;
      const ageMs = openTimeMs > 0 ? (Date.now() - openTimeMs) : ((pos.cycleCount || 0) * 5000);
      const cyclesElapsed = pos.cycleCount || 0;
      const maxHoldMinutes = this.accountType === 'SPOT' ? 5 : 15;
      const maxHoldMs = maxHoldMinutes * 60 * 1000;
      const maxHoldCycles = maxHoldMinutes * 12;

      // A. Holding Cap: Exit at market price to rotate capital if profitable or cycle expired
      if (ageMs >= maxHoldMs || cyclesElapsed >= maxHoldCycles) {
        if (pos.unrealizedPnL >= 0 || ageMs >= 900000) {
          const isProfitable = pos.unrealizedPnL >= 0;
          const exitNote = isProfitable
            ? `${maxHoldMinutes}m Scalp Expiry: Banked profit at ${maxHoldMinutes}m cap (+${pos.pnlPercent}%)`
            : `${maxHoldMinutes}m Scalp Expiry: Scalp duration reached ${maxHoldMinutes}m cap (${pos.pnlPercent}%)`;
          const closed = this.closePosition(pos.id, livePrice, 'TIME_LIMIT_EXIT', exitNote);
          if (closed) {
            closedTriggers.push(closed);
            continue;
          }
        }
      }

      // B. Stalled Momentum Soft Exit (After 3.5m / 42 cycles)
      // If scalp reached profit but starts pulling back from micro peak, lock it in!
      if ((ageMs >= 210000 || cyclesElapsed >= 42) && pos.unrealizedPnL > 0) {
        if (pos.side === 'LONG' && livePrice < pos.highestPrice * 0.998) {
          const closed = this.closePosition(pos.id, livePrice, 'MOMENTUM_EXHAUSTION_EXIT', `Fast Scalp Lock: Secured +${pos.pnlPercent}% gain before 5m cap`);
          if (closed) {
            closedTriggers.push(closed);
            continue;
          }
        } else if (pos.side === 'SHORT' && livePrice > pos.lowestPrice * 1.002) {
          const closed = this.closePosition(pos.id, livePrice, 'MOMENTUM_EXHAUSTION_EXIT', `Fast Scalp Lock: Secured +${pos.pnlPercent}% gain before 5m cap`);
          if (closed) {
            closedTriggers.push(closed);
            continue;
          }
        }
      }

      // ====================================================
      // 3. INTELLIGENT AUTO-CLOSE: SIGNAL REVERSAL
      // ====================================================
      if (this.reversalExitsEnabled && technicalsMap[pos.symbol]) {
        const exitEval = evaluatePositionExit(pos, technicalsMap[pos.symbol], livePrice);
        if (exitEval.shouldExit) {
          const closed = this.closePosition(pos.id, livePrice, exitEval.reason, exitEval.message);
          if (closed) {
            closedTriggers.push(closed);
            continue;
          }
        }
      }

      // ====================================================
      // 4. TARGET & STOP PRICE TRIGGERS
      // ====================================================
      if (pos.side === 'SHORT') {
        if (pos.takeProfit && livePrice <= pos.takeProfit) {
          const closed = this.closePosition(pos.id, pos.takeProfit, 'TAKE_PROFIT_TRIGGER', 'Scalp TP target reached');
          if (closed) closedTriggers.push(closed);
        } else if (pos.stopLoss && livePrice >= pos.stopLoss) {
          const reason = pos.trailingStopActive
            ? 'TRAILING_STOP_TRIGGER'
            : pos.breakEvenLocked
            ? 'BREAKEVEN_STOP_TRIGGER'
            : 'STOP_LOSS_TRIGGER';
          const closed = this.closePosition(pos.id, pos.stopLoss, reason, 'Stop protection triggered');
          if (closed) closedTriggers.push(closed);
        }
      } else if (pos.side === 'LONG') {
        if (pos.takeProfit && livePrice >= pos.takeProfit) {
          const closed = this.closePosition(pos.id, pos.takeProfit, 'TAKE_PROFIT_TRIGGER', 'Scalp TP target reached');
          if (closed) closedTriggers.push(closed);
        } else if (pos.stopLoss && livePrice <= pos.stopLoss) {
          const reason = pos.trailingStopActive
            ? 'TRAILING_STOP_TRIGGER'
            : pos.breakEvenLocked
            ? 'BREAKEVEN_STOP_TRIGGER'
            : 'STOP_LOSS_TRIGGER';
          const closed = this.closePosition(pos.id, pos.stopLoss, reason, 'Stop protection triggered');
          if (closed) closedTriggers.push(closed);
        }
      }
    }

    return closedTriggers;
  }

  reset(initialBalance = 10000) {
    this.initialBalance = initialBalance;
    this.balance = initialBalance;
    this.activePositions = [];
    this.closedTrades = [];
    this.winCount = 0;
    this.lossCount = 0;
    this.totalGrossProfit = 0;
    this.totalGrossLoss = 0;
    return this.getPortfolioState();
  }
}
