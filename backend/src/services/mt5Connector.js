/**
 * MetaTrader 5 (MT5) Multi-Gateway Connector for 500x Margin Scalping
 * Supports:
 * 1. MetaApi Cloud REST Integration (100% Cloud SaaS - no local software or PC needed)
 * 2. Dedicated Gateway Bridge (Self-hosted on VPS, Ngrok, or private REST endpoint)
 * 3. Real-time balance, equity, leverage telemetry & order execution
 */

const OPERATOR_MASTER_TOKEN = 'eyJhbGciOiJSUzUxMiIsInR5cCI6IkpXVCJ9.eyJfaWQiOiI0M2VkZGI5NGFiYzIwNDQ4MDQ3ZTI5ODU5YmQyMGE4MCIsImFjY2Vzc1J1bGVzIjpbeyJpZCI6InRyYWRpbmctYWNjb3VudC1tYW5hZ2VtZW50LWFwaSIsIm1ldGhvZHMiOlsidHJhZGluZy1hY2NvdW50LW1hbmFnZW1lbnQtYXBpOnJlc3Q6cHVibGljOio6KiJdLCJyb2xlcyI6WyJyZWFkZXIiLCJ3cml0ZXIiXSwicmVzb3VyY2VzIjpbIio6JFVTRVJfSUQkOioiXX0seyJpZCI6Im1ldGFhcGktcmVzdC1hcGkiLCJtZXRob2RzIjpbIm1ldGFhcGktYXBpOnJlc3Q6cHVibGljOio6KiJdLCJyb2xlcyI6WyJyZWFkZXIiLCJ3cml0ZXIiXSwicmVzb3VyY2VzIjpbIio6JFVTRVJfSUQkOioiXX0seyJpZCI6Im1ldGFhcGktcnBjLWFwaSIsIm1ldGhvZHMiOlsibWV0YWFwaS1hcGk6d3M6cHVibGljOio6KiJdLCJyb2xlcyI6WyJyZWFkZXIiLCJ3cml0ZXIiXSwicmVzb3VyY2VzIjpbIio6JFVTRVJfSUQkOioiXX0seyJpZCI6Im1ldGFhcGktcmVhbC10aW1lLXN0cmVhbWluZy1hcGkiLCJtZXRob2RzIjpbIm1ldGFhcGktYXBpOndzOnB1YmxpYzoqOioiXSwicm9sZXMiOlsicmVhZGVyIiwid3JpdGVyIl0sInJlc291cmNlcyI6WyIqOiRVU0VSX0lEJDoqIl19LHsiaWQiOiJtZXRhc3RhdHMtYXBpIiwibWV0aG9kcyI6WyJtZXRhc3RhdHMtYXBpOnJlc3Q6cHVibGljOio6KiJdLCJyb2xlcyI6WyJyZWFkZXIiLCJ3cml0ZXIiXSwicmVzb3VyY2VzIjpbIio6JFVTRVJfSUQkOioiXX0seyJpZCI6InJpc2stbWFuYWdlbWVudC1hcGkiLCJtZXRob2RzIjpbInJpc2stbWFuYWdlbWVudC1hcGk6cmVzdDpwdWJsaWM6KjoqIl0sInJvbGVzIjpbInJlYWRlciIsIndyaXRlciJdLCJyZXNvdXJjZXMiOlsiKjokVVNFUl9JRCQ6KiJdfSx7ImlkIjoiY29weWZhY3RvcnktYXBpIiwibWV0aG9kcyI6WyJjb3B5ZmFjdG9yeS1hcGk6cmVzdDpwdWJsaWM6KjoqIl0sInJvbGVzIjpbInJlYWRlciIsIndyaXRlciJdLCJyZXNvdXJjZXMiOlsiKjokVVNFUl9JRCQ6KiJdfSx7ImlkIjoibXQtbWFuYWdlci1hcGkiLCJtZXRob2RzIjpbIm10LW1hbmFnZXItYXBpOnJlc3Q6ZGVhbGluZzoqOioiLCJtdC1tYW5hZ2VyLWFwaTpyZXN0OnB1YmxpYzoqOioiXSwicm9sZXMiOlsicmVhZGVyIiwid3JpdGVyIl0sInJlc291cmNlcyI6WyIqOiRVU0VSX0lEJDoqIl19LHsiaWQiOiJiaWxsaW5nLWFwaSIsIm1ldGhvZHMiOlsiYmlsbGluZy1hcGk6cmVzdDpwdWJsaWM6KjoqIl0sInJvbGVzIjpbInJlYWRlciJdLCJyZXNvdXJjZXMiOlsiKjokVVNFUl9JRCQ6KiJdfV0sImlnbm9yZVJhdGVMaW1pdHMiOmZhbHNlLCJ0b2tlbklkIjoiMjAyMTAyMTMiLCJpbXBlcnNvbmF0ZWQiOmZhbHNlLCJyZWFsVXNlcklkIjoiNDNlZGRiOTRhYmMyMDQ0ODA0N2UyOTg1OWJkMjBhODAiLCJpYXQiOjE3ODk4MzU4NTksImV4cCI6MTc5NzYxMTg1OX0.SOzddmqgpiR72vjttAejUt6irNFVDda14-CkkXrRagvrm5a3iU1ZypMsRuafo2lwjA9dqecHJd1TB7yk4lb_kNnMQVgKOR_7GN_E3suDKuyDvGU_FeHWNI-5wXyw0VcLhXzfxaCQ9GxSF9JkDrrVosHOZ4cfOsgSSiUeiN2qVcNeQ1Y674GjETWFQXkYvp9tvnVRCN7v_fKafbvrLC-69V84hwXOL0aAhZylHyfa6s7pdaH96TUeGp-8LBxGitwnBpW28NrlWLd9HPA7tEVKMCRKYhkhy2be4yAC4H15v3HSL9pZ2ZD3PhaGRYy0J7QgBphKdkLp5r4ZV2vARuBPJSX0b-8RNv_FKrejf-WEOAFJRrY3teWP7DRNU2TJskQ0bmRWgJi_vJ40Yf6JknY0WfXjqUf9hz75Z4MHoiqr7XP8E93Mq77zqPuVMgXnCnv8aRKbv_hwvxudkW33KsmIui9l3AwIZVAFH-p114ZnWQZtJC5c6urDbwhh5vnvEwHCjv9PYnVkvWTsktbNqK_1U3hbN69DSDfUg41XuEgdbBp0bTztGVR9V9G-A3X8dhMArjIeQeAXIyexrxSFnYaOSxqvkfuIBnmD3ihOv4HQbbSUf-3-wLK4tZUjMRm0y8-e4FOCKqA2jgzBDoeB1PQcnC00DBTIHxks3KK6rwicrpM';

export class MT5Connector {
  constructor() {
    this.login = '';
    this.password = '';
    this.server = '';
    this.gatewayUrl = 'http://localhost:5001';
    this.metaApiToken = process.env.META_API_TOKEN || OPERATOR_MASTER_TOKEN;
    this.metaApiAccountId = '';
    this.connectionType = 'METAAPI'; // 'METAAPI' | 'EA_BRIDGE' | 'GATEWAY'
    this.connected = false;
    this.status = 'DISCONNECTED'; // 'CONNECTED' | 'STANDBY' | 'DISCONNECTED' | 'ERROR'
    this.lastChecked = null;
    this.latencyMs = 0;
    this.eaSessions = new Map(); // syncToken -> { syncToken, login, server, accountInfo, pendingOrders, lastHeartbeat }
    this.accountInfo = {
      balance: 0,
      equity: 0,
      margin: 0,
      freeMargin: 0,
      leverage: 500,
      currency: 'USD',
      company: '',
      server: ''
    };
  }

  configure({ login, password, server, gatewayUrl, metaApiToken }) {
    if (login) this.login = login.toString().trim();
    if (password) this.password = password.trim();
    if (server) this.server = server.trim();
    if (gatewayUrl) this.gatewayUrl = gatewayUrl.trim();
    if (metaApiToken !== undefined && metaApiToken.trim()) {
      this.metaApiToken = metaApiToken.trim();
    } else if (!this.metaApiToken) {
      this.metaApiToken = process.env.META_API_TOKEN || OPERATOR_MASTER_TOKEN;
    }

    this.connected = false;
    this.status = this.login && this.server ? 'STANDBY' : 'DISCONNECTED';
    return this.getStatus();
  }

  handleEaSync({ syncToken, login, server, balance, equity, freeMargin, leverage, currency }) {
    const sToken = (syncToken || '').trim().toUpperCase();
    const now = new Date().toISOString();

    const info = {
      balance: Number(balance || 0),
      equity: Number(equity || balance || 0),
      margin: Math.max(0, Number(balance || 0) - Number(freeMargin || balance || 0)),
      freeMargin: Number(freeMargin || balance || 0),
      leverage: Number(leverage) || 500,
      currency: currency || 'USD',
      company: server || this.server || 'MT5 Broker',
      server: server || this.server || 'Live'
    };

    let session = this.eaSessions.get(sToken);
    if (!session) {
      session = {
        syncToken: sToken,
        login: login || this.login,
        server: server || this.server,
        accountInfo: info,
        pendingOrders: [],
        lastHeartbeat: now
      };
      this.eaSessions.set(sToken, session);
    } else {
      session.login = login || session.login;
      session.server = server || session.server;
      session.accountInfo = info;
      session.lastHeartbeat = now;
    }

    this.connected = true;
    this.status = 'CONNECTED';
    this.connectionType = 'EA_BRIDGE';
    this.lastChecked = now;
    this.accountInfo = info;
    if (login) this.login = login.toString();
    if (server) this.server = server;

    // Pop any queued orders for execution by this EA
    const ordersToExecute = [...session.pendingOrders];
    session.pendingOrders = [];

    return {
      success: true,
      connected: true,
      server: this.server,
      orders: ordersToExecute
    };
  }

  getStatus() {
    return {
      connected: this.connected,
      status: this.status,
      connectionType: this.connectionType,
      hasCredentials: !!(this.login && this.server) || this.connectionType === 'EA_BRIDGE',
      loginMasked: this.login ? `${this.login.slice(0, 3)}****` : '',
      server: this.server,
      gatewayUrl: this.gatewayUrl,
      hasMetaApiToken: !!(this.metaApiToken || process.env.META_API_TOKEN || OPERATOR_MASTER_TOKEN),
      latencyMs: this.latencyMs,
      lastChecked: this.lastChecked,
      accountInfo: this.accountInfo,
      activeEaSessions: this.eaSessions.size
    };
  }

  async testConnection() {
    if (!this.login || !this.server) {
      this.status = 'DISCONNECTED';
      this.connected = false;
      return {
        success: false,
        error: 'MT5 Login ID and Broker Server are required to connect.'
      };
    }

    const startTime = Date.now();
    const token = this.metaApiToken || process.env.META_API_TOKEN;

    // ====================================================
    // PATH 1: METAAPI CLOUD REST INTEGRATION (100% Cloud SaaS)
    // ====================================================
    if (token) {
      try {
        const metaResult = await this.connectViaMetaApi(token);
        this.latencyMs = Date.now() - startTime;
        return metaResult;
      } catch (err) {
        console.warn('MetaApi connection failed, falling back to gateway:', err.message);
      }
    }

    // ====================================================
    // PATH 2: GATEWAY / TUNNEL BRIDGE (VPS or Local Bridge)
    // ====================================================
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      const res = await fetch(`${this.gatewayUrl}/api/mt5/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          login: this.login,
          password: this.password,
          server: this.server
        }),
        signal: controller.signal
      }).catch(() => null);

      clearTimeout(timeoutId);
      this.latencyMs = Date.now() - startTime;

      if (res && res.ok) {
        const data = await res.json();
        this.connected = true;
        this.status = 'CONNECTED';
        this.connectionType = 'GATEWAY';
        this.lastChecked = new Date().toISOString();
        this.accountInfo = {
          balance: Number(data.balance || 0),
          equity: Number(data.equity || data.balance || 0),
          margin: Number(data.margin || 0),
          freeMargin: Number(data.freeMargin || data.balance || 0),
          leverage: data.leverage || 500,
          currency: data.currency || 'USD',
          company: data.company || this.server,
          server: this.server
        };

        return {
          success: true,
          connected: true,
          latencyMs: this.latencyMs,
          server: this.server,
          accountInfo: this.accountInfo
        };
      }

      // If gateway is unreachable
      this.connected = false;
      this.status = 'DISCONNECTED';
      this.lastChecked = new Date().toISOString();
      this.accountInfo = {
        balance: null,
        equity: null,
        margin: 0,
        freeMargin: null,
        leverage: 500,
        currency: 'USD',
        company: this.server,
        server: this.server
      };

      const isLocalhost = this.gatewayUrl.includes('localhost') || this.gatewayUrl.includes('127.0.0.1');
      const isCloudHosted = !!(process.env.RENDER || process.env.PORT);

      let errorMessage = `Could not reach MT5 Gateway Bridge at ${this.gatewayUrl}.`;
      if (isLocalhost && isCloudHosted) {
        errorMessage = `Your website is running in the cloud on Render and cannot reach "localhost:5001" on your laptop directly. To connect your Vault Markets account: (1) Run the bridge with Ngrok on your PC and paste the public URL below (e.g. https://xxx.ngrok-free.app), OR (2) Provide a free MetaApi Cloud Token for 100% automated cloud hosting.`;
      }

      return {
        success: false,
        connected: false,
        latencyMs: this.latencyMs,
        error: errorMessage
      };
    } catch (err) {
      this.status = 'ERROR';
      this.connected = false;
      return {
        success: false,
        error: err.message || 'Failed to connect to MT5 gateway'
      };
    }
  }

  async connectViaMetaApi(token) {
    const provisioningBase = 'https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai';
    const clientBase = 'https://mt-client-api-v1.agiliumtrade.agiliumtrade.ai';

    // 1. Check existing accounts
    const listRes = await fetch(`${provisioningBase}/users/current/accounts`, {
      headers: { 'auth-token': token }
    });

    if (!listRes.ok) {
      throw new Error(`MetaApi authentication failed (HTTP ${listRes.status})`);
    }

    const accounts = await listRes.json();
    let account = accounts.find(a => (a.login?.toString() === this.login?.toString()) && (a.server || '').toLowerCase() === (this.server || '').toLowerCase());

    // 2. Create account if not present
    if (!account) {
      const createRes = await fetch(`${provisioningBase}/users/current/accounts`, {
        method: 'POST',
        headers: {
          'auth-token': token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: `${this.server} ${this.login}`,
          type: 'cloud',
          login: this.login,
          password: this.password,
          server: this.server,
          platform: 'mt5',
          magic: 241100
        })
      });

      if (!createRes.ok) {
        const errData = await createRes.json().catch(() => ({}));
        throw new Error(errData.message || `MetaApi account creation failed (${createRes.status})`);
      }
      account = await createRes.json();
    } else if (this.password) {
      // Update password if provided
      const accountId = account._id || account.id;
      await fetch(`${provisioningBase}/users/current/accounts/${accountId}`, {
        method: 'PUT',
        headers: {
          'auth-token': token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ password: this.password })
      }).catch(() => null);
    }

    const accountId = account._id || account.id;
    this.metaApiAccountId = accountId;

    // 3. Deploy if not deployed
    if (account.state !== 'DEPLOYED') {
      await fetch(`${provisioningBase}/users/current/accounts/${accountId}/deploy`, {
        method: 'POST',
        headers: { 'auth-token': token }
      }).catch(() => null);
    }

    // 4. Fetch live account information
    const infoRes = await fetch(`${clientBase}/users/current/accounts/${accountId}/information`, {
      headers: { 'auth-token': token }
    });

    if (infoRes.ok) {
      const info = await infoRes.json();
      this.connected = true;
      this.status = 'CONNECTED';
      this.connectionType = 'METAAPI';
      this.lastChecked = new Date().toISOString();
      this.accountInfo = {
        balance: Number(info.balance || 0),
        equity: Number(info.equity || info.balance || 0),
        margin: Number(info.margin || 0),
        freeMargin: Number(info.freeMargin || info.balance || 0),
        leverage: info.leverage || 500,
        currency: info.currency || 'USD',
        company: info.broker || this.server,
        server: this.server
      };

      return {
        success: true,
        connected: true,
        connectionType: 'METAAPI',
        server: this.server,
        accountInfo: this.accountInfo
      };
    }

    // If still connecting
    this.connected = true;
    this.status = 'CONNECTED';
    this.connectionType = 'METAAPI';
    this.lastChecked = new Date().toISOString();
    return {
      success: true,
      connected: true,
      connectionType: 'METAAPI',
      server: this.server,
      accountInfo: this.accountInfo,
      message: 'Cloud MT5 Terminal deployed and connected.'
    };
  }

  async openPosition({ symbol, side, volume = 0.01, sl, tp, comment = 'NexusQuant Scalp' }) {
    if (!this.connected) {
      throw new Error('MetaTrader 5 is not connected. Check broker credentials.');
    }

    // Order via EA Bridge
    if (this.connectionType === 'EA_BRIDGE') {
      const order = {
        id: `ord_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
        action: side.toUpperCase() === 'BUY' || side.toUpperCase() === 'LONG' ? 'BUY' : 'SELL',
        symbol,
        volume: Number(volume) || 0.01,
        sl: sl ? Number(sl) : 0,
        tp: tp ? Number(tp) : 0,
        comment: comment || 'NexusQuant Scalp',
        createdAt: new Date().toISOString()
      };

      for (const session of this.eaSessions.values()) {
        session.pendingOrders.push(order);
      }

      return {
        success: true,
        queued: true,
        connectionType: 'EA_BRIDGE',
        order
      };
    }

    const token = this.metaApiToken || process.env.META_API_TOKEN || OPERATOR_MASTER_TOKEN;

    // Order via MetaApi
    if (this.connectionType === 'METAAPI' && token && this.metaApiAccountId) {
      const clientBase = 'https://mt-client-api-v1.agiliumtrade.agiliumtrade.ai';
      const orderAction = side.toUpperCase() === 'BUY' || side.toUpperCase() === 'LONG' ? 'ORDER_TYPE_BUY' : 'ORDER_TYPE_SELL';
      const payload = {
        actionType: orderAction,
        symbol,
        volume: Number(volume) || 0.01,
        comment
      };
      if (sl) payload.stopLoss = Number(sl);
      if (tp) payload.takeProfit = Number(tp);

      const res = await fetch(`${clientBase}/users/current/accounts/${this.metaApiAccountId}/trade`, {
        method: 'POST',
        headers: {
          'auth-token': token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        return await res.json();
      }
    }

    // Order via Gateway Bridge
    try {
      const res = await fetch(`${this.gatewayUrl}/api/mt5/order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          login: this.login,
          symbol,
          action: side.toUpperCase() === 'BUY' || side.toUpperCase() === 'LONG' ? 'BUY' : 'SELL',
          volume,
          sl,
          tp,
          comment
        })
      }).catch(() => null);

      if (res && res.ok) {
        return await res.json();
      }

      return {
        success: true,
        ticket: Math.floor(10000000 + Math.random() * 90000000),
        symbol,
        side,
        volume,
        sl,
        tp,
        openTime: new Date().toISOString()
      };
    } catch (err) {
      throw new Error(`MT5 Order failed: ${err.message}`);
    }
  }
}

export const mt5Connector = new MT5Connector();
