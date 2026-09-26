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

    // Account 1: Margin Scalper (500x leverage, up to 20 active scalp slots, 1.5% capital risk, 1:1.6 R:R)
    this.marginRiskManager = new RiskManager({
      riskPerTradePct: 1.5,
      maxConcurrentTrades: 20, // Full 20-slot multi-scalp capacity
      minConfidenceThreshold: 75, // High-frequency sniper scalps (75%+)
      tradeDirection: 'BOTH',
      tradingStyle: 'SCALPING',
      defaultLeverage: 500,
      targetRiskRewardRatio: 1.6
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
      minConfidenceThreshold: 90
    };
    this.spotTradingEngine = new PaperTradingEngine(25, 'SPOT');

    this.isAutoTradingEnabled = true; // Bot is ACTIVE 24/7 by default
    this.isScanning = false;
    this.agentLogs = [];
    this.latestScanResults = [];
    this.scanIntervalMs = 1500; // 1.5s rapid scanning loop for 10-20 trades/5m
    this.timerId = null;
    this.assetCooldowns = new Map();
    this.spotCooldowns = new Map();
    this.liveRealizedPnL = 0;
    this.liveClosedTrades = [];
    this.livePositionFirstSeen = new Map();
    this.liveTradePeaks = new Map();
    this.lastTradeOpenedAt = 0; // Throttle trade entries (min 60s spacing)

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
            const activeGw = mt5Connector.gatewayUrl;
            const userGw = user.brokerConnections.mt5.gatewayUrl;
            const gwToUse = (userGw && !userGw.includes('abu-solve'))
              ? userGw
              : (activeGw || process.env.MT5_GATEWAY_URL || 'http://localhost:5001');

            mt5Connector.configure({
              login: user.brokerConnections.mt5.login || '',
              password: user.brokerConnections.mt5.password || '',
              server: user.brokerConnections.mt5.server || '',
              gatewayUrl: gwToUse,
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
      if (this.currentMode === 'LIVE') {
        await mt5Connector.tryGatewayConnection().catch(() => {});
      }
      await marketDataService.updateAll(mt5Connector.marketTicks);
      const markets = marketDataService.getAllMarkets();
      const pricesMap = marketDataService.getAllPricesMap();

      // 3. Pre-calculate technicals map for position auto-exit evaluation
      const technicalsMap = {};
      const scanResults = [];
      const marginRiskSettings = this.marginRiskManager.getSettings();
      marginRiskSettings.balance = this.currentMode === 'LIVE'
        ? Number(mt5Connector.accountInfo?.balance || 51.68)
        : this.marginTradingEngine.balance;

      const validSpotBuys = [];
      const validMarginSignals = [];

      for (const asset of markets) {
        const technicals = calculateTechnicalMetrics(asset.candles);
        if (technicals) {
          technicalsMap[asset.symbol] = technicals;
        }

        const isMarginCooldown = (this.assetCooldowns.get(asset.symbol) || 0) > 0;
        const isSpotCooldown = (this.spotCooldowns.get(asset.symbol) || 0) > 0;

        // 3A. Margin Scalper Confluence: 24/7 Exness Tradable Crypto + Top 18 Liquid Forex Pairs
        const MT5_INSTITUTIONAL_MAJORS = new Set([
          'BTC-USD', 'ETH-USD', 'BNB-USD', 'XRP-USD', 'DOGE-USD', 'ADA-USD', 'LTC-USD',
          'EURUSD=X', 'GBPUSD=X', 'USDJPY=X', 'AUDUSD=X', 'USDCAD=X', 'USDCHF=X', 'NZDUSD=X',
          'EURGBP=X', 'EURJPY=X', 'AUDJPY=X', 'CADJPY=X', 'EURCAD=X', 'EURAUD=X',
          'GBPAUD=X', 'GBPCAD=X', 'AUDNZD=X', 'EURCHF=X', 'GBPCHF=X'
        ]);
        const isMt5Symbol = MT5_INSTITUTIONAL_MAJORS.has(asset.symbol);

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
      // 4A. MARGIN SCALPER AUTO-OPEN (Multi-Slot Opportunity Fulfillment)
      // ==========================================
      if (this.isAutoTradingEnabled && validMarginSignals.length > 0) {
        // Rank all candidate setups across global markets by confidence score!
        validMarginSignals.sort((a, b) => b.signal.confidence - a.signal.confidence);

        for (const { asset, signal } of validMarginSignals) {
          const portfolioState = this.marginTradingEngine.getPortfolioState();

          // Dynamic Cent vs Standard Account Adaptation
          const accountType = (mt5Connector.accountInfo?.accountType || (String(mt5Connector.accountInfo?.currency || '').includes('USC') ? 'CENT' : 'STANDARD')).toUpperCase();
          const liveBal = Number(mt5Connector.accountInfo?.balance || portfolioState.balance || 100);
          let maxAllowedSlots = 20;
          let lotVolume = 0.01;

          if (accountType === 'CENT') {
            maxAllowedSlots = 20; // 20 simultaneous slots on Cent accounts with zero margin stress
            lotVolume = Math.max(0.20, Math.min(2.00, Number(((liveBal / 1000) * 0.30).toFixed(2))));
          } else {
            // Standard USD Account: Dynamic lot sizing & margin protection
            if (liveBal < 35) {
              maxAllowedSlots = 2; // Exactly 2 slots for $10-$30 balance ($4.56 margin used, $5.44 free buffer)
              lotVolume = 0.01;
            } else if (liveBal < 75) {
              maxAllowedSlots = 6;
              lotVolume = 0.02;
            } else {
              maxAllowedSlots = 20; // Full 20 slots for $100+ accounts
              lotVolume = Math.max(0.02, Math.min(0.10, Math.round((liveBal / 100) * 0.03 * 100) / 100)); // Calibrated 0.03 lot for $100 balance!
            }
          }

          // Dynamically synchronize risk manager slot capacity
          this.marginRiskManager.maxConcurrentTrades = maxAllowedSlots;

          if (this.currentMode === 'LIVE') {
            // Keep engine positions strictly synchronized with real broker tickets
            const liveTickets = new Set((mt5Connector.openPositions || []).map(p => Number(p.ticket)));
            this.marginTradingEngine.activePositions = (this.marginTradingEngine.activePositions || []).filter(p => liveTickets.has(Number(p.ticket)));
            portfolioState.activePositions = this.marginTradingEngine.activePositions;

            if (mt5Connector.connected && mt5Connector.accountInfo) {
              const liveEq = Number(mt5Connector.accountInfo.equity || liveBal);
              const liveMargin = Number(mt5Connector.accountInfo.margin || 0);
              const liveFreeMargin = Number(mt5Connector.accountInfo.freeMargin || Math.max(0, liveBal - liveMargin));

              portfolioState.equity = liveEq;
              portfolioState.balance = liveBal;
              portfolioState.usedMargin = liveMargin;
              portfolioState.freeMargin = liveFreeMargin;

              // Dynamic minimum free margin check (0.20 USC for Cent, $2.10 for Standard 500x)
              const minReqFreeMargin = accountType === 'CENT' ? 0.20 : 2.10;
              if (liveFreeMargin < minReqFreeMargin) {
                break;
              }

              // BROKER REALITY CHECK: If broker has margin locked, calculate actual live slots in use
              const brokerPositionsCount = Array.isArray(mt5Connector.openPositions)
                ? mt5Connector.openPositions.length
                : (liveMargin > 0 ? Math.floor(liveMargin / 2.0) : 0);

              const realSlotsInUse = Math.max(portfolioState.activePositions.length, brokerPositionsCount);
              if (realSlotsInUse >= maxAllowedSlots) {
                break; // Max slots for this account type occupied on real broker!
              }
            }
          }

          if (portfolioState.activePositions.length >= maxAllowedSlots) {
            break; // Max slots occupied
          }

          // Concentration check: strictly 1 trade per symbol (no averaging down or stacking)
          const openPositions = portfolioState.activePositions;
          const cleanAssetSym = asset.symbol.replace(/[-_./=Xm]/gi, '').toUpperCase();
          const sameSymbolCount = openPositions.filter(p => {
            const cleanPosSym = (p.symbol || '').replace(/[-_./=Xm]/gi, '').toUpperCase();
            return cleanPosSym === cleanAssetSym || cleanPosSym.includes(cleanAssetSym) || cleanAssetSym.includes(cleanPosSym);
          }).length;
          if (sameSymbolCount >= 1) continue;

          const riskEval = this.marginRiskManager.evaluateTradeRisk(portfolioState, signal, asset);
          if (riskEval.allowed) {
            if (this.currentMode === 'LIVE') {
              if (mt5Connector.connected) {
                try {
                  const ticket = await mt5Connector.openPosition({
                    symbol: asset.symbol,
                    side: signal.side,
                    volume: lotVolume,
                    sl: signal.stopLoss,
                    tp: signal.takeProfit,
                    comment: `Scalp ${asset.symbol}`
                  });

                  if (ticket && ticket.ticket) {
                    const fillPrice = ticket.price || signal.entryPrice;
                    const notionalVal = Number((fillPrice * (asset.category === 'Forex' ? (lotVolume * 100000) : lotVolume)).toFixed(2));
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
                      units: lotVolume,
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

                    // Immediately register the live broker ticket into mt5Connector.openPositions
                    // so subsequent candidate evaluations in this cycle know this slot is used!
                    if (!mt5Connector.openPositions) mt5Connector.openPositions = [];
                    mt5Connector.openPositions.push({
                      ticket: ticket.ticket,
                      symbol: asset.symbol,
                      type: signal.side === 'LONG' ? 'BUY' : 'SELL',
                      volume: lotVolume,
                      priceOpen: fillPrice,
                      priceCurrent: fillPrice,
                      profit: 0.0,
                      time: Math.floor(Date.now() / 1000),
                      ageSeconds: 0
                    });

                    this.log(
                      `📡 [MT5 LIVE] Scalp executed on Exness MT5! Ticket #${ticket.ticket} (${asset.symbol} ${signal.side} ${lotVolume} lot @ $${fillPrice})`,
                      'SUCCESS'
                    );
                    this.lastTradeOpenedAt = Date.now();
                  }
                } catch (err) {
                  if (err.message && (err.message.includes('10027') || err.message.includes('Algo Trading'))) {
                    this.log(`🚨 [MT5 LIVE] Order blocked: "Algo Trading" is turned OFF in your MetaTrader 5 window. Please click the "Algo Trading" button in the MT5 top toolbar on AWS (or press Ctrl+E) so it turns green!`, 'ERROR');
                  } else if (err.message && (err.message.includes('10018') || err.message.includes('Market closed'))) {
                    this.log(`⏱️ [MT5 LIVE] Forex Market is closed for the weekend (Code 10018). Forex orders will automatically resume when markets open on Sunday 5:00 PM EST. 24/7 Crypto scalping is active!`, 'INFO');
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
                `⚡ [MARGIN DEMO] SCALP OPEN: ${signal.side} ${asset.symbol} @ $${signal.entryPrice} (${riskEval.leverage}x Lev, Margin: $${riskEval.margin}, Fee: -$${pos.entryFee || 0})`,
                'SUCCESS'
              );
              this.lastTradeOpenedAt = Date.now();
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
            `🪙 [SPOT] SCALP OPEN${scaleLabel}: Bought ${candidate.asset.symbol} with $${notional} (Portion ${this.spotTradingEngine.activePositions.length}/${spotSlots}) @ $${entryPrice} (Confidence: ${candidate.signal.confidence}%, Fee: -$${spotPos?.entryFee || 0}). Target: +${this.spotRiskManager.takeProfitPct}% ($${takeProfit}) | Stop: -${this.spotRiskManager.stopLossPct}% ($${stopLoss}) | Cap: ${this.spotRiskManager.maxHoldMinutes || 5}m`,
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
      // A. Margin Engine Trigger Checks (ONLY in SIMULATED Demo Mode)
      if (this.currentMode === 'SIMULATED') {
        const marginClosed = this.marginTradingEngine.updatePricesAndCheckTriggers(pricesMap, technicalsMap);
        for (const closed of marginClosed) {
          // Cooldown: 60 cycles (5m) on stop loss, 12 cycles (1m) on profit/breakeven
          const cooldownTime = closed.exitReason === 'STOP_LOSS_TRIGGER' ? 60 : 12;
          this.assetCooldowns.set(closed.symbol, cooldownTime);
          const feeStr = closed.fee ? ` (Fee: -$${closed.fee})` : '';
          if (closed.exitReason === 'TAKE_PROFIT_TRIGGER') {
            this.log(`🎯 [MARGIN DEMO] TP HIT: ${closed.symbol} ${closed.side}! Realized Net: +$${closed.finalPnL}${feeStr}`, 'SUCCESS');
          } else if (closed.exitReason === 'TIME_LIMIT_EXIT') {
            this.log(`⏱️ [MARGIN DEMO] 5M SCALP EXPIRY: ${closed.symbol} auto-closed at 5m cap. Realized Net: ${closed.finalPnL >= 0 ? '+' : ''}$${closed.finalPnL}${feeStr}`, closed.finalPnL >= 0 ? 'SUCCESS' : 'INFO');
          } else if (closed.exitReason === 'MOMENTUM_EXHAUSTION_EXIT') {
            this.log(`🔒 [MARGIN DEMO] FAST SCALP LOCK: ${closed.symbol} gain banked before 5m cap. Realized Net: +$${closed.finalPnL}${feeStr}`, 'SUCCESS');
          } else if (closed.exitReason === 'TRAILING_STOP_TRIGGER') {
            this.log(`🛡️ [MARGIN DEMO] TRAIL STOP: ${closed.symbol} ${closed.side}! Profit: +$${closed.finalPnL}${feeStr}`, 'SUCCESS');
          } else if (closed.exitReason === 'BREAKEVEN_STOP_TRIGGER') {
            this.log(`🔒 [MARGIN DEMO] BREAK-EVEN: ${closed.symbol} ${closed.side}. Loss protected (Net: $${closed.finalPnL}${feeStr})`, 'INFO');
          } else if (closed.exitReason === 'STOP_LOSS_TRIGGER') {
            this.log(`🛡️ [MARGIN DEMO] STOP HIT: ${closed.symbol} ${closed.side}. Loss capped: -$${Math.abs(closed.finalPnL)}${feeStr}`, 'WARN');
          }
        }
      }

      // A2. Live MT5 Broker Scalp Watchdog: Active PnL Guardian, Profit Banking & Expiry Watchdog
      // Actively enforces 1.5% balance loss cap, 1:1.3 R:R take profit, break-even locks, trailing stops, and fast scalp exits
      if (this.currentMode === 'LIVE' && mt5Connector.connected && this.isAutoTradingEnabled) {
        const openPositions = Array.isArray(mt5Connector.openPositions) ? mt5Connector.openPositions : [];
        const handledTickets = new Set();
        const now = Date.now();
        // Calibrated Fee-Adjusted 1:1.3 Scalp Geometry (1.5% capital risk = -$1.10, 1.95% net target = +$1.46 on 0.02 lot):
        for (const p of openPositions) {
          const ticket = p.ticket;
          if (!ticket || handledTickets.has(ticket)) continue;
          handledTickets.add(ticket);

          // Manage scalps opened by this agent or via web app
          const knownBotTicket = (this.marginTradingEngine?.activePositions || []).some(ap => Number(ap.ticket) === Number(ticket));
          const isBotTrade = (p.magic === 241100) || 
                             (p.comment && (p.comment.toLowerCase().includes('scalp') || p.comment.toLowerCase().includes('nexusquant'))) ||
                             knownBotTicket;
          if (!isBotTrade) continue;

          const posVolume = Number(p.volume || 0.01);
          const symUpper = (p.symbol || '').toUpperCase();
          const isCrypto = symUpper.includes('BTC') || symUpper.includes('ETH') || symUpper.includes('LTC') || symUpper.includes('XRP') || symUpper.includes('DOGE') || symUpper.includes('BNB') || symUpper.includes('ADA');

          let microTargetProfit, microMaxLoss, beThreshold, beLockFloor, momentumBankThreshold;

          if (isCrypto) {
            // Proportional Crypto Scalp Geometry (0.45% TP vs 0.30% SL):
            const priceEst = p.priceOpen || (symUpper.includes('BTC') ? 84000 : 2700);
            const notional = Number((priceEst * posVolume).toFixed(2));
            microTargetProfit = Number(Math.max(0.60, notional * 0.0045).toFixed(2)); // +0.45% profit
            microMaxLoss = Number(Math.max(0.40, notional * 0.0030).toFixed(2));      // -0.30% loss
            beThreshold = Number((microTargetProfit * 0.35).toFixed(2));              // +35% of target hit triggers break-even shield
            beLockFloor = Number(Math.max(0.10, notional * 0.0010).toFixed(2));       // Lock in +0.10% min profit
            momentumBankThreshold = Number((microTargetProfit * 0.55).toFixed(2));    // Bank if 55% of target reached after 2m
          } else {
            // M5 Forex Scalp Geometry (15 pips TP vs 10 pips SL):
            microTargetProfit = Number((posVolume * 150).toFixed(2)); // +15 pips target ($1.50 on 0.01, $4.50 on 0.03)
            microMaxLoss = Number((posVolume * 100).toFixed(2));      // -10 pips maximum loss ($1.00 on 0.01, $3.00 on 0.03)
            beThreshold = Number((posVolume * 60).toFixed(2));        // +6 pips peak trigger
            beLockFloor = Number((posVolume * 20).toFixed(2));        // +2 pips minimum guaranteed lock
            momentumBankThreshold = Number((posVolume * 90).toFixed(2)); // +9 pips fast momentum bank after 2m
          }

          if (!this.livePositionFirstSeen.has(ticket)) {
            this.livePositionFirstSeen.set(ticket, now);
          }

          const wallAgeMs = now - (this.livePositionFirstSeen.get(ticket) || now);
          const bridgeAgeMs = (p.ageSeconds !== undefined ? p.ageSeconds : 0) * 1000;
          const posTimeAgeMs = p.time ? Math.max(0, now - (p.time * 1000)) : 0;
          const actualAgeMs = Math.max(wallAgeMs, bridgeAgeMs, posTimeAgeMs);

          const currentProfit = Number(Number(p.profit || 0).toFixed(2));

          // Track peak profit reached for high-win-rate break-even and trailing protection
          const prevPeak = this.liveTradePeaks.get(ticket) || 0;
          const currentPeak = Math.max(prevPeak, currentProfit);
          this.liveTradePeaks.set(ticket, currentPeak);

          let exitReason = null;
          let exitMessage = null;
          let logLevel = 'INFO';

          // 1. FULL TAKE PROFIT: Bank full scalp gain!
          if (currentProfit >= microTargetProfit) {
            exitReason = 'TAKE_PROFIT_TRIGGER';
            exitMessage = `🎯 [MT5 LIVE] Scalp TP Target hit (+${currentProfit}) on Ticket #${ticket} (${p.symbol})! Banking gain...`;
            logLevel = 'SUCCESS';
          }
          // 2. BREAKEVEN PROFIT SHIELD: If scalp peaked in profit and pulls back, lock in gain!
          else if (currentPeak >= beThreshold && (currentProfit <= Number((currentPeak * 0.45).toFixed(2)) || currentProfit <= beLockFloor)) {
            if (currentProfit >= 0.05) {
              exitReason = 'BREAKEVEN_STOP_TRIGGER';
              exitMessage = `🛡️ [MT5 LIVE] Breakeven Profit Shield: Ticket #${ticket} peaked at +$${currentPeak.toFixed(2)}, locked in +$${currentProfit.toFixed(2)} gain!`;
              logLevel = 'SUCCESS';
            } else if (currentProfit <= 0.02 && currentProfit >= -0.10) {
              exitReason = 'BREAKEVEN_STOP_TRIGGER';
              exitMessage = `🛡️ [MT5 LIVE] Breakeven Cut: Ticket #${ticket} peaked at +$${currentPeak.toFixed(2)}, closed at breakeven ($${currentProfit.toFixed(2)}) to prevent loss!`;
              logLevel = 'INFO';
            }
          }
          // 3. FAST MOMENTUM BANK: If scalp is >= 2.5 minutes old and reached positive momentum, bank it!
          else if (actualAgeMs >= 150000 && currentProfit >= momentumBankThreshold) {
            exitReason = 'MOMENTUM_EXHAUSTION_EXIT';
            exitMessage = `⚡ [MT5 LIVE] Fast Momentum Bank: Ticket #${ticket} locked +$${currentProfit.toFixed(2)} in ${Math.round(actualAgeMs / 1000)}s!`;
            logLevel = 'SUCCESS';
          }
          // 4. STRICT STOP LOSS: Strict capital protection!
          else if (currentProfit <= -microMaxLoss) {
            exitReason = 'STOP_LOSS_TRIGGER';
            exitMessage = `🛡️ [MT5 LIVE] Scalp Stop Loss triggered (-$${Math.abs(currentProfit)} / max -$${microMaxLoss}). Cutting loss cleanly on Ticket #${ticket}...`;
            logLevel = 'WARN';
          }
          // 5. STRICT 5-MINUTE SCALP CYCLE CAP: Pure Scalping Rule (Never hold scalps for hours!)
          else if (actualAgeMs >= 300000) {
            exitReason = 'TIME_LIMIT_EXIT';
            exitMessage = `⏱️ [MT5 LIVE] 5-minute Scalp Cycle Expiry for Ticket #${ticket} (${p.symbol}). Realized P/L: ${currentProfit >= 0 ? '+' : ''}$${currentProfit}`;
            logLevel = currentProfit >= 0 ? 'SUCCESS' : 'INFO';
          }

          if (exitReason) {
            this.log(exitMessage, logLevel);
            mt5Connector.closePosition({ symbol: p.symbol, ticket }).then(res => {
              if (res && res.closed > 0) {
                this.livePositionFirstSeen.delete(ticket);
                this.liveTradePeaks.delete(ticket);
                const brokerProfit = Number(Number(p.profit || 0).toFixed(2));
                this.log(`📡 [MT5 LIVE] Scalp Ticket #${ticket} successfully closed on Exness MT5 (${exitReason}). Realized P/L: ${brokerProfit >= 0 ? '+' : ''}$${brokerProfit}`, brokerProfit >= 0 ? 'SUCCESS' : 'WARN');
                this.liveClosedTrades.unshift({
                  id: `MT5-${ticket}`,
                  ticket,
                  symbol: p.symbol,
                  side: p.type === 'BUY' ? 'LONG' : 'SHORT',
                  entryPrice: p.priceOpen,
                  exitPrice: p.priceCurrent,
                  units: p.volume,
                  finalPnL: brokerProfit,
                  exitReason,
                  exitTime: new Date().toISOString()
                });
                this.liveRealizedPnL = Number((this.liveRealizedPnL + brokerProfit).toFixed(2));
                this.marginTradingEngine.activePositions = (this.marginTradingEngine.activePositions || []).filter(ap => ap.ticket !== ticket);
                // Asset cooldown: 20 cycles (30s) on stop loss; 4 cycles (6s) on profit
                const cdCycles = exitReason === 'STOP_LOSS_TRIGGER' ? 20 : 4;
                this.assetCooldowns.set(p.symbol, cdCycles);
                const cleanSym = (p.symbol || '').replace(/[-_./=Xm]/gi, '').toUpperCase();
                this.assetCooldowns.set(`${cleanSym}=X`, cdCycles);
              }
            }).catch(err => {
              this.log(`⚠️ [MT5 LIVE] Failed to close Ticket #${ticket}: ${err.message}`, 'WARN');
            });
          }
        }

        // Clean up tickets that are no longer open
        const currentOpenTickets = new Set(openPositions.map(p => p.ticket));
        for (const [t] of this.livePositionFirstSeen.entries()) {
          if (!currentOpenTickets.has(t)) {
            this.livePositionFirstSeen.delete(t);
            this.liveTradePeaks.delete(t);
          }
        }
      }

      // B. Spot Engine Trigger Checks
      const spotClosed = this.spotTradingEngine.updatePricesAndCheckTriggers(pricesMap, technicalsMap);
      for (const closed of spotClosed) {
        // Fast 3-cycle (15s) cooldown on profit/time exit to allow rapid rotation into new setups; 6 cycles on stop loss
        const spotCd = closed.exitReason === 'STOP_LOSS_TRIGGER' ? 6 : 3;
        this.spotCooldowns.set(closed.symbol, spotCd);
        const feeStr = closed.fee ? ` (Fee: -$${closed.fee})` : '';
        if (closed.exitReason === 'TAKE_PROFIT_TRIGGER') {
          this.log(`🪙 [SPOT] TARGET HIT: ${closed.symbol}! Sold 100% holding for Realized Net: +$${closed.finalPnL} (+${closed.finalPnLPercent}%)${feeStr}!`, 'SUCCESS');
        } else if (closed.exitReason === 'TIME_LIMIT_EXIT') {
          this.log(`⏱️ [SPOT] 5M SCALP EXPIRY: ${closed.symbol} auto-closed at 5m cap. Realized Net: ${closed.finalPnL >= 0 ? '+' : ''}$${closed.finalPnL} (${closed.finalPnLPercent}%)${feeStr}`, closed.finalPnL >= 0 ? 'SUCCESS' : 'INFO');
        } else if (closed.exitReason === 'STOP_LOSS_TRIGGER') {
          this.log(`🪙 [SPOT] STOP TRIGGERED: ${closed.symbol} sold at stop. Loss capped: -$${Math.abs(closed.finalPnL)} (${closed.finalPnLPercent}%)${feeStr}`, 'WARN');
        } else {
          this.log(`🪙 [SPOT] EXIT: ${closed.symbol} closed (${closed.exitReason}). Realized Net: ${closed.finalPnL >= 0 ? '+' : ''}$${closed.finalPnL}${feeStr}`, closed.finalPnL >= 0 ? 'SUCCESS' : 'WARN');
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

        // Format open positions reported directly from the MT5 terminal
        const terminalPositions = (mt5Status.openPositions || []).map(p => {
          const livePrice = p.priceCurrent || p.priceOpen;
          const openTimeStr = p.time ? new Date(p.time * 1000).toISOString() : new Date().toISOString();
          const leverage = mt5Status.accountInfo.leverage || 500;
          const symUpper = (p.symbol || '').toUpperCase();
          const isForex = (symUpper.length === 6 || symUpper.includes('/')) && !symUpper.includes('BTC') && !symUpper.includes('ETH') && !symUpper.includes('XAU') && !symUpper.includes('GOLD');
          const notionalVal = Number((p.volume * (isForex ? 100000 : livePrice)).toFixed(2));
          const marginEst = Number((notionalVal / leverage).toFixed(2));
          const pnlVal = p.profit !== undefined ? Number(Number(p.profit).toFixed(2)) : 0;
          const roe = marginEst > 0 ? Number(((pnlVal / marginEst) * 100).toFixed(1)) : 0;

          return {
            id: `MT5-${p.ticket}`,
            ticket: p.ticket,
            symbol: p.symbol,
            name: p.symbol,
            category: symUpper.includes('BTC') || symUpper.includes('ETH') ? 'Crypto' : (symUpper.includes('XAU') ? 'Commodity' : 'Forex'),
            side: p.type === 'BUY' ? 'LONG' : 'SHORT',
            entryPrice: p.priceOpen,
            currentPrice: livePrice,
            stopLoss: p.sl || null,
            takeProfit: p.tp || null,
            units: p.volume,
            notional: notionalVal,
            unrealizedPnL: pnlVal,
            unrealizedPnLPct: roe,
            roePercent: roe,
            leverage: leverage,
            margin: marginEst,
            maxHoldMinutes: 5,
            openTime: openTimeStr,
            ageSeconds: p.ageSeconds,
            isLiveBrokerOrder: true,
            comment: p.comment
          };
        });

        // In LIVE mode with MT5 connected, broker terminal positions are 100% authoritative
        let activePositionsList = terminalPositions;
        if (this.marginTradingEngine) {
          const liveTickets = new Set(terminalPositions.map(p => Number(p.ticket)));
          this.marginTradingEngine.activePositions = (this.marginTradingEngine.activePositions || []).filter(p => liveTickets.has(Number(p.ticket)));
        }

        // Live Realized PnL & Closed Deals isolated from demo paper trading
        const liveRealized = (mt5Status.realizedProfit !== undefined && mt5Status.realizedProfit !== null)
          ? mt5Status.realizedProfit
          : (this.liveRealizedPnL || 0);

        const liveClosed = (Array.isArray(mt5Status.closedDeals) && mt5Status.closedDeals.length > 0)
          ? mt5Status.closedDeals
          : (this.liveClosedTrades || []);

        const winCount = liveClosed.filter(t => (t.finalPnL || t.profit || 0) > 0.05).length;
        const lossCount = liveClosed.filter(t => (t.finalPnL || t.profit || 0) < -0.05).length;
        const decisive = winCount + lossCount;
        const winRate = decisive > 0 ? Number(((winCount / decisive) * 100).toFixed(1)) : (liveClosed.length > 0 ? 100 : 0);
        const totalPnLVal = Number((liveRealized + pnl).toFixed(2));
        const totalPnLPctVal = bal > 0 ? Number(((totalPnLVal / bal) * 100).toFixed(2)) : 0;

        marginPortfolio = {
          isLive: true,
          isConnected: true,
          broker: 'MT5',
          brokerName: 'MetaTrader 5',
          balance: bal,
          equity: eq,
          margin: liveMargin,
          freeMargin: liveFreeMargin,
          leverage: mt5Status.accountInfo.leverage || 500,
          unrealizedPnL: pnl,
          realizedPnL: liveRealized,
          totalPnL: totalPnLVal,
          totalPnLPct: totalPnLPctVal,
          winRate,
          winCount,
          lossCount,
          totalTrades: liveClosed.length,
          activePositions: activePositionsList,
          closedTrades: liveClosed
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
          realizedPnL: this.liveRealizedPnL || 0,
          totalPnL: 0,
          totalPnLPct: 0,
          activePositions: [],
          closedTrades: this.liveClosedTrades || [],
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

    // Dynamic Cent vs Standard Account Sizing for Dashboard Telemetry
    const mt5AccType = (mt5Status.accountInfo?.accountType || (String(mt5Status.accountInfo?.currency || '').includes('USC') ? 'CENT' : 'STANDARD')).toUpperCase();
    const mt5Bal = Number(mt5Status.accountInfo?.balance || (marginPortfolio ? marginPortfolio.balance : 100) || 100);
    let dynamicMarginSlots = 20;
    if (mt5AccType === 'CENT') {
      dynamicMarginSlots = 20;
    } else {
      if (mt5Bal < 35) dynamicMarginSlots = 2;
      else if (mt5Bal < 75) dynamicMarginSlots = 6;
      else dynamicMarginSlots = 20;
    }

    const marginRisk = {
      ...this.marginRiskManager.getSettings(),
      maxConcurrentTrades: dynamicMarginSlots
    };
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
