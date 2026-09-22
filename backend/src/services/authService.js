import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '../../data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

/**
 * Multi-Tenant Authentication & User Storage Service for NexusQuant SaaS
 * - Supports self-registration of client accounts
 * - Persistent disk storage across server restarts
 * - Per-user isolated broker credentials and live connection states
 */
class AuthService {
  constructor() {
    this.users = {};
    this.sessions = new Map();
    this.ensureDataDir();
    this.loadUsers();
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

    if (!this.users['test@gmail.com']) {
      this.users['test@gmail.com'] = {
        id: 'usr_live_002',
        email: 'test@gmail.com',
        password: 'testPass',
        name: 'Main Live Account',
        role: 'LIVE_BROKER',
        mode: 'LIVE',
        isAutoTradingEnabled: false,
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
            connected: false,
            login: '8636748',
            password: '',
            server: 'VaultMarkets-Live',
            gatewayUrl: 'http://localhost:5001',
            syncToken: 'NQ-SYNC-TEST002',
            status: 'STANDBY',
            lastChecked: null
          }
        }
      };
    }

    // Ensure all existing users have syncToken, isAutoTradingEnabled, and activeAccount
    for (const user of Object.values(this.users)) {
      if (user.isAutoTradingEnabled === undefined) {
        user.isAutoTradingEnabled = false;
      }
      if (!user.activeAccount) {
        user.activeAccount = 'MARGIN';
      }
      if (!user.brokerConnections) user.brokerConnections = {};
      if (!user.brokerConnections.mt5) user.brokerConnections.mt5 = {};
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
          gatewayUrl: 'http://localhost:5001',
          syncToken: `NQ-SYNC-${userId.slice(-6).toUpperCase()}`,
          status: 'DISCONNECTED',
          lastChecked: null
        }
      }
    };

    this.users[cleanEmail] = newUser;
    this.saveUsers();

    // Automatically create authenticated session
    const token = `sess_${crypto.randomBytes(24).toString('hex')}`;
    const expiresAt = Date.now() + 14 * 24 * 60 * 60 * 1000;
    this.sessions.set(token, {
      userId: newUser.id,
      email: newUser.email,
      expiresAt
    });

    return { token, user: this.sanitizeUser(newUser) };
  }

  login(email, password) {
    const cleanEmail = (email || '').trim().toLowerCase();
    const user = this.users[cleanEmail];

    if (!user || user.password !== password) {
      throw new Error('Invalid email or password. Please verify credentials.');
    }

    const token = `sess_${crypto.randomBytes(24).toString('hex')}`;
    const expiresAt = Date.now() + 14 * 24 * 60 * 60 * 1000;

    this.sessions.set(token, {
      userId: user.id,
      email: user.email,
      expiresAt
    });

    return { token, user: this.sanitizeUser(user) };
  }

  validateToken(token) {
    if (!token) return null;
    const session = this.sessions.get(token);
    if (!session) return null;

    if (Date.now() > session.expiresAt) {
      this.sessions.delete(token);
      return null;
    }

    const user = this.users[session.email];
    if (!user) return null;

    return this.sanitizeUser(user);
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
          syncToken: user.brokerConnections?.mt5?.syncToken || `NQ-SYNC-${(user.id || 'usr').slice(-6).toUpperCase()}`,
          status: user.brokerConnections?.mt5?.status || 'DISCONNECTED',
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
