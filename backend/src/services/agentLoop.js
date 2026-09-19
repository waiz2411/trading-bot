import { marketDataService } from './marketData.js';
import { calculateTechnicalMetrics } from './technicalAnalysis.js';
import { evaluateStrategyConfluence, evaluateSpotConfluence } from './strategyEngine.js';
import { RiskManager } from './riskManager.js';
import { PaperTradingEngine } from './paperTradingEngine.js';
import { binanceConnector } from './binanceConnector.js';
import { mt5Connector } from './mt5Connector.js';

export class AutonomousAgentLoop {
  constructor() {
    this.activeAccount = 'MARGIN'; // 'MARGIN' | 'SPOT'
    this.currentUser = 'demo@gmail.com';
    this.currentMode = 'SIMULATED'; // 'SIMULATED' | 'LIVE'

    // Account 1: Margin Scalper (500x leverage, 4 slots, 1.5% risk)
    this.marginRiskManager = new RiskManager({
      riskPerTradePct: 1.5,
      maxConcurrentTrades: 4,
      minConfidenceThreshold: 82,
      tradeDirection: 'BOTH',
      tradingStyle: 'SCALPING',
      defaultLeverage: 500,
      targetRiskRewardRatio: 1.3
    });
    this.marginTradingEngine = new PaperTradingEngine(10);

    // Account 2: Pure Spot Crypto (1x Cash Spot, 100% Capital Allocation, 1 Slot)
    this.spotRiskManager = {
      capitalAllocationPct: 100, // 100% full balance per spot trade
      stopLossPct: 1.0, // 1% Stop Loss default
      takeProfitPct: 2.5, // 2.5% Take Profit default
      minConfidenceThreshold: 82
    };
    this.spotTradingEngine = new PaperTradingEngine(10);

    this.isAutoTradingEnabled = true;
    this.isScanning = false;
    this.agentLogs = [];
    this.latestScanResults = [];
    this.scanIntervalMs = 5000;
    this.timerId = null;
    this.assetCooldowns = new Map();
    this.spotCooldowns = new Map();

    this.log('⚡ Autonomous Agent active: Dual-Account Engine (Margin Scalper 500x + Pure Spot 100% Crypto).');
  }

  setUserMode(userEmail, mode = 'SIMULATED') {
    this.currentUser = userEmail;
    this.currentMode = mode;
    this.log(`👤 Active session: ${userEmail} (${mode === 'LIVE' ? '🔴 LIVE BROKER MODE' : '🟢 SIMULATED DEMO'})`, 'INFO');
  }

  // Backwards compatibility accessors
  get tradingEngine() {
    return this.activeAccount === 'SPOT' ? this.spotTradingEngine : this.marginTradingEngine;
  }

  get riskManager() {
    return this.activeAccount === 'SPOT'
      ? {
          getSettings: () => ({
            ...this.spotRiskManager,
            tradingStyle: 'SPOT_BUY',
            defaultLeverage: 1,
            tradeDirection: 'LONG_ONLY',
            targetRiskRewardRatio: Number((this.spotRiskManager.takeProfitPct / this.spotRiskManager.stopLossPct).toFixed(2))
          })
        }
      : this.marginRiskManager;
  }

  switchAccount(account) {
    const target = (account || '').toUpperCase() === 'SPOT' ? 'SPOT' : 'MARGIN';
    this.activeAccount = target;
    this.log(`🔄 Switched active view to: ${target === 'SPOT' ? '🪙 PURE SPOT CRYPTO (100% Capital)' : '⚡ MARGIN SCALPER (500x)'}`, 'INFO');
    return this.activeAccount;
  }

  log(message, type = 'INFO') {
    const entry = {
      id: `LOG-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
      time: new Date().toLocaleTimeString(),
      timestamp: new Date().toISOString(),
      type,
      message
    };
    this.agentLogs.unshift(entry);
    if (this.agentLogs.length > 80) this.agentLogs.pop();
  }

  start() {
    if (this.timerId) return;
    this.log('Scalping Quant Loop active. Auto-Open & Auto-Close scanning 27 global markets...');
    this.runCycle();
    this.timerId = setInterval(() => this.runCycle(), this.scanIntervalMs);
  }

  stop() {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
      this.log('Agent loop paused.', 'WARN');
    }
  }

  toggleAutoTrading() {
    this.isAutoTradingEnabled = !this.isAutoTradingEnabled;
    this.log(
      `Autonomous execution switched to: ${this.isAutoTradingEnabled ? 'ENABLED (Auto-open & auto-close active)' : 'DISABLED (Manual only)'}`,
      this.isAutoTradingEnabled ? 'SUCCESS' : 'WARN'
    );
    return this.isAutoTradingEnabled;
  }

  setBalance(newBalance, closeOpenPositions = false, account = null) {
    const targetAcc = account ? account.toUpperCase() : this.activeAccount;
    const engine = targetAcc === 'SPOT' ? this.spotTradingEngine : this.marginTradingEngine;
    const state = engine.setBalance(newBalance, closeOpenPositions);
    this.log(`💰 [${targetAcc}] Balance updated to $${Number(newBalance).toLocaleString('en-US')}`, 'SUCCESS');
    return state;
  }

  adjustBalance(delta, account = null) {
    const targetAcc = account ? account.toUpperCase() : this.activeAccount;
    const engine = targetAcc === 'SPOT' ? this.spotTradingEngine : this.marginTradingEngine;
    const state = engine.adjustBalance(delta);
    this.log(`💰 [${targetAcc}] Balance adjusted by ${delta >= 0 ? '+' : ''}$${delta}. Current Balance: $${state.balance.toLocaleString('en-US')}`, 'SUCCESS');
    return state;
  }

  updateSpotSettings(newSettings = {}) {
    if (newSettings.stopLossPct !== undefined) {
      this.spotRiskManager.stopLossPct = Math.max(0.2, Math.min(10, Number(newSettings.stopLossPct)));
    }
    if (newSettings.takeProfitPct !== undefined) {
      this.spotRiskManager.takeProfitPct = Math.max(0.5, Math.min(25, Number(newSettings.takeProfitPct)));
    }
    this.log(`⚙️ Spot Strategy updated: SL: -${this.spotRiskManager.stopLossPct}%, TP: +${this.spotRiskManager.takeProfitPct}%`, 'INFO');
    return this.spotRiskManager;
  }

  setTradeDirection(direction) {
    this.marginRiskManager.tradeDirection = direction;
    this.log(`🎯 Trade Direction Mode updated: ${direction}`, 'INFO');
    return this.marginRiskManager.getSettings();
  }

  setTradingStyle(style) {
    this.marginRiskManager.tradingStyle = style;
    this.marginTradingEngine.scalpModeEnabled = style === 'SCALPING';
    this.log(`⏱️ Trading Horizon updated: ${style}`, 'INFO');
    return this.marginRiskManager.getSettings();
  }

  async runCycle() {
    if (this.isScanning) return;
    this.isScanning = true;

    try {
      // 1. Decrement cooldowns for both accounts
      for (const [symbol, count] of this.assetCooldowns.entries()) {
        if (count <= 1) this.assetCooldowns.delete(symbol);
        else this.assetCooldowns.set(symbol, count - 1);
      }
      for (const [symbol, count] of this.spotCooldowns.entries()) {
        if (count <= 1) this.spotCooldowns.delete(symbol);
        else this.spotCooldowns.set(symbol, count - 1);
      }

      // 2. Update live market prices
      await marketDataService.updateAll();
      const markets = marketDataService.getAllMarkets();
      const pricesMap = marketDataService.getAllPricesMap();

      // 3. Pre-calculate technicals map for position auto-exit evaluation
      const technicalsMap = {};
      const scanResults = [];
      const marginRiskSettings = this.marginRiskManager.getSettings();

      const validSpotBuys = [];

      for (const asset of markets) {
        const technicals = calculateTechnicalMetrics(asset.candles);
        if (technicals) {
          technicalsMap[asset.symbol] = technicals;
        }

        // 3A. Margin Scalper Confluence
        const signal = evaluateStrategyConfluence(asset, technicals, marginRiskSettings);

        // 3B. Pure Spot Crypto Confluence (Decoupled, 75%+ Win Rate Edge)
        let spotSignal = null;
        if (asset.category === 'Crypto') {
          spotSignal = evaluateSpotConfluence(asset, technicals, this.spotRiskManager);
          if (spotSignal.action === 'STRONG_BUY' && !(this.spotCooldowns.get(asset.symbol) > 0)) {
            validSpotBuys.push({ asset, signal: spotSignal });
          }
        }

        const scanItem = {
          symbol: asset.symbol,
          name: asset.name,
          category: asset.category,
          icon: asset.icon,
          price: asset.price,
          change24h: asset.change24h,
          high24h: asset.high24h,
          low24h: asset.low24h,
          technicals: {
            rsi: technicals?.rsi,
            macd: technicals?.macd?.histogram,
            ema50: technicals?.ema50,
            ema200: technicals?.ema200,
            atr: technicals?.atr
          },
          signal: this.activeAccount === 'SPOT' && spotSignal ? spotSignal : signal
        };

        scanResults.push(scanItem);

        // ==========================================
        // 4A. MARGIN SCALPER AUTO-OPEN (500x Lev)
        // ==========================================
        const isMarginCooldown = (this.assetCooldowns.get(asset.symbol) || 0) > 0;

        if (this.isAutoTradingEnabled && !isMarginCooldown && (signal.action === 'STRONG_BUY' || signal.action === 'STRONG_SELL')) {
          const portfolioState = this.marginTradingEngine.getPortfolioState();
          const riskEval = this.marginRiskManager.evaluateTradeRisk(portfolioState, signal, asset);

          if (riskEval.allowed) {
            const pos = this.marginTradingEngine.openPosition({
              symbol: asset.symbol,
              name: asset.name,
              category: asset.category,
              side: signal.side,
              entryPrice: signal.entryPrice,
              stopLoss: signal.stopLoss,
              takeProfit: signal.takeProfit,
              stopDistance: signal.stopDistance,
              targetDistance: signal.targetDistance,
              units: riskEval.units,
              notional: riskEval.notional,
              confidence: signal.confidence,
              reason: signal.reason,
              riskRewardRatio: signal.riskRewardRatio,
              tradingStyle: marginRiskSettings.tradingStyle,
              leverage: riskEval.leverage,
              margin: riskEval.margin,
              liquidationPrice: riskEval.liquidationPrice
            });

            this.log(
              `⚡ [MARGIN] SCALP OPEN: ${signal.side} ${asset.symbol} @ $${signal.entryPrice} (${riskEval.leverage}x Lev, Margin: $${riskEval.margin}). Target: $${signal.takeProfit} | Stop: $${signal.stopLoss}`,
              'SUCCESS'
            );

            // Live MT5 Bridge Dispatcher (when logged into Live Account)
            if (this.currentMode === 'LIVE' && mt5Connector.connected) {
              mt5Connector.openPosition({
                symbol: asset.symbol,
                side: signal.side,
                volume: 0.01,
                sl: signal.stopLoss,
                tp: signal.takeProfit,
                comment: `Scalp ${pos.id}`
              }).then(ticket => {
                this.log(`📡 [MT5 LIVE] Scalp order routed to broker! Ticket #${ticket.ticket}`, 'SUCCESS');
              }).catch(err => {
                this.log(`⚠️ [MT5 LIVE] Order warning: ${err.message}`, 'WARN');
              });
            }
          }
        }
      }

      this.latestScanResults = scanResults;

      // ==========================================
      // 4B. PURE SPOT CRYPTO AUTO-OPEN (100% Capital Allocation)
      // ==========================================
      if (this.isAutoTradingEnabled && this.spotTradingEngine.activePositions.length === 0 && validSpotBuys.length > 0) {
        // Pick the top confidence sniper crypto setup
        validSpotBuys.sort((a, b) => b.signal.confidence - a.signal.confidence);
        const topPick = validSpotBuys[0];
        const spotCash = this.spotTradingEngine.balance;

        if (spotCash >= 0.5) {
          const entryPrice = topPick.signal.entryPrice;
          const notional = Number(spotCash.toFixed(2));
          const rawUnits = notional / entryPrice;
          const units = Number(rawUnits.toFixed(topPick.asset.decimals || 4));

          const stopDist = topPick.signal.stopDistance;
          const targetDist = topPick.signal.targetDistance;
          const stopLoss = topPick.signal.stopLoss;
          const takeProfit = topPick.signal.takeProfit;

          const spotPos = this.spotTradingEngine.openPosition({
            symbol: topPick.asset.symbol,
            name: topPick.asset.name,
            category: 'Crypto',
            side: 'LONG',
            entryPrice,
            stopLoss,
            takeProfit,
            stopDistance: stopDist,
            targetDistance: targetDist,
            units,
            notional,
            confidence: topPick.signal.confidence,
            reason: `Pure Spot 100% Allocation (${topPick.signal.reason})`,
            riskRewardRatio: Number((this.spotRiskManager.takeProfitPct / this.spotRiskManager.stopLossPct).toFixed(1)),
            tradingStyle: 'SPOT_BUY',
            leverage: 1, // 1x Spot Cash
            margin: notional, // 100% full balance allocated
            liquidationPrice: 0 // No liquidation in spot
          });

          this.log(
            `🪙 [SPOT] 100% CAPITAL BUY: Bought ${topPick.asset.symbol} with $${notional} (100% Balance) @ $${entryPrice} (Confidence: ${topPick.signal.confidence}%). Target: +${this.spotRiskManager.takeProfitPct}% ($${takeProfit}) | Stop: -${this.spotRiskManager.stopLossPct}% ($${stopLoss})`,
            'SUCCESS'
          );

          // Live Binance API Dispatcher (when logged into Live Account)
          if (this.currentMode === 'LIVE' && binanceConnector.connected) {
            binanceConnector.placeSpotMarketOrder({
              symbol: topPick.asset.symbol,
              side: 'BUY',
              quoteOrderQty: notional
            }).then(liveOrder => {
              this.log(`🪙 [BINANCE LIVE] Real Market Buy executed on Binance! Order ID: ${liveOrder.orderId}`, 'SUCCESS');
            }).catch(err => {
              this.log(`⚠️ [BINANCE LIVE] Order warning: ${err.message}`, 'WARN');
            });
          }
        }
      }

      // ==========================================
      // 5. MANAGE EXITS FOR BOTH ENGINES
      // ==========================================
      // A. Margin Engine Trigger Checks
      const marginClosed = this.marginTradingEngine.updatePricesAndCheckTriggers(pricesMap, technicalsMap);
      for (const closed of marginClosed) {
        this.assetCooldowns.set(closed.symbol, 6);
        if (closed.exitReason === 'TAKE_PROFIT_TRIGGER') {
          this.log(`🎯 [MARGIN] TP HIT: ${closed.symbol} ${closed.side}! Realized: +$${closed.finalPnL}`, 'SUCCESS');
        } else if (closed.exitReason === 'TRAILING_STOP_TRIGGER') {
          this.log(`🛡️ [MARGIN] TRAIL STOP: ${closed.symbol} ${closed.side}! Profit: +$${closed.finalPnL}`, 'SUCCESS');
        } else if (closed.exitReason === 'BREAKEVEN_STOP_TRIGGER') {
          this.log(`🔒 [MARGIN] BREAK-EVEN: ${closed.symbol} ${closed.side}. $0 Loss protected.`, 'INFO');
        } else if (closed.exitReason === 'STOP_LOSS_TRIGGER') {
          this.log(`🛡️ [MARGIN] STOP HIT: ${closed.symbol} ${closed.side}. Loss capped: -$${Math.abs(closed.finalPnL)}`, 'WARN');
        }
      }

      // B. Spot Engine Trigger Checks
      const spotClosed = this.spotTradingEngine.updatePricesAndCheckTriggers(pricesMap, technicalsMap);
      for (const closed of spotClosed) {
        this.spotCooldowns.set(closed.symbol, 6);
        if (closed.exitReason === 'TAKE_PROFIT_TRIGGER') {
          this.log(`🪙 [SPOT] TARGET HIT: ${closed.symbol}! Sold 100% holding for +$${closed.finalPnL} (+${closed.finalPnLPercent}%)!`, 'SUCCESS');
        } else if (closed.exitReason === 'STOP_LOSS_TRIGGER') {
          this.log(`🪙 [SPOT] STOP TRIGGERED: ${closed.symbol} sold at stop. Loss: -$${Math.abs(closed.finalPnL)} (${closed.finalPnLPercent}%)`, 'WARN');
        } else {
          this.log(`🪙 [SPOT] EXIT: ${closed.symbol} closed. Realized: ${closed.finalPnL >= 0 ? '+' : ''}$${closed.finalPnL}`, closed.finalPnL >= 0 ? 'SUCCESS' : 'WARN');
        }

        // Live Binance Exit Sell
        if (this.currentMode === 'LIVE' && binanceConnector.connected && closed.units > 0) {
          binanceConnector.placeSpotMarketOrder({
            symbol: closed.symbol,
            side: 'SELL',
            quantity: closed.units
          }).then(() => {
            this.log(`🪙 [BINANCE LIVE] Real Spot Exit executed on Binance!`, 'SUCCESS');
          }).catch(err => {
            this.log(`⚠️ [BINANCE LIVE] Exit sell warning: ${err.message}`, 'WARN');
          });
        }
      }

    } catch (error) {
      console.error('Error during agent cycle:', error);
      this.log(`Cycle error: ${error.message}`, 'ERROR');
    } finally {
      this.isScanning = false;
    }
  }

  getDashboardData() {
    const marginPortfolio = this.marginTradingEngine.getPortfolioState();
    const spotPortfolio = this.spotTradingEngine.getPortfolioState();
    const marginRisk = this.marginRiskManager.getSettings();
    const spotRisk = {
      ...this.spotRiskManager,
      tradingStyle: 'SPOT_BUY',
      defaultLeverage: 1,
      tradeDirection: 'LONG_ONLY',
      targetRiskRewardRatio: Number((this.spotRiskManager.takeProfitPct / this.spotRiskManager.stopLossPct).toFixed(1))
    };

    const isSpot = this.activeAccount === 'SPOT';

    return {
      activeAccount: this.activeAccount,
      mode: this.currentMode,
      currentUser: this.currentUser,
      brokers: {
        binance: binanceConnector.getStatus(),
        mt5: mt5Connector.getStatus()
      },
      margin: {
        portfolio: marginPortfolio,
        riskSettings: marginRisk
      },
      spot: {
        portfolio: spotPortfolio,
        riskSettings: spotRisk
      },
      portfolio: isSpot ? spotPortfolio : marginPortfolio,
      riskSettings: isSpot ? spotRisk : marginRisk,
      isAutoTradingEnabled: this.isAutoTradingEnabled,
      isScanning: this.isScanning,
      marketScan: this.latestScanResults,
      logs: this.agentLogs,
      serverTime: new Date().toISOString()
    };
  }
}

export const agentLoop = new AutonomousAgentLoop();
