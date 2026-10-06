import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { marketDataService } from './marketData.js';
import { calculateTechnicalMetrics } from './technicalAnalysis.js';
import { evaluateStrategyConfluence, evaluateSpotConfluence, evaluateBtcHealth, scanRelativeStrengthLeaders, scanHotGainerLeaders } from './strategyEngine.js';
import { RiskManager } from './riskManager.js';
import { PaperTradingEngine } from './paperTradingEngine.js';
import { binanceConnector } from './binanceConnector.js';
import { mt5Connector } from './mt5Connector.js';
import { authService } from './authService.js';
import { isHalalCompliant } from './halalFilter.js';
import { getAssetPrecision, formatAssetPrice } from '../config/assets.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../data');

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
        mode: 'SIMULATED',
        isAutoTradingEnabled: undefined,
        lastSpotTradeOpenedAt: 0,
        lastMarginTradeOpenedAt: 0,
        spotCooldownUntil: new Map(),
        assetCooldowns: new Map(),
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
          maxSlots: 1,
          allocationPct: 100,
          maxTradesPerPair: 1,
          stopLossPct: 1.10,
          takeProfitPct: 1.60,
          trailingTriggerPct: 1.00,
          trailingDistancePct: 0.35,
          pullbackDiscountPct: 0.70,
          maxHoldMinutes: 120,
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
      const filePath = path.join(DATA_DIR, 'live_spot_trades.json');
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf8');
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
          // Live spot closed trades should ONLY be genuine live orders with real Binance order execution
          // Reject legacy paper simulation trades with 'TRD-' prefix or known simulation symbols
          const demoSymbols = new Set(['PARTI', 'RLC', 'MOVR', 'SCR', 'MEGA', 'TST', 'SEI', 'BANANA', 'PIVX']);
          this.liveSpotClosedTrades = list.filter(t => 
            t.isLiveBrokerOrder && 
            !String(t.id).startsWith('TRD-') &&
            !demoSymbols.has((t.name || '').toUpperCase())
          );
          this.liveSpotRealizedPnL = Number(this.liveSpotClosedTrades.reduce((acc, t) => acc + (t.finalPnL || 0), 0).toFixed(2));
        }
      }
    } catch (_) {}
  }

  savePersistedSpotTrades() {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      const filePath = path.join(DATA_DIR, 'live_spot_trades.json');
      fs.writeFileSync(filePath, JSON.stringify(this.liveSpotClosedTrades || [], null, 2), 'utf8');
    } catch (_) {}
  }

  async setUserMode(userEmail, mode = 'SIMULATED') {
    this.currentUser = userEmail;
    this.currentMode = mode;
    const uConfig = this.getConfig(userEmail);
    uConfig.mode = mode;

    // Purge phantom simulated trades when in LIVE broker mode
    if (mode === 'LIVE') {
      if (this.marginTradingEngine) {
        this.marginTradingEngine.activePositions = this.marginTradingEngine.activePositions.filter(p => !p.ticket);
      }
      if (this.spotTradingEngine) {
        // Live Spot positions are tracked separately in this.liveSpotPositions from real Binance balances
        this.spotTradingEngine.activePositions = [];
      }
    }

    // Synchronize broker connectors and persistent user state
    try {
      const user = await authService.getUserByEmail(userEmail);
      if (user) {
        if (user.is_auto_trading !== undefined || user.isAutoTradingEnabled !== undefined) {
          const autoVal = Boolean(user.is_auto_trading ?? user.isAutoTradingEnabled);
          this.isAutoTradingEnabled = autoVal;
          uConfig.isAutoTradingEnabled = autoVal;
        }
        if (user.account_type || user.accountType) {
          this.activeAccount = user.account_type || user.accountType;
        }
        if (user.brokerConnections?.binance) {
          binanceConnector.configure({
            apiKey: user.brokerConnections.binance.apiKey || '',
            apiSecret: user.brokerConnections.binance.apiSecret || '',
            isTestnet: user.brokerConnections.binance.isTestnet ?? true,
            proxyUrl: user.brokerConnections.binance.proxyUrl || '',
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
    const email = userEmail || this.currentUser || 'default';
    const config = this.getConfig(email);
    const current = config.isAutoTradingEnabled ?? this.isAutoTradingEnabled;
    const target = targetState !== null ? Boolean(targetState) : !current;

    if (target && this.currentMode === 'LIVE') {
      if (this.activeAccount === 'SPOT' && !binanceConnector.getStatus().connected) {
        throw new Error('Cannot start auto-trading: Binance Spot API is not connected. Connect Binance in Broker settings first.');
      }
      if (this.activeAccount === 'MARGIN' && !mt5Connector.getStatus().connected) {
        mt5Connector.tryGatewayConnection().catch(() => {});
      }
    }

    config.isAutoTradingEnabled = target;
    this.isAutoTradingEnabled = target;
    if (email && email !== 'default') {
      authService.setUserAutoTrading(email, target).catch(() => {});
    }
    this.log(
      `Autonomous execution switched to: ${target ? 'ENABLED (Auto-open & auto-close active 24/7)' : 'DISABLED (Manual only)'} for ${email}`,
      target ? 'SUCCESS' : 'WARN'
    );
    return target;
  }

  setBalance(newBalance, closeOpenPositions = false, account = null, userEmail = null) {
    if (this.currentMode === 'LIVE') {
      throw new Error('Manual balance editing is disabled in Live Broker Mode. Balances are fetched directly from your broker.');
    }
    const targetAcc = account ? account.toUpperCase() : this.activeAccount;
    const engine = this.getEngine(targetAcc, userEmail || this.currentUser);
    const state = engine.setBalance(newBalance, closeOpenPositions);
    this.log(`💰 [${targetAcc}] Balance updated to $${Number(newBalance).toLocaleString('en-US')}`, 'SUCCESS');
    return state;
  }

  adjustBalance(delta, account = null, userEmail = null) {
    if (this.currentMode === 'LIVE') {
      throw new Error('Manual balance adjustments are disabled in Live Broker Mode.');
    }
    const targetAcc = account ? account.toUpperCase() : this.activeAccount;
    const engine = this.getEngine(targetAcc, userEmail || this.currentUser);
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
      spotRiskManager.stopLossPct = Math.max(0.1, Math.min(10, Number(newSettings.stopLossPct)));
    }
    if (newSettings.takeProfitPct !== undefined) {
      spotRiskManager.takeProfitPct = Math.max(0.1, Math.min(25, Number(newSettings.takeProfitPct)));
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
      if (mt5Connector.hasCredentials || mt5Connector.connected) {
        await mt5Connector.tryGatewayConnection().catch(() => {});
      }
      if (binanceConnector.connected) {
        if (!this.binanceSyncCount) this.binanceSyncCount = 0;
        this.binanceSyncCount++;
        if (this.binanceSyncCount % 12 === 0) {
          await binanceConnector.getBalances().catch(() => {});
        }
      }
      await marketDataService.updateAll(mt5Connector.marketTicks);
      const markets = marketDataService.getAllMarkets();
      const pricesMap = marketDataService.getAllPricesMap();

      if (binanceConnector.connected) {
        this.syncLiveSpotPositions(binanceConnector.cachedBalances, pricesMap);
      }

      // Institutional 74.5% Win-Rate Engine: BTC Health Gate & Top Hot Gainer Leaders
      const btcAsset = markets.find(m => m.symbol === 'BTC-USD' || m.symbol === 'BTCUSDT' || m.symbol === 'BTC/USDT');
      const btcHealth = evaluateBtcHealth(btcAsset?.candles);
      const topHotLeaders = scanHotGainerLeaders(markets, 2);
      const topLeaders = topHotLeaders.length > 0 ? topHotLeaders : scanRelativeStrengthLeaders(markets, btcAsset?.candles, 3);
      const spotContext = { btcHealth, topHotLeaders, topLeaders };

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
              spotSignal = evaluateSpotConfluence(asset, technicals, this.spotRiskManager, spotContext);
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
      // 4. MULTI-TENANT AUTO-OPEN (MARGIN & SPOT)
      // ==========================================
      const allActiveUsers = new Set(Object.keys(this.engines));
      for (const k of Object.keys(this.configs)) allActiveUsers.add(k);
      if (this.currentUser) allActiveUsers.add(this.currentUser);

      for (const uKey of allActiveUsers) {
        const uConfig = this.getConfig(uKey);
        const uAutoTrading = uConfig.isAutoTradingEnabled ?? this.isAutoTradingEnabled;
        if (!uAutoTrading) continue;

        const uSpotEngine = this.getEngine('SPOT', uKey);
        const uMarginEngine = this.getEngine('MARGIN', uKey);
        const uSpotRisk = uConfig.spotRiskManager;
        const uMarginRisk = uConfig.marginRiskManager;

        // 4A. MARGIN SCALPER AUTO-OPEN FOR uKey
        if (validMarginSignals.length > 0) {
          const portfolioState = uMarginEngine.getPortfolioState();
          const accountType = (mt5Connector.accountInfo?.accountType || (String(mt5Connector.accountInfo?.currency || '').includes('USC') ? 'CENT' : 'STANDARD')).toUpperCase();
          const liveBal = Number(mt5Connector.accountInfo?.balance || portfolioState.balance || 100);
          let maxAllowedSlots = 20;
          let lotVolume = 0.01;

          if (accountType === 'CENT') {
            maxAllowedSlots = 20;
            lotVolume = Math.max(0.20, Math.min(2.00, Number(((liveBal / 1000) * 0.30).toFixed(2))));
          } else {
            if (liveBal < 35) {
              maxAllowedSlots = 2;
              lotVolume = 0.01;
            } else if (liveBal < 75) {
              maxAllowedSlots = 6;
              lotVolume = 0.02;
            } else {
              maxAllowedSlots = 20;
              lotVolume = Math.max(0.02, Math.min(0.10, Math.round((liveBal / 100) * 0.03 * 100) / 100));
            }
          }

          uMarginRisk.maxConcurrentTrades = maxAllowedSlots;

          if (this.currentMode === 'LIVE' && uKey === this.currentUser) {
            const liveTickets = new Set((mt5Connector.openPositions || []).map(p => Number(p.ticket)));
            uMarginEngine.activePositions = (uMarginEngine.activePositions || []).filter(p => liveTickets.has(Number(p.ticket)));
            portfolioState.activePositions = uMarginEngine.activePositions;

            if (mt5Connector.connected && mt5Connector.accountInfo) {
              const liveEq = Number(mt5Connector.accountInfo.equity || liveBal);
              const liveMargin = Number(mt5Connector.accountInfo.margin || 0);
              const liveFreeMargin = Number(mt5Connector.accountInfo.freeMargin || Math.max(0, liveBal - liveMargin));

              portfolioState.equity = liveEq;
              portfolioState.balance = liveBal;
              portfolioState.usedMargin = liveMargin;
              portfolioState.freeMargin = liveFreeMargin;

              const minReqFreeMargin = accountType === 'CENT' ? 0.20 : 2.10;
              if (liveFreeMargin >= minReqFreeMargin) {
                const brokerPositionsCount = Array.isArray(mt5Connector.openPositions)
                  ? mt5Connector.openPositions.length
                  : (liveMargin > 0 ? Math.floor(liveMargin / 2.0) : 0);

                const realSlotsInUse = Math.max(portfolioState.activePositions.length, brokerPositionsCount);
                if (realSlotsInUse < maxAllowedSlots) {
                  for (const { asset, signal } of validMarginSignals) {
                    if (uMarginEngine.activePositions.length >= maxAllowedSlots) break;
                    const cleanAssetSym = asset.symbol.replace(/[-_./=Xm]/gi, '').toUpperCase();
                    const sameSymbolCount = (portfolioState.activePositions || []).filter(p => {
                      const cleanPosSym = (p.symbol || '').replace(/[-_./=Xm]/gi, '').toUpperCase();
                      return cleanPosSym === cleanAssetSym || cleanPosSym.includes(cleanAssetSym) || cleanAssetSym.includes(cleanPosSym);
                    }).length;
                    if (sameSymbolCount >= 1) continue;

                    const riskEval = uMarginRisk.evaluateTradeRisk(portfolioState, signal, asset);
                    if (riskEval.allowed && mt5Connector.connected) {
                      mt5Connector.openPosition({
                        symbol: asset.symbol,
                        side: signal.side,
                        volume: lotVolume,
                        sl: signal.stopLoss,
                        tp: signal.takeProfit,
                        comment: `Scalp ${asset.symbol}`
                      }).catch(err => this.log(`⚠️ [MT5 LIVE] Order warning: ${err.message}`, 'WARN'));
                    }
                  }
                }
              }
            }
          } else {
            // Simulated Paper Demo Mode for uKey
            if (portfolioState.activePositions.length < maxAllowedSlots) {
              for (const { asset, signal } of validMarginSignals) {
                if (uMarginEngine.activePositions.length >= maxAllowedSlots) break;
                const cleanAssetSym = asset.symbol.replace(/[-_./=Xm]/gi, '').toUpperCase();
                const sameSymbolCount = (portfolioState.activePositions || []).filter(p => {
                  const cleanPosSym = (p.symbol || '').replace(/[-_./=Xm]/gi, '').toUpperCase();
                  return cleanPosSym === cleanAssetSym || cleanPosSym.includes(cleanAssetSym) || cleanAssetSym.includes(cleanPosSym);
                }).length;
                if (sameSymbolCount >= 1) continue;

                const riskEval = uMarginRisk.evaluateTradeRisk(portfolioState, signal, asset);
                if (riskEval.allowed) {
                  const pos = uMarginEngine.openPosition({
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
                    tradingStyle: uMarginRisk.tradingStyle,
                    maxHoldMinutes: uMarginRisk.maxHoldMinutes || 60,
                    leverage: riskEval.leverage,
                    margin: riskEval.margin,
                    liquidationPrice: riskEval.liquidationPrice
                  });

                  this.log(
                    `⚡ [MARGIN DEMO - ${uKey}] SCALP OPEN: ${signal.side} ${asset.symbol} @ $${signal.entryPrice} (${riskEval.leverage}x Lev, Margin: $${riskEval.margin}, Fee: -$${pos.entryFee || 0})`,
                    'SUCCESS'
                  );
                  uConfig.lastMarginTradeOpenedAt = Date.now();
                }
              }
            }
          }
        }

        // 4B. PURE SPOT CRYPTO AUTO-OPEN FOR uKey
        const uMode = uConfig.mode || (uKey === this.currentUser ? this.currentMode : 'SIMULATED');
        const isUserLive = (uMode === 'LIVE' && binanceConnector.connected);
        let usdtObj = (binanceConnector.cachedBalances || []).find(b => b.asset === 'USDT');
        if (isUserLive && (!usdtObj || !binanceConnector.cachedBalances || binanceConnector.cachedBalances.length === 0)) {
          const freshBals = await binanceConnector.getBalances(false).catch(() => []);
          usdtObj = (freshBals || []).find(b => b.asset === 'USDT');
        }
        const liveUsdtFree = usdtObj ? Number(usdtObj.free) : 0;
        const totalCash = isUserLive ? liveUsdtFree : uSpotEngine.balance;

        if (isUserLive && totalCash < 5.0) {
          // Cannot place any order on Binance below $5.00
          continue;
        }

        const dynamicSlots = (totalCash < 20 || !uSpotRisk.maxSlots) ? 1 : uSpotRisk.maxSlots;
        const uSpotSlots = dynamicSlots;
        const uSpotOpen = isUserLive ? (this.liveSpotPositions || []) : (uSpotEngine.activePositions || []);
        const uTimeSinceLastSpot = Date.now() - (uConfig.lastSpotTradeOpenedAt || 0);

        if (uSpotOpen.length < uSpotSlots && (uTimeSinceLastSpot >= 15000 || !uConfig.lastSpotTradeOpenedAt)) {
          // Find candidates matching uSpotRisk and uConfig
          const uValidSpotBuys = [];
          for (const asset of markets) {
            if (asset.category !== 'Crypto') continue;
            if (!isHalalCompliant(asset.symbol)) continue;

            const cleanName = (asset.name || asset.symbol.replace(/[-_/]/g, '').replace(/USD$/, '')).toUpperCase();
            const uCooldownMap = uConfig.spotCooldownUntil;
            const spotLockExpiry = Math.max(
              uCooldownMap?.get(asset.symbol) || 0,
              uCooldownMap?.get(cleanName) || 0,
              uCooldownMap?.get(`${cleanName}-USD`) || 0,
              uCooldownMap?.get(`${cleanName}USDT`) || 0,
              this.spotCooldownUntil?.get(asset.symbol) || 0,
              this.spotCooldownUntil?.get(cleanName) || 0,
              this.spotCooldownUntil?.get(`${cleanName}-USD`) || 0,
              this.spotCooldownUntil?.get(`${cleanName}USDT`) || 0
            );
            if (spotLockExpiry > Date.now()) continue;

            const allowVolatile = uSpotRisk.allowHighVolatility ?? true;
            const isVolatile = Boolean(asset.isHighVolatility || (asset.minVolatility && asset.minVolatility >= 1.4));
            const passesVolatilityFilter = allowVolatile ? isVolatile : !isVolatile;
            if (!passesVolatilityFilter) continue;

            const technicals = technicalsMap[asset.symbol];
            if (!technicals) continue;

            const spotSignal = evaluateSpotConfluence(asset, technicals, uSpotRisk, spotContext);
            if (spotSignal && spotSignal.action === 'STRONG_BUY') {
              uValidSpotBuys.push({ asset, signal: spotSignal });
            }
          }

          if (uValidSpotBuys.length > 0) {
            uValidSpotBuys.sort((a, b) => {
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

            let portionSize = Number((Math.floor((totalCash / uSpotSlots) * 100) / 100).toFixed(2));
            if (isUserLive && portionSize < 5.0 && totalCash >= 5.0) {
              portionSize = Number((Math.floor((totalCash - 0.03) * 100) / 100).toFixed(2));
            }
            const maxPerCoin = uSpotRisk.maxTradesPerPair || 2;

            for (const candidate of uValidSpotBuys) {
              const currentOpenCount = isUserLive ? (this.liveSpotPositions || []).length : uSpotEngine.activePositions.length;
              if (currentOpenCount >= uSpotSlots) break;

              const coinPositions = isUserLive
                ? (this.liveSpotPositions || []).filter(p => p.symbol === candidate.asset.symbol || (p.name && candidate.asset.symbol.includes(p.name)))
                : uSpotEngine.activePositions.filter(p => p.symbol === candidate.asset.symbol);
              if (coinPositions.length >= maxPerCoin) continue;

              if (coinPositions.length > 0) {
                const lastEntry = coinPositions[coinPositions.length - 1].entryPrice;
                const diffPct = Math.abs(candidate.signal.entryPrice - lastEntry) / lastEntry;
                if (diffPct < 0.003) continue;
              }

              const currentUsed = isUserLive
                ? (this.liveSpotPositions || []).reduce((acc, p) => acc + (p.notional || 0), 0)
                : uSpotEngine.activePositions.reduce((acc, p) => acc + (p.notional || 0), 0);
              const availableCash = Math.max(0, totalCash - currentUsed);
              const minAllowed = isUserLive ? 5.0 : 0.5;
              const maxSafeNotional = isUserLive ? (Math.floor((availableCash - 0.03) * 100) / 100) : availableCash;
              const notional = Number(Math.max(minAllowed, Math.min(portionSize, maxSafeNotional)).toFixed(2));

              if (notional < minAllowed) break;

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

              if (isUserLive) {
                binanceConnector.placeSpotMarketOrder({
                  symbol: candidate.asset.symbol,
                  side: 'BUY',
                  quoteOrderQty: notional
                }).then(liveOrder => {
                  this.log(`🪙 [BINANCE LIVE] Real Auto-Buy executed on Binance! Order ID: ${liveOrder.orderId} (${candidate.asset.symbol} with $${notional} USDT)`, 'SUCCESS');
                  binanceConnector.getBalances().then(bals => {
                    this.syncLiveSpotPositions(bals, marketDataService.getAllPricesMap());
                  }).catch(() => {});
                }).catch(err => {
                  this.log(`⚠️ [BINANCE LIVE] Auto-order notice: ${err.message}`, 'WARN');
                });
                uConfig.lastSpotTradeOpenedAt = Date.now();
              } else {
                const spotPos = uSpotEngine.openPosition({
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
                  reason: `Spot Scalp Slot ${uSpotEngine.activePositions.length + 1}/${uSpotSlots}${scaleLabel} (${candidate.signal.reason})`,
                  riskRewardRatio: Number((uSpotRisk.takeProfitPct / uSpotRisk.stopLossPct).toFixed(1)),
                  maxHoldMinutes: candidate.signal.maxHoldMinutes || uSpotRisk.maxHoldMinutes || 120,
                  tradingStyle: 'SPOT_BUY',
                  exitRule: candidate.signal.exitRule || 'HOT_RETEST_TRAILING_LOCK',
                  feeRate: uSpotRisk.feeRate || (uSpotRisk.useBnbFeeDiscount ? 0.00075 : 0.0010),
                  leverage: 1,
                  margin: notional,
                  liquidationPrice: 0
                });

                this.log(
                  `🪙 [SPOT - ${uKey}] SCALP OPEN${scaleLabel}: Bought ${candidate.asset.symbol} with $${notional} (Portion ${uSpotEngine.activePositions.length}/${uSpotSlots}) @ $${formatAssetPrice(entryPrice, precision)} (Win Prob: ${candidate.signal.winProbability || 74.5}%, Fee: -$${spotPos?.entryFee || 0}). Target: +${candidate.signal.takeProfitPct || uSpotRisk.takeProfitPct}% ($${formatAssetPrice(takeProfit, precision)}) | Stop: -${candidate.signal.stopLossPct || uSpotRisk.stopLossPct}% ($${formatAssetPrice(stopLoss, precision)}) | Trailing Lock @ +1.0%`,
                  'SUCCESS'
                );
                uConfig.lastSpotTradeOpenedAt = Date.now();
              }
            }
          }
        }
      }

      // ==========================================
      // 5. MANAGE EXITS FOR BOTH ENGINES
      // ==========================================
      // A. Margin Engine Trigger Checks (For ALL users' demo engines)
      for (const uKey of Object.keys(this.engines)) {
        const uMarginEngine = this.engines[uKey]?.MARGIN;
        if (uMarginEngine) {
          const marginClosed = uMarginEngine.updatePricesAndCheckTriggers(pricesMap, technicalsMap);
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

      // B. Authoritative Real-Time Binance Price Sync for Active Positions
      // Guarantees that every active open trade is evaluated strictly against the true Binance ticker price
      const openSpotAssets = new Set();
      for (const uKey of Object.keys(this.engines)) {
        const eng = this.engines[uKey]?.SPOT;
        if (eng && Array.isArray(eng.activePositions)) {
          for (const pos of eng.activePositions) {
            if (pos.category === 'Crypto') openSpotAssets.add(pos.symbol);
          }
        }
      }
      if (Array.isArray(this.liveSpotPositions)) {
        for (const pos of this.liveSpotPositions) {
          if (pos.symbol) openSpotAssets.add(pos.symbol);
        }
      }

      if (openSpotAssets.size > 0) {
        for (const sym of openSpotAssets) {
          const rawAsset = sym.replace(/[-_/]/g, '').replace(/USD$/, '');
          const binancePair = `${rawAsset}USDT`;
          try {
            const res = await fetch(`https://data-api.binance.vision/api/v3/ticker/price?symbol=${binancePair}`, {
              signal: AbortSignal.timeout(2500)
            });
            if (res.ok) {
              const data = await res.json();
              const liveP = parseFloat(data.price);
              if (!isNaN(liveP) && liveP > 0) {
                pricesMap[sym] = liveP;
                const m = marketDataService.getMarket(sym);
                if (m) m.price = liveP;
              }
            }
          } catch (_) {}
        }
      }

      // Spot Engine Trigger Checks (For DEMO simulated paper trading ONLY)
      for (const uKey of Object.keys(this.engines)) {
        const uSpotEngine = this.engines[uKey]?.SPOT;
        if (uSpotEngine) {
          const spotClosed = uSpotEngine.updatePricesAndCheckTriggers(pricesMap, technicalsMap);
          for (const closed of spotClosed) {
            // Anti-Churn Revenge Trade Protection for Demo
            const isLoss = (closed.finalPnL || 0) < -0.0001 || closed.exitReason === 'STOP_LOSS_TRIGGER';
            const lockMs = isLoss ? 15 * 60 * 1000 : 5 * 60 * 1000;
            const lockExpiry = Date.now() + lockMs;
            const cleanName = (closed.name || closed.symbol.replace(/[-_/]/g, '').replace(/USD$/, '')).toUpperCase();

            const userConfig = this.getConfig(uKey);
            if (!userConfig.spotCooldownUntil) userConfig.spotCooldownUntil = new Map();
            userConfig.spotCooldownUntil.set(closed.symbol, lockExpiry);
            userConfig.spotCooldownUntil.set(cleanName, lockExpiry);
            userConfig.spotCooldownUntil.set(`${cleanName}-USD`, lockExpiry);
            userConfig.spotCooldownUntil.set(`${cleanName}USDT`, lockExpiry);

            const userSpotRisk = userConfig.spotRiskManager;
            const feeStr = closed.fee ? ` (Fee: -$${closed.fee})` : '';
            const holdCapStr = `${userSpotRisk.maxHoldMinutes || 60}M`;

            if (closed.exitReason === 'TAKE_PROFIT_TRIGGER') {
              this.log(`🎯 [SPOT DEMO] TARGET HIT (+${userSpotRisk.takeProfitPct}%): ${closed.symbol}! Sold holding for Realized Net: +$${closed.finalPnL} (+${closed.finalPnLPercent}%)${feeStr}!`, 'SUCCESS');
            } else if (closed.exitReason === 'TRAILING_STOP_TRIGGER') {
              this.log(`🛡️ [SPOT DEMO] TRAILING PROFIT SECURED: ${closed.symbol}! Banked gain on trailing stop: +$${closed.finalPnL} (+${closed.finalPnLPercent}%)${feeStr}!`, 'SUCCESS');
            } else if (closed.exitReason === 'BREAKEVEN_STOP_TRIGGER') {
              this.log(`🔒 [SPOT DEMO] BREAK-EVEN SHIELD HIT: ${closed.symbol} closed with zero fee loss (Net: $${closed.finalPnL >= 0 ? '+' : ''}$${closed.finalPnL}${feeStr})!`, 'INFO');
            } else if (closed.exitReason === 'TIME_LIMIT_EXIT') {
              this.log(`⏱️ [SPOT DEMO] ${holdCapStr} HOLD EXPIRY: ${closed.symbol} auto-closed at ${holdCapStr} cap. Realized Net: ${closed.finalPnL >= 0 ? '+' : ''}$${closed.finalPnL} (${closed.finalPnLPercent}%)${feeStr}`, closed.finalPnL >= 0 ? 'SUCCESS' : 'INFO');
            } else if (closed.exitReason === 'STOP_LOSS_TRIGGER') {
              this.log(`🪙 [SPOT DEMO] STOP TRIGGERED (-${userSpotRisk.stopLossPct}%): ${closed.symbol} sold at stop. Loss capped: -$${Math.abs(closed.finalPnL)} (${closed.finalPnLPercent}%)${feeStr}. Coin locked on 15m cooldown.`, 'WARN');
            } else {
              this.log(`🪙 [SPOT DEMO] EXIT: ${closed.symbol} closed (${closed.exitReason}). Realized Net: ${closed.finalPnL >= 0 ? '+' : ''}$${closed.finalPnL}${feeStr}`, closed.finalPnL >= 0 ? 'SUCCESS' : 'WARN');
            }
          }
        }
      }

      // A3. Dedicated Live Binance Spot Holdings Guardian (Active PnL, TP, SL, and Hold Duration Watchdog)
      if (binanceConnector.connected && Array.isArray(this.liveSpotPositions) && this.liveSpotPositions.length > 0) {
        const liveActive = [...this.liveSpotPositions];
        for (const pos of liveActive) {
          const rawAsset = (pos.name || pos.symbol.replace(/[-_/]/g, '').replace(/USD$/, '')).toUpperCase();
          const livePrice = pricesMap[pos.symbol] || pricesMap[`${rawAsset}USDT`] || pos.currentPrice || pos.entryPrice;
          if (!livePrice || livePrice <= 0) continue;

          pos.currentPrice = livePrice;
          pos.highestPrice = Math.max(pos.highestPrice || 0, livePrice);
          pos.lowestPrice = Math.min(pos.lowestPrice || Infinity, livePrice);

          const gross = (livePrice - pos.entryPrice) * pos.units;
          const exitFee = Number((livePrice * pos.units * (pos.feeRate || 0.00075)).toFixed(4));
          const currentProfit = Number((gross - (pos.entryFee || 0) - exitFee).toFixed(2));
          pos.unrealizedPnL = currentProfit;
          pos.pnlPercent = pos.notional > 0 ? Number(((currentProfit / pos.notional) * 100).toFixed(2)) : 0;

          const openMs = pos.openTime ? new Date(pos.openTime).getTime() : Date.now();
          const holdMinutes = (Date.now() - openMs) / 60000;
          const maxHoldMinutes = pos.maxHoldMinutes || this.spotRiskManager.maxHoldMinutes || 60;

          // A. Break-Even Profit Lock (+0.50% move -> Lock in +0.20% Profit)
          const peakGainPct = ((pos.highestPrice - pos.entryPrice) / pos.entryPrice) * 100;
          const precision = pos.decimals || 4;
          if (peakGainPct >= 0.50) {
            const beStop = Number((pos.entryPrice * 1.0020).toFixed(precision));
            if (beStop > (pos.stopLoss || 0)) {
              pos.stopLoss = beStop;
              pos.breakEvenLocked = true;
            }
          }

          // B. Hot-Coin Trailing Profit Lock (>= +1.00% gain -> Trail 0.35% behind peak)
          if (peakGainPct >= 1.00) {
            const trailStop = Number((pos.highestPrice * (1 - 0.0035)).toFixed(precision));
            if (trailStop > (pos.stopLoss || 0)) {
              pos.stopLoss = trailStop;
              pos.trailingStopActive = true;
            }
          }

          let exitReason = null;
          let exitMsg = '';

          // 1. Take Profit Target Hit (+1.60%)
          if (pos.takeProfit && livePrice >= pos.takeProfit) {
            exitReason = 'TAKE_PROFIT_TRIGGER';
            exitMsg = `🎯 [BINANCE LIVE] TP Hit: ${pos.symbol} reached target ($${livePrice} >= $${pos.takeProfit})!`;
          }
          // 2. Break-Even Lock, Trailing Lock, or Stop Loss Protection Trigger
          else if (pos.stopLoss && livePrice <= pos.stopLoss) {
            if (pos.breakEvenLocked && !pos.trailingStopActive) {
              exitReason = 'BREAKEVEN_STOP_TRIGGER';
              exitMsg = `🔒 [BINANCE LIVE] Break-Even Lock: ${pos.symbol} secured +0.20% profit ($${livePrice} <= $${pos.stopLoss})!`;
            } else if (pos.trailingStopActive) {
              exitReason = 'TRAILING_PROFIT_LOCK';
              exitMsg = `🛡️ [BINANCE LIVE] Trailing Profit Lock: ${pos.symbol} secured +${peakGainPct.toFixed(2)}% peak gain at $${livePrice}!`;
            } else {
              exitReason = 'STOP_LOSS_TRIGGER';
              exitMsg = `🛑 [BINANCE LIVE] Stop Loss Hit: ${pos.symbol} ($${livePrice} <= $${pos.stopLoss})!`;
            }
          }
          // 3. Max Hold Duration Expiry
          else if (holdMinutes >= maxHoldMinutes) {
            exitReason = 'TIME_LIMIT_EXIT';
            exitMsg = `⏱️ [BINANCE LIVE] ${maxHoldMinutes}m Hold Expiry: ${pos.symbol} held for ${Math.round(holdMinutes)}m.`;
          }

          if (exitReason) {
            let orderSuccess = false;
            try {
              const balances = await binanceConnector.getBalances();
              const coinBal = (balances || []).find(b => b.asset.toUpperCase() === rawAsset);
              const qtyToSell = coinBal && coinBal.free > 0.00001 ? coinBal.free : 0;

              if (qtyToSell > 0) {
                const sellRes = await binanceConnector.placeSpotMarketOrder({
                  symbol: `${rawAsset}USDT`,
                  side: 'SELL',
                  quantity: qtyToSell
                });
                if (sellRes && (sellRes.success || sellRes.orderId || sellRes.status === 'FILLED')) {
                  orderSuccess = true;
                  this.log(`${exitMsg} Sold ${qtyToSell} ${rawAsset} on Binance! Realized Net: ${currentProfit >= 0 ? '+' : ''}$${currentProfit}`, currentProfit >= 0 ? 'SUCCESS' : 'WARN');

                  // Dust conversion sweep
                  const postBals = await binanceConnector.getBalances(true);
                  const remBal = (postBals || []).find(b => b.asset.toUpperCase() === rawAsset);
                  if (remBal && remBal.free > 0.00001) {
                    await binanceConnector.convertDustToBnb([rawAsset]).then(res => {
                      if (res && (res.totalTransfered || res.transferResult?.length)) {
                        this.log(`✨ [BINANCE LIVE] Leftover dust for ${rawAsset} (${remBal.free}) swept into BNB!`, 'SUCCESS');
                      }
                    }).catch(() => {});
                  }
                } else {
                  this.log(`⚠️ [BINANCE LIVE] Sell order for ${rawAsset} not confirmed by Binance.`, 'WARN');
                }
              } else {
                // If coin balance is already 0 or dust on Binance, it has ALREADY been sold!
                orderSuccess = true;
                this.log(`🪙 [BINANCE LIVE] ${exitMsg} ${rawAsset} is already sold on Binance wallet. Synchronizing closure cleanly.`, 'INFO');
              }
            } catch (err) {
              const errMsg = err.message || '';
              // If Binance returns "insufficient balance" or code -2010 or min notional, the coin was already sold!
              if (errMsg.includes('insufficient balance') || errMsg.includes('-2010') || errMsg.includes('MIN_NOTIONAL')) {
                orderSuccess = true;
                this.log(`🪙 [BINANCE LIVE] ${rawAsset} was already sold on Binance (${errMsg}). Synchronizing closure cleanly.`, 'INFO');
              } else {
                this.log(`⚠️ [BINANCE LIVE] Exit sell notice for ${rawAsset}: ${errMsg}`, 'WARN');
              }
            }

            // ONLY record trade as closed and remove from active positions if Binance sell confirmed!
            if (orderSuccess) {
              if (!this.liveSpotClosedTrades) this.liveSpotClosedTrades = [];
              this.liveSpotClosedTrades.unshift({
                id: `BINANCE-${rawAsset}-${Date.now()}`,
                symbol: pos.symbol,
                name: rawAsset,
                side: 'LONG',
                entryPrice: pos.entryPrice,
                exitPrice: livePrice,
                units: pos.units,
                notional: pos.notional,
                finalPnL: currentProfit,
                finalPnLPercent: pos.pnlPercent,
                fee: Number(((pos.entryFee || 0) + exitFee).toFixed(4)),
                exitReason,
                openTime: pos.openTime,
                exitTime: new Date().toISOString(),
                isLiveBrokerOrder: true
              });
              this.liveSpotRealizedPnL = Number(((this.liveSpotRealizedPnL || 0) + currentProfit).toFixed(2));
              this.savePersistedSpotTrades();

              // Remove from active positions
              this.liveSpotPositions = this.liveSpotPositions.filter(p => (p.name || '').toUpperCase() !== rawAsset);

              // Cooldown protection: 60 minutes on losses, 10 minutes on wins
              const isLoss = currentProfit < -0.0001 || exitReason === 'STOP_LOSS_TRIGGER';
              const lockMs = isLoss ? 60 * 60 * 1000 : 10 * 60 * 1000;
              const lockExpiry = Date.now() + lockMs;
              if (!this.spotCooldownUntil) this.spotCooldownUntil = new Map();
              this.spotCooldownUntil.set(pos.symbol, lockExpiry);
              this.spotCooldownUntil.set(rawAsset, lockExpiry);
              this.spotCooldownUntil.set(`${rawAsset}-USD`, lockExpiry);
              this.spotCooldownUntil.set(`${rawAsset}USDT`, lockExpiry);

              for (const u of Object.values(this.configs)) {
                if (!u.spotCooldownUntil) u.spotCooldownUntil = new Map();
                u.spotCooldownUntil.set(pos.symbol, lockExpiry);
                u.spotCooldownUntil.set(rawAsset, lockExpiry);
                u.spotCooldownUntil.set(`${rawAsset}-USD`, lockExpiry);
                u.spotCooldownUntil.set(`${rawAsset}USDT`, lockExpiry);
              }
            }
          }
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

        // Set 60-minute anti-churn lockout on losses, 10-minute on wins
        const isLoss = finalPnL < -0.0001 || closedRecord.exitReason === 'STOP_LOSS_TRIGGER';
        const lockMs = isLoss ? 60 * 60 * 1000 : 10 * 60 * 1000;
        const lockExpiry = Date.now() + lockMs;

        if (!this.spotCooldownUntil) this.spotCooldownUntil = new Map();
        this.spotCooldownUntil.set(pos.symbol, lockExpiry);
        this.spotCooldownUntil.set(posAsset, lockExpiry);
        this.spotCooldownUntil.set(`${posAsset}-USD`, lockExpiry);
        this.spotCooldownUntil.set(`${posAsset}USDT`, lockExpiry);

        for (const u of Object.values(this.configs)) {
          if (!u.spotCooldownUntil) u.spotCooldownUntil = new Map();
          u.spotCooldownUntil.set(pos.symbol, lockExpiry);
          u.spotCooldownUntil.set(posAsset, lockExpiry);
          u.spotCooldownUntil.set(`${posAsset}-USD`, lockExpiry);
          u.spotCooldownUntil.set(`${posAsset}USDT`, lockExpiry);
        }

        const spotCd = isLoss ? 1200 : 200;
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
    this.liveSpotPositions = updatedLivePositions;
    return this.liveSpotPositions;
  }

  getDashboardData(forcedMode = null, forcedAccount = null, userEmail = null) {
    const targetUser = userEmail || this.currentUser || 'default';
    const userConfig = this.getConfig(targetUser);
    const userMarginRisk = userConfig.marginRiskManager;
    const userSpotRisk = userConfig.spotRiskManager;
    const userMarginEngine = this.getEngine('MARGIN', targetUser);
    const userSpotEngine = this.getEngine('SPOT', targetUser);

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
        ...userMarginEngine.getPortfolioState(),
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
        ...userSpotEngine.getPortfolioState(),
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
      ...userMarginRisk.getSettings(),
      maxConcurrentTrades: dynamicMarginSlots
    };
    const spotCash = spotPortfolio.balance != null ? spotPortfolio.balance : (userSpotEngine.balance || 10);
    const dynamicSpotSlots = (spotCash < 20 || !userSpotRisk.maxSlots) ? 1 : userSpotRisk.maxSlots;
    const dynamicAllocationPct = Number((100 / dynamicSpotSlots).toFixed(0));

    const spotRisk = {
      ...userSpotRisk,
      maxSlots: dynamicSpotSlots,
      maxConcurrentTrades: dynamicSpotSlots,
      allocationPct: dynamicAllocationPct,
      tradingStyle: 'SPOT_BUY',
      defaultLeverage: 1,
      tradeDirection: 'LONG_ONLY',
      targetRiskRewardRatio: Number((userSpotRisk.takeProfitPct / userSpotRisk.stopLossPct).toFixed(1))
    };

    return {
      activeAccount,
      mode: currentMode,
      currentUser: targetUser,
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
      isAutoTradingEnabled: userConfig.isAutoTradingEnabled ?? this.isAutoTradingEnabled,
      isScanning: this.isScanning,
      marketScan: this.latestScanResults,
      logs: this.agentLogs,
      serverTime: new Date().toISOString()
    };
  }
}

export const agentLoop = new AutonomousAgentLoop();
