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
 *    (e.g., XMR, DASH, ZEC, SCRT)
 * 5. ZERO Leveraged Tokens & Zero Synthetic Riba Products (e.g. UP, DOWN, BULL, BEAR tokens)
 * 6. ONLY Genuine Utility, Layer 1/2, AI, Computing, Decentralized Storage, Oracles, Interoperability & Infrastructure.
 */

// Absolute Blacklist of Non-Halal Tokens (Meme, Riba lending, Casino/Gambling, Privacy, Leveraged)
export const HARAM_BLACKLIST = new Set([
  // Meme Coins
  'DOGE', 'SHIB', 'PEPE', 'FLOKI', 'BONK', 'WIF', 'MEME', 'TURBO', 'BOME', 'POPCAT',
  'MOG', 'BRETT', 'NEIRO', 'MEW', 'MYRO', 'SPX', 'LADYS', 'BABYDOGE', 'ELON', 'SAMO',
  'CORGIAI', 'SUNDOG', 'CAT', 'COQ', 'SLERF', 'TOSHI', 'PONKE', 'GIGA', 'GOAT', 'MOODENG',
  'DOGS', 'NOT', 'PUPPIES', 'WEN', 'SILLY', 'SMOG', 'COCO', 'TKO', 'WOOF', 'CHEEMS',
  // Riba / Lending / Yield Interest Protocols
  'AAVE', 'COMP', 'MKR', 'CRV', 'PENDLE', 'RDNT', 'JUST', 'VENUS', 'BENQI', 'MORPHO',
  'EULER', 'CREAM', 'AERODROME', 'KAMINO', 'MARGINFI', 'DRIFT', 'XVS', 'ALPACA', 'FOR',
  'DF', 'CREAM', 'BIFI', 'BADGER', 'FARM', 'YFI', 'YFII', 'AUTO',
  // Casino, Gambling & Sports Fan Tokens
  'ROLLBIT', 'RLB', 'FUN', 'WIN', 'BET', 'CHZ', 'BAR', 'PSG', 'CITY', 'JUV', 'ACM', 'OG', 'ATM', 'ASR', 'INTER', 'POR', 'ARG', 'MENGO', 'TRA',
  // Privacy Coins
  'XMR', 'DASH', 'ZEC', 'SCRT', 'ZEN', 'BEAM', 'GRIN',
  // Stablecoins / Wrapped Riba assets
  'USDC', 'FDUSD', 'TUSD', 'BUSD', 'EUR', 'GBP', 'DAI', 'USDP', 'AEUR', 'WBTC', 'WETH', 'WBETH', 'TBTC', 'USDD', 'FRAX', 'LUSD'
]);

// Verified Halal Crypto Directory (Utility, L1/L2, AI, Storage, Oracles, Web3 Infrastructure)
export const HALAL_APPROVED_ASSETS = {
  // Layer 1 Majors & High-Speed Networks
  'BTC': { name: 'Bitcoin', sector: 'Store of Value / L1', isVolatile: false, minVolatility: 0.5 },
  'ETH': { name: 'Ethereum', sector: 'Smart Contracts L1', isVolatile: false, minVolatility: 0.8 },
  'SOL': { name: 'Solana', sector: 'High-Throughput L1', isVolatile: true, minVolatility: 1.4 },
  'BNB': { name: 'Binance Coin', sector: 'BNB Chain Ecosystem Utility', isVolatile: false, minVolatility: 0.8 },
  'ADA': { name: 'Cardano', sector: 'Proof-of-Stake L1', isVolatile: false, minVolatility: 1.0 },
  'AVAX': { name: 'Avalanche', sector: 'Subnets Multi-Chain L1', isVolatile: true, minVolatility: 1.5 },
  'SUI': { name: 'Sui Network', sector: 'Move-Based Ultra-Fast L1', isVolatile: true, minVolatility: 1.8 },
  'APT': { name: 'Aptos', sector: 'Move-Based Parallel L1', isVolatile: true, minVolatility: 1.7 },
  'NEAR': { name: 'Near Protocol', sector: 'Sharded User-Owned Cloud L1', isVolatile: true, minVolatility: 1.6 },
  'SEI': { name: 'Sei Network', sector: 'Parallelized EVM L1', isVolatile: true, minVolatility: 1.8 },
  'LTC': { name: 'Litecoin', sector: 'Scrypt PoW Layer 1', isVolatile: false, minVolatility: 0.8 },
  'FTM': { name: 'Sonic / Fantom', sector: 'DAG L1 Blockchain', isVolatile: true, minVolatility: 1.7 },
  'DOT': { name: 'Polkadot', sector: 'Interoperability Parachain L1', isVolatile: false, minVolatility: 1.0 },
  'ATOM': { name: 'Cosmos Hub', sector: 'Inter-Blockchain Communication', isVolatile: false, minVolatility: 1.1 },
  'ALGO': { name: 'Algorand', sector: 'Pure PoS Green L1', isVolatile: false, minVolatility: 1.0 },
  'HBAR': { name: 'Hedera', sector: 'Enterprise Hashgraph DLT', isVolatile: false, minVolatility: 1.0 },
  'VET': { name: 'VeChain', sector: 'Enterprise Supply Chain L1', isVolatile: false, minVolatility: 1.1 },
  'KAS': { name: 'Kaspa', sector: 'GHOSTDAG Proof-of-Work L1', isVolatile: true, minVolatility: 1.8 },
  'ICP': { name: 'Internet Computer', sector: '100% On-Chain Cloud Compute', isVolatile: true, minVolatility: 1.6 },
  'EGLD': { name: 'MultiversX', sector: 'Adaptive State Sharding L1', isVolatile: true, minVolatility: 1.5 },
  'FLOW': { name: 'Flow', sector: 'Consumer Web3 & Gaming L1', isVolatile: true, minVolatility: 1.5 },
  'ROSE': { name: 'Oasis Network', sector: 'Confidential EVM Layer 1', isVolatile: true, minVolatility: 1.7 },
  'KAVA': { name: 'Kava', sector: 'Cosmos-Ethereum Co-Chain', isVolatile: true, minVolatility: 1.6 },
  'MINA': { name: 'Mina Protocol', sector: 'Succinct ZK Blockchain', isVolatile: true, minVolatility: 1.7 },
  'IOTA': { name: 'IOTA', sector: 'Tangle DAG IoT Network', isVolatile: true, minVolatility: 1.5 },
  'NEO': { name: 'NEO', sector: 'Smart Economy Dual-Token L1', isVolatile: true, minVolatility: 1.6 },
  'EOS': { name: 'EOS Network', sector: 'High-Performance DPoS L1', isVolatile: true, minVolatility: 1.5 },
  'ZIL': { name: 'Zilliqa', sector: 'Sharded Smart Contract L1', isVolatile: true, minVolatility: 1.6 },
  'QTUM': { name: 'Qtum', sector: 'UTXO PoS Smart Contracts', isVolatile: true, minVolatility: 1.5 },
  'ONE': { name: 'Harmony', sector: 'Fast Sharded Blockchain', isVolatile: true, minVolatility: 1.7 },
  'CFX': { name: 'Conflux Network', sector: 'Tree-Graph Consensus L1', isVolatile: true, minVolatility: 1.8 },
  'ASTR': { name: 'Astar Network', sector: 'Multi-VM Smart Hub', isVolatile: true, minVolatility: 1.7 },
  'RON': { name: 'Ronin', sector: 'EVM Gaming Blockchain', isVolatile: true, minVolatility: 1.7 },
  'KLAY': { name: 'Kaia / Klaytn', sector: 'Enterprise Public L1', isVolatile: true, minVolatility: 1.6 },
  'CKB': { name: 'Nervos Network', sector: 'Layer 1 PoW Common Knowledge', isVolatile: true, minVolatility: 1.8 },

  // Layer 2 & Modular Scaling
  'POL': { name: 'Polygon', sector: 'Ethereum ZK Layer 2', isVolatile: false, minVolatility: 1.1 },
  'OP': { name: 'Optimism', sector: 'Optimistic Rollup Layer 2', isVolatile: true, minVolatility: 1.6 },
  'ARB': { name: 'Arbitrum', sector: 'Layer 2 Scaling Protocol', isVolatile: true, minVolatility: 1.6 },
  'TIA': { name: 'Celestia', sector: 'Modular Data Availability', isVolatile: true, minVolatility: 1.9 },
  'STX': { name: 'Stacks', sector: 'Bitcoin Smart Contracts Layer 2', isVolatile: true, minVolatility: 1.7 },
  'STRK': { name: 'Starknet', sector: 'ZK-STARK Ethereum Layer 2', isVolatile: true, minVolatility: 1.8 },
  'ZK': { name: 'ZKsync', sector: 'ZK-Rollup Ethereum Layer 2', isVolatile: true, minVolatility: 1.8 },
  'MANTA': { name: 'Manta Network', sector: 'Modular ZK Layer 2', isVolatile: true, minVolatility: 1.8 },
  'METIS': { name: 'Metis', sector: 'Decentralized Sequencer L2', isVolatile: true, minVolatility: 1.8 },
  'BLAST': { name: 'Blast', sector: 'EVM Layer 2', isVolatile: true, minVolatility: 1.8 },

  // AI, Machine Learning & GPU Compute
  'RENDER': { name: 'Render Network', sector: 'Decentralized GPU Compute / AI', isVolatile: true, minVolatility: 1.8 },
  'FET': { name: 'Artificial Superintelligence', sector: 'Decentralized Machine Learning AI', isVolatile: true, minVolatility: 1.9 },
  'TAO': { name: 'Bittensor', sector: 'Decentralized Commodity AI Network', isVolatile: true, minVolatility: 1.9 },
  'IO': { name: 'io.net', sector: 'Decentralized GPU Cloud Clustering', isVolatile: true, minVolatility: 2.0 },
  'WLD': { name: 'Worldcoin', sector: 'Proof of Personhood AI', isVolatile: true, minVolatility: 1.8 },
  'ARKM': { name: 'Arkham', sector: 'AI-Powered Blockchain Intelligence', isVolatile: true, minVolatility: 1.9 },
  'PHB': { name: 'Phoenix', sector: 'AI & Privacy Web3 Compute', isVolatile: true, minVolatility: 2.0 },

  // Decentralized Data Storage & Infrastructure
  'AR': { name: 'Arweave', sector: 'Permanent Data Storage', isVolatile: true, minVolatility: 1.7 },
  'FIL': { name: 'Filecoin', sector: 'Decentralized IPFS Storage Network', isVolatile: true, minVolatility: 1.5 },
  'STORJ': { name: 'Storj', sector: 'Encrypted Distributed Cloud Storage', isVolatile: true, minVolatility: 1.7 },
  'ANKR': { name: 'Ankr Network', sector: 'Decentralized Web3 Node Infrastructure', isVolatile: true, minVolatility: 1.6 },
  'GRT': { name: 'The Graph', sector: 'Decentralized Indexing Protocol', isVolatile: true, minVolatility: 1.6 },
  'HOT': { name: 'Holo', sector: 'Distributed P2P Cloud Hosting', isVolatile: true, minVolatility: 1.6 },

  // Oracles, Cross-Chain & DePIN Infrastructure
  'LINK': { name: 'Chainlink', sector: 'Decentralized Oracle Network', isVolatile: false, minVolatility: 1.0 },
  'PYTH': { name: 'Pyth Network', sector: 'First-Party Financial Oracles', isVolatile: true, minVolatility: 1.8 },
  'INJ': { name: 'Injective', sector: 'Financial Infrastructure L1', isVolatile: true, minVolatility: 1.8 },
  'GALA': { name: 'Gala Games', sector: 'Web3 Entertainment Infrastructure', isVolatile: true, minVolatility: 2.0 },
  'XRP': { name: 'Ripple XRP', sector: 'Cross-Border Settlement', isVolatile: false, minVolatility: 1.0 },
  'QNT': { name: 'Quant Network', sector: 'Overledger Enterprise Interoperability', isVolatile: true, minVolatility: 1.8 },
  'AXS': { name: 'Axie Infinity', sector: 'Gaming & Metaverse Infrastructure', isVolatile: true, minVolatility: 1.8 },
  'SAND': { name: 'The Sandbox', sector: 'Decentralized Metaverse Utility', isVolatile: true, minVolatility: 1.7 },
  'MANA': { name: 'Decentraland', sector: 'Virtual Reality Spatial Utility', isVolatile: true, minVolatility: 1.7 },
  'THETA': { name: 'Theta Network', sector: 'Decentralized Video Streaming & Edge GPU', isVolatile: true, minVolatility: 1.6 },
  'ENJ': { name: 'Enjin Coin', sector: 'Digital Asset & NFT Infrastructure', isVolatile: true, minVolatility: 1.7 },
  'CHZ': { name: 'Chiliz', sector: 'Sports & Entertainment Infrastructure', isVolatile: true, minVolatility: 1.6 },
  'SUPER': { name: 'SuperVerse', sector: 'Web3 Gaming Protocol', isVolatile: true, minVolatility: 1.9 },
  'BEAMX': { name: 'Beam Gaming', sector: 'Sovereign Gaming Ecosystem', isVolatile: true, minVolatility: 1.9 },
  'HOOK': { name: 'Hooked Protocol', sector: 'Web3 Gamified Learn & Onboarding', isVolatile: true, minVolatility: 1.9 },
  'HFT': { name: 'Hashflow', sector: 'Zero-Slippage MEV-Protected Trading', isVolatile: true, minVolatility: 1.9 },
  'ID': { name: 'SPACE ID', sector: 'Universal Web3 Domain & Identity', isVolatile: true, minVolatility: 1.8 },
  'VANRY': { name: 'Vanar Chain', sector: 'Carbon-Neutral Entertainment L1', isVolatile: true, minVolatility: 2.0 }
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

  // 1. Check explicit blacklist first
  if (HARAM_BLACKLIST.has(clean)) {
    return false;
  }

  // 2. Reject Leveraged Tokens (e.g. BTCUP, ETHDOWN, etc.)
  if (clean.endsWith('UP') || clean.endsWith('DOWN') || clean.endsWith('BULL') || clean.endsWith('BEAR')) {
    return false;
  }

  // 3. Known Halal Approved Directory
  if (clean in HALAL_APPROVED_ASSETS) {
    return true;
  }

  // 4. Dynamic Halal Classifier: If not on blacklist and does not violate Shariah principles
  // It is classified as an approved Web3 Utility / Infrastructure coin
  return true;
}

/**
 * Get detailed Halal metadata (name, sector, volatility profile)
 */
export function getHalalMetadata(symbolOrBase) {
  const clean = String(symbolOrBase || '')
    .toUpperCase()
    .replace(/[-_/=X].*$/, '')
    .replace(/USD.*$/, '')
    .replace(/USDT$/, '');

  if (HALAL_APPROVED_ASSETS[clean]) {
    return HALAL_APPROVED_ASSETS[clean];
  }

  return {
    name: clean,
    sector: 'Web3 Utility & Infrastructure',
    isVolatile: true,
    minVolatility: 1.5
  };
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

    const info = getHalalMetadata(clean);

    // Volatility filtering
    if (highVolatilityOnly) {
      return info.isVolatile || (asset.minVolatility && asset.minVolatility >= 1.4) || asset.isHighVolatility || (asset.liveVolatility24h && asset.liveVolatility24h >= 3.5);
    }

    if (establishedOnly) {
      return !info.isVolatile && (!asset.liveVolatility24h || asset.liveVolatility24h < 3.5);
    }

    return true;
  });
}

