import { PaperTradingEngine } from './services/paperTradingEngine.js';
import { calculateTechnicalMetrics, calculateRSI } from './services/technicalAnalysis.js';
import { evaluateStrategyConfluence } from './services/strategyEngine.js';
import { RiskManager } from './services/riskManager.js';

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

function tickCandle(asset) {
  const candles = asset.candles;
  const last = candles[candles.length - 1];
  const vol = asset.category === 'Crypto' ? 0.0003 : 0.00015;

  if (!asset.momentumTicks || asset.momentumTicks <= 0) {
    asset.momentumTicks = Math.floor(6 + Math.random() * 8);
    asset.trendDirection = Math.random() > 0.48 ? 1 : -1;
  }
  asset.momentumTicks--;

  const swing = asset.trendDirection * vol * last.close * (0.4 + Math.random() * 0.3);
  const noise = (Math.random() - 0.5) * vol * last.close * 0.3;
  const newPrice = Math.max(0.001, last.close + swing + noise);

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

// 1. MARGIN SCALPER SIMULATION
const engine = new PaperTradingEngine(100, 'MARGIN');
const riskManager = new RiskManager({
  riskPerTradePct: 1.5,
  maxConcurrentTrades: 3,
  minConfidenceThreshold: 85,
  tradeDirection: 'BOTH',
  tradingStyle: 'SCALPING',
  defaultLeverage: 500,
  targetRiskRewardRatio: 1.3
});

// 2. SPOT ENGINE SIMULATION
import { evaluateSpotConfluence } from './services/strategyEngine.js';
const spotEngine = new PaperTradingEngine(25, 'SPOT');
const spotRiskSettings = {
  stopLossPct: 1.0,
  takeProfitPct: 2.2,
  minConfidenceThreshold: 82
};

const testAssets = [
  { symbol: 'BTC-USD', name: 'Bitcoin', category: 'Crypto', decimals: 2, basePrice: 77000 },
  { symbol: 'ETH-USD', name: 'Ethereum', category: 'Crypto', decimals: 2, basePrice: 2450 },
  { symbol: 'SOL-USD', name: 'Solana', category: 'Crypto', decimals: 2, basePrice: 105 },
  { symbol: 'GC=F', name: 'Gold', category: 'Commodities', decimals: 2, basePrice: 2635 },
  { symbol: 'EURUSD=X', name: 'Euro/USD', category: 'Forex', decimals: 4, basePrice: 1.155 }
];

testAssets.forEach(a => {
  a.candles = createRealisticCandles(a.basePrice, 70);
});

let takeProfits = 0;
let trailingStops = 0;
let breakEvens = 0;
let stopLosses = 0;
let reversalExits = 0;

const cooldowns = {};
let spotCooldown = 0;

// Simulate 800 ticks
for (let step = 0; step < 800; step++) {
  const pricesMap = {};
  const technicalsMap = {};

  for (const asset of testAssets) {
    const livePrice = tickCandle(asset);
    pricesMap[asset.symbol] = livePrice;

    const technicals = calculateTechnicalMetrics(asset.candles);
    if (technicals) technicalsMap[asset.symbol] = technicals;

    if (cooldowns[asset.symbol] > 0) {
      cooldowns[asset.symbol]--;
      continue;
    }

    // A. MARGIN SCALPER
    const signal = evaluateStrategyConfluence(asset, technicals, riskManager.getSettings());

    if (signal.action === 'STRONG_BUY' || signal.action === 'STRONG_SELL') {
      const portfolio = engine.getPortfolioState();
      const risk = riskManager.evaluateTradeRisk(portfolio, signal, asset);

      if (risk.allowed) {
        engine.openPosition({
          symbol: asset.symbol,
          name: asset.name,
          category: asset.category,
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
        cooldowns[asset.symbol] = 12;
      }
    }

    // B. PURE SPOT CRYPTO
    if (asset.category === 'Crypto' && spotCooldown <= 0 && spotEngine.activePositions.length === 0) {
      const spotSignal = evaluateSpotConfluence(asset, technicals, spotRiskSettings);
      if (spotSignal.action === 'STRONG_BUY') {
        const spotCash = spotEngine.balance;
        if (spotCash >= 5) {
          const entryPrice = spotSignal.entryPrice;
          const notional = Number(spotCash.toFixed(2));
          const rawUnits = notional / entryPrice;
          const units = Number(rawUnits.toFixed(asset.decimals || 4));

          spotEngine.openPosition({
            symbol: asset.symbol,
            name: asset.name,
            category: 'Crypto',
            side: 'LONG',
            entryPrice,
            stopLoss: spotSignal.stopLoss,
            takeProfit: spotSignal.takeProfit,
            stopDistance: spotSignal.stopDistance,
            targetDistance: spotSignal.targetDistance,
            units,
            notional,
            confidence: spotSignal.confidence,
            reason: spotSignal.reason,
            riskRewardRatio: spotSignal.riskRewardRatio,
            tradingStyle: 'SPOT_BUY',
            leverage: 1,
            margin: notional,
            liquidationPrice: 0
          });
          spotCooldown = 15;
        }
      }
    }
  }

  if (spotCooldown > 0) spotCooldown--;

  const closed = engine.updatePricesAndCheckTriggers(pricesMap, technicalsMap);
  for (const c of closed) {
    if (c.exitReason === 'TAKE_PROFIT_TRIGGER') takeProfits++;
    else if (c.exitReason === 'TRAILING_STOP_TRIGGER') trailingStops++;
    else if (c.exitReason === 'BREAKEVEN_STOP_TRIGGER') breakEvens++;
    else if (c.exitReason === 'SIGNAL_REVERSAL_EXIT' || c.exitReason === 'MOMENTUM_EXHAUSTION_EXIT') reversalExits++;
    else if (c.exitReason === 'STOP_LOSS_TRIGGER') stopLosses++;
  }

  spotEngine.updatePricesAndCheckTriggers(pricesMap, technicalsMap);
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
console.log(`• Starting Balance:    $${spotStats.initialBalance.toFixed(2)}`);
console.log(`• Final Balance:       $${spotStats.balance.toFixed(2)}`);
console.log(`• Realized PnL:        +$${spotStats.realizedPnL.toFixed(2)}`);
console.log(`• Spot Equity:         $${spotStats.equity.toFixed(2)} (${spotStats.totalPnLPct >= 0 ? '+' : ''}${spotStats.totalPnLPct}%)`);
console.log('================================================================');
