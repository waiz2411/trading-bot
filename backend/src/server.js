import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { agentLoop } from './services/agentLoop.js';
import { marketDataService } from './services/marketData.js';
import { authService } from './services/authService.js';
import { binanceConnector } from './services/binanceConnector.js';
import { mt5Connector } from './services/mt5Connector.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE']
}));
app.use(express.json());

// ====================================================
// AUTHENTICATION ROUTES
// ====================================================
app.post('/api/auth/register', (req, res) => {
  try {
    const { email, password, name } = req.body;
    const result = authService.register({ email, password, name });
    agentLoop.setUserMode(result.user.email, result.user.mode);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/auth/login', (req, res) => {
  try {
    const { email, password } = req.body;
    const result = authService.login(email, password);
    agentLoop.setUserMode(result.user.email, result.user.mode);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

app.get('/api/auth/me', (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const user = authService.validateToken(token);
    if (!user) {
      return res.status(401).json({ error: 'Session expired or invalid' });
    }
    agentLoop.setUserMode(user.email, user.mode);
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/logout', (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    authService.logout(token);
    // Note: Background auto-trading bot continues running 24/7 autonomously on server
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ====================================================
// BROKER & EXCHANGE INTEGRATION ROUTES
// ====================================================
// Binance Spot Config & Test
app.post('/api/broker/binance/config', (req, res) => {
  try {
    const { email, apiKey, apiSecret, isTestnet } = req.body;
    const status = binanceConnector.configure({ apiKey, apiSecret, isTestnet });
    if (email) {
      authService.updateBrokerConfig(email, 'binance', {
        apiKey,
        apiSecret,
        isTestnet: !!isTestnet,
        connected: false,
        status: apiKey ? 'STANDBY' : 'DISCONNECTED'
      });
    }
    res.json({ success: true, binance: status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/broker/binance/test', async (req, res) => {
  try {
    const { email, apiKey, apiSecret, isTestnet } = req.body;
    if (apiKey || apiSecret) {
      binanceConnector.configure({ apiKey, apiSecret, isTestnet });
    }
    const result = await binanceConnector.testConnection();
    if (result.connected && email) {
      authService.updateBrokerConfig(email, 'binance', {
        apiKey,
        apiSecret,
        isTestnet: !!isTestnet,
        connected: true,
        status: 'CONNECTED',
        lastChecked: new Date().toISOString()
      });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/broker/binance/balances', async (req, res) => {
  try {
    const balances = await binanceConnector.getBalances();
    res.json({ success: true, balances });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// MetaTrader 5 Config & Test
app.post('/api/broker/mt5/config', (req, res) => {
  try {
    const { email, login, password, server, gatewayUrl } = req.body;
    const status = mt5Connector.configure({ login, password, server, gatewayUrl });
    if (email) {
      authService.updateBrokerConfig(email, 'mt5', {
        login,
        password,
        server,
        gatewayUrl,
        connected: false,
        status: login && server ? 'STANDBY' : 'DISCONNECTED'
      });
    }
    res.json({ success: true, mt5: status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/broker/mt5/test', async (req, res) => {
  try {
    const { email, login, password, server, gatewayUrl } = req.body;
    if (login || server) {
      mt5Connector.configure({ login, password, server, gatewayUrl });
    }
    const result = await mt5Connector.testConnection();
    if (result.connected && email) {
      authService.updateBrokerConfig(email, 'mt5', {
        login,
        password,
        server,
        gatewayUrl,
        connected: true,
        status: 'CONNECTED',
        lastChecked: new Date().toISOString()
      });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/broker/mt5/account', (req, res) => {
  try {
    res.json({ success: true, mt5: mt5Connector.getStatus() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// MT5 Expert Advisor (EA) Heartbeat & Order Sync (100% Free / Unlimited SaaS Clients)
app.post('/api/broker/mt5/sync', (req, res) => {
  try {
    const { syncToken, login, server, balance, equity, freeMargin, leverage, currency } = req.body;
    if (!syncToken) {
      return res.status(400).json({ success: false, error: 'Missing syncToken in request.' });
    }

    const user = authService.getUserBySyncToken(syncToken);
    const result = mt5Connector.handleEaSync({
      syncToken,
      login,
      server,
      balance,
      equity,
      freeMargin,
      leverage,
      currency
    });

    if (user) {
      authService.updateBrokerConfig(user.email, 'mt5', {
        login: login || user.brokerConnections?.mt5?.login,
        server: server || user.brokerConnections?.mt5?.server,
        connected: true,
        status: 'CONNECTED',
        lastChecked: new Date().toISOString()
      });
    }

    res.json({
      success: true,
      connected: true,
      server: result.server,
      orders: result.orders || []
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Download Expert Advisor file directly
app.get('/api/broker/mt5/download-ea', (req, res) => {
  try {
    const eaPath = path.resolve(__dirname, '../../mt5-bridge/NexusQuant_Sync.mq5');
    if (fs.existsSync(eaPath)) {
      res.download(eaPath, 'NexusQuant_Sync.mq5');
    } else {
      res.status(404).json({ error: 'EA source file not found.' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Get complete dashboard state
app.get('/api/dashboard', (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const user = authService.validateToken(token);
    if (user && user.email !== agentLoop.currentUser) {
      agentLoop.setUserMode(user.email, user.mode);
    }
    const data = agentLoop.getDashboardData();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Toggle autonomous trading mode
app.post('/api/agent/toggle', (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const user = authService.validateToken(token);
    const userEmail = user ? user.email : agentLoop.currentUser;
    const newState = agentLoop.toggleAutoTrading(null, userEmail);
    res.json({ success: true, isAutoTradingEnabled: newState });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// API: Switch active account view ('MARGIN' | 'SPOT')
app.post('/api/account/switch', (req, res) => {
  try {
    const { account } = req.body;
    const active = agentLoop.switchAccount(account);
    res.json({ success: true, activeAccount: active, ...agentLoop.getDashboardData() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Update risk management settings (supports MARGIN and SPOT)
app.post('/api/agent/settings', (req, res) => {
  try {
    const { account, stopLossPct, takeProfitPct, ...otherSettings } = req.body;
    const targetAccount = (account || agentLoop.activeAccount).toUpperCase();

    if (targetAccount === 'SPOT' || stopLossPct !== undefined || takeProfitPct !== undefined) {
      agentLoop.updateSpotSettings({ stopLossPct, takeProfitPct, ...otherSettings });
      res.json({ success: true, spotSettings: agentLoop.spotRiskManager, settings: agentLoop.getDashboardData().riskSettings });
    } else {
      agentLoop.marginRiskManager.updateSettings(otherSettings);
      agentLoop.log(`Margin settings updated: ${JSON.stringify(otherSettings)}`, 'INFO');
      res.json({ success: true, settings: agentLoop.marginRiskManager.getSettings() });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Set Trade Direction (SHORT_ONLY, BOTH, LONG_ONLY)
app.post('/api/agent/direction', (req, res) => {
  try {
    const { direction } = req.body;
    if (!['SHORT_ONLY', 'BOTH', 'LONG_ONLY'].includes(direction)) {
      return res.status(400).json({ error: 'Invalid direction value' });
    }
    const settings = agentLoop.setTradeDirection(direction);
    res.json({ success: true, settings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Set Trading Style (SCALPING vs SWING)
app.post('/api/agent/style', (req, res) => {
  try {
    const { style } = req.body;
    if (!['SCALPING', 'SWING'].includes(style)) {
      return res.status(400).json({ error: 'Invalid style value' });
    }
    const settings = agentLoop.setTradingStyle(style);
    res.json({ success: true, settings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Set Leverage (1x to 500x)
app.post('/api/agent/leverage', (req, res) => {
  try {
    const { leverage } = req.body;
    const levNum = parseInt(leverage, 10);
    if (isNaN(levNum) || levNum < 1 || levNum > 500) {
      return res.status(400).json({ error: 'Leverage must be between 1x and 500x' });
    }
    agentLoop.marginRiskManager.updateSettings({ defaultLeverage: levNum });
    agentLoop.log(`⚙️ Account leverage updated to ${levNum}x`, 'INFO');
    res.json({ success: true, settings: agentLoop.marginRiskManager.getSettings() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Custom Balance Management (Set exact balance for MARGIN or SPOT)
app.post('/api/portfolio/balance', (req, res) => {
  try {
    const { balance, closeOpenPositions, account } = req.body;
    const num = parseFloat(balance);
    if (isNaN(num) || num <= 0) {
      return res.status(400).json({ error: 'Please provide a valid positive balance' });
    }
    const state = agentLoop.setBalance(num, !!closeOpenPositions, account);
    res.json({ success: true, portfolio: state, dashboard: agentLoop.getDashboardData() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Adjust Balance (Add or Subtract for MARGIN or SPOT)
app.post('/api/portfolio/adjust', (req, res) => {
  try {
    const { delta, account } = req.body;
    const num = parseFloat(delta);
    if (isNaN(num)) {
      return res.status(400).json({ error: 'Invalid delta amount' });
    }
    const state = agentLoop.adjustBalance(num, account);
    res.json({ success: true, portfolio: state, dashboard: agentLoop.getDashboardData() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Close an active trade manually (checks active engine, then fallback)
app.post('/api/trades/close/:id', (req, res) => {
  try {
    const { id } = req.params;
    let closed = agentLoop.tradingEngine.closePosition(id, null, 'MANUAL_USER_EXIT', 'Manual user exit via dashboard');
    if (!closed) {
      const otherEngine = agentLoop.activeAccount === 'SPOT' ? agentLoop.marginTradingEngine : agentLoop.spotTradingEngine;
      closed = otherEngine.closePosition(id, null, 'MANUAL_USER_EXIT', 'Manual user exit via dashboard');
    }
    if (!closed) {
      return res.status(404).json({ error: 'Trade not found or already closed' });
    }
    agentLoop.log(
      `✋ Manual Exit: ${closed.symbol} (${closed.side}). Realized: ${closed.finalPnL >= 0 ? '+' : ''}$${closed.finalPnL}`,
      closed.finalPnL >= 0 ? 'SUCCESS' : 'WARN'
    );
    res.json({ success: true, closedTrade: closed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Close ALL active trades at once
app.post('/api/trades/close-all', (req, res) => {
  try {
    const targetEngine = agentLoop.tradingEngine;
    const active = [...targetEngine.activePositions];
    const closedList = [];
    for (const pos of active) {
      const closed = targetEngine.closePosition(pos.id, null, 'MANUAL_USER_EXIT', 'Close All Triggered');
      if (closed) closedList.push(closed);
    }
    agentLoop.log(`🧹 Closed all ${closedList.length} active positions in [${agentLoop.activeAccount}].`, 'INFO');
    res.json({ success: true, closedCount: closedList.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Execute trade on demand
app.post('/api/trades/execute', (req, res) => {
  try {
    const { symbol, side } = req.body;
    const asset = marketDataService.getMarket(symbol);
    if (!asset) return res.status(404).json({ error: 'Asset not found' });

    const scanItem = agentLoop.latestScanResults.find(s => s.symbol === symbol);
    const stopDist = asset.price * 0.003;
    const targetDist = stopDist * 1.55;

    const signal = scanItem?.signal || {
      action: side === 'LONG' ? 'BUY' : 'SELL',
      side,
      confidence: 85,
      entryPrice: asset.price,
      stopLoss: side === 'LONG' ? asset.price - stopDist : asset.price + stopDist,
      takeProfit: side === 'LONG' ? asset.price + targetDist : asset.price - targetDist,
      stopDistance: stopDist,
      targetDistance: targetDist,
      riskRewardRatio: 1.55,
      reason: 'Manual execution triggered via Dashboard'
    };

    // Handle SPOT execution mode
    if (agentLoop.activeAccount === 'SPOT') {
      if (asset.category !== 'Crypto') {
        return res.status(400).json({ error: 'Pure Spot trading is only supported for Crypto assets.' });
      }
      if (agentLoop.spotTradingEngine.activePositions.length > 0) {
        return res.status(400).json({ error: 'Spot Account allows 1 active coin position at 100% capital allocation. Close current position first.' });
      }
      const spotCash = agentLoop.spotTradingEngine.balance;
      if (spotCash < 0.5) {
        return res.status(400).json({ error: 'Insufficient Spot balance to open trade.' });
      }

      const notional = Number(spotCash.toFixed(2));
      const entryPrice = asset.price;
      const rawUnits = notional / entryPrice;
      const units = Number(rawUnits.toFixed(asset.decimals || 4));
      const stopDist = Number((entryPrice * (agentLoop.spotRiskManager.stopLossPct / 100)).toFixed(asset.decimals || 4));
      const targetDist = Number((entryPrice * (agentLoop.spotRiskManager.takeProfitPct / 100)).toFixed(asset.decimals || 4));
      const stopLoss = Number((entryPrice - stopDist).toFixed(asset.decimals || 4));
      const takeProfit = Number((entryPrice + targetDist).toFixed(asset.decimals || 4));

      const trade = agentLoop.spotTradingEngine.openPosition({
        symbol: asset.symbol,
        name: asset.name,
        category: 'Crypto',
        side: 'LONG',
        entryPrice,
        stopLoss,
        takeProfit,
        stopDistance: stopDist,
        targetDistance: targetDist,
        units,
        notional,
        confidence: 90,
        reason: 'Manual 100% Spot Buy via Dashboard',
        riskRewardRatio: Number((agentLoop.spotRiskManager.takeProfitPct / agentLoop.spotRiskManager.stopLossPct).toFixed(1)),
        tradingStyle: 'SPOT_BUY',
        leverage: 1,
        margin: notional,
        liquidationPrice: 0
      });

      agentLoop.log(`🪙 [SPOT] MANUAL 100% BUY: Bought ${trade.symbol} with $${notional} (100% Spot Balance) @ $${entryPrice}`, 'SUCCESS');
      return res.json({ success: true, trade });
    }

    // MARGIN SCALPER execution mode
    const portfolio = agentLoop.marginTradingEngine.getPortfolioState();
    const riskEval = agentLoop.marginRiskManager.evaluateTradeRisk(portfolio, { ...signal, confidence: 99 }, asset);

    if (!riskEval.allowed) {
      return res.status(400).json({ error: riskEval.reason });
    }

    const trade = agentLoop.marginTradingEngine.openPosition({
      symbol: asset.symbol,
      name: asset.name,
      category: asset.category,
      side: side || signal.side,
      entryPrice: asset.price,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      stopDistance: signal.stopDistance || stopDist,
      targetDistance: signal.targetDistance || targetDist,
      units: riskEval.units,
      notional: riskEval.notional,
      confidence: signal.confidence,
      reason: `Manual One-Click Scalp (${signal.reason || 'User initiated'})`,
      riskRewardRatio: signal.riskRewardRatio || 1.55,
      tradingStyle: 'SCALPING',
      leverage: riskEval.leverage,
      margin: riskEval.margin,
      liquidationPrice: riskEval.liquidationPrice
    });

    agentLoop.log(`🖐️ [MARGIN] MANUAL SCALP OPENED: ${trade.side} ${trade.symbol} @ $${trade.entryPrice} (${riskEval.leverage}x Lev, Margin: $${riskEval.margin})`, 'INFO');
    res.json({ success: true, trade });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Reset paper portfolio to initial state
app.post('/api/portfolio/reset', (req, res) => {
  try {
    const { initialBalance, account } = req.body;
    const targetAccount = (account || agentLoop.activeAccount).toUpperCase();
    const engine = targetAccount === 'SPOT' ? agentLoop.spotTradingEngine : agentLoop.marginTradingEngine;
    const initBal = initialBalance !== undefined ? parseFloat(initialBalance) : 10;
    const resetState = engine.reset(initBal);
    agentLoop.log(`🔄 [${targetAccount}] Portfolio reset to $${initBal.toLocaleString('en-US')} virtual balance.`, 'WARN');
    res.json({ success: true, portfolio: resetState, dashboard: agentLoop.getDashboardData() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve static frontend assets in production (Render single-service deployment)
const distPath = path.resolve(__dirname, '../../frontend/dist');
app.use(express.static(distPath));

// Fallback all non-API routes to index.html (SPA client routing)
app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

// Start agent loop and web server
agentLoop.setUserMode('demo@gmail.com', 'SIMULATED');
agentLoop.start();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`=======================================================`);
  console.log(`🚀 Scalping Agent Backend running on port ${PORT}`);
  console.log(`📡 Autonomous Scalp Loop active: 27 Global Markets | 500x Lev | 1:1.3 R:R`);
  console.log(`=======================================================`);
});
