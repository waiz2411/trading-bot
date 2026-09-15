export const WATCHLIST = [
  // Cryptocurrencies (24/7 markets)
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

  // Forex Major & Minor Pairs
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

  // Commodities
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

  // Major Global Indices & Tech
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
