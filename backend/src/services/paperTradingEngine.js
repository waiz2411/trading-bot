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
  constructor(initialBalance = 10000) {
    this.initialBalance = initialBalance;
    this.balance = initialBalance;
    this.activePositions = [];
    this.closedTrades = [];
    this.winCount = 0;
    this.lossCount = 0;
    this.totalGrossProfit = 0;
    this.totalGrossLoss = 0;
    this.trailingStopsEnabled = true;
    this.reversalExitsEnabled = true;
    this.scalpModeEnabled = true;
  }

  getPortfolioState() {
    const unrealizedPnL = this.activePositions.reduce((acc, pos) => acc + (pos.unrealizedPnL || 0), 0);
    const equity = Number((this.balance + unrealizedPnL).toFixed(2));

    // Calculate trade performance metrics dynamically from closed trades ledger
    const totalTrades = this.closedTrades.length;
    let winCount = 0;
    let lossCount = 0;
    let breakEvenCount = 0;
    let grossProfit = 0;
    let grossLoss = 0;

    for (const trade of this.closedTrades) {
      const pnl = Number(trade.finalPnL || 0);
      if (pnl > 0) {
        winCount++;
        grossProfit += pnl;
      } else if (pnl < 0) {
        lossCount++;
        grossLoss += Math.abs(pnl);
      } else {
        breakEvenCount++;
      }
    }

    this.winCount = winCount;
    this.lossCount = lossCount;
    this.totalGrossProfit = Number(grossProfit.toFixed(2));
    this.totalGrossLoss = Number(grossLoss.toFixed(2));

    const decisiveTrades = winCount + lossCount;
    const winRate = decisiveTrades > 0 ? Number(((winCount / decisiveTrades) * 100).toFixed(1)) : 0;
    const profitFactor = grossLoss > 0
      ? Number((grossProfit / grossLoss).toFixed(2))
      : (grossProfit > 0 ? 99.9 : 0);

    const totalPnL = Number((equity - this.initialBalance).toFixed(2));
    const totalPnLPct = this.initialBalance > 0 ? Number(((totalPnL / this.initialBalance) * 100).toFixed(2)) : 0;

    // Margin & Leverage Portfolio Analytics
    const usedMargin = Number(this.activePositions.reduce((acc, pos) => acc + (pos.margin || (pos.notional / (pos.leverage || 1))), 0).toFixed(2));
    const freeMargin = Number(Math.max(0, equity - usedMargin).toFixed(2));
    const marginLevelPercent = usedMargin > 0 ? Number(((equity / usedMargin) * 100).toFixed(1)) : 999;

    return {
      initialBalance: this.initialBalance,
      balance: Number(this.balance.toFixed(2)),
      equity,
      usedMargin,
      freeMargin,
      marginLevelPercent,
      unrealizedPnL: Number(unrealizedPnL.toFixed(2)),
      realizedPnL: Number((this.balance - this.initialBalance).toFixed(2)),
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
      closedTrades: this.closedTrades.slice(-100).reverse()
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

    if (pnlRounded > 0) {
      this.winCount++;
      this.totalGrossProfit += pnlRounded;
    } else if (pnlRounded < 0) {
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
      isWin: pnlRounded > 0
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
      // 1. SCALPING DYNAMIC TRAILING STOP & BREAK-EVEN
      // ====================================================
      if (this.trailingStopsEnabled) {
        if (pos.side === 'SHORT') {
          const runDown = pos.entryPrice - pos.lowestPrice;

          // Scalp Break-Even: Price dropped 60% of target distance -> Lock Break-Even!
          if (!pos.breakEvenLocked && runDown >= pos.targetDistance * 0.60) {
            pos.stopLoss = Number((pos.entryPrice - pos.stopDistance * 0.05).toFixed(4));
            pos.breakEvenLocked = true;
          }

          // Scalp Trailing Stop: Price dropped 80% of target distance -> Trail closely!
          if (runDown >= pos.targetDistance * 0.80) {
            const newTrailStop = Number((pos.lowestPrice + pos.stopDistance * 0.25).toFixed(4));
            if (newTrailStop < pos.stopLoss) {
              pos.stopLoss = newTrailStop;
              pos.trailingStopActive = true;
            }
          }
        } else if (pos.side === 'LONG') {
          const runUp = pos.highestPrice - pos.entryPrice;

          if (!pos.breakEvenLocked && runUp >= pos.targetDistance * 0.60) {
            pos.stopLoss = Number((pos.entryPrice + pos.stopDistance * 0.05).toFixed(4));
            pos.breakEvenLocked = true;
          }

          if (runUp >= pos.targetDistance * 0.80) {
            const newTrailStop = Number((pos.highestPrice - pos.stopDistance * 0.25).toFixed(4));
            if (newTrailStop > pos.stopLoss) {
              pos.stopLoss = newTrailStop;
              pos.trailingStopActive = true;
            }
          }
        }
      }

      // ====================================================
      // 2. SCALP QUICK PROFIT BANK (75%+ TARGET REACHED)
      // ====================================================
      const targetProgress = pos.targetDistance > 0
        ? (pos.side === 'SHORT' ? (pos.entryPrice - livePrice) / pos.targetDistance : (livePrice - pos.entryPrice) / pos.targetDistance)
        : 0;

      if (pos.cycleCount >= 12 && targetProgress >= 0.75 && pos.unrealizedPnL > 0) {
        const closed = this.closePosition(pos.id, livePrice, 'SCALP_QUICK_BANK', 'Scalp profit locked at 75%+ target distance');
        if (closed) {
          closedTriggers.push(closed);
          continue;
        }
      }

      // If scalp has been open for 60 cycles (5+ mins) with zero progress -> Timeout exit
      if (pos.cycleCount >= 60 && Math.abs(pos.pnlPercent) < 0.15 && pos.unrealizedPnL <= 0.05) {
        const closed = this.closePosition(pos.id, livePrice, 'SCALP_TIMEOUT_EXIT', 'Scalp duration limit reached (Fast turnover)');
        if (closed) {
          closedTriggers.push(closed);
          continue;
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
