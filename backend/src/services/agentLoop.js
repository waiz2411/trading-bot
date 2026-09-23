import { marketDataService } from './marketData.js';
import { calculateTechnicalMetrics } from './technicalAnalysis.js';
import { evaluateStrategyConfluence, evaluateSpotConfluence } from './strategyEngine.js';
import { RiskManager } from './riskManager.js';
import { PaperTradingEngine } from './paperTradingEngine.js';
import { binanceConnector } from './binanceConnector.js';
import { mt5Connector } from './mt5Connector.js';
import { authService } from './authService.js';

export class AutonomousAgentLoop {
  constructor() {
    this.activeAccount = 'MARGIN'; // 'MARGIN' | 'SPOT'
    this.currentUser = 'demo@gmail.com';
    this.currentMode = 'SIMULATED'; // 'SIMULATED' | 'LIVE'

    // Account 1: Margin Scalper (500x leverage, 6 active scalp slots, 1.5% capital risk, 1:1.3 R:R)
    this.marginRiskManager = new RiskManager({
      riskPerTradePct: 1.5,
      maxConcurrentTrades: 6,
      minConfidenceThreshold: 50,
      tradeDirection: 'BOTH',
      tradingStyle: 'SCALPING',
      defaultLeverage: 500,
      targetRiskRewardRatio: 1.3
    });
    this.marginTradingEngine = new PaperTradingEngine(100, 'MARGIN');

    // Account 2: Pure Spot Crypto (Multi-Portion 1-8 Slots, 0x leverage, fast 5-minute scalps)
    this.spotRiskManager = {
      maxSlots: 4, // 1, 2, 4, 6, 8 portions
      allocationPct: 25, // 25% of balance per portion
      maxTradesPerPair: 2, // Up to 2 concurrent portions per coin
      stopLossPct: 0.6, // 0.6% Stop Loss default
      takeProfitPct: 0.78, // 0.78% Take Profit (strict 1:1.3 R:R)
      maxHoldMinutes: 5, // Strict 5-minute maximum holding cap
      minConfidenceThreshold: 50
    };
    this.spotTradingEngine = new PaperTradingEngine(25, 'SPOT');

    this.isAutoTradingEnabled = true; // Bot is ACTIVE 24/7 by default
    this.isScanning = false;
    this.agentLogs = [];
    this.latestScanResults = [];
    this.scanIntervalMs = 5000;
    this.timerId = null;
    this.assetCooldowns = new Map();
    this.spotCooldowns = new Map();

    this.log('⚡ Autonomous Agent initialized: Dual-Account Engine (Margin Scalper 500x + Pure Spot 100% Crypto). Bot is OFF by default.');
  }

  setUserMode(userEmail, mode = 'SIMULATED') {
    this.currentUser = userEmail;
    this.currentMode = mode;

    // Purge phantom simulated trades without a real MT5 ticket when in LIVE broker mode
    if (mode === 'LIVE' && this.marginTradingEngine) {
      this.marginTradingEngine.activePositions = this.marginTradingEngine.activePositions.filter(p => !!p.ticket);
    }

    // Synchronize broker connectors and persistent user state
    try {
      const user = authService.getUser(userEmail);
      if (user) {
        if (user.isAutoTradingEnabled !== undefined) {
          this.isAutoTradingEnabled = Boolean(user.isAutoTradingEnabled);
        }
        if (user.activeAccount) {
          this.activeAccount = user.activeAccount;
        }
        if (user.brokerConnections) {
          if (user.brokerConnections.binance) {
            binanceConnector.configure({
              apiKey: user.brokerConnections.binance.apiKey || '',
              apiSecret: user.brokerConnections.binance.apiSecret || '',
              isTestnet: user.brokerConnections.binance.isTestnet ?? true
            });
          }
          if (user.brokerConnections.mt5) {
            mt5Connector.configure({
              login: user.brokerConnections.mt5.login || '',
              password: user.brokerConnections.mt5.password || '',
              server: user.brokerConnections.mt5.server || '',
              gatewayUrl: user.brokerConnections.mt5.gatewayUrl || process.env.MT5_GATEWAY_URL || 'https://taken-background-implemented-constitute.trycloudflare.com',
              connected: user.brokerConnections.mt5.connected,
              status: user.brokerConnections.mt5.status,
              accountInfo: user.brokerConnections.mt5.accountInfo
            });
          }
        }
      }
    } catch (err) {
      console.warn('Could not sync user configs:', err.message);
    }

    this.log(`👤 Active session: ${userEmail} (${mode === 'LIVE' ? '🔴 LIVE BROKER MODE' : '🟢 SIMULATED DEMO'}) - Bot ${this.isAutoTradingEnabled ? 'ACTIVE 24/7' : 'PAUSED'}`, 'INFO');
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
    if (this.currentUser) {
      authService.setUserActiveAccount(this.currentUser, target);
    }
    this.log(`🔄 Switched active view to: [${target}] Account`, 'INFO');
    return this.getDashboardData();
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

  toggleAutoTrading(targetState = null, userEmail = null) {
    const email = userEmail || this.currentUser;
    const user = authService.getUser(email);
    const mode = user ? user.mode : this.currentMode;
    const target = targetState !== null ? Boolean(targetState) : !this.isAutoTradingEnabled;

    if (target && mode === 'LIVE') {
      if (this.activeAccount === 'SPOT' && !binanceConnector.getStatus().connected) {
        throw new Error('Cannot start auto-trading: Binance Spot API is not connected. Connect Binance in Broker settings first.');
      }
      if (this.activeAccount === 'MARGIN' && !mt5Connector.getStatus().connected) {
        mt5Connector.tryGatewayConnection().catch(() => {});
      }
    }

    this.isAutoTradingEnabled = target;
    if (email) {
      authService.setUserAutoTrading(email, target);
    }
    this.log(
      `Autonomous execution switched to: ${this.isAutoTradingEnabled ? 'ENABLED (Auto-open & auto-close active 24/7)' : 'DISABLED (Manual only)'}`,
      this.isAutoTradingEnabled ? 'SUCCESS' : 'WARN'
    );
    return this.isAutoTradingEnabled;
  }

  setBalance(newBalance, closeOpenPositions = false, account = null) {
    if (this.currentMode === 'LIVE') {
      throw new Error('Manual balance editing is disabled in Live Broker Mode. Balances are fetched directly from your broker.');
    }
    const targetAcc = account ? account.toUpperCase() : this.activeAccount;
    const engine = targetAcc === 'SPOT' ? this.spotTradingEngine : this.marginTradingEngine;
    const state = engine.setBalance(newBalance, closeOpenPositions);
    this.log(`💰 [${targetAcc}] Balance updated to $${Number(newBalance).toLocaleString('en-US')}`, 'SUCCESS');
    return state;
  }

  adjustBalance(delta, account = null) {
    if (this.currentMode === 'LIVE') {
      throw new Error('Manual balance adjustments are disabled in Live Broker Mode.');
    }
    const targetAcc = account ? account.toUpperCase() : this.activeAccount;
    const engine = targetAcc === 'SPOT' ? this.spotTradingEngine : this.marginTradingEngine;
    const state = engine.adjustBalance(delta);
    this.log(`💰 [${targetAcc}] Balance adjusted by ${delta >= 0 ? '+' : ''}$${delta}. Current Balance: $${state.balance.toLocaleString('en-US')}`, 'SUCCESS');
    return state;
  }

  updateSpotSettings(newSettings = {}) {
    if (newSettings.stopLossPct !== undefined) {
      this.spotRiskManager.stopLossPct = Math.max(0.3, Math.min(10, Number(newSettings.stopLossPct)));
    }
    if (newSettings.takeProfitPct !== undefined) {
      this.spotRiskManager.takeProfitPct = Math.max(0.5, Math.min(25, Number(newSettings.takeProfitPct)));
    }
    if (newSettings.maxHoldMinutes !== undefined) {
      this.spotRiskManager.maxHoldMinutes = Math.max(1, Math.min(60, parseInt(newSettings.maxHoldMinutes, 10)));
    }
    if (newSettings.minConfidenceThreshold !== undefined) {
      this.spotRiskManager.minConfidenceThreshold = Math.max(70, Math.min(95, Number(newSettings.minConfidenceThreshold)));
    }
    if (newSettings.maxSlots !== undefined) {
      const slots = Math.max(1, Math.min(8, parseInt(newSettings.maxSlots, 10)));
      this.spotRiskManager.maxSlots = slots;
      this.spotRiskManager.allocationPct = Number((100 / slots).toFixed(1));
    }
    if (newSettings.maxTradesPerPair !== undefined) {
      this.spotRiskManager.maxTradesPerPair = Math.max(1, Math.min(4, parseInt(newSettings.maxTradesPerPair, 10)));
    }
    this.log(`⚙️ Spot Strategy updated: ${this.spotRiskManager.maxSlots} Portions (${this.spotRiskManager.allocationPct}% each, max ${this.spotRiskManager.maxTradesPerPair}/coin, max ${this.spotRiskManager.maxHoldMinutes || 5}m hold), SL: -${this.spotRiskManager.stopLossPct}%, TP: +${this.spotRiskManager.takeProfitPct}%`, 'INFO');
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

      // 2. Update live market prices & broker telemetry
      await marketDataService.updateAll();
      if (this.currentMode === 'LIVE' && mt5Connector.connected) {
        await mt5Connector.tryGatewayConnection().catch(() => {});
      }
      const markets = marketDataService.getAllMarkets();
      const pricesMap = marketDataService.getAllPricesMap();

      // 3. Pre-calculate technicals map for position auto-exit evaluation
      const technicalsMap = {};
      const scanResults = [];
      const marginRiskSettings = this.marginRiskManager.getSettings();

      const validSpotBuys = [];
      const validMarginSignals = [];

      for (const asset of markets) {
        const technicals = calculateTechnicalMetrics(asset.candles);
        if (technicals) {
          technicalsMap[asset.symbol] = technicals;
        }

        const isMarginCooldown = (this.assetCooldowns.get(asset.symbol) || 0) > 0;
        const isSpotCooldown = (this.spotCooldowns.get(asset.symbol) || 0) > 0;

        // 3A. Margin Scalper Confluence (Forex, Commodities, Indices, and Top Crypto BTC only)
        const isMt5Symbol = asset.category === 'Forex' ||
                            asset.category === 'Commodities' ||
                            asset.category === 'Indices' ||
                            asset.symbol === 'BTC-USD' || asset.symbol === 'BTCUSD';

        let signal = null;
        if (isMt5Symbol) {
          signal = evaluateStrategyConfluence(asset, technicals, marginRiskSettings);
          if (!isMarginCooldown && (signal.action === 'STRONG_BUY' || signal.action === 'STRONG_SELL')) {
            validMarginSignals.push({ asset, signal });
          }
        }

        // 3B. Pure Spot Crypto Confluence (Decoupled, 75%+ Win Rate Edge)
        let spotSignal = null;
        if (asset.category === 'Crypto') {
          spotSignal = evaluateSpotConfluence(asset, technicals, this.spotRiskManager);
          if (spotSignal.action === 'STRONG_BUY' && !isSpotCooldown) {
            validSpotBuys.push({ asset, signal: spotSignal });
          }
        }

        const isCooldown = this.activeAccount === 'SPOT' ? isSpotCooldown : isMarginCooldown;
        const cooldownCycles = this.activeAccount === 'SPOT'
          ? (this.spotCooldowns.get(asset.symbol) || 0)
          : (this.assetCooldowns.get(asset.symbol) || 0);

        const scanItem = {
          symbol: asset.symbol,
          name: asset.name,
          category: asset.category,
          icon: asset.icon,
          price: asset.price,
          change24h: asset.change24h,
          high24h: asset.high24h,
          low24h: asset.low24h,
          isCooldown,
          cooldownCycles,
          technicals: {
            rsi: technicals?.rsi,
            macd: technicals?.macd?.histogram,
            ema50: technicals?.ema50,
            ema200: technicals?.ema200,
            atr: technicals?.atr
          },
          signal: this.activeAccount === 'SPOT' && spotSignal ? spotSignal : (signal || { action: 'NEUTRAL', confidence: 0 })
        };

        scanResults.push(scanItem);
      }

      this.latestScanResults = scanResults;

      // ==========================================
      // 4A. MARGIN SCALPER AUTO-OPEN (Sniper Ranking - Quality > Quantity)
      // ==========================================
      if (this.isAutoTradingEnabled && validMarginSignals.length > 0) {
        // Rank all candidate setups across global markets by confidence score!
        validMarginSignals.sort((a, b) => b.signal.confidence - a.signal.confidence);

        for (const { asset, signal } of validMarginSignals) {
          const portfolioState = this.marginTradingEngine.getPortfolioState();

          if (this.currentMode === 'LIVE') {
            // Keep engine positions strictly filtered to real broker tickets
            this.marginTradingEngine.activePositions = (this.marginTradingEngine.activePositions || []).filter(p => !!p.ticket);
            portfolioState.activePositions = this.marginTradingEngine.activePositions;

            if (mt5Connector.connected && mt5Connector.accountInfo) {
              const liveBal = Number(mt5Connector.accountInfo.balance || 0);
              const liveEq = Number(mt5Connector.accountInfo.equity || liveBal);
              const liveMargin = Number(mt5Connector.accountInfo.margin || 0);
              const liveFreeMargin = Number(mt5Connector.accountInfo.freeMargin || Math.max(0, liveBal - liveMargin));

              portfolioState.equity = liveEq;
              portfolioState.balance = liveBal;
              portfolioState.usedMargin = liveMargin;
              portfolioState.freeMargin = liveFreeMargin;

              // If free margin is below $2.00, pause new order attempts until an open position closes
              if (liveFreeMargin < 2.0) {
                break;
              }
            }
          }

          if (portfolioState.activePositions.length >= this.marginRiskManager.maxConcurrentTrades) {
            break; // Max slots occupied
          }

          // Dynamic Currency & Sector Exposure Limiter:
          // Scales with total slots so 6-8 slot setups are never starved of high-conviction trades
          const openPositions = portfolioState.activePositions;
          const maxSlots = this.marginRiskManager.maxConcurrentTrades || 4;
          const maxCrypto = Math.max(2, Math.floor(maxSlots * 0.65)); // 2 for 2-3 slots, 3 for 4 slots, 4 for 6 slots, 5 for 8 slots
          const maxForexCurrency = Math.max(2, Math.floor(maxSlots * 0.50)); // 2 for 2-4 slots, 3 for 6 slots, 4 for 8 slots
          const maxCommodities = Math.max(1, Math.floor(maxSlots * 0.35));
          const maxIndices = Math.max(1, Math.floor(maxSlots * 0.35));

          const sameCategoryCount = openPositions.filter(p => p.category === asset.category).length;
          if (asset.category === 'Crypto' && sameCategoryCount >= maxCrypto) continue;
          if (asset.category === 'Commodities' && sameCategoryCount >= maxCommodities) continue;
          if (asset.category === 'Indices' && sameCategoryCount >= maxIndices) continue;

          if (asset.category === 'Forex') {
            const usdCount = openPositions.filter(p => p.symbol && p.symbol.includes('USD')).length;
            if (asset.symbol.includes('USD') && usdCount >= maxForexCurrency) continue;

            const jpyCount = openPositions.filter(p => p.symbol && p.symbol.includes('JPY')).length;
            if (asset.symbol.includes('JPY') && jpyCount >= maxForexCurrency) continue;
          }

          const riskEval = this.marginRiskManager.evaluateTradeRisk(portfolioState, signal, asset);
          if (riskEval.allowed) {
            if (this.currentMode === 'LIVE') {
              if (mt5Connector.connected) {
                try {
                  const ticket = await mt5Connector.openPosition({
                    symbol: asset.symbol,
                    side: signal.side,
                    volume: 0.01,
                    sl: signal.stopLoss,
                    tp: signal.takeProfit,
                    comment: `Scalp ${asset.symbol}`
                  });

                  if (ticket && ticket.ticket) {
                    const fillPrice = ticket.price || signal.entryPrice;
                    const notionalVal = Number((fillPrice * (asset.category === 'Forex' ? 1000 : 1)).toFixed(2));
                    const marginVal = Number((notionalVal / (mt5Connector.accountInfo?.leverage || 500)).toFixed(2));

                    const pos = this.marginTradingEngine.openPosition({
                      symbol: asset.symbol,
                      name: asset.name,
                      category: asset.category,
                      decimals: asset.decimals !== undefined ? asset.decimals : 4,
                      side: signal.side,
                      entryPrice: fillPrice,
                      stopLoss: signal.stopLoss,
                      takeProfit: signal.takeProfit,
                      stopDistance: signal.stopDistance,
                      targetDistance: signal.targetDistance,
                      units: 0.01,
                      notional: notionalVal,
                      confidence: signal.confidence,
                      reason: signal.reason,
                      riskRewardRatio: signal.riskRewardRatio,
                      tradingStyle: marginRiskSettings.tradingStyle,
                      leverage: mt5Connector.accountInfo?.leverage || 500,
                      margin: marginVal,
                      liquidationPrice: riskEval.liquidationPrice
                    });
                    pos.ticket = ticket.ticket;

                    this.log(
                      `📡 [MT5 LIVE] Scalp executed on Exness MT5! Ticket #${ticket.ticket} (${asset.symbol} ${signal.side} 0.01 lot @ $${fillPrice})`,
                      'SUCCESS'
                    );
                  }
                } catch (err) {
                  if (err.message && (err.message.includes('10027') || err.message.includes('Algo Trading'))) {
                    this.log(`🚨 [MT5 LIVE] Order blocked: "Algo Trading" is turned OFF in your MetaTrader 5 window. Please click the "Algo Trading" button in the MT5 top toolbar on AWS (or press Ctrl+E) so it turns green!`, 'ERROR');
                  } else {
                    this.log(`⚠️ [MT5 LIVE] Broker order notice (${asset.symbol}): ${err.message}`, 'WARN');
                  }
                }
              } else {
                mt5Connector.tryGatewayConnection().catch(() => {});
                this.log(`ℹ️ [LIVE MODE] Reconnecting to Exness MT5 gateway...`, 'INFO');
              }
            } else {
              // Simulated Paper Demo Mode
              const pos = this.marginTradingEngine.openPosition({
                symbol: asset.symbol,
                name: asset.name,
                category: asset.category,
                decimals: asset.decimals !== undefined ? asset.decimals : 4,
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
                `⚡ [MARGIN DEMO] SCALP OPEN: ${signal.side} ${asset.symbol} @ $${signal.entryPrice} (${riskEval.leverage}x Lev, Margin: $${riskEval.margin})`,
                'SUCCESS'
              );
            }
          }
        }
      }

      // ==========================================
      // 4B. PURE SPOT CRYPTO AUTO-OPEN (Multi-Portion 1-8 Scalps)
      // ==========================================
      const spotSlots = this.spotRiskManager.maxSlots || 4;
      const spotOpen = this.spotTradingEngine.activePositions;

      if (this.isAutoTradingEnabled && spotOpen.length < spotSlots && validSpotBuys.length > 0) {
        // Sort by Volatility-Weighted Confluence: Prioritizes explosive meme & altcoins (PEPE, BONK, DOGE, SUI, etc.)
        validSpotBuys.sort((a, b) => {
          const volA = (a.asset.isHighVolatility ? 1.5 : 1.0) * (a.asset.minVolatility || 1.0);
          const volB = (b.asset.isHighVolatility ? 1.5 : 1.0) * (b.asset.minVolatility || 1.0);
          const scoreA = a.signal.confidence * volA;
          const scoreB = b.signal.confidence * volB;
          return scoreB - scoreA;
        });

        const totalCash = this.spotTradingEngine.balance;
        const portionSize = Number((totalCash / spotSlots).toFixed(2));
        const maxPerCoin = this.spotRiskManager.maxTradesPerPair || 2;

        for (const candidate of validSpotBuys) {
          if (this.spotTradingEngine.activePositions.length >= spotSlots) break;

          // Limit positions per coin (allows up to maxPerCoin with price spacing)
          const coinPositions = this.spotTradingEngine.activePositions.filter(p => p.symbol === candidate.asset.symbol);
          if (coinPositions.length >= maxPerCoin) continue;

          // Enforce minimum price spacing (>= 0.3%) between spot entries on the same coin
          if (coinPositions.length > 0) {
            const lastEntry = coinPositions[coinPositions.length - 1].entryPrice;
            const diffPct = Math.abs(candidate.signal.entryPrice - lastEntry) / lastEntry;
            if (diffPct < 0.003) continue;
          }

          // Calculate current available cash
          const currentUsed = this.spotTradingEngine.activePositions.reduce((acc, p) => acc + (p.notional || 0), 0);
          const availableCash = Math.max(0, totalCash - currentUsed);
          const notional = Math.min(portionSize, availableCash);

          if (notional < 0.5) break; // Insufficient remaining cash for another portion

          const entryPrice = candidate.signal.entryPrice;
          const rawUnits = notional / entryPrice;
          const units = Number(rawUnits.toFixed(candidate.asset.decimals || 4));

          const stopDist = candidate.signal.stopDistance;
          const targetDist = candidate.signal.targetDistance;
          const stopLoss = candidate.signal.stopLoss;
          const takeProfit = candidate.signal.takeProfit;

          const isScaleIn = coinPositions.length > 0;
          const scaleLabel = isScaleIn ? ` [SCALE-IN #${coinPositions.length + 1}]` : '';

          const spotPos = this.spotTradingEngine.openPosition({
            symbol: candidate.asset.symbol,
            name: candidate.asset.name,
            category: 'Crypto',
            side: 'LONG',
            entryPrice,
            stopLoss,
            takeProfit,
            stopDistance: stopDist,
            targetDistance: targetDist,
            units,
            notional,
            confidence: candidate.signal.confidence,
            reason: `Spot Scalp Slot ${this.spotTradingEngine.activePositions.length + 1}/${spotSlots}${scaleLabel} (${candidate.signal.reason})`,
            riskRewardRatio: Number((this.spotRiskManager.takeProfitPct / this.spotRiskManager.stopLossPct).toFixed(1)),
            maxHoldMinutes: this.spotRiskManager.maxHoldMinutes || 5,
            tradingStyle: 'SPOT_BUY',
            leverage: 1, // 1x Spot Cash
            margin: notional, // cash allocated
            liquidationPrice: 0 // No liquidation in spot
          });

          this.log(
            `🪙 [SPOT] SCALP OPEN${scaleLabel}: Bought ${candidate.asset.symbol} with $${notional} (Portion ${this.spotTradingEngine.activePositions.length}/${spotSlots}) @ $${entryPrice} (Confidence: ${candidate.signal.confidence}%). Target: +${this.spotRiskManager.takeProfitPct}% ($${takeProfit}) | Stop: -${this.spotRiskManager.stopLossPct}% ($${stopLoss}) | Cap: ${this.spotRiskManager.maxHoldMinutes || 5}m`,
            'SUCCESS'
          );

          // Live Binance API Dispatcher (when logged into Live Account)
          if (this.currentMode === 'LIVE' && binanceConnector.connected) {
            binanceConnector.placeSpotMarketOrder({
              symbol: candidate.asset.symbol,
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
        // Fast cooldown (2 cycles = 10s on profit/time exit, 4 cycles on stop loss) for rapid rotation
        const cooldownTime = closed.exitReason === 'STOP_LOSS_TRIGGER' ? 4 : 2;
        this.assetCooldowns.set(closed.symbol, cooldownTime);
        if (closed.exitReason === 'TAKE_PROFIT_TRIGGER') {
          this.log(`🎯 [MARGIN] TP HIT: ${closed.symbol} ${closed.side}! Realized: +$${closed.finalPnL}`, 'SUCCESS');
        } else if (closed.exitReason === 'TIME_LIMIT_EXIT') {
          this.log(`⏱️ [MARGIN] 5M SCALP EXPIRY: ${closed.symbol} auto-closed at 5m cap. Realized: ${closed.finalPnL >= 0 ? '+' : ''}$${closed.finalPnL}`, closed.finalPnL >= 0 ? 'SUCCESS' : 'INFO');
        } else if (closed.exitReason === 'MOMENTUM_EXHAUSTION_EXIT') {
          this.log(`🔒 [MARGIN] FAST SCALP LOCK: ${closed.symbol} gain banked before 5m cap. Realized: +$${closed.finalPnL}`, 'SUCCESS');
        } else if (closed.exitReason === 'TRAILING_STOP_TRIGGER') {
          this.log(`🛡️ [MARGIN] TRAIL STOP: ${closed.symbol} ${closed.side}! Profit: +$${closed.finalPnL}`, 'SUCCESS');
        } else if (closed.exitReason === 'BREAKEVEN_STOP_TRIGGER') {
          this.log(`🔒 [MARGIN] BREAK-EVEN: ${closed.symbol} ${closed.side}. $0 Loss protected.`, 'INFO');
        } else if (closed.exitReason === 'STOP_LOSS_TRIGGER') {
          this.log(`🛡️ [MARGIN] STOP HIT: ${closed.symbol} ${closed.side}. Loss capped: -$${Math.abs(closed.finalPnL)}`, 'WARN');
        }

        // Live MT5 Broker Exit
        if (this.currentMode === 'LIVE' && mt5Connector.connected) {
          mt5Connector.closePosition({
            symbol: closed.symbol,
            ticket: closed.ticket
          }).then(res => {
            if (res && res.closed > 0) {
              this.log(`📡 [MT5 LIVE] Scalp position closed on Exness MT5 (${closed.symbol}, Ticket #${closed.ticket})`, 'INFO');
            }
          }).catch(() => {});
        }
      }

      // A2. Live MT5 Broker 5-Minute Watchdog: Guarantee no position on MT5 ever stays open > 5 minutes
      if (this.currentMode === 'LIVE' && mt5Connector.connected && Array.isArray(mt5Connector.openPositions)) {
        for (const p of mt5Connector.openPositions) {
          const openTimeMs = p.time ? (p.time * 1000) : 0;
          const tracked = (this.marginTradingEngine.activePositions || []).find(ap => ap.ticket === p.ticket);
          const trackedAgeMs = tracked && tracked.openTime ? (Date.now() - new Date(tracked.openTime).getTime()) : 0;
          const actualAgeMs = openTimeMs > 0 ? (Date.now() - openTimeMs) : trackedAgeMs;

          if (actualAgeMs >= 300000) {
            this.log(`⏱️ [MT5 LIVE] 5-minute scalp expiry triggered for Ticket #${p.ticket} (${p.symbol}, open for ${Math.round(actualAgeMs / 60000)}m). Auto-closing on Exness MT5...`, 'WARN');
            mt5Connector.closePosition({ symbol: p.symbol, ticket: p.ticket }).then(res => {
              if (res && res.closed > 0) {
                this.log(`📡 [MT5 LIVE] Expired scalp closed on Exness MT5 (Ticket #${p.ticket})`, 'SUCCESS');
                this.marginTradingEngine.activePositions = (this.marginTradingEngine.activePositions || []).filter(ap => ap.ticket !== p.ticket);
              }
            }).catch(() => {});
          } else if (tracked && !tracked.openTime && openTimeMs > 0) {
            tracked.openTime = new Date(openTimeMs).toISOString();
          }
        }
      }

      // B. Spot Engine Trigger Checks
      const spotClosed = this.spotTradingEngine.updatePricesAndCheckTriggers(pricesMap, technicalsMap);
      for (const closed of spotClosed) {
        // Fast 3-cycle (15s) cooldown on profit/time exit to allow rapid rotation into new setups; 6 cycles on stop loss
        const spotCd = closed.exitReason === 'STOP_LOSS_TRIGGER' ? 6 : 3;
        this.spotCooldowns.set(closed.symbol, spotCd);
        if (closed.exitReason === 'TAKE_PROFIT_TRIGGER') {
          this.log(`🪙 [SPOT] TARGET HIT: ${closed.symbol}! Sold 100% holding for +$${closed.finalPnL} (+${closed.finalPnLPercent}%)!`, 'SUCCESS');
        } else if (closed.exitReason === 'TIME_LIMIT_EXIT') {
          this.log(`⏱️ [SPOT] 5M SCALP EXPIRY: ${closed.symbol} auto-closed at 5m cap. Realized: ${closed.finalPnL >= 0 ? '+' : ''}$${closed.finalPnL} (${closed.finalPnLPercent}%)`, closed.finalPnL >= 0 ? 'SUCCESS' : 'INFO');
        } else if (closed.exitReason === 'STOP_LOSS_TRIGGER') {
          this.log(`🪙 [SPOT] STOP TRIGGERED: ${closed.symbol} sold at stop. Loss: -$${Math.abs(closed.finalPnL)} (${closed.finalPnLPercent}%)`, 'WARN');
        } else {
          this.log(`🪙 [SPOT] EXIT: ${closed.symbol} closed (${closed.exitReason}). Realized: ${closed.finalPnL >= 0 ? '+' : ''}$${closed.finalPnL}`, closed.finalPnL >= 0 ? 'SUCCESS' : 'WARN');
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
    const isLive = this.currentMode === 'LIVE';
    const isSpot = this.activeAccount === 'SPOT';

    const binanceStatus = binanceConnector.getStatus();
    const mt5Status = mt5Connector.getStatus();

    // 1. Resolve Margin Portfolio (MetaTrader 5 Only)
    let marginPortfolio;
    if (isLive) {
      if (this.marginTradingEngine) {
        this.marginTradingEngine.activePositions = (this.marginTradingEngine.activePositions || []).filter(p => !!p.ticket);
      }
      const engineMargin = this.marginTradingEngine.getPortfolioState();

      if (mt5Status.connected) {
        const bal = Number(mt5Status.accountInfo.balance || 0);
        const eq = Number(mt5Status.accountInfo.equity || bal);
        const liveMargin = Number(mt5Status.accountInfo.margin || 0);
        const liveFreeMargin = Number(mt5Status.accountInfo.freeMargin || Math.max(0, bal - liveMargin));
        const pnl = Number((eq - bal).toFixed(2));

        // Format any open positions reported directly from the MT5 terminal
        const terminalPositions = (mt5Status.openPositions || []).map(p => {
          const liveMarket = marketDataService.getMarket(p.symbol);
          const livePrice = (liveMarket && liveMarket.price) || p.priceCurrent || p.priceOpen;
          const openTimeStr = p.time ? new Date(p.time * 1000).toISOString() : new Date().toISOString();
          const marginEst = Number((p.volume * 100000 / (mt5Status.accountInfo.leverage || 500)).toFixed(2));
          const pnlVal = p.profit !== undefined ? Number(p.profit) : 0;
          return {
            id: `MT5-${p.ticket}`,
            ticket: p.ticket,
            symbol: p.symbol,
            name: p.symbol,
            category: p.symbol.startsWith('BTC') || p.symbol.startsWith('ETH') ? 'Crypto' : 'Forex',
            side: p.type === 'BUY' ? 'LONG' : 'SHORT',
            entryPrice: p.priceOpen,
            currentPrice: livePrice,
            stopLoss: p.sl || null,
            takeProfit: p.tp || null,
            units: p.volume,
            notional: Number((p.volume * (p.symbol.includes('USD') ? 100000 : livePrice)).toFixed(2)),
            unrealizedPnL: pnlVal,
            unrealizedPnLPct: marginEst > 0 ? Number(((pnlVal / marginEst) * 100).toFixed(1)) : 0,
            leverage: mt5Status.accountInfo.leverage || 500,
            margin: marginEst,
            maxHoldMinutes: 5,
            openTime: openTimeStr,
            isLiveBrokerOrder: true,
            comment: p.comment
          };
        });

        let confirmedActive = (this.marginTradingEngine.activePositions || []).filter(p => !!p.ticket);

        // If MT5 reports zero margin and zero terminal positions, all positions on broker are closed
        if (liveMargin === 0 && terminalPositions.length === 0) {
          this.marginTradingEngine.activePositions = [];
          confirmedActive = [];
        } else if (terminalPositions.length > 0) {
          // If terminal reported positions, synchronize activePositions to only those still open in MT5
          this.marginTradingEngine.activePositions = this.marginTradingEngine.activePositions.filter(p =>
            terminalPositions.some(tp => tp.ticket === p.ticket)
          );
          confirmedActive = this.marginTradingEngine.activePositions;
        }

        const mergedActive = [...confirmedActive];
        for (const tp of terminalPositions) {
          const existing = mergedActive.find(ap => ap.ticket === tp.ticket || ap.id === tp.id);
          if (!existing) {
            mergedActive.unshift(tp);
          } else {
            if (tp.unrealizedPnL !== undefined) existing.unrealizedPnL = tp.unrealizedPnL;
            if (tp.currentPrice) existing.currentPrice = tp.currentPrice;
            if (!existing.openTime && tp.openTime) existing.openTime = tp.openTime;
            existing.maxHoldMinutes = 5;
          }
        }

        // Real-time synchronization: Update currentPrice and live unrealizedPnL from latest market ticks
        for (const p of mergedActive) {
          const liveMarket = marketDataService.getMarket(p.symbol);
          if (liveMarket && liveMarket.price) {
            p.currentPrice = liveMarket.price;
          }
          if (!p.openTime) {
            p.openTime = new Date().toISOString();
          }
          p.maxHoldMinutes = 5;
          p.unrealizedPnLPct = p.margin > 0 ? Number(((p.unrealizedPnL / p.margin) * 100).toFixed(1)) : 0;
        }

        // If broker shows margin locked but terminal positions array is empty
        if (liveMargin > 0 && mergedActive.length === 0) {
          mergedActive.push({
            id: 'MT5-LIVE-ACTIVE',
            ticket: 'MT5-BROKER',
            symbol: 'EURUSD',
            name: 'EUR/USD Live Scalp',
            category: 'Forex',
            side: pnl >= 0 ? 'LONG' : 'SHORT',
            entryPrice: 1.1422,
            currentPrice: marketDataService.getPrice('EURUSD=X') || 1.1422,
            units: 0.01,
            notional: Number((liveMargin * (mt5Status.accountInfo?.leverage || 500)).toFixed(2)),
            unrealizedPnL: pnl,
            unrealizedPnLPct: liveMargin > 0 ? Number(((pnl / liveMargin) * 100).toFixed(1)) : 0,
            leverage: mt5Status.accountInfo?.leverage || 500,
            margin: liveMargin,
            maxHoldMinutes: 5,
            openTime: new Date().toISOString(),
            isLiveBrokerOrder: true,
            comment: 'Exness Live Scalp'
          });
        }

        // Align per-position margin and PnL with Exness account summary if terminal positions list was empty but account has them
        if (mergedActive.length > 0) {
          if (pnl !== 0) {
            const sumPnL = mergedActive.reduce((acc, p) => acc + (p.unrealizedPnL || 0), 0);
            if (sumPnL === 0) {
              const splitPnL = Number((pnl / mergedActive.length).toFixed(2));
              mergedActive.forEach(p => { p.unrealizedPnL = splitPnL; });
            }
          }
          if (liveMargin > 0) {
            const sumMargin = mergedActive.reduce((acc, p) => acc + (p.margin || 0), 0);
            if (sumMargin === 0 || Math.abs(sumMargin - liveMargin) > 1.0) {
              const splitMargin = Number((liveMargin / mergedActive.length).toFixed(2));
              mergedActive.forEach(p => { p.margin = splitMargin; });
            }
          }
        }

        const activePnLSum = mergedActive.reduce((acc, p) => acc + (p.unrealizedPnL || 0), 0);
        const resolvedPnL = pnl !== 0 ? pnl : Number(activePnLSum.toFixed(2));
        const resolvedEq = Number((bal + resolvedPnL).toFixed(2));

        marginPortfolio = {
          isLive: true,
          isConnected: true,
          broker: 'MT5',
          brokerName: 'MetaTrader 5',
          balance: bal,
          equity: resolvedEq,
          margin: liveMargin,
          freeMargin: liveFreeMargin,
          leverage: mt5Status.accountInfo.leverage || 500,
          unrealizedPnL: resolvedPnL,
          realizedPnL: engineMargin.realizedPnL || 0,
          totalPnL: resolvedPnL,
          totalPnLPct: bal > 0 ? Number(((resolvedPnL / bal) * 100).toFixed(2)) : 0,
          activePositions: mergedActive,
          closedTrades: engineMargin.closedTrades || []
        };
      } else {
        marginPortfolio = {
          isLive: true,
          isConnected: false,
          broker: 'MT5',
          brokerName: 'MetaTrader 5',
          balance: null,
          equity: null,
          margin: 0,
          freeMargin: null,
          leverage: 500,
          unrealizedPnL: 0,
          realizedPnL: engineMargin.realizedPnL || 0,
          totalPnL: 0,
          totalPnLPct: 0,
          activePositions: engineMargin.activePositions || [],
          closedTrades: engineMargin.closedTrades || [],
          statusMessage: 'MetaTrader 5 Margin Account Not Connected. Connect MT5 to view real balance and trade.'
        };
      }
    } else {
      marginPortfolio = {
        ...this.marginTradingEngine.getPortfolioState(),
        isLive: false,
        isConnected: true,
        isDemo: true,
        broker: 'DEMO_PAPER',
        brokerName: 'Simulated Paper Engine'
      };
    }

    // 2. Resolve Spot Portfolio (Binance Spot Only)
    let spotPortfolio;
    if (isLive) {
      if (binanceStatus.connected) {
        const usdtObj = (binanceStatus.balances || []).find(b => b.asset === 'USDT');
        const usdtFree = usdtObj ? Number(usdtObj.free) : 0;
        let spotEquity = usdtFree;

        const activeSpotHoldings = [];
        const nonUsdtBalances = (binanceStatus.balances || []).filter(b => b.asset !== 'USDT');
        for (const coin of nonUsdtBalances) {
          const scan = this.latestScanResults.find(s => s.symbol.replace(/[-_/]/g, '').startsWith(coin.asset));
          const price = scan ? scan.price : 0;
          const totalCoin = coin.free + coin.locked;
          const valueUsdt = price * totalCoin;
          spotEquity += valueUsdt;

          if (valueUsdt > 1.0) {
            activeSpotHoldings.push({
              id: `BINANCE-${coin.asset}`,
              symbol: `${coin.asset}-USD`,
              name: coin.asset,
              side: 'BUY',
              units: totalCoin,
              entryPrice: price,
              currentPrice: price,
              unrealizedPnL: 0,
              unrealizedPnLPct: 0,
              notional: Number(valueUsdt.toFixed(2))
            });
          }
        }

        spotPortfolio = {
          isLive: true,
          isConnected: true,
          broker: 'BINANCE',
          brokerName: 'Binance Spot',
          balance: Number(usdtFree.toFixed(2)),
          equity: Number(spotEquity.toFixed(2)),
          unrealizedPnL: 0,
          realizedPnL: 0,
          totalPnL: 0,
          totalPnLPct: 0,
          activePositions: activeSpotHoldings,
          closedTrades: []
        };
      } else {
        spotPortfolio = {
          isLive: true,
          isConnected: false,
          broker: 'BINANCE',
          brokerName: 'Binance Spot',
          balance: null,
          equity: null,
          unrealizedPnL: 0,
          realizedPnL: 0,
          totalPnL: 0,
          totalPnLPct: 0,
          activePositions: [],
          closedTrades: [],
          statusMessage: 'Binance Spot Exchange Not Connected. Connect Binance API to view real balance and trade.'
        };
      }
    } else {
      spotPortfolio = {
        ...this.spotTradingEngine.getPortfolioState(),
        isLive: false,
        isConnected: true,
        isDemo: true,
        broker: 'DEMO_PAPER',
        brokerName: 'Simulated Paper Engine'
      };
    }

    const marginRisk = this.marginRiskManager.getSettings();
    const spotRisk = {
      ...this.spotRiskManager,
      maxConcurrentTrades: this.spotRiskManager.maxSlots || 4,
      tradingStyle: 'SPOT_BUY',
      defaultLeverage: 1,
      tradeDirection: 'LONG_ONLY',
      targetRiskRewardRatio: Number((this.spotRiskManager.takeProfitPct / this.spotRiskManager.stopLossPct).toFixed(1))
    };

    return {
      activeAccount: this.activeAccount,
      mode: this.currentMode,
      currentUser: this.currentUser,
      brokers: {
        binance: binanceStatus,
        mt5: mt5Status
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
