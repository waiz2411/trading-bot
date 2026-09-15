import { marketDataService } from './marketData.js';
import { calculateTechnicalMetrics } from './technicalAnalysis.js';
import { evaluateStrategyConfluence } from './strategyEngine.js';
import { RiskManager } from './riskManager.js';
import { PaperTradingEngine } from './paperTradingEngine.js';

export class AutonomousAgentLoop {
  constructor() {
    this.riskManager = new RiskManager({
      riskPerTradePct: 1.5,
      maxConcurrentTrades: 4,
      minConfidenceThreshold: 78,
      tradeDirection: 'SHORT_ONLY', // Default to Short trades as requested
      tradingStyle: 'SCALPING' // Default to Scalping only as requested
    });

    this.tradingEngine = new PaperTradingEngine(10000);
    this.isAutoTradingEnabled = true;
    this.isScanning = false;
    this.agentLogs = [];
    this.latestScanResults = [];
    this.scanIntervalMs = 5000; // Ultra-fast 5 second scalping radar
    this.timerId = null;
    this.assetCooldowns = new Map();

    this.log('⚡ Scalping Engine active: Configured for SHORT TRADES ONLY with dynamic balance control.');
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
    this.log('Scalping Quant Loop active. Auto-Open & Auto-Close scanning 15 global markets...');
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

  setBalance(newBalance, closeOpenPositions = false) {
    const state = this.tradingEngine.setBalance(newBalance, closeOpenPositions);
    this.log(`💰 Demo Account Balance updated to $${Number(newBalance).toLocaleString('en-US')}`, 'SUCCESS');
    return state;
  }

  adjustBalance(delta) {
    const state = this.tradingEngine.adjustBalance(delta);
    this.log(`💰 Demo Balance adjusted by ${delta >= 0 ? '+' : ''}$${delta}. Current Balance: $${state.balance.toLocaleString('en-US')}`, 'SUCCESS');
    return state;
  }

  setTradeDirection(direction) {
    this.riskManager.tradeDirection = direction;
    this.log(`🎯 Trade Direction Mode updated: ${direction}`, 'INFO');
    return this.riskManager.getSettings();
  }

  setTradingStyle(style) {
    this.riskManager.tradingStyle = style;
    this.tradingEngine.scalpModeEnabled = style === 'SCALPING';
    this.log(`⏱️ Trading Horizon updated: ${style}`, 'INFO');
    return this.riskManager.getSettings();
  }

  async runCycle() {
    if (this.isScanning) return;
    this.isScanning = true;

    try {
      // 1. Decrement asset cooldowns
      for (const [symbol, count] of this.assetCooldowns.entries()) {
        if (count <= 1) {
          this.assetCooldowns.delete(symbol);
        } else {
          this.assetCooldowns.set(symbol, count - 1);
        }
      }

      // 2. Update live market prices
      await marketDataService.updateAll();
      const markets = marketDataService.getAllMarkets();
      const pricesMap = marketDataService.getAllPricesMap();

      // 3. Pre-calculate technicals map for position auto-exit evaluation
      const technicalsMap = {};
      const scanResults = [];
      const riskSettings = this.riskManager.getSettings();

      for (const asset of markets) {
        const technicals = calculateTechnicalMetrics(asset.candles);
        if (technicals) {
          technicalsMap[asset.symbol] = technicals;
        }

        const signal = evaluateStrategyConfluence(asset, technicals, riskSettings);

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
          signal
        };

        scanResults.push(scanItem);

        // 4. Autonomous Scalp Entry Logic (Auto-Open)
        const isCooldown = (this.assetCooldowns.get(asset.symbol) || 0) > 0;

        if (this.isAutoTradingEnabled && !isCooldown && (signal.action === 'STRONG_BUY' || signal.action === 'STRONG_SELL')) {
          const portfolioState = this.tradingEngine.getPortfolioState();
          const riskEval = this.riskManager.evaluateTradeRisk(portfolioState, signal, asset);

          if (riskEval.allowed) {
            const newTrade = this.tradingEngine.openPosition({
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
              tradingStyle: riskSettings.tradingStyle,
              leverage: riskEval.leverage,
              margin: riskEval.margin,
              liquidationPrice: riskEval.liquidationPrice
            });

            this.log(
              `⚡ SCALP AUTO-OPEN: ${signal.side} ${asset.symbol} @ $${signal.entryPrice} (${riskEval.leverage}x Leverage, Margin: $${riskEval.margin}). Target: $${signal.takeProfit} | Stop: $${signal.stopLoss}`,
              'SUCCESS'
            );
          }
        }
      }

      this.latestScanResults = scanResults;

      // 5. Autonomous Intelligent Scalp Position Management & Auto-Close
      const closedTriggers = this.tradingEngine.updatePricesAndCheckTriggers(pricesMap, technicalsMap);

      for (const closed of closedTriggers) {
        this.assetCooldowns.set(closed.symbol, 6);

        if (closed.exitReason === 'TAKE_PROFIT_TRIGGER') {
          this.log(
            `🎯 SCALP HIT TP: ${closed.symbol} ${closed.side}! Realized Profit: +$${closed.finalPnL} (+${closed.finalPnLPercent}%)`,
            'SUCCESS'
          );
        } else if (closed.exitReason === 'SCALP_QUICK_BANK') {
          this.log(
            `💰 SCALP BANKED PROFIT: ${closed.symbol} ${closed.side}! Swift gain banked: +$${closed.finalPnL} (+${closed.finalPnLPercent}%)`,
            'SUCCESS'
          );
        } else if (closed.exitReason === 'SCALP_TIMEOUT_EXIT') {
          this.log(
            `⏱️ SCALP TIMEOUT: ${closed.symbol} ${closed.side} exited flat to recycle capital. PnL: ${closed.finalPnL >= 0 ? '+' : ''}$${closed.finalPnL}`,
            'INFO'
          );
        } else if (closed.exitReason === 'TRAILING_STOP_TRIGGER') {
          this.log(
            `🛡️ TRAILING STOP HIT: ${closed.symbol} ${closed.side}! Scalp Profit Locked: +$${closed.finalPnL}`,
            'SUCCESS'
          );
        } else if (closed.exitReason === 'BREAKEVEN_STOP_TRIGGER') {
          this.log(
            `🔒 BREAK-EVEN EXIT: ${closed.symbol} ${closed.side}. $0 Loss guaranteed.`,
            'INFO'
          );
        } else if (closed.exitReason === 'SIGNAL_REVERSAL_EXIT') {
          this.log(
            `⚡ REVERSAL CUT: ${closed.symbol} ${closed.side}. Closed early. PnL: ${closed.finalPnL >= 0 ? '+' : ''}$${closed.finalPnL}`,
            closed.finalPnL >= 0 ? 'SUCCESS' : 'WARN'
          );
        } else if (closed.exitReason === 'MOMENTUM_EXHAUSTION_EXIT') {
          this.log(
            `✨ MOMENTUM PEAK EXIT: ${closed.symbol} ${closed.side}. Banked +$${closed.finalPnL}`,
            'SUCCESS'
          );
        } else if (closed.exitReason === 'STOP_LOSS_TRIGGER') {
          this.log(
            `🛡️ SCALP STOP HIT: ${closed.symbol} ${closed.side}. Loss capped at -$${Math.abs(closed.finalPnL)}`,
            'WARN'
          );
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
    return {
      portfolio: this.tradingEngine.getPortfolioState(),
      riskSettings: this.riskManager.getSettings(),
      isAutoTradingEnabled: this.isAutoTradingEnabled,
      isScanning: this.isScanning,
      marketScan: this.latestScanResults,
      logs: this.agentLogs,
      serverTime: new Date().toISOString()
    };
  }
}

export const agentLoop = new AutonomousAgentLoop();
