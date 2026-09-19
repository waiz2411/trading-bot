import crypto from 'crypto';

/**
 * Authentication Service for NexusQuant
 * - Demo Account: demo@gmail.com / demoPass (Simulated Paper Trading)
 * - Main Live Account: test@gmail.com / testPass (Real Broker & Exchange Trading)
 */

class AuthService {
  constructor() {
    this.users = {
      'demo@gmail.com': {
        id: 'usr_demo_001',
        email: 'demo@gmail.com',
        password: 'demoPass',
        name: 'Demo Trader',
        role: 'DEMO',
        mode: 'SIMULATED',
        createdAt: '2026-09-01T00:00:00.000Z',
        brokerConnections: {
          binance: { connected: false, apiKey: '', isTestnet: true },
          mt5: { connected: false, login: '', server: '' }
        }
      },
      'test@gmail.com': {
        id: 'usr_live_002',
        email: 'test@gmail.com',
        password: 'testPass',
        name: 'Main Live Account',
        role: 'LIVE_BROKER',
        mode: 'LIVE',
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
            login: '',
            password: '',
            server: '',
            gatewayUrl: 'http://localhost:5001',
            status: 'STANDBY',
            lastChecked: null
          }
        }
      }
    };

    this.sessions = new Map();

    const defaultToken = 'sess_demo_default_token';
    this.sessions.set(defaultToken, {
      userId: 'usr_demo_001',
      email: 'demo@gmail.com',
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000
    });
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

    const userProfile = this.sanitizeUser(user);
    return { token, user: userProfile };
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

  updateBrokerConfig(email, broker, config) {
    const user = this.getUser(email);
    if (!user) throw new Error('User not found');

    if (broker === 'binance') {
      user.brokerConnections.binance = {
        ...user.brokerConnections.binance,
        ...config,
        lastUpdated: new Date().toISOString()
      };
      return user.brokerConnections.binance;
    } else if (broker === 'mt5') {
      user.brokerConnections.mt5 = {
        ...user.brokerConnections.mt5,
        ...config,
        lastUpdated: new Date().toISOString()
      };
      return user.brokerConnections.mt5;
    }
    throw new Error('Unknown broker type');
  }

  sanitizeUser(user) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      mode: user.mode,
      brokerConnections: {
        binance: {
          connected: user.brokerConnections.binance.connected,
          apiKey: user.brokerConnections.binance.apiKey ? `${user.brokerConnections.binance.apiKey.slice(0, 6)}...` : '',
          isTestnet: user.brokerConnections.binance.isTestnet,
          status: user.brokerConnections.binance.status,
          lastChecked: user.brokerConnections.binance.lastChecked
        },
        mt5: {
          connected: user.brokerConnections.mt5.connected,
          login: user.brokerConnections.mt5.login ? `${user.brokerConnections.mt5.login.slice(0, 3)}****` : '',
          server: user.brokerConnections.mt5.server,
          status: user.brokerConnections.mt5.status,
          lastChecked: user.brokerConnections.mt5.lastChecked
        }
      }
    };
  }
}

export const authService = new AuthService();
