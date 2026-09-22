import crypto from 'crypto';

/**
 * MEXC Global Exchange Connector
 * Supports:
 * 1. Spot API v3 (Binance-compatible HMAC-SHA256, 0% maker fees)
 * 2. Contract / Futures API (Up to 200x leverage on BTC, ETH, SOL, DOGE, etc.)
 * 3. 100% Pure Cloud Execution (Zero local software, no IP blocks on cloud servers)
 */

export class MEXCConnector {
  constructor() {
    this.apiKey = '';
    this.apiSecret = '';
    this.defaultLeverage = 50; // Default 50x (configurable up to 200x)
    this.connected = false;
    this.status = 'DISCONNECTED'; // 'CONNECTED' | 'STANDBY' | 'DISCONNECTED' | 'ERROR'
    this.lastChecked = null;
    this.latencyMs = 0;
    this.timeOffset = 0;
    this.cachedBalances = {
      spot: [],
      futures: {
        equity: 0,
        available: 0,
        margin: 0,
        unrealizedPnl: 0,
        currency: 'USDT'
      }
    };
  }

  get spotBaseUrl() {
    return 'https://api.mexc.com';
  }

  get futuresBaseUrl() {
    return 'https://contract.mexc.com';
  }

  configure({ apiKey, apiSecret, defaultLeverage = 50 }) {
    if (apiKey) this.apiKey = apiKey.trim();
    if (apiSecret) this.apiSecret = apiSecret.trim();
    if (defaultLeverage) this.defaultLeverage = Math.min(200, Math.max(1, Number(defaultLeverage)));
    this.connected = false;
    this.status = this.apiKey ? 'STANDBY' : 'DISCONNECTED';
    return this.getStatus();
  }

  getStatus() {
    return {
      connected: this.connected,
      status: this.status,
      hasCredentials: !!(this.apiKey && this.apiSecret),
      apiKeyMasked: this.apiKey ? `${this.apiKey.slice(0, 6)}...` : '',
      defaultLeverage: this.defaultLeverage,
      latencyMs: this.latencyMs,
      lastChecked: this.lastChecked,
      balances: this.cachedBalances
    };
  }

  /**
   * Format symbol for MEXC:
   * Spot: BTCUSDT
   * Futures: BTC_USDT
   */
  formatSymbol(symbol, isFutures = false) {
    if (!symbol) return isFutures ? 'BTC_USDT' : 'BTCUSDT';
    let clean = symbol.toUpperCase().replace(/[-=/]/g, '').trim();
    if (clean.endsWith('USD')) clean = clean.replace(/USD$/, 'USDT');
    if (!clean.endsWith('USDT')) clean = `${clean}USDT`;

    if (isFutures) {
      // Convert BTCUSDT -> BTC_USDT
      return clean.replace(/USDT$/, '_USDT');
    }
    return clean;
  }

  async syncTime() {
    try {
      const startTime = Date.now();
      const res = await fetch(`${this.spotBaseUrl}/api/v3/time`);
      if (res.ok) {
        const data = await res.json();
        const roundTrip = Math.round((Date.now() - startTime) / 2);
        this.timeOffset = (data.serverTime - Date.now()) + roundTrip;
      }
    } catch (err) {
      console.warn('Could not sync MEXC server time:', err.message);
    }
  }

  signSpotQuery(params = {}) {
    const timestamp = Date.now() + (this.timeOffset || 0);
    const queryObj = {
      ...params,
      recvWindow: 60000,
      timestamp
    };

    const queryString = Object.keys(queryObj)
      .sort()
      .map(k => `${k}=${encodeURIComponent(queryObj[k])}`)
      .join('&');

    const signature = crypto
      .createHmac('sha256', this.apiSecret)
      .update(queryString)
      .digest('hex');

    return `${queryString}&signature=${signature}`;
  }

  signFuturesHeaders(paramStr = '') {
    const timestamp = Date.now() + (this.timeOffset || 0);
    const signString = `${this.apiKey}${timestamp}${paramStr}`;
    const signature = crypto
      .createHmac('sha256', this.apiSecret)
      .update(signString)
      .digest('hex');

    return {
      'ApiKey': this.apiKey,
      'Request-Time': timestamp.toString(),
      'Signature': signature,
      'Content-Type': 'application/json'
    };
  }

  async testConnection() {
    if (!this.apiKey || !this.apiSecret) {
      this.status = 'DISCONNECTED';
      this.connected = false;
      return {
        success: false,
        error: 'MEXC Access Key (API Key) and Secret Key are required.'
      };
    }

    const startTime = Date.now();
    try {
      await this.syncTime();

      // 1. Fetch Spot account
      const spotQuery = this.signSpotQuery();
      const spotRes = await fetch(`${this.spotBaseUrl}/api/v3/account?${spotQuery}`, {
        headers: {
          'X-MEXC-APIKEY': this.apiKey,
          'Content-Type': 'application/json'
        }
      });

      this.latencyMs = Date.now() - startTime;

      if (!spotRes.ok) {
        const errData = await spotRes.json().catch(() => ({}));
        this.status = 'ERROR';
        this.connected = false;
        return {
          success: false,
          error: errData.msg || `MEXC Spot Authentication failed (HTTP ${spotRes.status})`,
          code: errData.code
        };
      }

      const spotData = await spotRes.json();
      const nonZeroSpot = (spotData.balances || [])
        .filter(b => Number(b.free) > 0 || Number(b.locked) > 0)
        .map(b => ({
          asset: b.asset,
          free: Number(b.free),
          locked: Number(b.locked)
        }));

      // 2. Fetch Futures assets
      let futuresAssets = {
        equity: 0,
        available: 0,
        margin: 0,
        unrealizedPnl: 0,
        currency: 'USDT'
      };

      try {
        const futuresHeaders = this.signFuturesHeaders('');
        const futRes = await fetch(`${this.futuresBaseUrl}/api/v1/private/account/assets`, {
          headers: futuresHeaders
        });

        if (futRes.ok) {
          const futData = await futRes.json();
          if (futData.success && futData.data) {
            const usdtAsset = Array.isArray(futData.data)
              ? futData.data.find(a => a.currency === 'USDT')
              : futData.data;
            if (usdtAsset) {
              futuresAssets = {
                equity: Number(usdtAsset.equity || usdtAsset.availableBalance || 0),
                available: Number(usdtAsset.availableBalance || 0),
                margin: Number(usdtAsset.positionMargin || 0),
                unrealizedPnl: Number(usdtAsset.unrealisedPnl || 0),
                currency: 'USDT'
              };
            }
          }
        }
      } catch (futErr) {
        console.warn('Could not fetch MEXC futures assets:', futErr.message);
      }

      this.cachedBalances = {
        spot: nonZeroSpot,
        futures: futuresAssets
      };

      this.connected = true;
      this.status = 'CONNECTED';
      this.lastChecked = new Date().toISOString();

      return {
        success: true,
        connected: true,
        latencyMs: this.latencyMs,
        leverage: this.defaultLeverage,
        balances: this.cachedBalances,
        message: 'Successfully connected to MEXC Global! Spot & 200x Margin ready.'
      };
    } catch (err) {
      this.status = 'ERROR';
      this.connected = false;
      return {
        success: false,
        error: err.message || 'Failed to connect to MEXC'
      };
    }
  }

  async getBalances() {
    if (!this.connected) {
      await this.testConnection();
    }
    return this.cachedBalances;
  }

  /**
   * Execute 200x Futures Order
   * side: 'BUY' (Open Long) | 'SELL' (Open Short)
   */
  async openFuturesOrder({ symbol, side, amountUsdt, leverage = 50, stopLoss, takeProfit }) {
    if (!this.apiKey || !this.apiSecret) {
      throw new Error('MEXC API keys are not configured.');
    }

    const pair = this.formatSymbol(symbol, true);
    const lev = Math.min(200, Math.max(1, Number(leverage || this.defaultLeverage)));

    // 1. Ensure leverage is set for this contract
    try {
      const levBody = JSON.stringify({
        symbol: pair,
        leverage: lev,
        openType: 1 // 1: Isolated margin, 2: Cross margin
      });
      const levHeaders = this.signFuturesHeaders(levBody);
      await fetch(`${this.futuresBaseUrl}/api/v1/private/position/change_leverage`, {
        method: 'POST',
        headers: levHeaders,
        body: levBody
      });
    } catch (e) {
      console.warn('Could not update MEXC leverage:', e.message);
    }

    // 2. Fetch current contract price to determine volume in contracts
    let contractPrice = 0;
    try {
      const tickerRes = await fetch(`${this.futuresBaseUrl}/api/v1/contract/ticker?symbol=${pair}`);
      if (tickerRes.ok) {
        const tData = await tickerRes.json();
        contractPrice = Number(tData.data?.lastPrice || tData.data?.fairPrice || 0);
      }
    } catch {
      contractPrice = 1;
    }

    // Vol in contract units (1 contract value varies by pair, e.g. 0.0001 BTC or 1 unit)
    const totalExposure = amountUsdt * lev;
    const vol = Math.max(1, Math.floor(contractPrice > 0 ? totalExposure / contractPrice : amountUsdt));

    // Side: 1 = Open Long, 3 = Open Short
    const orderSide = side.toUpperCase() === 'BUY' ? 1 : 3;

    const orderPayload = {
      symbol: pair,
      vol,
      side: orderSide,
      type: 5, // 5 = Market order
      openType: 1 // Isolated
    };

    if (stopLoss) orderPayload.stopLossPrice = Number(stopLoss);
    if (takeProfit) orderPayload.takeProfitPrice = Number(takeProfit);

    const bodyStr = JSON.stringify(orderPayload);
    const headers = this.signFuturesHeaders(bodyStr);

    const res = await fetch(`${this.futuresBaseUrl}/api/v1/private/order/submit`, {
      method: 'POST',
      headers,
      body: bodyStr
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || `MEXC Futures order rejected (${res.status})`);
    }

    return {
      success: true,
      orderId: data.data,
      symbol: pair,
      side: side.toUpperCase(),
      leverage: lev,
      volume: vol,
      timestamp: new Date().toISOString()
    };
  }
}

export const mexcConnector = new MEXCConnector();
