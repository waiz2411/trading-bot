import fs from 'fs';
import path from 'path';
import { marketDataService } from './marketData.js';
import { calculateTechnicalMetrics } from './technicalAnalysis.js';
import { evaluateStrategyConfluence, evaluateSpotConfluence } from './strategyEngine.js';
import { RiskManager } from './riskManager.js';
import { PaperTradingEngine } from './paperTradingEngine.js';
import { binanceConnector } from './binanceConnector.js';
import { mt5Connector } from './mt5Connector.js';
import { authService } from './authService.js';
import { isHalalCompliant } from './halalFilter.js';
import { getAssetPrecision, formatAssetPrice } from '../config/assets.js';

export class AutonomousAgentLoop {
  constructor() {
    this.activeAccount = 'MARGIN'; // 'MARGIN' | 'SPOT'
    this.currentUser = 'demo@gmail.com';
    this.currentMode = 'SIMULATED'; // 'SIMULATED' | 'LIVE'

    this.engines = {};
    this.configs = {};

    this.isAutoTradingEnabled = false; // Bot is PAUSED by default
    this.isScanning = false;
    this.agentLogs = [];
    this.latestScanResults = [];
    this.scanIntervalMs = 1500; // 1.5s rapid scanning loop for 10-20 trades/5m
    this.timerId = null;
    this.assetCooldowns = new Map();
    this.spotCooldowns = new Map();
    this.spotCooldownUntil = new Map(); // Absolute timestamp lockouts (15m on loss, 5m on win)
    this.liveRealizedPnL = 0;
    this.liveClosedTrades = [];
    this.liveSpotRealizedPnL = 0;
    this.liveSpotClosedTrades = [];
    this.livePositionFirstSeen = new Map();
    this.liveTradePeaks = new Map();
    this.lastTradeOpenedAt = 0;
    this.lastSpotTradeOpenedAt = 0; // 30s inter-trade pacing delay

    this.loadPersistedSpotTrades();
    this.log('⚡ Autonomous Agent initialized: Dual-Account Engine (Margin Scalper 500x + Pure Spot 100% Crypto). Bot is OFF by default.');
  }

  getConfig(email) {
    const userKey = email || 'default';
    if (!this.configs[userKey]) {
      this.configs[userKey] = {
        marginRiskManager: new RiskManager({
          riskPerTradePct: 1.5,
          maxConcurrentTrades: 20,
          minConfidenceThreshold: 70,
          tradeDirection: 'BOTH',
          tradingStyle: 'SCALPING',
          defaultLeverage: 500,
          targetRiskRewardRatio: 1.6,
          maxHoldMinutes: 120
        }),
        spotRiskManager: {
          maxSlots: 4,
          allocationPct: 25,
          maxTradesPerPair: 1,
          stopLossPct: 1.0,
          takeProfitPct: 1.5,
          maxHoldMinutes: 15,
          minConfidenceThreshold: 90,
          allowHighVolatility: true,
          volatilityMode: 'HIGH_VOLATILITY_HALAL',
          useBnbFeeDiscount: true,
          feeRate: 0.00075,
          isHalalStrict: true
        }
      };
    }
    return this.configs[userKey];
  }

  get marginRiskManager() {
    return this.getConfig(this.currentUser).marginRiskManager;
  }

  get spotRiskManager() {
    return this.getConfig(this.currentUser).spotRiskManager;
  }

  getEngine(account, email) {
    const userKey = email || 'default';
    if (!this.engines[userKey]) {
      this.engines[userKey] = {
        MARGIN: new PaperTradingEngine(100, 'MARGIN', userKey),
        SPOT: new PaperTradingEngine(10, 'SPOT', userKey)
      };
    }
    return this.engines[userKey][account];
  }

  get marginTradingEngine() {
    return this.getEngine('MARGIN', this.currentUser);
  }

  get spotTradingEngine() {
    return this.getEngine('SPOT', this.currentUser);
  }

  loadPersistedSpotTrades() {
    try {
      const filePath = path.resolve('backend/src/data/live_spot_trades.json');
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf8');
        const list = JSON.parse(raw);
        if (Array.isArray(list) && list.length > 0) {
          this.liveSpotClosedTrades = list;
          this.liveSpotRealizedPnL = Number(list.reduce((acc, t) => acc + (t.finalPnL || 0), 0).toFixed(2));
        }
      }
    } catch (_) {}
  }

  savePersistedSpotTrades() {
    try {
      const dirPath = path.resolve('backend/src/data');
      if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
      const filePath = path.join(dirPath, 'live_spot_trades.json');
      fs.writeFileSync(filePath, JSON.stringify(this.liveSpotClosedTrades || [], null, 2), 'utf8');
    } catch (_) {}
  }

  async setUserMode(userEmail, mode = 'SIMULATED') {
    this.currentUser = userEmail;
    this.currentMode = mode;

    // Purge phantom simulated trades without a real MT5 ticket when in LIVE broker mode
    if (mode === 'LIVE' && this.marginTradingEngine) {
      this.marginTradingEngine.activePositions = this.marginTradingEngine.activePositions.filter(p => !!p.ticket);
    }

    // Synchronize broker connectors and persistent user state
    try {
      const user = await authService.getUserByEmail(userEmail);
      if (user) {
        if (user.is_auto_trading !== undefined || user.isAutoTradingEnabled !== undefined) {
          this.isAutoTradingEnabled = Boolean(user.is_auto_trading ?? user.isAutoTradingEnabled);
        }
        if (user.account_type || user.accountType) {
          this.activeAccount = user.account_type || user.accountType;
        }
        if (user.brokerConnections?.binance) {
          binanceConnector.configure({
            apiKey: user.brokerConnections.binance.apiKey || '',
            apiSecret: user.brokerConnections.binance.apiSecret || '',
            isTestnet: user.brokerConnections.binance.isTestnet ?? true,
            connected: user.brokerConnections.binance.connected,
            status: user.brokerConnections.binance.status,
            balances: user.brokerConnections.binance.balances
          });
        }
        if (user.brokerConnections?.mt5) {
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

  updateMarginSettings(newSettings = {}, userEmail = null) {
    const config = this.getConfig(userEmail || this.currentUser);
    config.marginRiskManager.updateSettings(newSettings);
    this.log(`Margin settings updated: ${JSON.stringify(newSettings)}`, 'INFO');
    return config.marginRiskManager.getSettings();
  }

  updateSpotSettings(newSettings = {}, userEmail = null) {
    const config = this.getConfig(userEmail || this.currentUser);
    const spotRiskManager = config.spotRiskManager;

    if (newSettings.stopLossPct !== undefined) {
      spotRiskManager.stopLossPct = Math.max(0.3, Math.min(10, Number(newSettings.stopLossPct)));
    }
    if (newSettings.takeProfitPct !== undefined) {
      spotRiskManager.takeProfitPct = Math.max(0.5, Math.min(25, Number(newSettings.takeProfitPct)));
    }
    if (newSettings.maxHoldMinutes !== undefined) {
      spotRiskManager.maxHoldMinutes = Math.max(1, Math.min(1440, parseInt(newSettings.maxHoldMinutes, 10)));
    }
    if (newSettings.minConfidenceThreshold !== undefined) {
      spotRiskManager.minConfidenceThreshold = Math.max(70, Math.min(95, Number(newSettings.minConfidenceThreshold)));
    }
    if (newSettings.maxSlots !== undefined) {
      const slots = Math.max(1, Math.min(8, parseInt(newSettings.maxSlots, 10)));
      spotRiskManager.maxSlots = slots;
      spotRiskManager.allocationPct = Number((100 / slots).toFixed(1));
    }
    if (newSettings.maxTradesPerPair !== undefined) {
      spotRiskManager.maxTradesPerPair = Math.max(1, Math.min(4, parseInt(newSettings.maxTradesPerPair, 10)));
    }
    if (newSettings.allowHighVolatility !== undefined) {
      spotRiskManager.allowHighVolatility = Boolean(newSettings.allowHighVolatility);
    }
    if (newSettings.volatilityMode !== undefined) {
      spotRiskManager.volatilityMode = newSettings.volatilityMode;
      if (newSettings.volatilityMode === 'ESTABLISHED_HALAL') {
        spotRiskManager.allowHighVolatility = false;
      } else if (newSettings.volatilityMode === 'HIGH_VOLATILITY_HALAL') {
        spotRiskManager.allowHighVolatility = true;
      }
    }
    if (newSettings.useBnbFeeDiscount !== undefined) {
      spotRiskManager.useBnbFeeDiscount = Boolean(newSettings.useBnbFeeDiscount);
      spotRiskManager.feeRate = spotRiskManager.useBnbFeeDiscount ? 0.00075 : 0.0010;
    }
    const volLabel = spotRiskManager.allowHighVolatility ? '⚡ High-Volatility Halal Hunter' : '🛡️ Standard Halal Majors';
    const feeLabel = spotRiskManager.useBnbFeeDiscount ? '0.075% BNB Discount' : '0.10% Standard';
    this.log(`⚙️ Spot Strategy updated: [${volLabel} | ${feeLabel}] ${spotRiskManager.maxSlots} Portions (${spotRiskManager.allocationPct}% each, max ${spotRiskManager.maxTradesPerPair}/coin, max ${spotRiskManager.maxHoldMinutes || 5}m hold), SL: -${spotRiskManager.stopLossPct}%, TP: +${spotRiskManager.takeProfitPct}% (🕌 100% Shariah Compliant)`, 'INFO');
    return spotRiskManager;
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
        if (binanceConnector.connected) {
          if (!this.binanceSyncCount) this.binanceSyncCount = 0;
          this.binanceSyncCount++;
          if (this.binanceSyncCount % 2 === 0) {
            await binanceConnector.getBalances().catch(() => {});
          }
        }
      }
      await marketDataService.updateAll(mt5Connector.marketTicks);
      const markets = marketDataService.getAllMarkets();
      const pricesMap = marketDataService.getAllPricesMap();

      if (this.currentMode === 'LIVE' && binanceConnector.connected) {
        this.syncLiveSpotPositions(binanceConnector.cachedBalances, pricesMap);
      }

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

        // 3A. Margin Scalper Confluence: 24/7 Exness Tradable Halal Crypto + Top 18 Liquid Forex Pairs
        const MT5_INSTITUTIONAL_MAJORS = new Set([
          'BTC-USD', 'ETH-USD', 'BNB-USD', 'XRP-USD', 'ADA-USD', 'LTC-USD',
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

        // 3B. Pure Spot Crypto Confluence (100% Shariah Halal Filtered & Volatility Selected)
        let spotSignal = null;
        const cleanName = (asset.name || asset.symbol.replace(/[-_/]/g, '').replace(/USD$/, '')).toUpperCase();
        const spotLockExpiry = Math.max(
          this.spotCooldownUntil?.get(asset.symbol) || 0,
          this.spotCooldownUntil?.get(cleanName) || 0,
          this.spotCooldownUntil?.get(`${cleanName}-USD`) || 0,
          this.spotCooldownUntil?.get(`${cleanName}USDT`) || 0
        );
        const isSpotCooldown = spotLockExpiry > Date.now();
        const remainingLockSec = isSpotCooldown ? Math.ceil((spotLockExpiry - Date.now()) / 1000) : 0;

        if (asset.category === 'Crypto') {
          if (isHalalCompliant(asset.symbol)) {
            const allowVolatile = this.spotRiskManager.allowHighVolatility ?? true;
            const isVolatile = Boolean(asset.isHighVolatility || (asset.minVolatility && asset.minVolatility >= 1.4));
            
            // Respect user choice: strictly enforce volatility mode
            const passesVolatilityFilter = allowVolatile ? isVolatile : !isVolatile;
            if (passesVolatilityFilter) {
              spotSignal = evaluateSpotConfluence(asset, technicals, this.spotRiskManager);
              if (spotSignal.action === 'STRONG_BUY' && !isSpotCooldown) {
                validSpotBuys.push({ asset, signal: spotSignal });
              }
            }
          }
        }

        const isCooldown = this.activeAccount === 'SPOT' ? isSpotCooldown : isMarginCooldown;
        const cooldownCycles = this.activeAccount === 'SPOT'
          ? remainingLockSec
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
          isHalal: asset.isHalal ?? (asset.category === 'Crypto' ? isHalalCompliant(asset.symbol) : undefined),
          halalSector: asset.halalSector,
          isHighVolatility: asset.isHighVolatility,
          liveVolatility24h: asset.liveVolatility24h,
          isCooldown,
          cooldownCycles,
          technicals: {
            rsi: technicals?.rsi,
            macd: technicals?.macd?.histogram,
            ema50: technicals?.ema50,
            ema200: technicals?.ema200,
            atr: technicals?.atr
          },
          signal: asset.category === 'Crypto'
            ? (spotSignal || { action: 'NEUTRAL', confidence: 0 })
            : (signal || { action: 'NEUTRAL', confidence: 0 })
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
                maxHoldMinutes: marginRiskSettings.maxHoldMinutes || this.marginRiskManager.maxHoldMinutes || 60,
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
      // 4B. PURE SPOT CRYPTO AUTO-OPEN (100% Shariah Halal Filtered)
      // ==========================================
      const spotSlots = this.spotRiskManager.maxSlots || 4;
      const spotOpen = this.spotTradingEngine.activePositions;
      const timeSinceLastSpot = Date.now() - (this.lastSpotTradeOpenedAt || 0);

      if (this.isAutoTradingEnabled && spotOpen.length < spotSlots && validSpotBuys.length > 0 && (timeSinceLastSpot >= 30000 || this.lastSpotTradeOpenedAt === 0)) {
        // Intelligent Multi-Candidate Win Probability Ranking:
        // When multiple coins achieve 95-100% confidence, we do NOT simply pick the first one.
        // We deeply compare:
        // 1. winProbability (EMA fan expansion slope, RSI 45-55 sweet spot, EMA21 pullback proximity, lower wick defense, liquidity)
        // 2. rawScore (Uncapped multi-factor confluence score)
        // 3. 24h Volatility & Volume Liquidity (Minimal spread slippage)
        validSpotBuys.sort((a, b) => {
          const winA = a.signal.winProbability ?? a.signal.confidence;
          const winB = b.signal.winProbability ?? b.signal.confidence;
          if (Math.abs(winB - winA) >= 0.5) return winB - winA;

          const rawA = a.signal.rawScore ?? a.signal.confidence;
          const rawB = b.signal.rawScore ?? b.signal.confidence;
          if (rawB !== rawA) return rawB - rawA;

          const volA = (a.asset.quoteVolume || 0) * (a.asset.liveVolatility24h || 1);
          const volB = (b.asset.quoteVolume || 0) * (b.asset.liveVolatility24h || 1);
          return volB - volA;
        });

        const usdtObj = (binanceConnector.cachedBalances || []).find(b => b.asset === 'USDT');
        const liveUsdtFree = usdtObj ? Number(usdtObj.free) : 0;
        const totalCash = (this.currentMode === 'LIVE' && binanceConnector.connected && liveUsdtFree > 0)
          ? liveUsdtFree
          : this.spotTradingEngine.balance;
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

          // Calculate current available cash (with 0.01 buffer for Binance market order safety)
          const currentUsed = this.spotTradingEngine.activePositions.reduce((acc, p) => acc + (p.notional || 0), 0);
          const availableCash = Math.max(0, totalCash - currentUsed);
          const notional = Number(Math.max(0.5, Math.min(portionSize, availableCash, totalCash > 1 ? totalCash - 0.01 : totalCash)).toFixed(2));

          if (notional < 0.5) break; // Insufficient remaining cash for another portion

          const entryPrice = candidate.signal.entryPrice;
          const precision = getAssetPrecision(entryPrice, candidate.asset.decimals || 4);
          const rawUnits = notional / entryPrice;
          const units = Number(rawUnits.toFixed(Math.max(4, precision)));

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
            decimals: precision,
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
            feeRate: this.spotRiskManager.feeRate || (this.spotRiskManager.useBnbFeeDiscount ? 0.00075 : 0.0010),
            leverage: 1, // 1x Spot Cash
            margin: notional, // cash allocated
            liquidationPrice: 0 // No liquidation in spot
          });

          this.log(
            `🪙 [SPOT] SCALP OPEN${scaleLabel}: Bought ${candidate.asset.symbol} with $${notional} (Portion ${this.spotTradingEngine.activePositions.length}/${spotSlots}) @ $${formatAssetPrice(entryPrice, precision)} (Confidence: ${candidate.signal.confidence}%, Fee: -$${spotPos?.entryFee || 0}). Target: +${this.spotRiskManager.takeProfitPct}% ($${formatAssetPrice(takeProfit, precision)}) | Stop: -${this.spotRiskManager.stopLossPct}% ($${formatAssetPrice(stopLoss, precision)}) | Cap: ${this.spotRiskManager.maxHoldMinutes || 5}m`,
            'SUCCESS'
          );
          this.lastSpotTradeOpenedAt = Date.now();

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
            beThreshold = Number((microTargetProfit * 0.70).toFixed(2));              // +70% of target hit triggers break-even shield
            beLockFloor = Number(Math.max(0.10, notional * 0.0010).toFixed(2));       // Lock in +0.10% min profit
            momentumBankThreshold = Number((microTargetProfit * 0.85).toFixed(2));    // Bank if 85% of target reached after 2m
          } else {
            // M5 Forex Scalp Geometry (15 pips TP vs 10 pips SL):
            microTargetProfit = Number((posVolume * 150).toFixed(2)); // +15 pips target ($1.50 on 0.01, $4.50 on 0.03)
            microMaxLoss = Number((posVolume * 100).toFixed(2));      // -10 pips maximum loss ($1.00 on 0.01, $3.00 on 0.03)
            beThreshold = Number((posVolume * 105).toFixed(2));        // +10.5 pips peak trigger
            beLockFloor = Number((posVolume * 20).toFixed(2));        // +2 pips minimum guaranteed lock
            momentumBankThreshold = Number((posVolume * 125).toFixed(2)); // +12.5 pips fast momentum bank after 2m
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

          const maxHoldMinutes = this.marginRiskManager.maxHoldMinutes || 60;
          const maxHoldMs = maxHoldMinutes * 60 * 1000;
          const momentumAgeMs = Math.min(150000, Math.floor(maxHoldMs * 0.5));

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
          // 3. FAST MOMENTUM BANK: If scalp reached positive momentum after holding for half duration, bank it!
          else if (actualAgeMs >= momentumAgeMs && currentProfit >= momentumBankThreshold) {
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
          // 5. DYNAMIC SCALP CYCLE CAP (Auto-close at user-selected 3m, 5m, 10m, 15m, 30m, 60m cap)
          else if (actualAgeMs >= maxHoldMs) {
            exitReason = 'TIME_LIMIT_EXIT';
            exitMessage = `⏱️ [MT5 LIVE] ${maxHoldMinutes}-minute Scalp Cycle Expiry for Ticket #${ticket} (${p.symbol}). Realized P/L: ${currentProfit >= 0 ? '+' : ''}$${currentProfit}`;
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
        if (this.currentMode === 'LIVE') {
          if (!this.liveSpotClosedTrades) this.liveSpotClosedTrades = [];
          const exists = this.liveSpotClosedTrades.some(t => t.id === closed.id);
          if (!exists) {
            this.liveSpotClosedTrades.unshift({
              ...closed,
              isLiveBrokerOrder: true,
              exitTime: new Date().toISOString()
            });
            this.liveSpotRealizedPnL = Number(((this.liveSpotRealizedPnL || 0) + (closed.finalPnL || 0)).toFixed(2));
          }
        }

        // Anti-Churn Revenge Trade Protection: 15-Minute strict lockout on Losses; 5-Minute on profit
        const isLoss = (closed.finalPnL || 0) < -0.0001 || closed.exitReason === 'STOP_LOSS_TRIGGER';
        const lockMs = isLoss ? 15 * 60 * 1000 : 5 * 60 * 1000;
        const lockExpiry = Date.now() + lockMs;
        const cleanName = (closed.name || closed.symbol.replace(/[-_/]/g, '').replace(/USD$/, '')).toUpperCase();

        if (!this.spotCooldownUntil) this.spotCooldownUntil = new Map();
        this.spotCooldownUntil.set(closed.symbol, lockExpiry);
        this.spotCooldownUntil.set(cleanName, lockExpiry);
        this.spotCooldownUntil.set(`${cleanName}-USD`, lockExpiry);
        this.spotCooldownUntil.set(`${cleanName}USDT`, lockExpiry);

        const spotCd = isLoss ? 600 : 200;
        this.spotCooldowns.set(closed.symbol, spotCd);
        this.spotCooldowns.set(`${cleanName}-USD`, spotCd);
        this.spotCooldowns.set(`${cleanName}USDT`, spotCd);
        this.spotCooldowns.set(cleanName, spotCd);

        const feeStr = closed.fee ? ` (Fee: -$${closed.fee})` : '';
        const holdCapStr = `${this.spotRiskManager.maxHoldMinutes || 60}M`;

        if (closed.exitReason === 'TAKE_PROFIT_TRIGGER') {
          this.log(`🪙 [SPOT] TARGET HIT (+${this.spotRiskManager.takeProfitPct}%): ${closed.symbol}! Sold holding for Realized Net: +$${closed.finalPnL} (+${closed.finalPnLPercent}%)${feeStr}!`, 'SUCCESS');
        } else if (closed.exitReason === 'TRAILING_STOP_TRIGGER') {
          this.log(`🛡️ [SPOT] TRAILING PROFIT SECURED: ${closed.symbol}! Banked gain on trailing stop: +$${closed.finalPnL} (+${closed.finalPnLPercent}%)${feeStr}!`, 'SUCCESS');
        } else if (closed.exitReason === 'BREAKEVEN_STOP_TRIGGER') {
          this.log(`🔒 [SPOT] BREAK-EVEN SHIELD HIT: ${closed.symbol} closed with zero fee loss (Net: $${closed.finalPnL >= 0 ? '+' : ''}$${closed.finalPnL}${feeStr})!`, 'INFO');
        } else if (closed.exitReason === 'TIME_LIMIT_EXIT') {
          this.log(`⏱️ [SPOT] ${holdCapStr} HOLD EXPIRY: ${closed.symbol} auto-closed at ${holdCapStr} cap. Realized Net: ${closed.finalPnL >= 0 ? '+' : ''}$${closed.finalPnL} (${closed.finalPnLPercent}%)${feeStr}`, closed.finalPnL >= 0 ? 'SUCCESS' : 'INFO');
        } else if (closed.exitReason === 'STOP_LOSS_TRIGGER') {
          this.log(`🪙 [SPOT] STOP TRIGGERED (-${this.spotRiskManager.stopLossPct}%): ${closed.symbol} sold at stop. Loss capped: -$${Math.abs(closed.finalPnL)} (${closed.finalPnLPercent}%)${feeStr}. Coin locked on 15m cooldown.`, 'WARN');
        } else {
          this.log(`🪙 [SPOT] EXIT: ${closed.symbol} closed (${closed.exitReason}). Realized Net: ${closed.finalPnL >= 0 ? '+' : ''}$${closed.finalPnL}${feeStr}`, closed.finalPnL >= 0 ? 'SUCCESS' : 'WARN');
        }

        // Live Binance Exit Sell
        if (this.currentMode === 'LIVE' && binanceConnector.connected) {
          const rawAsset = (closed.name || closed.symbol.replace(/[-_/]/g, '').replace(/USD$/, '')).toUpperCase();
          try {
            const balances = await binanceConnector.getBalances();
            const coinBal = balances.find(b => b.asset.toUpperCase() === rawAsset);
            const qtyToSell = coinBal && coinBal.free > 0.00001 ? coinBal.free : closed.units;
            if (qtyToSell > 0) {
              await binanceConnector.placeSpotMarketOrder({
                symbol: `${rawAsset}USDT`,
                side: 'SELL',
                quantity: qtyToSell
              });
              this.log(`🪙 [BINANCE LIVE] Real Spot Exit executed on Binance! Sold ${qtyToSell} ${rawAsset}`, 'SUCCESS');
              await binanceConnector.getBalances();
            }
          } catch (err) {
            this.log(`⚠️ [BINANCE LIVE] Exit sell notice: ${err.message}`, 'WARN');
          }

          if (!this.liveSpotClosedTrades) this.liveSpotClosedTrades = [];
          this.liveSpotClosedTrades.unshift({
            ...closed,
            id: `BINANCE-${rawAsset}-${Date.now()}`,
            isLiveBrokerOrder: true,
            exitTime: new Date().toISOString()
          });
          this.liveSpotRealizedPnL = Number(((this.liveSpotRealizedPnL || 0) + (closed.finalPnL || 0)).toFixed(2));
          this.savePersistedSpotTrades();
        }
      }

    } catch (error) {
      console.error('Error during agent cycle:', error);
      this.log(`Cycle error: ${error.message}`, 'ERROR');
    } finally {
      this.isScanning = false;
    }
  }

  syncLiveSpotPositions(balances = [], pricesMap = {}) {
    if (!Array.isArray(balances) || balances.length === 0) {
      this.liveSpotPositions = [];
      return [];
    }

    // Filter valid non-USDT balances with >= $1.00 estimated value
    const validHoldings = balances.filter(b => {
      if (b.asset === 'USDT' || b.asset === 'BNB' || b.free <= 0.00001) return false;
      const assetUpper = b.asset.toUpperCase();
      const symbol = `${assetUpper}-USD`;
      const livePrice = pricesMap[symbol] || pricesMap[`${assetUpper}USDT`] || 0;
      const scan = this.latestScanResults.find(s => s.symbol.replace(/[-_/]/g, '').startsWith(assetUpper));
      const estPrice = livePrice || (scan ? scan.price : 0) || 0;
      const notionalEst = estPrice > 0 ? estPrice * b.free : 0;
      return notionalEst >= 1.00;
    });

    const validAssetNames = new Set(validHoldings.map(b => b.asset.toUpperCase()));
    const currentActive = this.liveSpotPositions || [];

    // 1. Detect and record positions that were sold / closed on Binance
    for (const pos of currentActive) {
      const posAsset = (pos.name || pos.symbol.replace(/[-_/]/g, '').replace(/USD$/, '')).toUpperCase();
      if (!validAssetNames.has(posAsset)) {
        const livePrice = pricesMap[pos.symbol] || pos.currentPrice || pos.entryPrice;
        const gross = (livePrice - pos.entryPrice) * pos.units;
        const exitFee = Number((livePrice * pos.units * (pos.feeRate || 0.00075)).toFixed(4));
        const finalPnL = Number((gross - (pos.entryFee || 0) - exitFee).toFixed(2));
        const finalPnLPct = pos.notional > 0 ? Number(((finalPnL / pos.notional) * 100).toFixed(2)) : 0;

        const uniqueId = pos.id ? `${pos.id}-${Date.now()}` : `BINANCE-${posAsset}-${Date.now()}`;
        const closedRecord = {
          id: uniqueId,
          symbol: pos.symbol,
          name: pos.name || posAsset,
          side: 'LONG',
          entryPrice: pos.entryPrice,
          exitPrice: livePrice,
          units: pos.units,
          notional: pos.notional,
          finalPnL,
          finalPnLPercent: finalPnLPct,
          fee: Number(((pos.entryFee || 0) + exitFee).toFixed(4)),
          exitReason: finalPnL >= 0 ? 'TAKE_PROFIT_TRIGGER' : 'STOP_LOSS_TRIGGER',
          openTime: pos.openTime,
          exitTime: new Date().toISOString(),
          isLiveBrokerOrder: true
        };

        // Set 15-minute anti-churn lockout on losses, 5-minute on wins
        const isLoss = finalPnL < -0.0001 || closedRecord.exitReason === 'STOP_LOSS_TRIGGER';
        const lockMs = isLoss ? 15 * 60 * 1000 : 5 * 60 * 1000;
        const lockExpiry = Date.now() + lockMs;

        if (!this.spotCooldownUntil) this.spotCooldownUntil = new Map();
        this.spotCooldownUntil.set(pos.symbol, lockExpiry);
        this.spotCooldownUntil.set(posAsset, lockExpiry);
        this.spotCooldownUntil.set(`${posAsset}-USD`, lockExpiry);
        this.spotCooldownUntil.set(`${posAsset}USDT`, lockExpiry);

        const spotCd = isLoss ? 600 : 200;
        this.spotCooldowns.set(pos.symbol, spotCd);
        this.spotCooldowns.set(`${posAsset}-USD`, spotCd);
        this.spotCooldowns.set(`${posAsset}USDT`, spotCd);
        this.spotCooldowns.set(posAsset, spotCd);

        if (!this.liveSpotClosedTrades) this.liveSpotClosedTrades = [];
        this.liveSpotClosedTrades.unshift(closedRecord);
        this.liveSpotRealizedPnL = Number(((this.liveSpotRealizedPnL || 0) + finalPnL).toFixed(2));
        this.savePersistedSpotTrades();
        this.log(`🪙 [BINANCE LIVE] Trade Closed: ${pos.symbol} sold on Binance! Realized Net: ${finalPnL >= 0 ? '+' : ''}$${finalPnL} (${finalPnLPct}%)`, finalPnL >= 0 ? 'SUCCESS' : 'INFO');
      }
    }

    // 2. Retain only genuinely active holdings with >= $1.00 value
    const remainingLive = currentActive.filter(p => {
      const assetUpper = (p.name || p.symbol.replace(/[-_/]/g, '').replace(/USD$/, '')).toUpperCase();
      return validAssetNames.has(assetUpper);
    });

    // 3. Register or update live holdings
    const updatedLivePositions = [];
    for (const coin of validHoldings) {
      const assetUpper = coin.asset.toUpperCase();
      const symbol = `${assetUpper}-USD`;
      const livePrice = pricesMap[symbol] || pricesMap[`${assetUpper}USDT`] || 0;
      const scan = this.latestScanResults.find(s => s.symbol.replace(/[-_/]/g, '').startsWith(assetUpper));
      const entryPrice = livePrice || (scan ? scan.price : 0) || 0;
      const notionalEst = entryPrice > 0 ? Number((entryPrice * coin.free).toFixed(2)) : 0;

      let trackedPos = remainingLive.find(p => {
        const pSym = (p.name || p.symbol.replace(/[-_/]/g, '').replace(/USD$/, '')).toUpperCase();
        return pSym === assetUpper;
      });

      const precision = getAssetPrecision(livePrice || 1, 4);

      if (!trackedPos) {
        const stopDist = entryPrice * (this.spotRiskManager.stopLossPct / 100);
        const targetDist = entryPrice * (this.spotRiskManager.takeProfitPct / 100);
        const stopLoss = Number((entryPrice - stopDist).toFixed(precision));
        const takeProfit = Number((entryPrice + targetDist).toFixed(precision));
        const notional = notionalEst;
        const feeRate = this.spotRiskManager.feeRate || (this.spotRiskManager.useBnbFeeDiscount ? 0.00075 : 0.0010);
        const entryFee = Number((notional * feeRate).toFixed(4));

        trackedPos = {
          id: `BINANCE-${assetUpper}`,
          symbol,
          name: assetUpper,
          category: 'Crypto',
          side: 'LONG',
          entryPrice,
          currentPrice: livePrice || entryPrice,
          highestPrice: livePrice || entryPrice,
          lowestPrice: livePrice || entryPrice,
          stopLoss,
          takeProfit,
          stopDistance: stopDist,
          targetDistance: targetDist,
          units: coin.free,
          notional,
          confidence: 95,
          reason: 'Live Binance Spot Holding',
          riskRewardRatio: Number((this.spotRiskManager.takeProfitPct / this.spotRiskManager.stopLossPct).toFixed(1)),
          maxHoldMinutes: this.spotRiskManager.maxHoldMinutes || 60,
          openTime: new Date().toISOString(),
          tradingStyle: 'SPOT_BUY',
          feeRate,
          entryFee,
          estimatedExitFee: entryFee,
          leverage: 1,
          margin: notional,
          liquidationPrice: 0,
          isLiveBrokerOrder: true
        };
      } else {
        trackedPos.currentPrice = livePrice || trackedPos.currentPrice;
        trackedPos.highestPrice = Math.max(trackedPos.highestPrice || 0, livePrice || 0);
        trackedPos.lowestPrice = Math.min(trackedPos.lowestPrice || Infinity, livePrice || Infinity);
        trackedPos.notional = notionalEst;
      }
      updatedLivePositions.push(trackedPos);
    }
    return this.liveSpotPositions || [];
  }

  getDashboardData(forcedMode = null, forcedAccount = null) {
    const currentMode = forcedMode || this.currentMode;
    const activeAccount = (forcedAccount || this.activeAccount || 'MARGIN').toUpperCase();
    const isLive = currentMode === 'LIVE';
    const isSpot = activeAccount === 'SPOT';

    const binanceStatus = binanceConnector.getStatus();
    const mt5Status = mt5Connector.getStatus();
    const pricesMap = marketDataService.getAllPricesMap();

    // 1. Resolve Margin Portfolio (MetaTrader 5 Only)
    let marginPortfolio;
    if (isLive) {
      if (mt5Status.connected && mt5Status.accountInfo) {
        const bal = Number(mt5Status.accountInfo.balance || 0);
        const eq = Number(mt5Status.accountInfo.equity || bal);
        const liveMargin = Number(mt5Status.accountInfo.margin || 0);
        const liveFreeMargin = Number(mt5Status.accountInfo.freeMargin || Math.max(0, bal - liveMargin));
        const pnl = Number((eq - bal).toFixed(2));

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

        const liveRealized = (mt5Status.realizedProfit !== undefined && mt5Status.realizedProfit !== null)
          ? mt5Status.realizedProfit
          : (this.liveRealizedPnL || 0);

        const liveClosed = (Array.isArray(mt5Status.closedDeals) && mt5Status.closedDeals.length > 0)
          ? mt5Status.closedDeals
          : (this.liveClosedTrades || []);

        const winCount = liveClosed.filter(t => (t.finalPnL !== undefined ? t.finalPnL : (t.profit || 0)) > 0.05).length;
        const lossCount = liveClosed.filter(t => (t.finalPnL !== undefined ? t.finalPnL : (t.profit || 0)) < -0.0001).length;
        const breakEvenCount = liveClosed.filter(t => {
          const p = t.finalPnL !== undefined ? t.finalPnL : (t.profit || 0);
          return p >= -0.0001 && p <= 0.05;
        }).length;
        const decisive = winCount + lossCount;
        const winRate = decisive > 0 ? Number(((winCount / decisive) * 100).toFixed(1)) : 0;
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
          breakEvenCount,
          totalTrades: liveClosed.length,
          activePositions: terminalPositions,
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
          realizedPnL: 0,
          totalPnL: 0,
          totalPnLPct: 0,
          activePositions: [],
          closedTrades: [],
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
      const hasBinanceBalances = Array.isArray(binanceStatus.balances) && binanceStatus.balances.length > 0;
      if (binanceStatus.connected || hasBinanceBalances) {
        this.syncLiveSpotPositions(binanceStatus.balances, pricesMap);

        const usdtObj = (binanceStatus.balances || []).find(b => b.asset === 'USDT');
        const usdtFree = usdtObj ? Number(usdtObj.free) : 0;

        let totalHoldingValue = 0;
        let totalSpotUnrealizedPnL = 0;
        let totalSpotFees = 0;

        const activeSpotHoldings = (this.liveSpotPositions || []).map(pos => {
          const livePrice = pricesMap[pos.symbol] || pos.currentPrice || pos.entryPrice;
          const currentNotional = Number((livePrice * pos.units).toFixed(2));
          let pnl = pos.unrealizedPnL;
          if (pnl === undefined || pnl === null || isNaN(pnl)) {
            const gross = (livePrice - pos.entryPrice) * pos.units;
            const exitFee = Number((currentNotional * (pos.feeRate || 0.00075)).toFixed(4));
            pnl = Number((gross - (pos.entryFee || 0) - exitFee).toFixed(2));
          }
          const pnlPct = pos.pnlPercent !== undefined ? pos.pnlPercent : (pos.notional > 0 ? Number(((pnl / pos.notional) * 100).toFixed(2)) : 0);
          const roe = pos.roePercent !== undefined ? pos.roePercent : (pos.margin > 0 ? Number(((pnl / pos.margin) * 100).toFixed(2)) : 0);

          totalHoldingValue += currentNotional;
          totalSpotUnrealizedPnL += (pnl || 0);
          totalSpotFees += ((pos.entryFee || 0) + (pos.estimatedExitFee || (pos.entryFee || 0)));

          return {
            ...pos,
            id: pos.id || `BINANCE-${pos.name}`,
            symbol: pos.symbol,
            name: pos.name,
            category: 'Crypto',
            side: 'LONG',
            entryPrice: pos.entryPrice,
            currentPrice: livePrice,
            stopLoss: pos.stopLoss,
            takeProfit: pos.takeProfit,
            stopDistance: pos.stopDistance,
            targetDistance: pos.targetDistance,
            units: pos.units,
            notional: currentNotional,
            margin: currentNotional,
            leverage: 1,
            tradingStyle: 'SPOT_BUY',
            maxHoldMinutes: pos.maxHoldMinutes || this.spotRiskManager.maxHoldMinutes || 60,
            openTime: pos.openTime,
            trailingStopActive: pos.trailingStopActive,
            breakEvenLocked: pos.breakEvenLocked,
            unrealizedPnL: pnl,
            unrealizedPnLPct: pnlPct,
            roePercent: roe,
            entryFee: pos.entryFee || 0,
            estimatedExitFee: pos.estimatedExitFee || pos.entryFee || 0,
            isLiveBrokerOrder: true
          };
        });

        const spotEquity = Number((usdtFree + totalHoldingValue).toFixed(2));
        const liveRealized = this.liveSpotRealizedPnL || 0;
        const totalPnLVal = Number((liveRealized + totalSpotUnrealizedPnL).toFixed(2));
        const totalPnLPctVal = spotEquity > 0 ? Number(((totalPnLVal / spotEquity) * 100).toFixed(2)) : 0;

        const liveTrades = this.liveSpotClosedTrades || [];
        const winCount = liveTrades.filter(t => (t.finalPnL || 0) > 0.05).length;
        const lossCount = liveTrades.filter(t => (t.finalPnL || 0) < -0.0001).length;
        const breakEvenCount = liveTrades.filter(t => {
          const p = t.finalPnL || 0;
          return p >= -0.0001 && p <= 0.05;
        }).length;
        const decisive = winCount + lossCount;
        const winRate = decisive > 0 ? Number(((winCount / decisive) * 100).toFixed(1)) : 0;

        spotPortfolio = {
          isLive: true,
          isConnected: true,
          broker: 'BINANCE',
          brokerName: 'Binance Spot',
          balance: Number(usdtFree.toFixed(2)),
          freeCash: Number(usdtFree.toFixed(2)),
          holdingValue: Number(totalHoldingValue.toFixed(2)),
          usedMargin: Number(totalHoldingValue.toFixed(2)),
          equity: spotEquity,
          unrealizedPnL: Number(totalSpotUnrealizedPnL.toFixed(2)),
          realizedPnL: liveRealized,
          totalPnL: totalPnLVal,
          totalPnLPct: totalPnLPctVal,
          totalFeesPaid: Number(totalSpotFees.toFixed(2)),
          winRate,
          winCount,
          lossCount,
          breakEvenCount,
          totalTrades: liveTrades.length,
          activePositions: activeSpotHoldings,
          closedTrades: liveTrades
        };
      } else {
        spotPortfolio = {
          isLive: true,
          isConnected: false,
          broker: 'BINANCE',
          brokerName: 'Binance Spot',
          balance: null,
          equity: null,
          freeCash: null,
          holdingValue: 0,
          usedMargin: 0,
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
      activeAccount,
      mode: currentMode,
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
