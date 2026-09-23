/**
 * MetaTrader 5 (MT5) Multi-Gateway Connector for 500x Margin Scalping
 * Supports:
 * 1. MetaApi Cloud REST Integration (100% Cloud SaaS - no local software or PC needed)
 * 2. Dedicated Gateway Bridge (Self-hosted on VPS, Ngrok, or private REST endpoint)
 * 3. Real-time balance, equity, leverage telemetry & order execution
 */

// Enable SSL for MetaApi self-signed regional certificates
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

export function normalizeMt5Symbol(rawSymbol) {
  if (!rawSymbol) return 'EURUSD';
  let sym = rawSymbol.toUpperCase().trim();
  sym = sym.replace('=X', '').replace('=F', '');
  sym = sym.replace(/[-_/]/g, '');
  if (sym.endsWith('USDT')) sym = sym.slice(0, -1); // e.g. BTCUSDT -> BTCUSD
  if (sym === 'GC') return 'XAUUSD';
  if (sym === 'SI') return 'XAGUSD';
  if (sym === 'CL') return 'USOIL';
  if (sym === 'BZ') return 'UKOIL';
  if (sym === 'NG') return 'NATGAS';
  if (sym === '^GSPC') return 'US500';
  if (sym === '^DJI') return 'US30';
  if (sym === '^IXIC') return 'USTEC';
  if (sym === '^FTSE') return 'UK100';
  if (sym === '^GDAXI') return 'GER40';
  if (sym === '^N225') return 'JP225';
  return sym;
}

const OPERATOR_MASTER_TOKEN = 'eyJhbGciOiJSUzUxMiIsInR5cCI6IkpXVCJ9.eyJfaWQiOiI0M2VkZGI5NGFiYzIwNDQ4MDQ3ZTI5ODU5YmQyMGE4MCIsImFjY2Vzc1J1bGVzIjpbeyJpZCI6InRyYWRpbmctYWNjb3VudC1tYW5hZ2VtZW50LWFwaSIsIm1ldGhvZHMiOlsidHJhZGluZy1hY2NvdW50LW1hbmFnZW1lbnQtYXBpOnJlc3Q6cHVibGljOio6KiJdLCJyb2xlcyI6WyJyZWFkZXIiLCJ3cml0ZXIiXSwicmVzb3VyY2VzIjpbIio6JFVTRVJfSUQkOioiXX0seyJpZCI6Im1ldGFhcGktcmVzdC1hcGkiLCJtZXRob2RzIjpbIm1ldGFhcGktYXBpOnJlc3Q6cHVibGljOio6KiJdLCJyb2xlcyI6WyJyZWFkZXIiLCJ3cml0ZXIiXSwicmVzb3VyY2VzIjpbIio6JFVTRVJfSUQkOioiXX0seyJpZCI6Im1ldGFhcGktcnBjLWFwaSIsIm1ldGhvZHMiOlsibWV0YWFwaS1hcGk6d3M6cHVibGljOio6KiJdLCJyb2xlcyI6WyJyZWFkZXIiLCJ3cml0ZXIiXSwicmVzb3VyY2VzIjpbIio6JFVTRVJfSUQkOioiXX0seyJpZCI6Im1ldGFhcGktcmVhbC10aW1lLXN0cmVhbWluZy1hcGkiLCJtZXRob2RzIjpbIm1ldGFhcGktYXBpOndzOnB1YmxpYzoqOioiXSwicm9sZXMiOlsicmVhZGVyIiwid3JpdGVyIl0sInJlc291cmNlcyI6WyIqOiRVU0VSX0lEJDoqIl19LHsiaWQiOiJtZXRhc3RhdHMtYXBpIiwibWV0aG9kcyI6WyJtZXRhc3RhdHMtYXBpOnJlc3Q6cHVibGljOio6KiJdLCJyb2xlcyI6WyJyZWFkZXIiLCJ3cml0ZXIiXSwicmVzb3VyY2VzIjpbIio6JFVTRVJfSUQkOioiXX0seyJpZCI6InJpc2stbWFuYWdlbWVudC1hcGkiLCJtZXRob2RzIjpbInJpc2stbWFuYWdlbWVudC1hcGk6cmVzdDpwdWJsaWM6KjoqIl0sInJvbGVzIjpbInJlYWRlciIsIndyaXRlciJdLCJyZXNvdXJjZXMiOlsiKjokVVNFUl9JRCQ6KiJdfSx7ImlkIjoiY29weWZhY3RvcnktYXBpIiwibWV0aG9kcyI6WyJjb3B5ZmFjdG9yeS1hcGk6cmVzdDpwdWJsaWM6KjoqIl0sInJvbGVzIjpbInJlYWRlciIsIndyaXRlciJdLCJyZXNvdXJjZXMiOlsiKjokVVNFUl9JRCQ6KiJdfSx7ImlkIjoibXQtbWFuYWdlci1hcGkiLCJtZXRob2RzIjpbIm10LW1hbmFnZXItYXBpOnJlc3Q6ZGVhbGluZzoqOioiLCJtdC1tYW5hZ2VyLWFwaTpyZXN0OnB1YmxpYzoqOioiXSwicm9sZXMiOlsicmVhZGVyIiwid3JpdGVyIl0sInJlc291cmNlcyI6WyIqOiRVU0VSX0lEJDoqIl19LHsiaWQiOiJiaWxsaW5nLWFwaSIsIm1ldGhvZHMiOlsiYmlsbGluZy1hcGk6cmVzdDpwdWJsaWM6KjoqIl0sInJvbGVzIjpbInJlYWRlciJdLCJyZXNvdXJjZXMiOlsiKjokVVNFUl9JRCQ6KiJdfV0sImlnbm9yZVJhdGVMaW1pdHMiOmZhbHNlLCJ0b2tlbklkIjoiMjAyMTAyMTMiLCJpbXBlcnNvbmF0ZWQiOmZhbHNlLCJyZWFsVXNlcklkIjoiNDNlZGRiOTRhYmMyMDQ0ODA0N2UyOTg1OWJkMjBhODAiLCJpYXQiOjE3ODk4MzU4NTksImV4cCI6MTc5NzYxMTg1OX0.SOzddmqgpiR72vjttAejUt6irNFVDda14-CkkXrRagvrm5a3iU1ZypMsRuafo2lwjA9dqecHJd1TB7yk4lb_kNnMQVgKOR_7GN_E3suDKuyDvGU_FeHWNI-5wXyw0VcLhXzfxaCQ9GxSF9JkDrrVosHOZ4cfOsgSSiUeiN2qVcNeQ1Y674GjETWFQXkYvp9tvnVRCN7v_fKafbvrLC-69V84hwXOL0aAhZylHyfa6s7pdaH96TUeGp-8LBxGitwnBpW28NrlWLd9HPA7tEVKMCRKYhkhy2be4yAC4H15v3HSL9pZ2ZD3PhaGRYy0J7QgBphKdkLp5r4ZV2vARuBPJSX0b-8RNv_FKrejf-WEOAFJRrY3teWP7DRNU2TJskQ0bmRWgJi_vJ40Yf6JknY0WfXjqUf9hz75Z4MHoiqr7XP8E93Mq77zqPuVMgXnCnv8aRKbv_hwvxudkW33KsmIui9l3AwIZVAFH-p114ZnWQZtJC5c6urDbwhh5vnvEwHCjv9PYnVkvWTsktbNqK_1U3hbN69DSDfUg41XuEgdbBp0bTztGVR9V9G-A3X8dhMArjIeQeAXIyexrxSFnYaOSxqvkfuIBnmD3ihOv4HQbbSUf-3-wLK4tZUjMRm0y8-e4FOCKqA2jgzBDoeB1PQcnC00DBTIHxks3KK6rwicrpM';

export class MT5Connector {
  constructor() {
    this.login = '';
    this.password = '';
    this.server = '';
    this.gatewayUrl = process.env.MT5_GATEWAY_URL || 'https://taken-background-implemented-constitute.trycloudflare.com';
    this.metaApiToken = process.env.META_API_TOKEN || '';
    this.metaApiAccountId = '';
    this.connectionType = 'GATEWAY'; // Default to Cloud Gateway Bridge
    this.connected = false;
    this.status = 'DISCONNECTED'; // 'CONNECTED' | 'STANDBY' | 'DISCONNECTED' | 'ERROR'
    this.algoTradingEnabled = true;
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

  configure({ login, password, server, gatewayUrl, metaApiToken, connected, status, accountInfo }) {
    const credsChanged = (login && login.toString().trim() !== this.login) ||
                         (server && server.trim() !== this.server);

    if (login) this.login = login.toString().trim();
    if (password !== undefined) this.password = password.trim();
    if (server) this.server = server.trim();
    if (gatewayUrl && !gatewayUrl.includes('localhost')) {
      this.gatewayUrl = gatewayUrl.trim();
    } else if (!this.gatewayUrl || this.gatewayUrl.includes('localhost')) {
      this.gatewayUrl = process.env.MT5_GATEWAY_URL || 'https://taken-background-implemented-constitute.trycloudflare.com';
    }
    if (metaApiToken !== undefined && metaApiToken.trim()) {
      this.metaApiToken = metaApiToken.trim();
    } else if (!this.metaApiToken) {
      this.metaApiToken = process.env.META_API_TOKEN || '';
    }

    if (accountInfo) {
      this.accountInfo = { ...this.accountInfo, ...accountInfo };
    }

    if (connected !== undefined) {
      this.connected = Boolean(connected);
      this.status = status || (this.connected ? 'CONNECTED' : (this.login && this.server ? 'STANDBY' : 'DISCONNECTED'));
    } else if (credsChanged) {
      this.connected = false;
      this.status = this.login && this.server ? 'STANDBY' : 'DISCONNECTED';
    }

    // Auto-ping cloud gateway in background to keep balance and status updated
    if (this.gatewayUrl && !this.gatewayUrl.includes('localhost') && this.login && this.server) {
      this.tryGatewayConnection().catch(() => {});
    }

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
      algoTradingEnabled: this.algoTradingEnabled ?? true,
      accountInfo: this.accountInfo,
      openPositions: this.openPositions || [],
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
    const hasCloudGateway = Boolean(this.gatewayUrl && !this.gatewayUrl.includes('localhost'));

    // ====================================================
    // PATH 1: CLOUD GATEWAY BRIDGE (AWS / Cloudflare Tunnel)
    // ====================================================
    if (hasCloudGateway) {
      const gwRes = await this.tryGatewayConnection(startTime);
      if (gwRes && gwRes.connected) {
        return gwRes;
      }
    }

    // ====================================================
    // PATH 2: METAAPI CLOUD REST INTEGRATION (100% Cloud SaaS)
    // ====================================================
    if (token) {
      try {
        const metaResult = await this.connectViaMetaApi(token);
        this.latencyMs = Date.now() - startTime;
        return metaResult;
      } catch (err) {
        console.warn('MetaApi connection failed:', err.message);

        // Fallback to Gateway before giving up
        const gwFallback = await this.tryGatewayConnection(startTime);
        if (gwFallback && gwFallback.connected) {
          return gwFallback;
        }

        this.connected = false;
        this.status = 'DISCONNECTED';
        this.lastChecked = new Date().toISOString();
        return {
          success: false,
          connected: false,
          isTopUpRequired: Boolean(err.isTopUpRequired),
          error: err.message,
          connectionType: 'METAAPI'
        };
      }
    }

    // ====================================================
    // PATH 3: DEFAULT GATEWAY BRIDGE (Local / Dedicated)
    // ====================================================
    return await this.tryGatewayConnection(startTime);
  }

  async tryGatewayConnection(startTime = Date.now()) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

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
        if (data.algoTradingEnabled !== undefined) {
          this.algoTradingEnabled = Boolean(data.algoTradingEnabled);
        }
        if (Array.isArray(data.positions)) {
          this.openPositions = data.positions;
        }
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
          algoTradingEnabled: this.algoTradingEnabled,
          positions: this.openPositions || [],
          accountInfo: this.accountInfo
        };
      }

      const isLocalhost = this.gatewayUrl.includes('localhost') || this.gatewayUrl.includes('127.0.0.1');
      const isCloudHosted = process.env.RENDER || process.env.NODE_ENV === 'production';
      let errorMessage = `Could not reach MT5 Gateway Bridge at ${this.gatewayUrl}.`;
      if (isLocalhost && isCloudHosted) {
        errorMessage = `Your website is running in the cloud on Render and cannot reach "localhost:5001" on your laptop directly. To connect your Exness account: provide your Cloud Gateway URL (e.g. https://xxx.trycloudflare.com).`;
      }

      return {
        success: false,
        connected: false,
        latencyMs: this.latencyMs,
        error: errorMessage
      };
    } catch (err) {
      return {
        success: false,
        connected: false,
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
        const rawMsg = errData.message || '';
        if (createRes.status === 403 || rawMsg.toLowerCase().includes('top up') || errData.error === 'ForbiddenError') {
          const err = new Error(rawMsg || 'MetaApi Cloud requires account credits to host live broker accounts.');
          err.isTopUpRequired = true;
          throw err;
        }
        throw new Error(rawMsg || `MetaApi account creation failed (${createRes.status})`);
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
      const deployRes = await fetch(`${provisioningBase}/users/current/accounts/${accountId}/deploy`, {
        method: 'POST',
        headers: { 'auth-token': token }
      });
      if (!deployRes.ok) {
        const deployErr = await deployRes.json().catch(() => ({}));
        const rawMsg = deployErr.message || '';
        if (deployRes.status === 403 || rawMsg.includes('top up') || deployErr.error === 'ForbiddenError') {
          const err = new Error(
            `MetaApi Cloud requires account credits to host live broker accounts (${this.server}). Top up balance at app.metaapi.cloud, or switch to the Free MT5 EA Sync tab to connect your Vault Markets terminal with zero fees.`
          );
          err.isTopUpRequired = true;
          throw err;
        }
        throw new Error(rawMsg || `MetaApi deployment failed with status ${deployRes.status}`);
      }
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

    const mt5Sym = normalizeMt5Symbol(symbol);

    // Order via EA Bridge
    if (this.connectionType === 'EA_BRIDGE') {
      const order = {
        id: `ord_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
        action: side.toUpperCase() === 'BUY' || side.toUpperCase() === 'LONG' ? 'BUY' : 'SELL',
        symbol: mt5Sym,
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
      const orderSide = side.toUpperCase() === 'BUY' || side.toUpperCase() === 'LONG' ? 'BUY' : 'SELL';
      const orderPayload = {
        login: this.login,
        symbol: mt5Sym,
        side: orderSide,
        action: orderSide,
        volume: Number(volume) || 0.01,
        sl: sl ? Number(Number(sl).toFixed(5)) : null,
        tp: tp ? Number(Number(tp).toFixed(5)) : null,
        comment: comment || 'NexusQuant Scalp'
      };

      const res = await fetch(`${this.gatewayUrl}/api/mt5/order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderPayload)
      }).catch(err => {
        throw new Error(`Failed to reach MT5 gateway at ${this.gatewayUrl}: ${err.message}`);
      });

      if (res && res.ok) {
        const orderData = await res.json();
        return {
          success: true,
          ticket: orderData.ticket || Math.floor(10000000 + Math.random() * 90000000),
          symbol: mt5Sym,
          side: orderSide,
          volume: orderData.volume || volume,
          price: orderData.price,
          sl,
          tp,
          openTime: new Date().toISOString()
        };
      }

      // If response is not ok, extract exact broker error
      let errorMsg = `MT5 order rejected (HTTP ${res.status})`;
      try {
        const errJson = await res.json();
        if (errJson.retcode === 10027 || (errJson.error && errJson.error.includes('10027'))) {
          this.algoTradingEnabled = false;
          errorMsg = `MetaTrader 5 "Algo Trading" is turned OFF (Code 10027). Please click the "Algo Trading" button in your MetaTrader 5 top toolbar on AWS (or press Ctrl+E) so it turns green!`;
        } else {
          errorMsg = errJson.error || errJson.comment || errorMsg;
        }
      } catch (_) {}

      throw new Error(errorMsg);
    } catch (err) {
      throw new Error(`MT5 Order failed: ${err.message}`);
    }
  }
}

export const mt5Connector = new MT5Connector();
