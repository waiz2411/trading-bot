import { PaperTradingEngine } from './services/paperTradingEngine.js';
import { calculateTechnicalMetrics, calculateRSI } from './services/technicalAnalysis.js';
import { evaluateStrategyConfluence, evaluateSpotConfluence } from './services/strategyEngine.js';
import { RiskManager } from './services/riskManager.js';
import { WATCHLIST } from './config/assets.js';

console.log('================================================================');
console.log('🧪 TESTING 75%+ WIN-RATE SNIPER SCALPING STRATEGY');
console.log('================================================================');

// Generate realistic natural candles with zero artificial bias
function createRealisticCandles(basePrice, count = 70) {
  const candles = [];
  let price = basePrice;
  const now = Date.now();
  for (let i = count; i >= 0; i--) {
    const time = new Date(now - i * 60000).toISOString();
    const open = price;
    // Unbiased random walk with mean reversion
    const meanReversion = (basePrice - price) * 0.05;
    const change = ((Math.random() - 0.5) * 0.003 * price) + meanReversion;
    const close = Math.max(0.001, open + change);
    const high = Math.max(open, close) + Math.random() * 0.0015 * price;
    const low = Math.min(open, close) - Math.random() * 0.0015 * price;
    candles.push({ time, open, high, low, close, volume: 10000 });
    price = close;
  }
  return candles;
}

// Realistic price initialization for assets
const DEFAULT_PRICES = {
  'BTC-USD': 77000,
  'ETH-USD': 2460,
  'SOL-USD': 105,
  'BNB-USD': 718,
  'XRP-USD': 1.40,
  'DOGE-USD': 0.165,
  'ADA-USD': 0.585,
  'AVAX-USD': 24.5,
  'LINK-USD': 14.8,
  'SUI-USD': 3.15,
  'EURUSD=X': 1.0850,
  'GBPUSD=X': 1.2950,
  'USDJPY=X': 152.40,
  'AUDUSD=X': 0.6550,
  'USDCAD=X': 1.3850,
  'USDCHF=X': 0.8650,
  'GC=F': 2635.0,
  'SI=F': 31.20,
  'CL=F': 70.50,
  'NG=F': 2.85,
  '^GSPC': 5850.0,
  '^IXIC': 18500.0,
  '^DJI': 42800.0
};

// 1. MARGIN SCALPER SIMULATION
const engine = new PaperTradingEngine(100, 'MARGIN');
const riskManager = new RiskManager({
  riskPerTradePct: 1.5,
  maxConcurrentTrades: 2, // Strict 2-slot sniper discipline
  minConfidenceThreshold: 85,
  tradeDirection: 'BOTH',
  tradingStyle: 'SCALPING',
  defaultLeverage: 500,
  targetRiskRewardRatio: 1.3
});

// 2. SPOT ENGINE SIMULATION
const spotEngine = new PaperTradingEngine(25, 'SPOT');
const spotRiskSettings = {
  stopLossPct: 1.0,
  takeProfitPct: 2.2,
  minConfidenceThreshold: 82
};

// Select a representative multi-asset portfolio across Crypto, Forex, Commodities, Indices
const testAssets = WATCHLIST.slice(0, 15).map(item => ({
  ...item,
  basePrice: DEFAULT_PRICES[item.symbol] || 100,
  candles: []
}));

testAssets.forEach(a => {
  a.candles = createRealisticCandles(a.basePrice, 70);
});

function tickCandle(asset) {
  const candles = asset.candles;
  const last = candles[candles.length - 1];
  const vol = asset.category === 'Crypto' ? 0.0003 : 0.00012;

  // Coherent wave momentum: 25 to 50 ticks of directional bias (72% trend, 28% pullback)
  if (!asset.momentumTicks || asset.momentumTicks <= 0) {
    asset.momentumTicks = Math.floor(25 + Math.random() * 25);
    if (!asset.macroDirection) asset.macroDirection = Math.random() > 0.5 ? 1 : -1;
    if (Math.random() < 0.18) asset.macroDirection *= -1;
    asset.trendDirection = Math.random() > 0.28 ? asset.macroDirection : -asset.macroDirection;
  }
  asset.momentumTicks--;

  const swing = asset.trendDirection * vol * last.close * (0.35 + Math.random() * 0.25);
  const noise = (Math.random() - 0.5) * vol * last.close * 0.15;
  const newPrice = Number(Math.max(0.0001, last.close + swing + noise).toFixed(asset.decimals || 4));

  if (!last.tickCount) last.tickCount = 0;
  last.tickCount++;

  if (last.tickCount > 10) {
    const newCandle = {
      time: new Date().toISOString(),
      open: newPrice,
      high: newPrice,
      low: newPrice,
      close: newPrice,
      volume: 15000,
      tickCount: 1
    };
    candles.push(newCandle);
    if (candles.length > 70) candles.shift();
  } else {
    last.close = newPrice;
    last.high = Math.max(last.high, newPrice);
    last.low = Math.min(last.low, newPrice);
  }

  return newPrice;
}

let takeProfits = 0;
let trailingStops = 0;
let breakEvens = 0;
let stopLosses = 0;
let reversalExits = 0;

let spotTP = 0;
let spotTrail = 0;
let spotBE = 0;
let spotSL = 0;

const cooldowns = {};
let spotCooldown = 0;

// Simulate 2500 ticks for statistically robust evaluation
for (let step = 0; step < 2500; step++) {
  const pricesMap = {};
  const technicalsMap = {};
  const marginCandidates = [];
  const spotCandidates = [];

  for (const asset of testAssets) {
    const livePrice = tickCandle(asset);
    asset.price = livePrice;
    pricesMap[asset.symbol] = livePrice;

    const technicals = calculateTechnicalMetrics(asset.candles);
    if (technicals) technicalsMap[asset.symbol] = technicals;

    if (cooldowns[asset.symbol] > 0) {
      cooldowns[asset.symbol]--;
      continue;
    }

    // A. MARGIN SCALPER CANDIDATE EVALUATION
    const signal = evaluateStrategyConfluence(asset, technicals, riskManager.getSettings());
    if (signal.action === 'STRONG_BUY' || signal.action === 'STRONG_SELL') {
      marginCandidates.push({ asset, signal });
    }

    // B. SPOT CRYPTO CANDIDATE EVALUATION
    if (asset.category === 'Crypto') {
      const spotSignal = evaluateSpotConfluence(asset, technicals, spotRiskSettings);
      if (spotSignal.action === 'STRONG_BUY') {
        spotCandidates.push({ asset, signal: spotSignal });
      }
    }
  }

  // SNIPER SELECTION: Sort margin candidates descending by confidence score
  if (marginCandidates.length > 0) {
    marginCandidates.sort((a, b) => b.signal.confidence - a.signal.confidence);

    for (const { asset, signal } of marginCandidates) {
      const portfolio = engine.getPortfolioState();
      if (portfolio.activePositions.length >= riskManager.getSettings().maxConcurrentTrades) {
        break; // Sniper slot limit reached
      }

      const risk = riskManager.evaluateTradeRisk(portfolio, signal, asset);
      if (risk.allowed) {
        engine.openPosition({
          symbol: asset.symbol,
          name: asset.name,
          category: asset.category,
          decimals: asset.decimals !== undefined ? asset.decimals : 4,
          side: signal.side,
          entryPrice: signal.entryPrice,
          stopLoss: signal.stopLoss,
          takeProfit: signal.takeProfit,
          stopDistance: signal.stopDistance,
          targetDistance: signal.targetDistance,
          units: risk.units,
          notional: risk.notional,
          confidence: signal.confidence,
          reason: signal.reason,
          riskRewardRatio: signal.riskRewardRatio,
          tradingStyle: 'SCALPING',
          leverage: risk.leverage,
          margin: risk.margin,
          liquidationPrice: risk.liquidationPrice
        });
        cooldowns[asset.symbol] = 8;
      }
    }
  }

  // PURE SPOT SNIPER SELECTION (100% Capital on #1 Best Setup)
  if (spotCooldown <= 0 && spotEngine.activePositions.length === 0 && spotCandidates.length > 0) {
    spotCandidates.sort((a, b) => b.signal.confidence - a.signal.confidence);
    const topSpot = spotCandidates[0];
    const spotCash = spotEngine.balance;

    if (spotCash >= 5) {
      const entryPrice = topSpot.signal.entryPrice;
      const notional = Number(spotCash.toFixed(2));
      const rawUnits = notional / entryPrice;
      const units = Number(rawUnits.toFixed(topSpot.asset.decimals || 4));

      spotEngine.openPosition({
        symbol: topSpot.asset.symbol,
        name: topSpot.asset.name,
        category: 'Crypto',
        decimals: topSpot.asset.decimals || 4,
        side: 'LONG',
        entryPrice,
        stopLoss: topSpot.signal.stopLoss,
        takeProfit: topSpot.signal.takeProfit,
        stopDistance: topSpot.signal.stopDistance,
        targetDistance: topSpot.signal.targetDistance,
        units,
        notional,
        confidence: topSpot.signal.confidence,
        reason: topSpot.signal.reason,
        riskRewardRatio: topSpot.signal.riskRewardRatio,
        tradingStyle: 'SPOT_BUY',
        leverage: 1,
        margin: notional,
        liquidationPrice: 0
      });
      spotCooldown = 15;
    }
  }

  if (spotCooldown > 0) spotCooldown--;

  const closed = engine.updatePricesAndCheckTriggers(pricesMap, technicalsMap);
  for (const c of closed) {
    cooldowns[c.symbol] = 6;
    if (c.exitReason === 'TAKE_PROFIT_TRIGGER') takeProfits++;
    else if (c.exitReason === 'TRAILING_STOP_TRIGGER') trailingStops++;
    else if (c.exitReason === 'BREAKEVEN_STOP_TRIGGER') breakEvens++;
    else if (c.exitReason === 'SIGNAL_REVERSAL_EXIT' || c.exitReason === 'MOMENTUM_EXHAUSTION_EXIT') reversalExits++;
    else if (c.exitReason === 'STOP_LOSS_TRIGGER') stopLosses++;
  }

  const spotClosed = spotEngine.updatePricesAndCheckTriggers(pricesMap, technicalsMap);
  for (const c of spotClosed) {
    if (c.exitReason === 'TAKE_PROFIT_TRIGGER') spotTP++;
    else if (c.exitReason === 'TRAILING_STOP_TRIGGER') spotTrail++;
    else if (c.exitReason === 'BREAKEVEN_STOP_TRIGGER') spotBE++;
    else if (c.exitReason === 'STOP_LOSS_TRIGGER') spotSL++;
  }
}

const stats = engine.getPortfolioState();
console.log('\n📊 MARGIN SCALPER RESULTS:');
console.log(`• Total Closed Trades: ${stats.totalTrades}`);
console.log(`• Decisive Wins:       ${stats.winCount} (${stats.winRate}%)`);
console.log(`• Decisive Losses:     ${stats.lossCount}`);
console.log(`• Break-Evens ($0):    ${stats.breakEvenCount}`);
console.log(`• Profit Factor:       ${stats.profitFactor}`);
console.log(`• Exits Breakdown:     TP: ${takeProfits} | Trail: ${trailingStops} | BE: ${breakEvens} | Rev: ${reversalExits} | SL: ${stopLosses}`);
console.log(`• Starting Balance:    $${stats.initialBalance.toFixed(2)}`);
console.log(`• Final Balance:       $${stats.balance.toFixed(2)}`);
console.log(`• Realized PnL:        +$${stats.realizedPnL.toFixed(2)}`);
console.log(`• Total Equity:        $${stats.equity.toFixed(2)} (${stats.totalPnLPct >= 0 ? '+' : ''}${stats.totalPnLPct}%)`);

const spotStats = spotEngine.getPortfolioState();
console.log('\n🪙 PURE SPOT CRYPTO RESULTS:');
console.log(`• Total Closed Trades: ${spotStats.totalTrades}`);
console.log(`• Decisive Wins:       ${spotStats.winCount} (${spotStats.winRate}%)`);
console.log(`• Decisive Losses:     ${spotStats.lossCount}`);
console.log(`• Break-Evens:         ${spotStats.breakEvenCount}`);
console.log(`• Profit Factor:       ${spotStats.profitFactor}`);
console.log(`• Exits Breakdown:     TP: ${spotTP} | Trail: ${spotTrail} | BE: ${spotBE} | SL: ${spotSL}`);
console.log(`• Starting Balance:    $${spotStats.initialBalance.toFixed(2)}`);
console.log(`• Final Balance:       $${spotStats.balance.toFixed(2)}`);
console.log(`• Realized PnL:        +$${spotStats.realizedPnL.toFixed(2)}`);
console.log(`• Spot Equity:         $${spotStats.equity.toFixed(2)} (${spotStats.totalPnLPct >= 0 ? '+' : ''}${spotStats.totalPnLPct}%)`);
console.log('================================================================');
