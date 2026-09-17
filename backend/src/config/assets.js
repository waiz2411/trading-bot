export const WATCHLIST = [
  // ==========================================
  // 1. CRYPTOCURRENCIES (24/7 Global Markets)
  // ==========================================
  {
    symbol: 'BTC-USD',
    name: 'Bitcoin',
    category: 'Crypto',
    baseAsset: 'BTC',
    quoteAsset: 'USD',
    decimals: 2,
    icon: '₿',
    minVolatility: 0.5
  },
  {
    symbol: 'ETH-USD',
    name: 'Ethereum',
    category: 'Crypto',
    baseAsset: 'ETH',
    quoteAsset: 'USD',
    decimals: 2,
    icon: 'Ξ',
    minVolatility: 0.8
  },
  {
    symbol: 'SOL-USD',
    name: 'Solana',
    category: 'Crypto',
    baseAsset: 'SOL',
    quoteAsset: 'USD',
    decimals: 2,
    icon: '◎',
    minVolatility: 1.0
  },
  {
    symbol: 'BNB-USD',
    name: 'Binance Coin',
    category: 'Crypto',
    baseAsset: 'BNB',
    quoteAsset: 'USD',
    decimals: 2,
    icon: 'BNB',
    minVolatility: 0.8
  },
  {
    symbol: 'XRP-USD',
    name: 'Ripple XRP',
    category: 'Crypto',
    baseAsset: 'XRP',
    quoteAsset: 'USD',
    decimals: 4,
    icon: '✕',
    minVolatility: 1.0
  },
  {
    symbol: 'DOGE-USD',
    name: 'Dogecoin',
    category: 'Crypto',
    baseAsset: 'DOGE',
    quoteAsset: 'USD',
    decimals: 4,
    icon: 'Ð',
    minVolatility: 1.2
  },
  {
    symbol: 'ADA-USD',
    name: 'Cardano',
    category: 'Crypto',
    baseAsset: 'ADA',
    quoteAsset: 'USD',
    decimals: 4,
    icon: '₳',
    minVolatility: 1.0
  },
  {
    symbol: 'AVAX-USD',
    name: 'Avalanche',
    category: 'Crypto',
    baseAsset: 'AVAX',
    quoteAsset: 'USD',
    decimals: 2,
    icon: '🔺',
    minVolatility: 1.1
  },
  {
    symbol: 'LINK-USD',
    name: 'Chainlink',
    category: 'Crypto',
    baseAsset: 'LINK',
    quoteAsset: 'USD',
    decimals: 3,
    icon: '🔗',
    minVolatility: 1.0
  },
  {
    symbol: 'SUI-USD',
    name: 'Sui Network',
    category: 'Crypto',
    baseAsset: 'SUI',
    quoteAsset: 'USD',
    decimals: 4,
    icon: '💧',
    minVolatility: 1.3
  },
  {
    symbol: 'NEAR-USD',
    name: 'Near Protocol',
    category: 'Crypto',
    baseAsset: 'NEAR',
    quoteAsset: 'USD',
    decimals: 3,
    icon: 'Ⓝ',
    minVolatility: 1.2
  },
  {
    symbol: 'PEPE-USD',
    name: 'Pepe',
    category: 'Crypto',
    baseAsset: 'PEPE',
    quoteAsset: 'USD',
    decimals: 6,
    icon: '🐸',
    minVolatility: 1.8
  },

  // ==========================================
  // 2. FOREX MAJOR & MINOR PAIRS (24/5 Liquid)
  // ==========================================
  {
    symbol: 'EURUSD=X',
    name: 'Euro / US Dollar',
    category: 'Forex',
    baseAsset: 'EUR',
    quoteAsset: 'USD',
    decimals: 4,
    icon: '€/$',
    minVolatility: 0.1
  },
  {
    symbol: 'GBPUSD=X',
    name: 'British Pound / US Dollar',
    category: 'Forex',
    baseAsset: 'GBP',
    quoteAsset: 'USD',
    decimals: 4,
    icon: '£/$',
    minVolatility: 0.15
  },
  {
    symbol: 'USDJPY=X',
    name: 'US Dollar / Japanese Yen',
    category: 'Forex',
    baseAsset: 'USD',
    quoteAsset: 'JPY',
    decimals: 2,
    icon: '$/¥',
    minVolatility: 0.2
  },
  {
    symbol: 'AUDUSD=X',
    name: 'Australian Dollar / US Dollar',
    category: 'Forex',
    baseAsset: 'AUD',
    quoteAsset: 'USD',
    decimals: 4,
    icon: 'A$/$',
    minVolatility: 0.15
  },
  {
    symbol: 'USDCAD=X',
    name: 'US Dollar / Canadian Dollar',
    category: 'Forex',
    baseAsset: 'USD',
    quoteAsset: 'CAD',
    decimals: 4,
    icon: '$/C$',
    minVolatility: 0.15
  },
  {
    symbol: 'USDCHF=X',
    name: 'US Dollar / Swiss Franc',
    category: 'Forex',
    baseAsset: 'USD',
    quoteAsset: 'CHF',
    decimals: 4,
    icon: '$/Fr',
    minVolatility: 0.15
  },
  {
    symbol: 'NZDUSD=X',
    name: 'New Zealand Dollar / US Dollar',
    category: 'Forex',
    baseAsset: 'NZD',
    quoteAsset: 'USD',
    decimals: 4,
    icon: 'NZ$/$',
    minVolatility: 0.15
  },
  {
    symbol: 'EURGBP=X',
    name: 'Euro / British Pound',
    category: 'Forex',
    baseAsset: 'EUR',
    quoteAsset: 'GBP',
    decimals: 4,
    icon: '€/£',
    minVolatility: 0.12
  },
  {
    symbol: 'EURJPY=X',
    name: 'Euro / Japanese Yen',
    category: 'Forex',
    baseAsset: 'EUR',
    quoteAsset: 'JPY',
    decimals: 2,
    icon: '€/¥',
    minVolatility: 0.18
  },
  {
    symbol: 'GBPJPY=X',
    name: 'British Pound / Japanese Yen',
    category: 'Forex',
    baseAsset: 'GBP',
    quoteAsset: 'JPY',
    decimals: 2,
    icon: '£/¥',
    minVolatility: 0.22
  },

  // ==========================================
  // 3. COMMODITIES
  // ==========================================
  {
    symbol: 'GC=F',
    name: 'Gold Futures (XAU)',
    category: 'Commodities',
    baseAsset: 'Gold',
    quoteAsset: 'USD',
    decimals: 2,
    icon: '🪙',
    minVolatility: 0.3
  },
  {
    symbol: 'SI=F',
    name: 'Silver Futures (XAG)',
    category: 'Commodities',
    baseAsset: 'Silver',
    quoteAsset: 'USD',
    decimals: 3,
    icon: '🥈',
    minVolatility: 0.5
  },
  {
    symbol: 'CL=F',
    name: 'Crude Oil WTI',
    category: 'Commodities',
    baseAsset: 'Oil',
    quoteAsset: 'USD',
    decimals: 2,
    icon: '🛢️',
    minVolatility: 0.6
  },

  // ==========================================
  // 4. MAJOR GLOBAL INDICES
  // ==========================================
  {
    symbol: '^GSPC',
    name: 'S&P 500 Index',
    category: 'Indices',
    baseAsset: 'SPX',
    quoteAsset: 'USD',
    decimals: 2,
    icon: '📈',
    minVolatility: 0.2
  },
  {
    symbol: '^IXIC',
    name: 'NASDAQ Composite',
    category: 'Indices',
    baseAsset: 'NDX',
    quoteAsset: 'USD',
    decimals: 2,
    icon: '💻',
    minVolatility: 0.3
  }
];
