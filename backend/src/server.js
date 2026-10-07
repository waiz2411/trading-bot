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
import { mexcConnector } from './services/mexcConnector.js';

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
// SECONDARY REPLICA MODE (Mirrors Master Hostinger 100%)
// ====================================================
const PRIMARY_BACKEND_URL = process.env.PRIMARY_BACKEND_URL;
if (PRIMARY_BACKEND_URL) {
  console.log(`📡 Mirror Replica Mode Active: Proxying /api traffic to Master: ${PRIMARY_BACKEND_URL}`);
  
  app.use('/api', async (req, res, next) => {
    // Keep local proxy and server diagnostic routes handled by this replica server
    if (req.path.startsWith('/binance-proxy') || req.path === '/system/ip') {
      return next();
    }

    try {
      const cleanPrimary = PRIMARY_BACKEND_URL.replace(/\/+$/, '');
      const targetUrl = `${cleanPrimary}${req.originalUrl}`;
      
      const headers = {};
      for (const [k, v] of Object.entries(req.headers)) {
        const lower = k.toLowerCase();
        if (lower !== 'host' && lower !== 'content-length' && lower !== 'connection') {
          headers[k] = v;
        }
      }

      const fetchOptions = {
        method: req.method,
        headers
      };

      if (req.method !== 'GET' && req.method !== 'HEAD' && req.body && Object.keys(req.body).length > 0) {
        fetchOptions.body = JSON.stringify(req.body);
        headers['content-type'] = 'application/json';
      }

      const masterRes = await fetch(targetUrl, fetchOptions);
      const contentType = masterRes.headers.get('content-type') || 'application/json';
      const data = await masterRes.text();

      const setCookies = masterRes.headers.getSetCookie ? masterRes.headers.getSetCookie() : [masterRes.headers.get('set-cookie')].filter(Boolean);
      for (const c of setCookies) {
        res.append('Set-Cookie', c);
      }

      res.status(masterRes.status).header('content-type', contentType).send(data);
    } catch (err) {
      res.status(502).json({ error: `Master sync error: ${err.message}` });
    }
  });
}

// ====================================================
// AUTHENTICATION & MULTI-TENANT SAAS ROUTES
// ====================================================
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name, phone, accountType } = req.body;
    const result = await authService.register({ email, password, name, phone, accountType });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await authService.login(email, password);
    agentLoop.setUserMode(result.user.email, result.user.mode);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

app.get('/api/auth/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const user = await authService.validateToken(token);
    if (!user) {
      return res.status(401).json({ error: 'Session expired or invalid' });
    }
    agentLoop.setUserMode(user.email, user.mode);
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    await authService.logout(token);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Switch User Mode: SIMULATED (Demo) vs LIVE (Real Broker)
app.post('/api/user/mode', async (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const user = await authService.validateToken(token);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const { mode } = req.body;
    const updatedMode = await authService.setUserActiveMode(user.email, mode);
    agentLoop.setUserMode(user.email, updatedMode);

    const updatedUser = await authService.getUserByEmail(user.email);
    res.json({ success: true, mode: updatedMode, user: authService.sanitizeUser(updatedUser) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ====================================================
// ADMIN USER MANAGEMENT ROUTES (Admin Only)
// ====================================================
// Middleware to verify Admin role
const requireAdmin = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const user = await authService.validateToken(token);
    if (!user || user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Forbidden: Admin privileges required.' });
    }
    req.adminUser = user;
    next();
  } catch (err) {
    res.status(403).json({ error: 'Unauthorized access.' });
  }
};

app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const users = await authService.getAllUsers();
    res.json({ success: true, users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/users/status', requireAdmin, async (req, res) => {
  try {
    const { userId, status } = req.body;
    const result = await authService.updateUserStatus(userId, status);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/admin/users/:id/trades', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const trades = await authService.getUserTradeHistory(id);
    res.json({ success: true, trades });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await authService.deleteUser(id);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ====================================================
// BROKER & EXCHANGE INTEGRATION ROUTES
// ====================================================
// Binance Spot Config & Test
app.post('/api/broker/binance/config', (req, res) => {
  try {
    const { email, apiKey, apiSecret, isTestnet, proxyUrl } = req.body;
    const status = binanceConnector.configure({ apiKey, apiSecret, isTestnet, proxyUrl });
    if (email) {
      authService.updateBrokerConfig(email, 'binance', {
        apiKey,
        apiSecret,
        isTestnet: !!isTestnet,
        proxyUrl: proxyUrl ? proxyUrl.trim() : '',
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
    const { email, apiKey, apiSecret, isTestnet, proxyUrl } = req.body;
    if (apiKey || apiSecret || proxyUrl !== undefined) {
      binanceConnector.configure({ apiKey, apiSecret, isTestnet, proxyUrl });
    }
    const result = await binanceConnector.testConnection();
    const targetEmail = email || agentLoop.currentUser;
    if (result.connected && targetEmail) {
      authService.updateBrokerConfig(targetEmail, 'binance', {
        apiKey,
        apiSecret,
        isTestnet: !!isTestnet,
        proxyUrl: binanceConnector.proxyUrl || (proxyUrl ? proxyUrl.trim() : ''),
        connected: true,
        status: 'CONNECTED',
        balances: result.balances || [],
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

app.post('/api/broker/binance/convert-dust', async (req, res) => {
  try {
    const { assets } = req.body || {};
    let targetAssets = assets;
    if (!targetAssets || targetAssets.length === 0) {
      const balances = await binanceConnector.getBalances();
      targetAssets = balances
        .filter(b => b.asset !== 'USDT' && b.asset !== 'BNB' && b.free > 0.00001)
        .map(b => b.asset);
    }
    const result = await binanceConnector.convertDustToBnb(targetAssets);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Transparent Binance Proxy Route (Permits US nodes like Hostinger to proxy through European nodes like Render)
app.all('/api/binance-proxy/*', async (req, res) => {
  try {
    const subPath = req.originalUrl.replace(/^\/api\/binance-proxy/, '');
    const targetUrl = `https://api.binance.com${subPath}`;
    
    const headers = {};
    for (const [key, val] of Object.entries(req.headers)) {
      const lower = key.toLowerCase();
      if (lower !== 'host' && lower !== 'content-length' && lower !== 'connection') {
        headers[key] = val;
      }
    }

    const fetchOptions = {
      method: req.method,
      headers
    };

    const hasBody = req.body && (
      (typeof req.body === 'object' && Object.keys(req.body).length > 0) ||
      (typeof req.body === 'string' && req.body.length > 0)
    );

    if (req.method !== 'GET' && req.method !== 'HEAD' && hasBody) {
      fetchOptions.body = typeof req.body === 'object' ? JSON.stringify(req.body) : req.body;
      headers['content-type'] = 'application/json';
    } else {
      delete headers['content-type'];
    }

    const binanceRes = await fetch(targetUrl, fetchOptions);
    const contentType = binanceRes.headers.get('content-type') || 'application/json';
    const data = await binanceRes.text();
    
    res.status(binanceRes.status).header('content-type', contentType).send(data);
  } catch (err) {
    res.status(502).json({ error: `Binance proxy error: ${err.message}` });
  }
});

// MetaTrader 5 Config & Test
app.post('/api/broker/mt5/register-tunnel', (req, res) => {
  try {
    const { url } = req.body;
    if (url && typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
      const cleanUrl = url.trim().replace(/\/+$/, '');
      mt5Connector.gatewayUrl = cleanUrl;
      console.log(`[MT5 Bridge] Registered public gateway URL: ${cleanUrl}`);

      // Propagate registered gateway URL across user profiles to prevent overwrite
      if (authService.users) {
        for (const u of Object.values(authService.users)) {
          if (u.brokerConnections && u.brokerConnections.mt5) {
            u.brokerConnections.mt5.gatewayUrl = cleanUrl;
          }
        }
        authService.saveUsers();
      }

      mt5Connector.tryGatewayConnection().catch(() => {});
      return res.json({ success: true, gatewayUrl: cleanUrl });
    }
    return res.status(400).json({ success: false, error: 'Valid gateway URL required' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/broker/mt5/gateway-url', (req, res) => {
  res.json({ success: true, gatewayUrl: mt5Connector.gatewayUrl || '' });
});

app.post('/api/broker/mt5/config', (req, res) => {
  try {
    const { email, login, password, server, gatewayUrl, metaApiToken, connectionType } = req.body;
    const existing = email ? authService.getUser(email)?.brokerConnections?.mt5 : null;
    const isSameCreds = existing && String(existing.login) === String(login) && existing.server === server;
    const connected = isSameCreds ? Boolean(existing.connected) : false;

    const status = mt5Connector.configure({
      login,
      password,
      server,
      gatewayUrl,
      metaApiToken,
      connectionType,
      connected,
      status: connected ? 'CONNECTED' : (login && server ? 'STANDBY' : 'DISCONNECTED')
    });

    if (email) {
      authService.updateBrokerConfig(email, 'mt5', {
        login,
        password,
        server,
        gatewayUrl,
        metaApiToken,
        connectionType,
        connected,
        status: connected ? 'CONNECTED' : (login && server ? 'STANDBY' : 'DISCONNECTED')
      });
    }
    res.json({ success: true, mt5: status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/broker/mt5/test', async (req, res) => {
  try {
    const { email, login, password, server, gatewayUrl, metaApiToken, connectionType } = req.body;
    if (login || server || connectionType) {
      mt5Connector.configure({ login, password, server, gatewayUrl, metaApiToken, connectionType });
    }
    const result = await mt5Connector.testConnection();
    if (result.connected && email) {
      authService.updateBrokerConfig(email, 'mt5', {
        login,
        password,
        server,
        gatewayUrl,
        metaApiToken,
        connectionType,
        connected: true,
        status: 'CONNECTED',
        accountInfo: result.accountInfo,
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
app.post(['/api/broker/mt5/sync', '/api/broker/mt5/ea/sync'], (req, res) => {
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

// ====================================================
// MEXC GLOBAL ROUTES (Spot & 200x Futures Margin)
// ====================================================
app.post('/api/broker/mexc/config', (req, res) => {
  try {
    const { email, apiKey, apiSecret, defaultLeverage } = req.body;
    const status = mexcConnector.configure({ apiKey, apiSecret, defaultLeverage });
    if (email) {
      authService.updateBrokerConfig(email, 'mexc', {
        apiKey,
        apiSecret,
        defaultLeverage: defaultLeverage || 50,
        connected: false,
        status: apiKey ? 'STANDBY' : 'DISCONNECTED'
      });
    }
    res.json({ success: true, mexc: status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/broker/mexc/test', async (req, res) => {
  try {
    const { email, apiKey, apiSecret, defaultLeverage } = req.body;
    if (apiKey || apiSecret) {
      mexcConnector.configure({ apiKey, apiSecret, defaultLeverage });
    }
    const result = await mexcConnector.testConnection();
    if (result.connected && email) {
      authService.updateBrokerConfig(email, 'mexc', {
        apiKey,
        apiSecret,
        defaultLeverage: defaultLeverage || 50,
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

app.get('/api/broker/mexc/balances', async (req, res) => {
  try {
    const balances = await mexcConnector.getBalances();
    res.json({ success: true, balances });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Outbound Server IP & Region Detection (for Binance API IP Whitelist & Jurisdiction Check)
app.get('/api/system/ip', async (req, res) => {
  try {
    const ipRes = await fetch('http://ip-api.com/json/', { signal: AbortSignal.timeout(3000) });
    const data = await ipRes.json();
    res.json({ 
      success: true, 
      ip: data.query, 
      country: data.country || 'Unknown', 
      countryCode: data.countryCode || '', 
      region: data.regionName || '',
      city: data.city || '',
      isUS: data.countryCode === 'US'
    });
  } catch (err) {
    try {
      const fallback = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(2000) });
      const fData = await fallback.json();
      res.json({ success: true, ip: fData.ip, country: '', countryCode: '', isUS: false });
    } catch (e2) {
      res.json({ success: false, error: err.message });
    }
  }
});

// API: Get complete dashboard state
app.get('/api/dashboard', async (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const user = await authService.validateToken(token);
    
    const userEmail = user ? user.email : 'default';
    const userMode = (user && user.mode) ? user.mode : (userEmail === 'waiztahseen@gmail.com' ? 'LIVE' : 'SIMULATED');
    const userAccount = (user && (user.accountType || user.account_type)) ? (user.accountType || user.account_type) : agentLoop.activeAccount;

    const uConfig = agentLoop.getConfig(userEmail);
    if (user && user.isAutoTradingEnabled !== undefined && uConfig.isAutoTradingEnabled === undefined) {
      uConfig.isAutoTradingEnabled = user.isAutoTradingEnabled;
    }

    if (userMode === 'LIVE' && binanceConnector.connected) {
      const freshBals = await binanceConnector.getBalances().catch(() => {});
      if (freshBals && freshBals.length > 0 && userEmail && userEmail !== 'default') {
        authService.updateBrokerConfig(userEmail, 'binance', {
          balances: freshBals,
          lastChecked: new Date().toISOString()
        }).catch(() => {});
      }
    }

    const data = agentLoop.getDashboardData(userMode, userAccount, userEmail);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Toggle autonomous trading mode
app.post('/api/agent/toggle', async (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const user = await authService.validateToken(token);
    const userEmail = user ? user.email : 'default';
    const newState = agentLoop.toggleAutoTrading(null, userEmail);
    res.json({ success: true, isAutoTradingEnabled: newState });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// API: Switch active account view ('MARGIN' | 'SPOT')
app.post('/api/account/switch', async (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const user = await authService.validateToken(token);
    const userEmail = user ? user.email : 'default';

    const { account } = req.body;
    if (user && user.email) {
      await authService.setUserActiveAccount(user.email, account);
    }
    const dashboard = agentLoop.getDashboardData(null, account, userEmail);
    res.json({ success: true, activeAccount: account, ...dashboard });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Update risk management settings (supports MARGIN and SPOT)
app.post('/api/agent/settings', async (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const user = await authService.validateToken(token);
    const userEmail = user ? user.email : 'default';

    const { account, stopLossPct, takeProfitPct, ...otherSettings } = req.body;
    const targetAccount = (account || agentLoop.activeAccount).toUpperCase();

    if (targetAccount === 'SPOT') {
      agentLoop.updateSpotSettings({ stopLossPct, takeProfitPct, ...otherSettings }, userEmail);
    } else {
      agentLoop.updateMarginSettings(otherSettings, userEmail);
    }

    // Always pause bot on configuration change so user can review before launching
    if (agentLoop.isAutoTradingEnabled) {
      agentLoop.toggleAutoTrading(false, userEmail);
      agentLoop.log('⏸️ Bot paused automatically after settings change. Click Start to resume trading.', 'WARN');
    }

    const userConfig = agentLoop.getConfig(userEmail);
    const dashboard = agentLoop.getDashboardData(null, null, userEmail);
    res.json({
      success: true,
      spotSettings: userConfig.spotRiskManager,
      marginSettings: userConfig.marginRiskManager.getSettings(),
      settings: dashboard.riskSettings,
      isAutoTradingEnabled: agentLoop.isAutoTradingEnabled
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Set Trade Direction (SHORT_ONLY, BOTH, LONG_ONLY)
app.post('/api/agent/direction', async (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const user = await authService.validateToken(token);
    const userEmail = user ? user.email : 'default';

    const { direction } = req.body;
    if (!['SHORT_ONLY', 'BOTH', 'LONG_ONLY'].includes(direction)) {
      return res.status(400).json({ error: 'Invalid direction value' });
    }
    const config = agentLoop.getConfig(userEmail);
    config.marginRiskManager.tradeDirection = direction;
    agentLoop.log(`🧭 Trade Direction Mode updated: ${direction} for ${userEmail}`, 'INFO');
    res.json({ success: true, settings: config.marginRiskManager.getSettings() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Set Trading Style (SCALPING vs SWING)
app.post('/api/agent/style', async (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const user = await authService.validateToken(token);
    const userEmail = user ? user.email : 'default';

    const { style } = req.body;
    if (!['SCALPING', 'SWING'].includes(style)) {
      return res.status(400).json({ error: 'Invalid style value' });
    }
    const config = agentLoop.getConfig(userEmail);
    config.marginRiskManager.tradingStyle = style;
    const engine = agentLoop.getEngine('MARGIN', userEmail);
    engine.scalpModeEnabled = style === 'SCALPING';
    agentLoop.log(`⏱️ Trading Horizon updated: ${style} for ${userEmail}`, 'INFO');
    res.json({ success: true, settings: config.marginRiskManager.getSettings() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Set Leverage (1x to 500x)
app.post('/api/agent/leverage', async (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const user = await authService.validateToken(token);
    const userEmail = user ? user.email : 'default';

    const { leverage } = req.body;
    const levNum = parseInt(leverage, 10);
    if (isNaN(levNum) || levNum < 1 || levNum > 500) {
      return res.status(400).json({ error: 'Leverage must be between 1x and 500x' });
    }
    const config = agentLoop.getConfig(userEmail);
    config.marginRiskManager.updateSettings({ defaultLeverage: levNum });
    agentLoop.log(`⚙️ Account leverage updated to ${levNum}x for ${userEmail}`, 'INFO');
    res.json({ success: true, settings: config.marginRiskManager.getSettings() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Custom Balance Management (Set exact balance for MARGIN or SPOT)
app.post('/api/portfolio/balance', async (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const user = await authService.validateToken(token);
    const userEmail = user ? user.email : 'default';
    const userMode = (user && user.mode) ? user.mode : (userEmail === 'waiztahseen@gmail.com' ? 'LIVE' : 'SIMULATED');

    const { balance, closeOpenPositions, account } = req.body;
    const num = parseFloat(balance);
    if (isNaN(num) || num <= 0) {
      return res.status(400).json({ error: 'Please provide a valid positive balance' });
    }
    const targetAccount = (account || agentLoop.activeAccount).toUpperCase();
    const state = agentLoop.setBalance(num, !!closeOpenPositions, targetAccount, userEmail);
    res.json({ success: true, portfolio: state, dashboard: agentLoop.getDashboardData(userMode, targetAccount, userEmail) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Adjust Balance (Add or Subtract for MARGIN or SPOT)
app.post('/api/portfolio/adjust', async (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const user = await authService.validateToken(token);
    const userEmail = user ? user.email : 'default';
    const userMode = (user && user.mode) ? user.mode : (userEmail === 'waiztahseen@gmail.com' ? 'LIVE' : 'SIMULATED');

    const { delta, account } = req.body;
    const num = parseFloat(delta);
    if (isNaN(num)) {
      return res.status(400).json({ error: 'Invalid delta amount' });
    }
    const targetAccount = (account || agentLoop.activeAccount).toUpperCase();
    const state = agentLoop.adjustBalance(num, targetAccount, userEmail);
    res.json({ success: true, portfolio: state, dashboard: agentLoop.getDashboardData(userMode, targetAccount, userEmail) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Close an active trade manually (supports MT5, Binance Spot, and Demo)
app.post('/api/trades/close/:id', async (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const user = await authService.validateToken(token);
    const userEmail = user ? user.email : agentLoop.currentUser;
    const { id } = req.params;

    // 1. Direct Binance Spot Position Close (supports BINANCE-xxx, xxx-USD, or live holdings)
    const isLiveSpotTrade = id.startsWith('BINANCE-') || (agentLoop.liveSpotPositions || []).some(p => p.id === id || p.symbol === id || (p.name && id.includes(p.name)));
    const userAccount = (user && (user.accountType || user.account_type)) || agentLoop.activeAccount;
    const userMode = (user && user.mode) || (isLiveSpotTrade ? 'LIVE' : agentLoop.currentMode);
    const isSpotContext = userAccount === 'SPOT' || isLiveSpotTrade;
    const isLive = userMode === 'LIVE' || isLiveSpotTrade;

    const liveSpotMatch = isLive ? (agentLoop.liveSpotPositions || []).find(p => 
      p.id === id || p.symbol === id || (p.name && id.includes(p.name)) || id.includes(p.symbol)
    ) : null;
    const demoSpotMatch = agentLoop.getEngine('SPOT', userEmail).activePositions.find(p => 
      p.id === id || p.symbol === id || id.includes(p.symbol) || (p.name && id.includes(p.name))
    );

    if (id.startsWith('BINANCE-') || isLiveSpotTrade || liveSpotMatch || (isSpotContext && (id.endsWith('-USD') || demoSpotMatch))) {
      let assetName = '';
      if (liveSpotMatch) {
        assetName = (liveSpotMatch.name || liveSpotMatch.symbol.replace(/[-_/]/g, '').replace(/USD$/, '')).toUpperCase();
      } else if (demoSpotMatch) {
        assetName = (demoSpotMatch.name || demoSpotMatch.symbol.replace(/[-_/]/g, '').replace(/USD$/, '')).toUpperCase();
      } else {
        assetName = id.replace('BINANCE-', '').replace(/-[0-9]+$/, '').replace(/[-_/]/g, '').replace(/USD$/, '').toUpperCase();
      }

      const binanceSymbol = `${assetName}USDT`;
      let soldUnits = 0;
      let tradeFinalPnL = 0;

      if (isLive && binanceConnector.connected) {
        const balances = await binanceConnector.getBalances(true);
        const coinBal = balances.find(b => b.asset.toUpperCase() === assetName);
        const qtyToSell = coinBal && coinBal.free > 0.00001 ? coinBal.free : (liveSpotMatch ? liveSpotMatch.units : 0);

        if (coinBal && coinBal.free > 0.00001) {
          try {
            const sellRes = await binanceConnector.placeSpotMarketOrder({
              symbol: binanceSymbol,
              side: 'SELL',
              quantity: qtyToSell
            });
            if (sellRes && (sellRes.success || sellRes.orderId || sellRes.status === 'FILLED')) {
              soldUnits = qtyToSell;
              agentLoop.log(`🪙 [BINANCE LIVE] Manual Exit: Sold ${qtyToSell} ${assetName} on Binance Spot`, 'SUCCESS');
              // Dust sweep
              await binanceConnector.convertDustToBnb([assetName]).catch(() => {});
            }
          } catch (sellErr) {
            const errMsg = sellErr.message || '';
            // If the coin is already sold on Binance or dust, synchronize closure
            if (errMsg.includes('insufficient balance') || errMsg.includes('-2010') || errMsg.includes('MIN_NOTIONAL')) {
              agentLoop.log(`🪙 [BINANCE LIVE] Manual Exit: ${assetName} was already sold on Binance (${errMsg}). Synchronizing closure cleanly.`, 'INFO');
            } else {
              agentLoop.log(`⚠️ [BINANCE LIVE] Manual exit notice for ${assetName}: ${errMsg}. Force-closing position in dashboard.`, 'WARN');
            }
          }
        } else {
          // If coin has already been sold on Binance (free <= 0.00001), synchronize closure cleanly
          soldUnits = liveSpotMatch ? liveSpotMatch.units : 0;
          agentLoop.log(`🪙 [BINANCE LIVE] Manual Exit: ${assetName} was already sold on Binance. Synchronizing closure cleanly.`, 'INFO');
        }

        // Calculate realized PnL for the live closed position
        if (liveSpotMatch) {
          const pricesMap = marketDataService.getAllPricesMap();
          const exitPrice = pricesMap[`${assetName}-USD`] || pricesMap[binanceSymbol] || liveSpotMatch.currentPrice || liveSpotMatch.entryPrice;
          const gross = (exitPrice - liveSpotMatch.entryPrice) * liveSpotMatch.units;
          const exitFee = Number((exitPrice * liveSpotMatch.units * (liveSpotMatch.feeRate || 0.00075)).toFixed(4));
          tradeFinalPnL = Number((gross - (liveSpotMatch.entryFee || 0) - exitFee).toFixed(2));
          const pnlPct = liveSpotMatch.notional > 0 ? Number(((tradeFinalPnL / liveSpotMatch.notional) * 100).toFixed(2)) : 0;

          if (!agentLoop.liveSpotClosedTrades) agentLoop.liveSpotClosedTrades = [];
          agentLoop.liveSpotClosedTrades.unshift({
            id: `BINANCE-${assetName}-${Date.now()}`,
            symbol: liveSpotMatch.symbol,
            name: assetName,
            side: 'LONG',
            entryPrice: liveSpotMatch.entryPrice,
            exitPrice,
            units: liveSpotMatch.units,
            notional: liveSpotMatch.notional,
            finalPnL: tradeFinalPnL,
            finalPnLPercent: pnlPct,
            fee: Number(((liveSpotMatch.entryFee || 0) + exitFee).toFixed(4)),
            exitReason: 'MANUAL_USER_EXIT',
            openTime: liveSpotMatch.openTime,
            exitTime: new Date().toISOString(),
            isLiveBrokerOrder: true
          });
          agentLoop.liveSpotRealizedPnL = Number(((agentLoop.liveSpotRealizedPnL || 0) + tradeFinalPnL).toFixed(2));
          agentLoop.savePersistedSpotTrades();

          // Remove from live positions
          agentLoop.liveSpotPositions = (agentLoop.liveSpotPositions || []).filter(p => (p.name || '').toUpperCase() !== assetName);
        }

        // Refresh cached balances and positions from Binance
        const updatedBals = await binanceConnector.getBalances().catch(() => []);
        agentLoop.syncLiveSpotPositions(updatedBals, marketDataService.getAllPricesMap());
      }

      // If demo position also existed, close in demo engine
      if (demoSpotMatch) {
        const closed = agentLoop.getEngine('SPOT', userEmail).closePosition(demoSpotMatch.id, null, 'MANUAL_USER_EXIT', 'Manual user exit via dashboard');
        if (closed && !isLive) {
          tradeFinalPnL = closed.finalPnL || 0;
        }
      }

      const isLoss = tradeFinalPnL < -0.0001;
      const lockMs = isLoss ? 15 * 60 * 1000 : 5 * 60 * 1000;
      const lockExp = Date.now() + lockMs;
      if (!agentLoop.spotCooldownUntil) agentLoop.spotCooldownUntil = new Map();
      agentLoop.spotCooldownUntil.set(`${assetName}-USD`, lockExp);
      agentLoop.spotCooldownUntil.set(`${assetName}USDT`, lockExp);
      agentLoop.spotCooldownUntil.set(assetName, lockExp);

      return res.json({
        success: true,
        closedTrade: {
          id,
          symbol: `${assetName}-USD`,
          units: soldUnits,
          finalPnL: tradeFinalPnL,
          side: 'SELL'
        }
      });
    }

    // 2. Direct MT5 Broker Order Ticket Close (e.g. MT5-123456)
    if (id.startsWith('MT5-')) {
      const ticket = id.replace('MT5-', '');
      const pos = (mt5Connector.openPositions || []).find(p => String(p.ticket) === String(ticket));
      const symbol = pos ? pos.symbol : undefined;
      const profit = pos ? Number(Number(pos.profit || 0).toFixed(2)) : 0;
      const closeRes = await mt5Connector.closePosition({ ticket, symbol });
      if (!closeRes || closeRes.closed === 0) {
        return res.status(400).json({ error: closeRes?.error || `Failed to close MT5 position #${ticket} on broker terminal` });
      }
      agentLoop.liveClosedTrades.unshift({
        id,
        ticket,
        symbol: symbol || 'MT5',
        side: pos ? (pos.type === 'BUY' ? 'LONG' : 'SHORT') : 'LIVE',
        entryPrice: pos ? pos.priceOpen : 0,
        exitPrice: pos ? pos.priceCurrent : 0,
        units: pos ? pos.volume : 0.01,
        finalPnL: profit,
        exitReason: 'MANUAL_USER_EXIT',
        exitTime: new Date().toISOString()
      });
      agentLoop.liveRealizedPnL = Number((agentLoop.liveRealizedPnL + profit).toFixed(2));
      agentLoop.log(`✋ Manual MT5 Exit: Ticket #${ticket} (Realized: ${profit >= 0 ? '+' : ''}$${profit})`, profit >= 0 ? 'SUCCESS' : 'INFO');
      return res.json({ success: true, closedTrade: { id, ticket, finalPnL: profit } });
    }

    // 3. Demo / Paper Engine Position Close
    let closed = agentLoop.getEngine(agentLoop.activeAccount, userEmail).closePosition(id, null, 'MANUAL_USER_EXIT', 'Manual user exit via dashboard');
    if (!closed) {
      const otherEngine = agentLoop.activeAccount === 'SPOT' ? agentLoop.getEngine('MARGIN', userEmail) : agentLoop.getEngine('SPOT', userEmail);
      closed = otherEngine.closePosition(id, null, 'MANUAL_USER_EXIT', 'Manual user exit via dashboard');
    }
    if (!closed) {
      // Also check if id is a ticket directly without 'MT5-' prefix
      const pos = (mt5Connector.openPositions || []).find(p => String(p.ticket) === String(id));
      if (pos) {
        const ticket = pos.ticket;
        const profit = Number(Number(pos.profit || 0).toFixed(2));
        const closeRes = await mt5Connector.closePosition({ ticket, symbol: pos.symbol });
        if (!closeRes || closeRes.closed === 0) {
          return res.status(400).json({ error: closeRes?.error || `Failed to close MT5 position #${ticket} on broker terminal` });
        }
        agentLoop.liveClosedTrades.unshift({
          id: `MT5-${ticket}`,
          ticket,
          symbol: pos.symbol || 'MT5',
          side: pos.type === 'BUY' ? 'LONG' : 'SHORT',
          entryPrice: pos.priceOpen || 0,
          exitPrice: pos.priceCurrent || 0,
          units: pos.volume || 0.01,
          finalPnL: profit,
          exitReason: 'MANUAL_USER_EXIT',
          exitTime: new Date().toISOString()
        });
        agentLoop.liveRealizedPnL = Number((agentLoop.liveRealizedPnL + profit).toFixed(2));
        agentLoop.log(`✋ Manual MT5 Exit: Ticket #${ticket} (Realized: ${profit >= 0 ? '+' : ''}$${profit})`, profit >= 0 ? 'SUCCESS' : 'INFO');
        return res.json({ success: true, closedTrade: { id: `MT5-${ticket}`, ticket, finalPnL: profit } });
      }
      return res.status(404).json({ error: 'Trade not found or already closed' });
    }

    // If running live MT5, also close on broker terminal
    if (agentLoop.currentMode === 'LIVE' && mt5Connector.connected && closed.ticket) {
      await mt5Connector.closePosition({ symbol: closed.symbol, ticket: closed.ticket }).catch(() => {});
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

// API: Close ALL active trades at once (supports Demo, MT5, and Binance Spot)
app.post('/api/trades/close-all', async (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const user = await authService.validateToken(token);
    const userEmail = user ? user.email : agentLoop.currentUser;
    const targetEngine = agentLoop.getEngine(agentLoop.activeAccount, userEmail);
    const active = [...targetEngine.activePositions];
    const closedList = [];
    for (const pos of active) {
      const closed = targetEngine.closePosition(pos.id, null, 'MANUAL_USER_EXIT', 'Close All Triggered');
      if (closed) closedList.push(closed);
    }

    if (agentLoop.currentMode === 'LIVE') {
      if (mt5Connector.connected) {
        await mt5Connector.closeAllPositions().catch(() => {});
        agentLoop.getEngine('MARGIN', userEmail).activePositions = [];
      }
      if (binanceConnector.connected) {
        const balances = await binanceConnector.getBalances();
        for (const b of balances) {
          if (b.asset !== 'USDT' && b.asset !== 'BNB' && b.free > 0.00001) {
            try {
              await binanceConnector.placeSpotMarketOrder({
                symbol: `${b.asset}USDT`,
                side: 'SELL',
                quantity: b.free
              });
              agentLoop.log(`🪙 [BINANCE LIVE] Close All: Sold ${b.free} ${b.asset} on Binance Spot`, 'SUCCESS');
              closedList.push({ id: `BINANCE-${b.asset}`, symbol: `${b.asset}-USD` });
            } catch (err) {
              agentLoop.log(`⚠️ [BINANCE LIVE] Close All notice for ${b.asset}: ${err.message}`, 'WARN');
            }
          }
        }
        await binanceConnector.getBalances();
      }
    }

    agentLoop.log(`🧹 Closed all active positions in [${agentLoop.activeAccount}].`, 'INFO');
    res.json({ success: true, closedCount: closedList.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Execute trade on demand
app.post('/api/trades/execute', async (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const user = await authService.validateToken(token);
    const userEmail = user ? user.email : agentLoop.currentUser;
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

      const isLive = agentLoop.currentMode === 'LIVE';
      let spotCash = agentLoop.getEngine('SPOT', userEmail).balance;
      const userSpotRisk = agentLoop.getConfig(userEmail).spotRiskManager;
      let maxSlots = userSpotRisk.maxSlots || 1;

      if (isLive && binanceConnector.connected) {
        const balances = await binanceConnector.getBalances();
        const usdtObj = balances.find(b => b.asset === 'USDT');
        spotCash = usdtObj ? Number(usdtObj.free) : 0;

        // Dynamic slot sizing: on micro-balance Spot accounts (< $20), collapse to 1 slot
        // so that orders meet Binance's minNotional requirement ($5.00 USDT per trade)
        if (spotCash < 20) {
          maxSlots = 1;
        }

        if (spotCash < 5.0) {
          return res.status(400).json({ error: `Insufficient Spot USDT balance ($${spotCash.toFixed(2)}). Binance requires at least $5.00 USDT per trade.` });
        }

        // Count real active live spot holdings on Binance (>= $1.00 notional)
        const liveActiveCount = (agentLoop.liveSpotPositions || []).length;
        if (liveActiveCount >= maxSlots) {
          return res.status(400).json({ error: `Spot Account allows ${maxSlots} active coin position(s) at ${(100 / maxSlots).toFixed(0)}% allocation. Close current position first.` });
        }
      } else {
        if (spotCash < 20) {
          maxSlots = 1;
        }
        if (agentLoop.getEngine('SPOT', userEmail).activePositions.length >= maxSlots) {
          return res.status(400).json({ error: `Spot Account allows ${maxSlots} active coin position(s) at ${(100 / maxSlots).toFixed(0)}% allocation. Close current position first.` });
        }
      }

      if (spotCash < 0.5) {
        return res.status(400).json({ error: `Insufficient Spot USDT balance ($${spotCash.toFixed(2)}) to open trade.` });
      }

      let rawNotional = spotCash / maxSlots;
      if (isLive && rawNotional < 5.0 && spotCash >= 5.0) {
        rawNotional = spotCash;
      }
      const minAllowed = isLive ? 5.0 : 0.5;
      const notional = Number((Math.max(minAllowed, Math.min(rawNotional, spotCash > 1 ? spotCash - 0.01 : spotCash))).toFixed(2));
      const entryPrice = asset.price;
      const rawUnits = notional / entryPrice;
      const units = Number(rawUnits.toFixed(asset.decimals || 4));
      const stopDist = Number((entryPrice * (agentLoop.spotRiskManager.stopLossPct / 100)).toFixed(asset.decimals || 4));
      const targetDist = Number((entryPrice * (agentLoop.spotRiskManager.takeProfitPct / 100)).toFixed(asset.decimals || 4));
      const stopLoss = Number((entryPrice - stopDist).toFixed(asset.decimals || 4));
      const takeProfit = Number((entryPrice + targetDist).toFixed(asset.decimals || 4));

      // Execute on Live Binance if connected
      if (isLive && binanceConnector.connected) {
        try {
          const liveOrder = await binanceConnector.placeSpotMarketOrder({
            symbol: asset.symbol,
            side: 'BUY',
            quoteOrderQty: notional
          });
          agentLoop.log(`🪙 [BINANCE LIVE] Manual Market Buy executed on Binance! Order ID: ${liveOrder.orderId} (${asset.symbol} with $${notional} USDT)`, 'SUCCESS');

          // Immediately sync real balances so liveSpotPositions updates right away
          const newBals = await binanceConnector.getBalances().catch(() => []);
          agentLoop.syncLiveSpotPositions(newBals, marketDataService.getAllPricesMap());

          const liveTrade = {
            id: `BINANCE-${asset.name || asset.symbol}-${liveOrder.orderId || Date.now()}`,
            symbol: asset.symbol,
            name: asset.name || asset.symbol,
            category: 'Crypto',
            side: 'LONG',
            entryPrice,
            stopLoss,
            takeProfit,
            units,
            notional,
            isLiveBrokerOrder: true,
            orderId: liveOrder.orderId,
            openTime: new Date().toISOString()
          };

          return res.json({ success: true, trade: liveTrade });
        } catch (binanceErr) {
          return res.status(400).json({ error: `Binance order rejected: ${binanceErr.message}` });
        }
      }

      // Execute on DEMO Paper Trading Engine ONLY
      const trade = agentLoop.getEngine('SPOT', userEmail).openPosition({
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
        confidence: 95,
        reason: `Manual Spot Buy (${(100 / maxSlots).toFixed(0)}% Allocation)`,
        riskRewardRatio: Number((agentLoop.spotRiskManager.takeProfitPct / agentLoop.spotRiskManager.stopLossPct).toFixed(1)),
        maxHoldMinutes: agentLoop.spotRiskManager.maxHoldMinutes || 60,
        tradingStyle: 'SPOT_BUY',
        feeRate: agentLoop.spotRiskManager.feeRate || (agentLoop.spotRiskManager.useBnbFeeDiscount ? 0.00075 : 0.0010),
        leverage: 1,
        margin: notional,
        liquidationPrice: 0
      });

      agentLoop.log(`🪙 [SPOT DEMO] MANUAL BUY: Bought ${trade.symbol} with $${notional} @ $${entryPrice} (SL: -$${agentLoop.spotRiskManager.stopLossPct}%, TP: +$${agentLoop.spotRiskManager.takeProfitPct}%, Cap: ${agentLoop.spotRiskManager.maxHoldMinutes || 60}m)`, 'SUCCESS');
      return res.json({ success: true, trade });
    }

    // MARGIN SCALPER execution mode
    if (agentLoop.currentMode === 'LIVE') {
      const isMt5Symbol = asset.category === 'Forex' ||
                          asset.category === 'Commodities' ||
                          asset.category === 'Indices' ||
                          asset.symbol === 'BTC-USD' || asset.symbol === 'BTCUSD';
      if (!isMt5Symbol) {
        return res.status(400).json({ error: `${asset.symbol} is not supported on MetaTrader 5 margin accounts. Trade Forex, Gold, or BTC on MT5, or switch to Spot Account for Altcoins.` });
      }
      if (!mt5Connector.connected) {
        return res.status(400).json({ error: 'MetaTrader 5 broker is not connected. Connect MT5 first.' });
      }

      try {
        const ticket = await mt5Connector.openPosition({
          symbol: asset.symbol,
          side: side || signal.side,
          volume: 0.01,
          sl: signal.stopLoss,
          tp: signal.takeProfit,
          comment: `Manual Scalp ${asset.symbol}`
        });

        const fillPrice = ticket.price || asset.price;
        const notionalVal = Number((fillPrice * (asset.category === 'Forex' ? 1000 : 1)).toFixed(2));
        const marginVal = Number((notionalVal / (mt5Connector.accountInfo?.leverage || 500)).toFixed(2));

        const trade = agentLoop.getEngine('MARGIN', userEmail).openPosition({
          symbol: asset.symbol,
          name: asset.name,
          category: asset.category,
          side: side || signal.side,
          entryPrice: fillPrice,
          stopLoss: signal.stopLoss,
          takeProfit: signal.takeProfit,
          stopDistance: signal.stopDistance || stopDist,
          targetDistance: signal.targetDistance || targetDist,
          units: 0.01,
          notional: notionalVal,
          confidence: signal.confidence,
          reason: `Manual One-Click Scalp (${signal.reason || 'User initiated'})`,
          riskRewardRatio: signal.riskRewardRatio || 1.55,
          tradingStyle: 'SCALPING',
          leverage: mt5Connector.accountInfo?.leverage || 500,
          margin: marginVal,
          liquidationPrice: 0
        });
        trade.ticket = ticket.ticket;

        agentLoop.log(`📡 [MT5 LIVE] Manual Scalp executed on Exness MT5! Ticket #${ticket.ticket} (${asset.symbol} ${trade.side} 0.01 lot @ $${fillPrice})`, 'SUCCESS');
        return res.json({ success: true, trade });
      } catch (err) {
        return res.status(400).json({ error: `MT5 Execution Failed: ${err.message}` });
      }
    }

    const portfolio = agentLoop.getEngine('MARGIN', userEmail).getPortfolioState();
    const riskEval = agentLoop.marginRiskManager.evaluateTradeRisk(portfolio, { ...signal, confidence: 99 }, asset);

    if (!riskEval.allowed) {
      return res.status(400).json({ error: riskEval.reason });
    }

    const trade = agentLoop.getEngine('MARGIN', userEmail).openPosition({
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
app.post('/api/portfolio/reset', async (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const user = await authService.validateToken(token);
    const userEmail = user ? user.email : 'default';
    const { initialBalance, account } = req.body;
    const targetAccount = (account || agentLoop.activeAccount).toUpperCase();
    const engine = agentLoop.getEngine(targetAccount, userEmail);
    const initBal = initialBalance !== undefined ? parseFloat(initialBalance) : 10;
    const resetState = engine.reset(initBal);
    agentLoop.log(`🔄 [${targetAccount}] Portfolio reset to $${initBal.toLocaleString('en-US')} virtual balance.`, 'WARN');
    const userMode = (user && user.mode) ? user.mode : (userEmail === 'waiztahseen@gmail.com' ? 'LIVE' : 'SIMULATED');
    res.json({ success: true, portfolio: resetState, dashboard: agentLoop.getDashboardData(userMode, targetAccount, userEmail) });
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

// Start database, agent loop and web server
try {
  await authService.init();
  console.log('✅ Multi-tenant SaaS database initialized.');
} catch (dbErr) {
  console.error('⚠️ Database init error (will retry on query):', dbErr.message);
}

if (!process.env.PRIMARY_BACKEND_URL && !process.env.RENDER) {
  const startupUser = 'waiztahseen@gmail.com';
  agentLoop.setUserMode(startupUser, 'LIVE').then(() => {
    agentLoop.isAutoTradingEnabled = true;
    agentLoop.getConfig(startupUser).isAutoTradingEnabled = true;
    agentLoop.start();
    console.log(`🚀 Scalping bot started automatically for ${startupUser} in LIVE broker mode.`);
  }).catch(err => {
    console.error('Failed to initialize startup user mode:', err.message);
    agentLoop.start();
  });
} else {
  console.log('⏸️ Autonomous trading loop paused on Proxy/Replica server (Master Hostinger executes all live trades).');
}

const SOCKET_PATH = process.env.SOCKET_PATH;
if (SOCKET_PATH) {
  try {
    if (fs.existsSync(SOCKET_PATH)) {
      fs.unlinkSync(SOCKET_PATH);
    }
  } catch (_) {}
  
  app.listen(SOCKET_PATH, () => {
    try { fs.chmodSync(SOCKET_PATH, '777'); } catch (_) {}
    console.log(`=======================================================`);
    console.log(`🚀 Scalping Agent Backend running on Unix Socket: ${SOCKET_PATH}`);
    console.log(`📡 Autonomous Scalp Loop active: 27 Global Markets | 500x Lev | 1:1.3 R:R`);
    console.log(`=======================================================`);
  });
} else {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`=======================================================`);
    console.log(`🚀 Scalping Agent Backend running on port ${PORT}`);
    console.log(`📡 Autonomous Scalp Loop active: 27 Global Markets | 500x Lev | 1:1.3 R:R`);
    console.log(`=======================================================`);
  });
}



