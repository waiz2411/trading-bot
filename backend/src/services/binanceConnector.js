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
  }

  get baseUrl() {
    return this.isTestnet
      ? 'https://testnet.binance.vision'
      : 'https://api.binance.com';
  }

  configure({ apiKey, apiSecret, isTestnet = true }) {
    if (apiKey) this.apiKey = apiKey.trim();
    if (apiSecret) this.apiSecret = apiSecret.trim();
    this.isTestnet = !!isTestnet;
    this.connected = false;
    this.status = this.apiKey ? 'STANDBY' : 'DISCONNECTED';
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

  signQuery(queryString = '') {
    const timestamp = Date.now();
    const withTimestamp = queryString ? `${queryString}&timestamp=${timestamp}` : `timestamp=${timestamp}`;
    const signature = crypto
      .createHmac('sha256', this.apiSecret)
      .update(withTimestamp)
      .digest('hex');
    return `${withTimestamp}&signature=${signature}`;
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
      const pingRes = await fetch(`${this.baseUrl}/api/v3/ping`, { method: 'GET' });
      if (!pingRes.ok) {
        throw new Error(`Binance ping failed with HTTP ${pingRes.status}`);
      }
      this.latencyMs = Date.now() - startTime;

      // 2. Test authenticated account query
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
        return {
          success: false,
          latencyMs: this.latencyMs,
          error: accountData.msg || `Binance API error (code ${accountData.code})`
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

  /**
   * Execute Spot Market Order
   * For Buy: Uses quoteOrderQty (e.g. buy with 10 USDT)
   * For Sell: Uses quantity (e.g. sell units of coin)
   */
  async placeSpotMarketOrder({ symbol, side = 'BUY', quoteOrderQty, quantity }) {
    if (!this.connected || !this.apiKey || !this.apiSecret) {
      throw new Error('Binance Spot is not connected. Configure credentials in Live Broker settings.');
    }

    const binanceSymbol = this.formatSymbol(symbol);
    const params = new URLSearchParams();
    params.append('symbol', binanceSymbol);
    params.append('side', side.toUpperCase());
    params.append('type', 'MARKET');

    if (side.toUpperCase() === 'BUY' && quoteOrderQty) {
      params.append('quoteOrderQty', quoteOrderQty.toString());
    } else if (quantity) {
      params.append('quantity', quantity.toString());
    }

    const signedQuery = this.signQuery(params.toString());

    const res = await fetch(`${this.baseUrl}/api/v3/order?${signedQuery}`, {
      method: 'POST',
      headers: {
        'X-MBX-APIKEY': this.apiKey,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.msg || `Binance order rejected: ${res.statusText}`);
    }

    // Refresh balances after order
    this.getBalances().catch(() => {});

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
}

export const binanceConnector = new BinanceConnector();
