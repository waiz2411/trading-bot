/**
 * Shariah & Islamic Halal Crypto Compliance Guard
 * 
 * Strict Islamic Finance Standards (Fiqh al-Mu'amalat):
 * 1. ZERO Meme Coins: Pure speculation, no intrinsic utility, or gambling-like (Maysir) mechanisms.
 *    (e.g., DOGE, SHIB, PEPE, FLOKI, BONK, WIF, MEME, TURBO, BOME, POPCAT, MOG, NEIRO, etc.)
 * 2. ZERO Riba / Lending / Interest Protocols: Decentralized borrowing, lending, yield farming, or interest-splitting protocols.
 *    (e.g., AAVE, COMP, MKR, CRV, PENDLE, RDNT, JUST, VENUS, BENQI, etc.)
 * 3. ZERO Casino / Gambling / Betting Tokens: Casino, sportsbook, or betting-related tokens.
 *    (e.g., ROLLBIT, FUN, WIN, BET, CHZ fan tokens, etc.)
 * 4. ZERO Privacy Coins: Untraceable tokens frequently utilized in illicit activities.
 *    (e.g., XMR, DASH, ZEC)
 * 5. ONLY Genuine Utility, Layer 1/2, AI, Computing, Decentralized Storage, Oracles & Infrastructure.
 */

// Absolute Blacklist of Non-Halal Tokens (Meme, Riba lending, Casino/Gambling)
export const HARAM_BLACKLIST = new Set([
  // Meme Coins
  'DOGE', 'SHIB', 'PEPE', 'FLOKI', 'BONK', 'WIF', 'MEME', 'TURBO', 'BOME', 'POPCAT',
  'MOG', 'BRETT', 'NEIRO', 'MEW', 'MYRO', 'SPX', 'LADYS', 'BABYDOGE', 'ELON', 'SAMO',
  'CORGIAI', 'SUNDOG', 'CAT', 'COQ', 'SLERF', 'TOSHI', 'PONKE', 'GIGA', 'GOAT', 'MOODENG',
  // Riba / Lending / Yield Interest Protocols
  'AAVE', 'COMP', 'MKR', 'CRV', 'PENDLE', 'RDNT', 'JUST', 'VENUS', 'BENQI', 'MORPHO',
  'EULER', 'CREAM', 'AERODROME', 'KAMINO', 'MARGINFI', 'DRIFT',
  // Casino & Gambling
  'ROLLBIT', 'RLB', 'FUN', 'WIN', 'BET', 'CHZ', 'BAR', 'PSG', 'CITY', 'JUV',
  // Privacy Coins
  'XMR', 'DASH', 'ZEC', 'SCRT'
]);

// Verified Halal Crypto Directory (Utility, L1/L2, AI, Storage, Oracles, Web3 Infrastructure)
export const HALAL_APPROVED_ASSETS = {
  // Layer 1 Majors & Utility
  'BTC': { name: 'Bitcoin', sector: 'Store of Value / L1', isVolatile: false, minVolatility: 0.5 },
  'ETH': { name: 'Ethereum', sector: 'Smart Contracts L1', isVolatile: false, minVolatility: 0.8 },
  'SOL': { name: 'Solana', sector: 'High-Throughput L1', isVolatile: true, minVolatility: 1.4 },
  'ADA': { name: 'Cardano', sector: 'Proof-of-Stake L1', isVolatile: false, minVolatility: 1.0 },
  'AVAX': { name: 'Avalanche', sector: 'Subnets Multi-Chain L1', isVolatile: true, minVolatility: 1.5 },
  'SUI': { name: 'Sui Network', sector: 'Move-Based Ultra-Fast L1', isVolatile: true, minVolatility: 1.8 },
  'APT': { name: 'Aptos', sector: 'Move-Based Parallel L1', isVolatile: true, minVolatility: 1.7 },
  'NEAR': { name: 'Near Protocol', sector: 'Sharded User-Owned Cloud L1', isVolatile: true, minVolatility: 1.6 },
  'SEI': { name: 'Sei Network', sector: 'Parallelized EVM L1', isVolatile: true, minVolatility: 1.8 },
  'KAS': { name: 'Kaspa', sector: 'GHOSTDAG PoW L1', isVolatile: true, minVolatility: 1.8 },
  'FTM': { name: 'Sonic / Fantom', sector: 'DAG L1 Blockchain', isVolatile: true, minVolatility: 1.7 },
  'DOT': { name: 'Polkadot', sector: 'Interoperability Parachain L1', isVolatile: false, minVolatility: 1.0 },
  'ATOM': { name: 'Cosmos Hub', sector: 'Inter-Blockchain Communication', isVolatile: false, minVolatility: 1.1 },
  'ALGO': { name: 'Algorand', sector: 'Pure PoS Green L1', isVolatile: false, minVolatility: 1.0 },
  'HBAR': { name: 'Hedera', sector: 'Enterprise Hashgraph DLT', isVolatile: false, minVolatility: 1.0 },
  'VET': { name: 'VeChain', sector: 'Enterprise Supply Chain L1', isVolatile: false, minVolatility: 1.1 },

  // Layer 2 & Modular Scaling
  'POL': { name: 'Polygon', sector: 'Ethereum ZK Layer 2', isVolatile: false, minVolatility: 1.1 },
  'OP': { name: 'Optimism', sector: 'Optimistic Rollup Layer 2', isVolatile: true, minVolatility: 1.6 },
  'ARB': { name: 'Arbitrum', sector: 'Layer 2 Scaling Protocol', isVolatile: true, minVolatility: 1.6 },
  'TIA': { name: 'Celestia', sector: 'Modular Data Availability', isVolatile: true, minVolatility: 1.9 },
  'STX': { name: 'Stacks', sector: 'Bitcoin Smart Contracts Layer 2', isVolatile: true, minVolatility: 1.7 },

  // AI & Decentralized Compute
  'RENDER': { name: 'Render Network', sector: 'Decentralized GPU Compute / AI', isVolatile: true, minVolatility: 1.8 },
  'FET': { name: 'Artificial Superintelligence', sector: 'Decentralized Machine Learning AI', isVolatile: true, minVolatility: 1.9 },
  'ICP': { name: 'Internet Computer', sector: '100% On-Chain Cloud Compute', isVolatile: true, minVolatility: 1.6 },

  // Decentralized Data Storage
  'AR': { name: 'Arweave', sector: 'Permanent Data Storage', isVolatile: true, minVolatility: 1.7 },
  'FIL': { name: 'Filecoin', sector: 'Decentralized IPFS Storage Network', isVolatile: true, minVolatility: 1.5 },

  // Oracles & Financial Tech Infrastructure (Non-Riba)
  'LINK': { name: 'Chainlink', sector: 'Decentralized Oracle Network', isVolatile: false, minVolatility: 1.0 },
  'INJ': { name: 'Injective', sector: 'Financial Infrastructure L1', isVolatile: true, minVolatility: 1.8 },
  'GALA': { name: 'Gala Games', sector: 'Web3 Entertainment Infrastructure', isVolatile: true, minVolatility: 2.0 },
  'XRP': { name: 'Ripple XRP', sector: 'Cross-Border Settlement', isVolatile: false, minVolatility: 1.0 },
  'BNB': { name: 'Binance Coin', sector: 'BNB Chain Ecosystem Utility', isVolatile: false, minVolatility: 0.8 }
};

/**
 * Validates if a symbol is 100% Shariah / Halal Compliant
 */
export function isHalalCompliant(symbolOrBase) {
  if (!symbolOrBase) return false;
  const clean = String(symbolOrBase)
    .toUpperCase()
    .replace(/[-_/=X].*$/, '')
    .replace(/USD.*$/, '')
    .replace(/USDT$/, '');

  // Check explicit blacklist first
  if (HARAM_BLACKLIST.has(clean)) {
    return false;
  }

  // Check if it is in approved Halal directory
  return clean in HALAL_APPROVED_ASSETS;
}

/**
 * Filter a list of market assets to only include Halal compliant ones
 */
export function filterHalalAssets(assets = [], options = {}) {
  const { highVolatilityOnly = false, establishedOnly = false } = options;

  return assets.filter(asset => {
    if (asset.category !== 'Crypto') return true; // Non-crypto forex handled separately

    const clean = (asset.baseAsset || asset.symbol)
      .toUpperCase()
      .replace(/[-_/=X].*$/, '')
      .replace(/USD.*$/, '')
      .replace(/USDT$/, '');

    // Strict Halal check
    if (!isHalalCompliant(clean)) {
      return false;
    }

    const info = HALAL_APPROVED_ASSETS[clean];
    if (!info) return false;

    // Volatility filtering
    if (highVolatilityOnly) {
      return info.isVolatile || (asset.minVolatility && asset.minVolatility >= 1.4) || asset.isHighVolatility;
    }

    if (establishedOnly) {
      return !info.isVolatile && (asset.minVolatility ? asset.minVolatility < 1.4 : true);
    }

    return true;
  });
}
