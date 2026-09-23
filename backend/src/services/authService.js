import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '../../data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SECRET_FILE = path.join(DATA_DIR, 'auth_secret.key');

/**
 * Multi-Tenant Authentication & User Storage Service for NexusQuant SaaS
 * - Supports self-registration of client accounts
 * - Persistent disk storage across server restarts
 * - Per-user isolated broker credentials and live connection states
 */
export class AuthService {
  constructor() {
    this.users = {};
    this.sessions = new Map();
    this.secretKey = '';
    this.ensureDataDir();
    this.ensureSecretKey();
    this.loadUsers();
  }

  ensureSecretKey() {
    try {
      if (process.env.JWT_SECRET) {
        this.secretKey = process.env.JWT_SECRET.trim();
        return;
      }
      if (fs.existsSync(SECRET_FILE)) {
        this.secretKey = fs.readFileSync(SECRET_FILE, 'utf-8').trim();
      }
      if (!this.secretKey) {
        this.secretKey = crypto.randomBytes(32).toString('hex');
        fs.writeFileSync(SECRET_FILE, this.secretKey, 'utf-8');
      }
    } catch (err) {
      console.warn('Failed to ensure auth secret file, using fallback salt:', err.message);
      this.secretKey = process.env.JWT_SECRET || 'nexusquant-prod-auth-salt-9817234';
    }
  }

  ensureDataDir() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
    } catch (err) {
      console.error('Failed to create data directory:', err);
    }
  }

  loadUsers() {
    try {
      if (fs.existsSync(USERS_FILE)) {
        const raw = fs.readFileSync(USERS_FILE, 'utf-8');
        this.users = JSON.parse(raw);
      }
    } catch (err) {
      console.warn('Could not load users.json, re-initializing defaults:', err.message);
      this.users = {};
    }

    // Seed default demo and test accounts if missing
    if (!this.users['demo@gmail.com']) {
      this.users['demo@gmail.com'] = {
        id: 'usr_demo_001',
        email: 'demo@gmail.com',
        password: 'demoPass',
        name: 'Demo Paper Trader',
        role: 'DEMO',
        mode: 'SIMULATED',
        isAutoTradingEnabled: false,
        activeAccount: 'MARGIN',
        createdAt: '2026-09-01T00:00:00.000Z',
        brokerConnections: {
          binance: { connected: false, apiKey: '', isTestnet: true },
          mt5: { connected: false, login: '', server: '', syncToken: 'NQ-DEMO-001' }
        }
      };
    }

const LIVE_MT5_GATEWAY_URL = process.env.MT5_GATEWAY_URL || 'https://taken-background-implemented-constitute.trycloudflare.com';

    if (!this.users['test@gmail.com']) {
      this.users['test@gmail.com'] = {
        id: 'usr_live_002',
        email: 'test@gmail.com',
        password: 'testPass',
        name: 'Main Live Account',
        role: 'LIVE_BROKER',
        mode: 'LIVE',
        isAutoTradingEnabled: true,
        activeAccount: 'MARGIN',
        createdAt: '2026-09-01T00:00:00.000Z',
        brokerConnections: {
          binance: {
            connected: false,
            apiKey: '',
            apiSecret: '',
            isTestnet: true,
            status: 'STANDBY',
            lastChecked: null
          },
          mt5: {
            connected: true,
            login: '474621142',
            password: 'Test@123',
            server: 'Exness-MT5Trial15',
            gatewayUrl: LIVE_MT5_GATEWAY_URL,
            syncToken: 'NQ-SYNC-TEST002',
            status: 'CONNECTED',
            lastChecked: new Date().toISOString()
          }
        }
      };
    }

    // Ensure all existing users have syncToken, isAutoTradingEnabled, activeAccount, and live gatewayUrl
    for (const user of Object.values(this.users)) {
      if (user.email === 'test@gmail.com') {
        user.mode = 'LIVE';
        user.isAutoTradingEnabled = true;
        user.activeAccount = 'MARGIN';
        if (!user.brokerConnections) user.brokerConnections = {};
        user.brokerConnections.mt5 = {
          connected: true,
          login: '474621142',
          password: 'Test@123',
          server: 'Exness-MT5Trial15',
          gatewayUrl: LIVE_MT5_GATEWAY_URL,
          syncToken: user.brokerConnections.mt5?.syncToken || 'NQ-SYNC-TEST002',
          status: 'CONNECTED',
          lastChecked: new Date().toISOString(),
          accountInfo: {
            balance: 10.0,
            equity: 8.5,
            margin: 0,
            freeMargin: 8.5,
            leverage: 500,
            currency: 'USD',
            company: 'Exness Technologies Ltd',
            server: 'Exness-MT5Trial15'
          }
        };
      }
      if (user.isAutoTradingEnabled === undefined) {
        user.isAutoTradingEnabled = false;
      }
      if (!user.activeAccount) {
        user.activeAccount = 'MARGIN';
      }
      if (!user.brokerConnections) user.brokerConnections = {};
      if (!user.brokerConnections.mt5) user.brokerConnections.mt5 = {};
      if (!user.brokerConnections.mt5.gatewayUrl || user.brokerConnections.mt5.gatewayUrl.includes('localhost')) {
        user.brokerConnections.mt5.gatewayUrl = LIVE_MT5_GATEWAY_URL;
      }
      if (!user.brokerConnections.mexc) {
        user.brokerConnections.mexc = {
          connected: false,
          apiKey: '',
          apiSecret: '',
          defaultLeverage: 50,
          status: 'DISCONNECTED',
          lastChecked: null
        };
      }
      if (!user.brokerConnections.mt5.syncToken) {
        user.brokerConnections.mt5.syncToken = `NQ-SYNC-${(user.id || 'usr').slice(-6).toUpperCase()}`;
      }
    }

    this.saveUsers();
  }

  saveUsers() {
    try {
      fs.writeFileSync(USERS_FILE, JSON.stringify(this.users, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to persist users to disk:', err);
    }
  }

  register({ email, password, name }) {
    const cleanEmail = (email || '').trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      throw new Error('Please enter a valid email address.');
    }
    if (!password || password.length < 5) {
      throw new Error('Password must be at least 5 characters long.');
    }
    if (this.users[cleanEmail]) {
      throw new Error('An account with this email already exists. Please sign in.');
    }

    const userId = `usr_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const newUser = {
      id: userId,
      email: cleanEmail,
      password,
      name: (name || cleanEmail.split('@')[0]).trim(),
      role: 'CLIENT',
      mode: 'LIVE', // New client accounts are real live accounts ready to connect brokers
      isAutoTradingEnabled: false,
      activeAccount: 'MARGIN',
      createdAt: new Date().toISOString(),
      brokerConnections: {
        binance: {
          connected: false,
          apiKey: '',
          apiSecret: '',
          isTestnet: true,
          status: 'DISCONNECTED',
          lastChecked: null
        },
        mt5: {
          connected: false,
          login: '',
          password: '',
          server: '',
          gatewayUrl: LIVE_MT5_GATEWAY_URL,
          syncToken: `NQ-SYNC-${userId.slice(-6).toUpperCase()}`,
          status: 'DISCONNECTED',
          lastChecked: null
        }
      }
    };

    this.users[cleanEmail] = newUser;
    this.saveUsers();

    // Automatically create authenticated persistent session token (30 days validity)
    const token = this.createSessionToken(newUser);
    return { token, user: this.sanitizeUser(newUser) };
  }

  createSessionToken(user) {
    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days
    const payload = JSON.stringify({
      userId: user.id,
      email: user.email,
      expiresAt
    });
    const b64Payload = Buffer.from(payload).toString('base64url');
    const signature = crypto.createHmac('sha256', this.secretKey).update(b64Payload).digest('base64url');
    const token = `nq_${b64Payload}.${signature}`;

    this.sessions.set(token, {
      userId: user.id,
      email: user.email,
      expiresAt
    });

    return token;
  }

  login(email, password) {
    const cleanEmail = (email || '').trim().toLowerCase();
    const user = this.users[cleanEmail];

    if (!user || user.password !== password) {
      throw new Error('Invalid email or password. Please verify credentials.');
    }

    const token = this.createSessionToken(user);
    return { token, user: this.sanitizeUser(user) };
  }

  validateToken(token) {
    if (!token || typeof token !== 'string') return null;

    // Fast path: In-memory session hit
    const session = this.sessions.get(token);
    if (session) {
      if (Date.now() > session.expiresAt) {
        this.sessions.delete(token);
        return null;
      }
      const user = this.users[session.email];
      return user ? this.sanitizeUser(user) : null;
    }

    // Persistent path: Verify cryptographic HMAC-SHA256 signature
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

        const payloadStr = Buffer.from(b64Payload, 'base64url').toString('utf-8');
        const payload = JSON.parse(payloadStr);

        if (payload.expiresAt && Date.now() <= payload.expiresAt) {
          const user = this.users[payload.email];
          if (user) {
            // Re-cache in memory for sub-millisecond future lookups
            this.sessions.set(token, {
              userId: user.id,
              email: user.email,
              expiresAt: payload.expiresAt
            });
            return this.sanitizeUser(user);
          }
        }
      } catch (err) {
        console.warn('Stateless token verification error:', err.message);
        return null;
      }
    }

    return null;
  }

  logout(token) {
    if (token) {
      this.sessions.delete(token);
    }
    return true;
  }

  getUser(email) {
    const cleanEmail = (email || '').trim().toLowerCase();
    return this.users[cleanEmail] || null;
  }

  getUserById(id) {
    return Object.values(this.users).find(u => u.id === id) || null;
  }

  getUserBySyncToken(syncToken) {
    if (!syncToken) return null;
    const clean = syncToken.toString().trim().toUpperCase();
    return Object.values(this.users).find(u =>
      (u.brokerConnections?.mt5?.syncToken || '').toUpperCase() === clean
    ) || null;
  }

  updateBrokerConfig(email, broker, config) {
    const user = this.getUser(email);
    if (!user) throw new Error('User not found');

    if (broker === 'binance') {
      user.brokerConnections.binance = {
        ...user.brokerConnections.binance,
        ...config,
        lastUpdated: new Date().toISOString()
      };
      this.saveUsers();
      return user.brokerConnections.binance;
    } else if (broker === 'mt5') {
      user.brokerConnections.mt5 = {
        ...user.brokerConnections.mt5,
        ...config,
        lastUpdated: new Date().toISOString()
      };
      this.saveUsers();
      return user.brokerConnections.mt5;
    } else if (broker === 'mexc') {
      user.brokerConnections.mexc = {
        ...user.brokerConnections.mexc,
        ...config,
        lastUpdated: new Date().toISOString()
      };
      this.saveUsers();
      return user.brokerConnections.mexc;
    }
    throw new Error('Unknown broker type');
  }

  setUserAutoTrading(email, isEnabled) {
    const cleanEmail = (email || '').trim().toLowerCase();
    const user = this.users[cleanEmail];
    if (user) {
      user.isAutoTradingEnabled = Boolean(isEnabled);
      this.saveUsers();
      return user.isAutoTradingEnabled;
    }
    return false;
  }

  setUserActiveAccount(email, activeAccount) {
    const cleanEmail = (email || '').trim().toLowerCase();
    const user = this.users[cleanEmail];
    if (user) {
      user.activeAccount = (activeAccount || 'MARGIN').toUpperCase();
      this.saveUsers();
      return user.activeAccount;
    }
    return 'MARGIN';
  }

  sanitizeUser(user) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      mode: user.mode,
      isAutoTradingEnabled: Boolean(user.isAutoTradingEnabled),
      activeAccount: user.activeAccount || 'MARGIN',
      brokerConnections: {
        binance: {
          connected: user.brokerConnections?.binance?.connected || false,
          apiKey: user.brokerConnections?.binance?.apiKey ? `${user.brokerConnections.binance.apiKey.slice(0, 6)}...` : '',
          isTestnet: user.brokerConnections?.binance?.isTestnet ?? true,
          status: user.brokerConnections?.binance?.status || 'DISCONNECTED',
          lastChecked: user.brokerConnections?.binance?.lastChecked || null
        },
        mt5: {
          connected: user.brokerConnections?.mt5?.connected || false,
          login: user.brokerConnections?.mt5?.login ? `${user.brokerConnections.mt5.login.toString().slice(0, 3)}****` : '',
          server: user.brokerConnections?.mt5?.server || '',
          gatewayUrl: user.brokerConnections?.mt5?.gatewayUrl || '',
          syncToken: user.brokerConnections?.mt5?.syncToken || `NQ-SYNC-${(user.id || 'usr').slice(-6).toUpperCase()}`,
          status: user.brokerConnections?.mt5?.status || (user.brokerConnections?.mt5?.connected ? 'CONNECTED' : 'DISCONNECTED'),
          lastChecked: user.brokerConnections?.mt5?.lastChecked || null
        },
        mexc: {
          connected: user.brokerConnections?.mexc?.connected || false,
          apiKey: user.brokerConnections?.mexc?.apiKey ? `${user.brokerConnections.mexc.apiKey.slice(0, 6)}...` : '',
          defaultLeverage: user.brokerConnections?.mexc?.defaultLeverage || 50,
          status: user.brokerConnections?.mexc?.status || 'DISCONNECTED',
          lastChecked: user.brokerConnections?.mexc?.lastChecked || null
        }
      }
    };
  }
}

export const authService = new AuthService();
