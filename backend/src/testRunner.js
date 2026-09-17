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

const engine = new PaperTradingEngine(10);
const riskManager = new RiskManager({
  riskPerTradePct: 1.5,
  maxConcurrentTrades: 3,
  minConfidenceThreshold: 82,
  tradeDirection: 'BOTH',
  tradingStyle: 'SCALPING',
  defaultLeverage: 500,
  targetRiskRewardRatio: 1.3
});

const testAssets = [
  { symbol: 'BTC-USD', name: 'Bitcoin', category: 'Crypto', decimals: 2, basePrice: 77000 },
  { symbol: 'ETH-USD', name: 'Ethereum', category: 'Crypto', decimals: 2, basePrice: 2450 },
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

// Simulate 400 ticks
for (let step = 0; step < 400; step++) {
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
        cooldowns[asset.symbol] = 8;
      }
    }
  }

  const closed = engine.updatePricesAndCheckTriggers(pricesMap, technicalsMap);
  for (const c of closed) {
    if (c.exitReason === 'TAKE_PROFIT_TRIGGER' || c.exitReason === 'SCALP_QUICK_BANK') takeProfits++;
    else if (c.exitReason === 'TRAILING_STOP_TRIGGER') trailingStops++;
    else if (c.exitReason === 'BREAKEVEN_STOP_TRIGGER') breakEvens++;
    else if (c.exitReason === 'SIGNAL_REVERSAL_EXIT' || c.exitReason === 'MOMENTUM_EXHAUSTION_EXIT') reversalExits++;
    else if (c.exitReason === 'STOP_LOSS_TRIGGER') stopLosses++;
  }
}

// Flush remaining
for (const p of [...engine.activePositions]) {
  engine.closePosition(p.id, p.currentPrice, 'AUDIT_CLOSE');
}

const stats = engine.getPortfolioState();
console.log('\n📊 RESULTS:');
console.log(`• Total Trades:     ${stats.totalTrades}`);
console.log(`• Wins:             ${stats.winCount} (${stats.winRate}%)`);
console.log(`• Losses:           ${stats.lossCount}`);
console.log(`• Profit Factor:    ${stats.profitFactor}`);
console.log(`• Exits Breakdown:  TP: ${takeProfits} | Trail: ${trailingStops} | BE: ${breakEvens} | Rev: ${reversalExits} | SL: ${stopLosses}`);
console.log(`• Final Equity:     $${stats.equity.toFixed(2)}`);
console.log(`• Net Profit:       +$${stats.totalPnL.toFixed(2)} (${stats.totalPnLPct}%)`);
console.log('================================================================');
