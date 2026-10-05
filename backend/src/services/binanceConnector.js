import crypto from 'crypto';

/**
 * Binance Spot Trading REST API Connector
 * Supports:
 * - HMAC-SHA256 authenticated requests
 * - Testnet (https://testnet.binance.vision) and Mainnet (https://api.binance.com)
 * - Connectivity testing, ping, and account permissions check
 * - Live spot balances retrieval (USDT, BTC, ETH, SOL, etc.)
 * - Spot market order execution using quoteOrderQty (100% USDT balance allocation)
 */

export class BinanceConnector {
  constructor() {
    this.apiKey = '';
    this.apiSecret = '';
    this.isTestnet = true;
    this.connected = false;
    this.status = 'DISCONNECTED'; // 'CONNECTED' | 'STANDBY' | 'DISCONNECTED' | 'ERROR'
    this.lastChecked = null;
    this.cachedBalances = [];
    this.latencyMs = 0;
    this.timeOffset = 0; // Milliseconds difference with Binance server clock
  }

  get baseUrl() {
    if (this.isTestnet) return 'https://testnet.binance.vision';
    const proxy = process.env.BINANCE_PROXY_URL || this.proxyUrl;
    if (proxy) return proxy.replace(/\/+$/, '');
    return 'https://api.binance.com';
  }

  configure({ apiKey, apiSecret, isTestnet = true, proxyUrl, connected, status, balances }) {
    if (apiKey) this.apiKey = apiKey.trim();
    if (apiSecret) this.apiSecret = apiSecret.trim();
    if (proxyUrl !== undefined) this.proxyUrl = proxyUrl ? proxyUrl.trim() : '';
    this.isTestnet = !!isTestnet;
    if (connected !== undefined) {
      this.connected = Boolean(connected);
      this.status = status || (this.connected ? 'CONNECTED' : (this.apiKey ? 'STANDBY' : 'DISCONNECTED'));
    } else if (!this.apiKey || !this.apiSecret) {
      this.connected = false;
      this.status = 'DISCONNECTED';
    }
    if (balances && Array.isArray(balances) && balances.length > 0) {
      this.cachedBalances = balances;
    }
    return this.getStatus();
  }

  getStatus() {
    return {
      connected: this.connected,
      status: this.status,
      isTestnet: this.isTestnet,
      hasCredentials: !!(this.apiKey && this.apiSecret),
      apiKeyMasked: this.apiKey ? `${this.apiKey.slice(0, 6)}...` : '',
      latencyMs: this.latencyMs,
      lastChecked: this.lastChecked,
      balances: this.cachedBalances
    };
  }

  formatSymbol(symbol) {
    if (!symbol) return 'BTCUSDT';
    // Clean symbol: e.g. BTC-USD -> BTCUSDT, SOL-USD -> SOLUSDT
    let clean = symbol.replace(/[-_/]/g, '').toUpperCase();
    if (clean.endsWith('USD')) clean = clean.replace(/USD$/, 'USDT');
    if (!clean.endsWith('USDT') && !clean.endsWith('BUSD') && !clean.endsWith('FDUSD')) {
      clean = `${clean}USDT`;
    }
    return clean;
  }

  async syncTime() {
    try {
      const startTime = Date.now();
      const res = await fetch(`${this.baseUrl}/api/v3/time`);
      if (res.ok) {
        const data = await res.json();
        const endTime = Date.now();
        const latency = Math.round((endTime - startTime) / 2);
        this.timeOffset = data.serverTime - endTime;
        this.lastTimeSync = Date.now();
      }
    } catch (err) {
      console.warn('Could not sync Binance server time:', err.message);
    }
  }

  signQuery(queryString = '') {
    // 1500ms backward safety buffer guarantees timestamp is never ahead of Binance clock
    // recvWindow=60000 allows up to 60 seconds of valid window
    const timestamp = Date.now() + (this.timeOffset || 0) - 1500;
    const windowParam = 'recvWindow=60000';
    const base = queryString
      ? `${queryString}&${windowParam}&timestamp=${timestamp}`
      : `${windowParam}&timestamp=${timestamp}`;
    const signature = crypto
      .createHmac('sha256', this.apiSecret)
      .update(base)
      .digest('hex');
    return `${base}&signature=${signature}`;
  }

  async testConnection() {
    if (!this.apiKey || !this.apiSecret) {
      this.status = 'DISCONNECTED';
      this.connected = false;
      return {
        success: false,
        error: 'API Key and API Secret are required to connect to Binance.'
      };
    }

    const startTime = Date.now();

    try {
      // 1. Test latency with ping
      let pingRes = await fetch(`${this.baseUrl}/api/v3/ping`, { method: 'GET' });
      if (!pingRes.ok && pingRes.status === 451) {
        // Automatic failover: If the requested endpoint (e.g. Anycast worker running in US) returned 451,
        // retry via our dedicated European Frankfurt gateway
        const europeanGateway = 'https://trading-bot-test-z6bi.onrender.com/api/binance-proxy';
        if (this.baseUrl !== europeanGateway) {
          console.log(`[BinanceConnector] Endpoint ${this.baseUrl} returned HTTP 451. Retrying via European Frankfurt Gateway...`);
          try {
            const euPing = await fetch(`${europeanGateway}/api/v3/ping`, { method: 'GET' });
            if (euPing.ok) {
              this.proxyUrl = europeanGateway;
              pingRes = euPing;
            }
          } catch (eFail) {
            console.warn('[BinanceConnector] European gateway fallback check failed:', eFail.message);
          }
        }
      }

      if (!pingRes.ok) {
        if (pingRes.status === 451) {
          this.status = 'ERROR';
          this.connected = false;
          return {
            success: false,
            latencyMs: Date.now() - startTime,
            isGeoBlocked: true,
            error: 'Binance Global returned HTTP 451 (US Jurisdiction Restriction). The proxy URL reached Binance from a US datacenter. Click "Use Built-in Germany Gateway" below to route through Frankfurt, Germany.'
          };
        }
        throw new Error(`Binance ping failed with HTTP ${pingRes.status}`);
      }
      this.latencyMs = Date.now() - startTime;

      // 2. Synchronize server time to prevent clock drift errors
      await this.syncTime();

      // 3. Test authenticated account query
      const signedQuery = this.signQuery('');
      const accountRes = await fetch(`${this.baseUrl}/api/v3/account?${signedQuery}`, {
        method: 'GET',
        headers: {
          'X-MBX-APIKEY': this.apiKey
        }
      });

      const accountData = await accountRes.json();

      if (!accountRes.ok) {
        this.status = 'ERROR';
        this.connected = false;
        let errMsg = accountData.msg || `Binance API error (code ${accountData.code})`;
        if (accountData.code === -2015) {
          errMsg = 'Binance Error -2015: Invalid API-key, IP, or permissions. Please check: (1) "Enable Spot & Margin Trading" is checked in your Binance API settings, (2) If IP restriction is enabled, ensure your IP is added to the whitelist, and (3) You saved changes with Binance 2FA verification.';
        }
        return {
          success: false,
          latencyMs: this.latencyMs,
          error: errMsg
        };
      }

      this.connected = true;
      this.status = 'CONNECTED';
      this.lastChecked = new Date().toISOString();

      // Extract non-zero spot balances
      const nonZero = (accountData.balances || [])
        .map(b => ({
          asset: b.asset,
          free: parseFloat(b.free) || 0,
          locked: parseFloat(b.locked) || 0,
          total: (parseFloat(b.free) || 0) + (parseFloat(b.locked) || 0)
        }))
        .filter(b => b.total > 0.00001);

      this.cachedBalances = nonZero;

      return {
        success: true,
        connected: true,
        latencyMs: this.latencyMs,
        canTrade: accountData.canTrade,
        accountType: accountData.accountType || 'SPOT',
        balances: nonZero
      };
    } catch (err) {
      this.status = 'ERROR';
      this.connected = false;
      return {
        success: false,
        latencyMs: this.latencyMs,
        error: err.message || 'Connection failed. Please check network and API credentials.'
      };
    }
  }

  async getBalances() {
    if (!this.connected) {
      return this.cachedBalances;
    }

    try {
      const signedQuery = this.signQuery('');
      const res = await fetch(`${this.baseUrl}/api/v3/account?${signedQuery}`, {
        method: 'GET',
        headers: { 'X-MBX-APIKEY': this.apiKey }
      });
      const data = await res.json();
      if (res.ok && data.balances) {
        this.cachedBalances = data.balances
          .map(b => ({
            asset: b.asset,
            free: parseFloat(b.free) || 0,
            locked: parseFloat(b.locked) || 0,
            total: (parseFloat(b.free) || 0) + (parseFloat(b.locked) || 0)
          }))
          .filter(b => b.total > 0.00001);
      }
      return this.cachedBalances;
    } catch (err) {
      console.error('Failed to update Binance balances:', err);
      return this.cachedBalances;
    }
  }

  async getSymbolLotSize(symbol) {
    if (!this.symbolFilters) this.symbolFilters = {};
    if (this.symbolFilters[symbol]) return this.symbolFilters[symbol];

    try {
      const res = await fetch(`${this.baseUrl}/api/v3/exchangeInfo?symbol=${symbol}`);
      if (res.ok) {
        const data = await res.json();
        const symInfo = data.symbols?.[0];
        const lotFilter = symInfo?.filters?.find(f => f.filterType === 'LOT_SIZE');
        const notionalFilter = symInfo?.filters?.find(f => f.filterType === 'NOTIONAL' || f.filterType === 'MIN_NOTIONAL');
        const minNotional = notionalFilter ? (parseFloat(notionalFilter.minNotional) || 5.0) : 5.0;

        const stepSize = lotFilter ? (parseFloat(lotFilter.stepSize) || 0.0001) : 0.0001;
        const minQty = lotFilter ? (parseFloat(lotFilter.minQty) || 0.0001) : 0.0001;
        this.symbolFilters[symbol] = { stepSize, minQty, minNotional };
        return this.symbolFilters[symbol];
      }
    } catch (err) {
      console.warn(`Could not fetch lot size for ${symbol}:`, err.message);
    }
    return { stepSize: 0.01, minQty: 0.01, minNotional: 5.0 };
  }

  async getPrice(symbol) {
    const binanceSymbol = this.formatSymbol(symbol);
    try {
      const res = await fetch(`${this.baseUrl}/api/v3/ticker/price?symbol=${binanceSymbol}`);
      if (res.ok) {
        const data = await res.json();
        return parseFloat(data.price) || null;
      }
    } catch (_) {}
    return null;
  }

  /**
   * Execute Spot Market Order
   * For Buy: Uses quoteOrderQty (e.g. buy with 10 USDT)
   * For Sell: Uses quantity (e.g. sell units of coin)
   */
  async placeSpotMarketOrder({ symbol, side = 'BUY', quoteOrderQty, quantity }, isRetry = false) {
    if (!this.connected || !this.apiKey || !this.apiSecret) {
      throw new Error('Binance Spot is not connected. Configure credentials in Live Broker settings.');
    }

    // Proactively sync server time if not synced recently
    if (!this.lastTimeSync || Date.now() - this.lastTimeSync > 60000) {
      await this.syncTime();
    }

    const binanceSymbol = this.formatSymbol(symbol);
    const params = new URLSearchParams();
    params.append('symbol', binanceSymbol);
    params.append('side', side.toUpperCase());
    params.append('type', 'MARKET');

    if (side.toUpperCase() === 'BUY' && quoteOrderQty) {
      const filter = await this.getSymbolLotSize(binanceSymbol);
      const minNotional = filter?.minNotional || 5.0;
      const numNotional = Number(quoteOrderQty);
      if (numNotional < minNotional) {
        throw new Error(`Order size ($${numNotional.toFixed(2)}) is below Binance minimum required order size ($${minNotional.toFixed(2)} USDT).`);
      }
      params.append('quoteOrderQty', numNotional.toFixed(2));
    } else if (quantity) {
      const filter = await this.getSymbolLotSize(binanceSymbol);
      let formattedQty = Number(quantity);
      if (filter && filter.stepSize) {
        const stepStr = filter.stepSize.toString();
        const decimals = stepStr.includes('.') ? stepStr.split('.')[1].replace(/0+$/, '').length : 0;
        const steps = Math.floor(formattedQty / filter.stepSize);
        formattedQty = (steps * filter.stepSize).toFixed(decimals);
      } else {
        formattedQty = formattedQty.toFixed(4);
      }
      params.append('quantity', formattedQty.toString());
    }

    const signedQuery = this.signQuery(params.toString());

    const res = await fetch(`${this.baseUrl}/api/v3/order?${signedQuery}`, {
      method: 'POST',
      headers: {
        'X-MBX-APIKEY': this.apiKey
      }
    });

    const data = await res.json();

    if (!res.ok) {
      // Automatic recovery from timestamp drift (code -1021)
      if (!isRetry && (data.code === -1021 || (data.msg && data.msg.toLowerCase().includes('ahead of the server')))) {
        await this.syncTime();
        return this.placeSpotMarketOrder({ symbol, side, quoteOrderQty, quantity }, true);
      }
      throw new Error(data.msg || `Binance order rejected: ${res.statusText}`);
    }

    // Refresh balances after order
    await this.getBalances().catch(() => {});

    return {
      success: true,
      orderId: data.orderId,
      symbol: data.symbol,
      side: data.side,
      status: data.status,
      executedQty: data.executedQty,
      cummulativeQuoteQty: data.cummulativeQuoteQty,
      fills: data.fills || []
    };
  }

  /**
   * Convert leftover small balances (dust) to BNB via Binance SAPI
   */
  async convertDustToBnb(assets = []) {
    if (!this.connected || !this.apiKey || !this.apiSecret) return null;
    try {
      const assetList = (Array.isArray(assets) ? assets : [assets])
        .map(a => a.toUpperCase())
        .filter(a => a && a !== 'USDT' && a !== 'BNB' && a !== 'USDC' && a !== 'FDUSD');
      if (assetList.length === 0) return null;

      const params = new URLSearchParams();
      for (const a of assetList) {
        params.append('asset', a);
      }
      const signedQuery = this.signQuery(params.toString());
      const res = await fetch(`${this.baseUrl}/sapi/v1/asset/dust?${signedQuery}`, {
        method: 'POST',
        headers: {
          'X-MBX-APIKEY': this.apiKey
        }
      });
      const data = await res.json();
      if (res.ok) {
        await this.getBalances().catch(() => {});
        return data;
      } else {
        console.warn('[BinanceConnector] Dust conversion notice:', data.msg || res.statusText);
        return null;
      }
    } catch (err) {
      console.warn('[BinanceConnector] Dust conversion error:', err.message);
      return null;
    }
  }
}

export const binanceConnector = new BinanceConnector();
