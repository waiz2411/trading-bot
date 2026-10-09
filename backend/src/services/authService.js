import crypto from 'crypto';
import { db } from './db.js';

/**
 * Enterprise Multi-Tenant SaaS Authentication & User Management Service
 * - Backed by Hostinger MySQL Database
 * - Strict Account Type Isolation (MARGIN vs SPOT)
 * - Admin Approval Workflow (PENDING -> ACTIVE)
 * - Per-User Isolated Broker Credentials & Risk Configurations
 */

export class AuthService {
  constructor() {
    this.sessions = new Map();
    this.secretKey = process.env.JWT_SECRET || 'nexusquant-prod-auth-salt-9817234';
  }

  async init() {
    await db.init();
  }

  createSessionToken(user) {
    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days validity
    const payload = JSON.stringify({
      userId: user.id,
      email: user.email,
      role: user.role,
      accountType: user.account_type || user.accountType,
      expiresAt
    });
    const b64Payload = Buffer.from(payload).toString('base64url');
    const signature = crypto.createHmac('sha256', this.secretKey).update(b64Payload).digest('base64url');
    const token = `nq_${b64Payload}.${signature}`;

    this.sessions.set(token, {
      userId: user.id,
      email: user.email,
      role: user.role,
      accountType: user.account_type || user.accountType,
      expiresAt
    });

    return token;
  }

  async validateToken(token) {
    if (!token || typeof token !== 'string') return null;

    // Fast memory path
    const cachedSession = this.sessions.get(token);
    if (cachedSession) {
      if (Date.now() > cachedSession.expiresAt) {
        this.sessions.delete(token);
        return null;
      }
      const user = await this.getUserById(cachedSession.userId);
      return user && user.status === 'ACTIVE' ? this.sanitizeUser(user) : null;
    }

    // Cryptographic signature path
    if (token.startsWith('nq_') && token.includes('.')) {
      try {
        const withoutPrefix = token.slice(3);
        const dotIndex = withoutPrefix.indexOf('.');
        if (dotIndex === -1) return null;

        const b64Payload = withoutPrefix.slice(0, dotIndex);
        const signature = withoutPrefix.slice(dotIndex + 1);
        if (!b64Payload || !signature) return null;

        const expectedSig = crypto.createHmac('sha256', this.secretKey).update(b64Payload).digest('base64url');
        const sigBuf = Buffer.from(signature);
        const expBuf = Buffer.from(expectedSig);
        if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
          return null;
        }

        const payload = JSON.parse(Buffer.from(b64Payload, 'base64url').toString('utf-8'));
        if (payload.expiresAt && Date.now() <= payload.expiresAt) {
          const user = await this.getUserById(payload.userId);
          if (user && user.status === 'ACTIVE') {
            this.sessions.set(token, {
              userId: user.id,
              email: user.email,
              role: user.role,
              accountType: user.account_type,
              expiresAt: payload.expiresAt
            });
            return this.sanitizeUser(user);
          }
        }
      } catch (err) {
        console.warn('Token validation error:', err.message);
        return null;
      }
    }

    return null;
  }

  async register({ email, password, name, phone, accountType }) {
    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanPhone = (phone || '').trim();
    const targetType = (accountType || 'MARGIN').toUpperCase() === 'SPOT' ? 'SPOT' : 'MARGIN';

    if (!cleanEmail || !cleanEmail.includes('@')) {
      throw new Error('Please enter a valid email address.');
    }
    if (!password || password.length < 5) {
      throw new Error('Password must be at least 5 characters long.');
    }
    if (!cleanPhone || cleanPhone.length < 7) {
      throw new Error('Please enter a valid phone number (at least 7 digits).');
    }

    // Check if email already exists
    const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [cleanEmail]);
    if (existing.length > 0) {
      throw new Error('An account with this email already exists. Please sign in.');
    }

    const userId = `usr_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const cleanName = (name || cleanEmail.split('@')[0]).trim();

    // Insert user into MySQL with status = 'PENDING'
    await db.query(`
      INSERT INTO users (id, email, password, name, phone, account_type, status, role, active_mode, is_auto_trading)
      VALUES (?, ?, ?, ?, ?, ?, 'PENDING', 'CLIENT', 'SIMULATED', FALSE)
    `, [userId, cleanEmail, password, cleanName, cleanPhone, targetType]);

    // Initialize default broker connections
    const defaultMt5 = {
      connected: false,
      login: '',
      password: '',
      server: '',
      gatewayUrl: process.env.MT5_GATEWAY_URL || 'https://grid-air-telescope-object.trycloudflare.com',
      syncToken: `NQ-SYNC-${userId.slice(-6).toUpperCase()}`,
      status: 'DISCONNECTED',
      lastChecked: null
    };

    const defaultBinance = {
      connected: false,
      apiKey: '',
      apiSecret: '',
      isTestnet: true,
      status: 'DISCONNECTED',
      lastChecked: null
    };

    await db.query(`
      INSERT INTO user_broker_configs (user_id, broker, config_json)
      VALUES (?, 'mt5', ?), (?, 'binance', ?)
    `, [userId, JSON.stringify(defaultMt5), userId, JSON.stringify(defaultBinance)]);

    return {
      pendingApproval: true,
      message: 'Account registered successfully! Your account is currently PENDING admin approval. You will be able to log in once an administrator approves your account.'
    };
  }

  async login(email, password) {
    const cleanEmail = (email || '').trim().toLowerCase();
    const [rows] = await db.query('SELECT * FROM users WHERE email = ?', [cleanEmail]);

    if (rows.length === 0) {
      throw new Error('Invalid email or password. Please verify your credentials.');
    }

    const user = rows[0];

    if (user.password !== password) {
      throw new Error('Invalid email or password. Please verify your credentials.');
    }

    // Check Approval Status
    if (user.status === 'PENDING') {
      throw new Error('Your account is pending admin approval. You will be able to log in once an administrator approves your account.');
    }

    if (user.status === 'SUSPENDED') {
      throw new Error('Your account is currently suspended. Please contact platform support.');
    }

    if (user.status === 'REJECTED') {
      throw new Error('Your account application was not approved.');
    }

    // Fetch broker configs
    const brokerConfigs = await this.getUserBrokerConfigs(user.id);
    user.brokerConnections = brokerConfigs;

    const token = this.createSessionToken(user);
    return { token, user: this.sanitizeUser(user) };
  }

  async logout(token) {
    if (token) {
      this.sessions.delete(token);
    }
    return true;
  }

  async getUserById(id) {
    const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [id]);
    if (rows.length === 0) return null;
    const user = rows[0];
    user.brokerConnections = await this.getUserBrokerConfigs(user.id);
    if (!user.mode) {
      if (user.brokerConnections?.binance?.connected || user.brokerConnections?.mt5?.connected) {
        user.mode = 'LIVE';
      } else {
        user.mode = 'SIMULATED';
      }
    }
    return user;
  }

  async getUser(email) {
    return this.getUserByEmail(email);
  }

  async getUserByEmail(email) {
    const cleanEmail = (email || '').trim().toLowerCase();
    const [rows] = await db.query('SELECT * FROM users WHERE email = ?', [cleanEmail]);
    if (rows.length === 0) return null;
    const user = rows[0];
    user.brokerConnections = await this.getUserBrokerConfigs(user.id);
    if (!user.mode) {
      if (user.brokerConnections?.binance?.connected || user.brokerConnections?.mt5?.connected) {
        user.mode = 'LIVE';
      } else {
        user.mode = 'SIMULATED';
      }
    }
    return user;
  }

  async getUserBrokerConfigs(userId) {
    const [rows] = await db.query('SELECT broker, config_json FROM user_broker_configs WHERE user_id = ?', [userId]);
    const configs = {
      binance: { connected: false, apiKey: '', isTestnet: true, status: 'DISCONNECTED' },
      mt5: { connected: false, login: '', server: '', status: 'DISCONNECTED', syncToken: `NQ-SYNC-${userId.slice(-6).toUpperCase()}` },
      mexc: { connected: false, apiKey: '', defaultLeverage: 50, status: 'DISCONNECTED' }
    };

    for (const r of rows) {
      try {
        configs[r.broker] = JSON.parse(r.config_json);
      } catch (_) {}
    }

    return configs;
  }

  async updateBrokerConfig(email, broker, config) {
    const user = await this.getUserByEmail(email);
    if (!user) throw new Error('User not found');

    const existingConfigs = await this.getUserBrokerConfigs(user.id);
    const updated = { ...existingConfigs[broker], ...config, lastUpdated: new Date().toISOString() };

    await db.query(`
      INSERT INTO user_broker_configs (user_id, broker, config_json)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE config_json = VALUES(config_json), updated_at = NOW()
    `, [user.id, broker, JSON.stringify(updated)]);

    return updated;
  }

  async setUserAutoTrading(email, isEnabled) {
    const cleanEmail = (email || '').trim().toLowerCase();
    await db.query('UPDATE users SET is_auto_trading = ? WHERE email = ?', [Boolean(isEnabled), cleanEmail]);
    return Boolean(isEnabled);
  }

  async setUserActiveMode(email, mode) {
    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanMode = (mode || 'SIMULATED').toUpperCase() === 'LIVE' ? 'LIVE' : 'SIMULATED';
    await db.query('UPDATE users SET active_mode = ? WHERE email = ?', [cleanMode, cleanEmail]);
    return cleanMode;
  }

  async setUserActiveAccount(email, accountType) {
    const cleanEmail = (email || '').trim().toLowerCase();
    const targetType = (accountType || 'MARGIN').toUpperCase() === 'SPOT' ? 'SPOT' : 'MARGIN';
    await db.query('UPDATE users SET account_type = ? WHERE email = ?', [targetType, cleanEmail]);
    for (const [token, session] of this.sessions.entries()) {
      if (session.email && session.email.toLowerCase() === cleanEmail) {
        session.accountType = targetType;
      }
    }
    return targetType;
  }

  // --- ADMIN MANAGEMENT METHODS ---
  async getAllUsers() {
    const [users] = await db.query(`
      SELECT id, email, name, phone, account_type, status, role, active_mode, is_auto_trading, created_at, updated_at
      FROM users
      ORDER BY created_at DESC
    `);

    // Fetch broker configs for all users
    const [brokerRows] = await db.query('SELECT user_id, broker, config_json FROM user_broker_configs');
    const brokerMap = {};
    for (const r of brokerRows) {
      if (!brokerMap[r.user_id]) brokerMap[r.user_id] = {};
      try {
        const parsed = JSON.parse(r.config_json);
        brokerMap[r.user_id][r.broker] = {
          connected: Boolean(parsed.connected),
          status: parsed.status || (parsed.connected ? 'CONNECTED' : 'DISCONNECTED'),
          lastChecked: parsed.lastChecked || null,
          server: parsed.server || '',
          isTestnet: parsed.isTestnet
        };
      } catch (_) {}
    }

    // Fetch aggregate trade stats per user from user_trades table
    const [tradeStatsRows] = await db.query(`
      SELECT 
        user_id,
        COUNT(*) as totalTrades,
        SUM(CASE WHEN exit_price IS NOT NULL THEN 1 ELSE 0 END) as closedTrades,
        SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as winTrades,
        SUM(CASE WHEN pnl < 0 THEN 1 ELSE 0 END) as lossTrades,
        COALESCE(SUM(pnl), 0) as totalRealizedPnL,
        SUM(CASE WHEN exit_price IS NULL THEN 1 ELSE 0 END) as openTradesCount
      FROM user_trades
      GROUP BY user_id
    `);

    const statsMap = {};
    for (const s of tradeStatsRows) {
      const closed = Number(s.closedTrades) || 0;
      const wins = Number(s.winTrades) || 0;
      statsMap[s.user_id] = {
        totalTrades: Number(s.totalTrades) || 0,
        closedTrades: closed,
        winTrades: wins,
        lossTrades: Number(s.lossTrades) || 0,
        winRate: closed > 0 ? Number(((wins / closed) * 100).toFixed(1)) : 0,
        totalRealizedPnL: Number(Number(s.totalRealizedPnL || 0).toFixed(2)),
        openTradesCount: Number(s.openTradesCount) || 0
      };
    }

    return users.map(u => ({
      ...u,
      brokerConnections: brokerMap[u.id] || {
        binance: { connected: false, status: 'DISCONNECTED' },
        mt5: { connected: false, status: 'DISCONNECTED' }
      },
      stats: statsMap[u.id] || {
        totalTrades: 0,
        closedTrades: 0,
        winTrades: 0,
        lossTrades: 0,
        winRate: 0,
        totalRealizedPnL: 0,
        openTradesCount: 0
      }
    }));
  }

  async getUserTradeHistory(userId) {
    const [trades] = await db.query(`
      SELECT id, trade_id, mode, account_type, symbol, side, entry_price, exit_price, pnl, pnl_pct, trade_json, created_at
      FROM user_trades
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 100
    `, [userId]);

    return trades.map(t => {
      let extra = {};
      try {
        extra = JSON.parse(t.trade_json);
      } catch (_) {}
      return {
        id: t.trade_id || t.id,
        mode: t.mode,
        accountType: t.account_type,
        symbol: t.symbol,
        side: t.side,
        entryPrice: Number(t.entry_price),
        exitPrice: t.exit_price ? Number(t.exit_price) : null,
        pnl: t.pnl ? Number(t.pnl) : null,
        pnlPct: t.pnl_pct ? Number(t.pnl_pct) : null,
        timestamp: t.created_at,
        ...extra
      };
    });
  }

  async updateUserStatus(userId, status) {
    const validStatuses = ['PENDING', 'ACTIVE', 'SUSPENDED', 'REJECTED'];
    if (!validStatuses.includes(status)) {
      throw new Error(`Invalid status: ${status}. Must be one of: ${validStatuses.join(', ')}`);
    }

    const [res] = await db.query('UPDATE users SET status = ? WHERE id = ?', [status, userId]);
    if (res.affectedRows === 0) {
      throw new Error('User not found');
    }
    return { success: true, userId, status };
  }

  async deleteUser(userId) {
    // Prevent deleting main admin
    const [rows] = await db.query('SELECT role, email FROM users WHERE id = ?', [userId]);
    if (rows.length > 0 && rows[0].role === 'ADMIN' && rows[0].email === 'test@gmail.com') {
      throw new Error('Cannot delete primary administrator account.');
    }

    await db.query('DELETE FROM user_broker_configs WHERE user_id = ?', [userId]);
    await db.query('DELETE FROM user_settings WHERE user_id = ?', [userId]);
    await db.query('DELETE FROM user_trades WHERE user_id = ?', [userId]);
    const [res] = await db.query('DELETE FROM users WHERE id = ?', [userId]);
    return { success: res.affectedRows > 0, userId };
  }

  sanitizeUser(user) {
    const b = user.brokerConnections || {};
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone || '',
      accountType: user.account_type || user.accountType || 'MARGIN',
      status: user.status || 'PENDING',
      role: user.role || 'CLIENT',
      mode: user.active_mode || user.mode || 'SIMULATED',
      isAutoTradingEnabled: Boolean(user.is_auto_trading || user.isAutoTradingEnabled),
      createdAt: user.created_at,
      brokerConnections: {
        binance: {
          connected: b.binance?.connected || false,
          apiKey: b.binance?.apiKey ? `${b.binance.apiKey.slice(0, 6)}...` : '',
          isTestnet: b.binance?.isTestnet ?? true,
          status: b.binance?.status || 'DISCONNECTED',
          lastChecked: b.binance?.lastChecked || null
        },
        mt5: {
          connected: b.mt5?.connected || false,
          login: b.mt5?.login ? `${b.mt5.login.toString().slice(0, 3)}****` : '',
          server: b.mt5?.server || '',
          gatewayUrl: b.mt5?.gatewayUrl || '',
          syncToken: b.mt5?.syncToken || `NQ-SYNC-${(user.id || 'usr').slice(-6).toUpperCase()}`,
          status: b.mt5?.status || (b.mt5?.connected ? 'CONNECTED' : 'DISCONNECTED'),
          lastChecked: b.mt5?.lastChecked || null
        },
        mexc: {
          connected: b.mexc?.connected || false,
          apiKey: b.mexc?.apiKey ? `${b.mexc.apiKey.slice(0, 6)}...` : '',
          defaultLeverage: b.mexc?.defaultLeverage || 50,
          status: b.mexc?.status || 'DISCONNECTED',
          lastChecked: b.mexc?.lastChecked || null
        }
      }
    };
  }
}

export const authService = new AuthService();
