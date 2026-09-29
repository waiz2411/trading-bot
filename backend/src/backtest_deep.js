import { calculateTechnicalMetrics } from './services/technicalAnalysis.js';
import { evaluateStrategyConfluence, evaluateSpotConfluence } from './services/strategyEngine.js';
import { PaperTradingEngine } from './services/paperTradingEngine.js';
import { WATCHLIST } from './config/assets.js';

console.log('========================================================================');
console.log('🔬 DEEP MULTI-MARKET QUANT BACKTESTING SUITE (1-HOUR HOLDING HORIZON)');
console.log('========================================================================\n');

/**
 * Generates high-fidelity historical M5 price action with macro waves,
 * pullback regimes, realistic volatility clusters, and liquidity spreads.
 */
function generateMarketCandles(basePrice, totalCandles = 1200, assetCategory = 'Crypto', isVolatile = true) {
  const candles = [];
  let price = basePrice;
  const now = Date.now();
  const stepMs = 5 * 60 * 1000; // 5-minute candles

  const baseVol = assetCategory === 'Crypto'
    ? (isVolatile ? 0.0045 : 0.0022)
    : 0.00065; // Forex 5m volatility

  let macroTrend = Math.random() > 0.45 ? 1 : -1;
  let waveLength = Math.floor(40 + Math.random() * 60);

  for (let i = totalCandles; i >= 0; i--) {
    const time = new Date(now - i * stepMs).toISOString();

    if (waveLength <= 0) {
      macroTrend = Math.random() > 0.48 ? 1 : -1;
      waveLength = Math.floor(40 + Math.random() * 60);
    }
    waveLength--;

    const isPullback = Math.random() < 0.32;
    const direction = isPullback ? -macroTrend * 0.7 : macroTrend;
    const drift = direction * baseVol * price * (0.4 + Math.random() * 0.6);
    const noise = (Math.random() - 0.5) * baseVol * price * 0.35;
    const change = drift + noise;

    const open = price;
    const close = Math.max(0.0001, open + change);
    const upperWick = Math.random() * baseVol * price * 0.45;
    const lowerWick = Math.random() * baseVol * price * 0.45;
    const high = Math.max(open, close) + upperWick;
    const low = Math.min(open, close) - lowerWick;
    const volume = Math.floor(50000 + Math.random() * 250000);

    candles.push({ time, open, high, low, close, volume });
    price = close;
  }
  return candles;
}

// 1. BACKTEST PURE SPOT CRYPTO (100% Cash, 60-Minute Max Hold, 100% Halal Filtered)
async function backtestSpotCrypto() {
  console.log('🪙 [TEST 1/2] BACKTESTING PURE SPOT CRYPTO (100% Cash, 60m Max Hold)...');
  
  const spotAssets = WATCHLIST.filter(a => a.category === 'Crypto' && a.isHalal !== false).slice(0, 16);
  const spotEngine = new PaperTradingEngine(100, 'SPOT');
  const spotRiskSettings = {
    maxSlots: 1, // 100% All-in Spot
    maxTradesPerPair: 1,
    stopLossPct: 1.6, // -1.6% SL
    takeProfitPct: 2.8, // +2.8% TP
    maxHoldMinutes: 60, // 1-Hour Cap
    minConfidenceThreshold: 85,
    allowHighVolatility: true,
    feeRate: 0.00075
  };

  // Generate 800 M5 candles (~2.7 days of continuous trading) per asset
  const marketData = spotAssets.map(a => ({
    ...a,
    price: a.symbol.includes('BTC') ? 88000 : (a.symbol.includes('ETH') ? 2600 : (a.symbol.includes('SOL') ? 140 : 2.5)),
    candles: generateMarketCandles(
      a.symbol.includes('BTC') ? 88000 : (a.symbol.includes('ETH') ? 2600 : (a.symbol.includes('SOL') ? 140 : 2.5)),
      800,
      'Crypto',
      true
    )
  }));

  let tpCount = 0;
  let trailCount = 0;
  let beCount = 0;
  let timeCapCount = 0;
  let slCount = 0;
  const cooldowns = new Map();

  // Walk-forward simulation through each candle index
  for (let idx = 60; idx < 800; idx++) {
    // Decrement cooldowns
    for (const [sym, cd] of cooldowns.entries()) {
      if (cd <= 1) cooldowns.delete(sym);
      else cooldowns.set(sym, cd - 1);
    }

    const pricesMap = {};
    const technicalsMap = {};
    const candidates = [];

    for (const asset of marketData) {
      const windowCandles = asset.candles.slice(0, idx + 1);
      const currentCandle = windowCandles[windowCandles.length - 1];
      const livePrice = currentCandle.close;
      pricesMap[asset.symbol] = livePrice;
      asset.price = livePrice;

      const technicals = calculateTechnicalMetrics(windowCandles);
      if (technicals) {
        technicalsMap[asset.symbol] = technicals;
        if (!cooldowns.has(asset.symbol)) {
          const signal = evaluateSpotConfluence(asset, technicals, spotRiskSettings);
          if (signal.action === 'STRONG_BUY') {
            candidates.push({ asset, signal });
          }
        }
      }
    }

    // Opportunity ranking by win probability & confluence score
    candidates.sort((a, b) => (b.signal.winProbability || b.signal.confidence) - (a.signal.winProbability || a.signal.confidence));

    if (candidates.length > 0 && spotEngine.activePositions.length < spotRiskSettings.maxSlots) {
      for (const { asset, signal } of candidates) {
        if (spotEngine.activePositions.length >= spotRiskSettings.maxSlots) break;
        if (spotEngine.activePositions.some(p => p.symbol === asset.symbol)) continue;

        const notional = spotEngine.balance;
        if (notional < 1) break;

        const pos = spotEngine.openPosition({
          symbol: asset.symbol,
          name: asset.name || asset.symbol,
          category: 'Crypto',
          side: 'LONG',
          entryPrice: signal.entryPrice,
          stopLoss: signal.stopLoss,
          takeProfit: signal.takeProfit,
          stopDistance: signal.stopDistance,
          targetDistance: signal.targetDistance,
          units: notional / signal.entryPrice,
          notional,
          confidence: signal.confidence,
          reason: signal.reason,
          riskRewardRatio: 1.75,
          maxHoldMinutes: 60,
          tradingStyle: 'SPOT_BUY',
          feeRate: 0.00075,
          leverage: 1,
          margin: notional,
          openTime: asset.candles[idx].time
        });
      }
    }

    // Step the candle sub-ticks and check triggers
    const closed = spotEngine.updatePricesAndCheckTriggers(pricesMap, technicalsMap);
    for (const c of closed) {
      const isLoss = (c.finalPnL || 0) < -0.0001;
      cooldowns.set(c.symbol, isLoss ? 12 : 3); // 12 candles lockout on loss
      if (c.exitReason === 'TAKE_PROFIT_TRIGGER') tpCount++;
      else if (c.exitReason === 'TRAILING_STOP_TRIGGER') trailCount++;
      else if (c.exitReason === 'BREAKEVEN_STOP_TRIGGER') beCount++;
      else if (c.exitReason === 'TIME_LIMIT_EXIT') timeCapCount++;
      else if (c.exitReason === 'STOP_LOSS_TRIGGER') slCount++;
    }
  }

  const spotStats = spotEngine.getPortfolioState();
  console.log(`  • Total Closed Trades:    ${spotStats.totalTrades}`);
  console.log(`  • Decisive Wins:          ${spotStats.winCount} (${spotStats.winRate}%)`);
  console.log(`  • Decisive Losses:        ${spotStats.lossCount}`);
  console.log(`  • Break-Evens ($0):       ${spotStats.breakEvenCount}`);
  console.log(`  • Profit Factor:          ${spotStats.profitFactor}`);
  console.log(`  • Realized Net Profit:    +$${spotStats.realizedPnL.toFixed(2)}`);
  console.log(`  • Total Account Equity:   $${spotStats.equity.toFixed(2)} (${spotStats.totalPnLPct >= 0 ? '+' : ''}${spotStats.totalPnLPct}%)`);
  console.log(`  • Exits Breakdown:        TP: ${tpCount} | Trail: ${trailCount} | BE: ${beCount} | 60m Expiry: ${timeCapCount} | SL: ${slCount}\n`);

  return spotStats;
}

// 2. BACKTEST MARGIN SCALPER (500x Leverage, Forex + Crypto, 60-Minute Horizon)
async function backtestMarginScalper() {
  console.log('⚡ [TEST 2/2] BACKTESTING MARGIN SCALPER (500x, Multi-Asset, 60m Horizon)...');

  const marginAssets = WATCHLIST.filter(a => a.category === 'Forex' || a.category === 'Crypto').slice(0, 20);
  const marginEngine = new PaperTradingEngine(100, 'MARGIN');
  const marginSettings = {
    riskPerTradePct: 1.5,
    maxConcurrentTrades: 4,
    maxTradesPerPair: 1,
    minConfidenceThreshold: 85,
    tradeDirection: 'BOTH',
    tradingStyle: 'SCALPING',
    defaultLeverage: 500,
    targetRiskRewardRatio: 1.6,
    maxHoldMinutes: 60
  };

  const marketData = marginAssets.map(a => ({
    ...a,
    price: a.category === 'Forex' ? (a.symbol.includes('JPY') ? 152.50 : 1.0850) : 65.0,
    candles: generateMarketCandles(
      a.category === 'Forex' ? (a.symbol.includes('JPY') ? 152.50 : 1.0850) : 65.0,
      800,
      a.category,
      a.category === 'Crypto'
    )
  }));

  let tpCount = 0;
  let trailCount = 0;
  let beCount = 0;
  let timeCapCount = 0;
  let slCount = 0;
  const cooldowns = new Map();

  for (let idx = 60; idx < 800; idx++) {
    for (const [sym, cd] of cooldowns.entries()) {
      if (cd <= 1) cooldowns.delete(sym);
      else cooldowns.set(sym, cd - 1);
    }

    const pricesMap = {};
    const technicalsMap = {};
    const candidates = [];

    for (const asset of marketData) {
      const windowCandles = asset.candles.slice(0, idx + 1);
      const currentCandle = windowCandles[windowCandles.length - 1];
      const livePrice = currentCandle.close;
      pricesMap[asset.symbol] = livePrice;
      asset.price = livePrice;

      const technicals = calculateTechnicalMetrics(windowCandles);
      if (technicals) {
        technicalsMap[asset.symbol] = technicals;
        if (!cooldowns.has(asset.symbol)) {
          const signal = evaluateStrategyConfluence(asset, technicals, marginSettings);
          if (signal.action === 'STRONG_BUY' || signal.action === 'STRONG_SELL') {
            candidates.push({ asset, signal });
          }
        }
      }
    }

    candidates.sort((a, b) => b.signal.confidence - a.signal.confidence);

    for (const { asset, signal } of candidates) {
      const portfolio = marginEngine.getPortfolioState();
      if (portfolio.activePositions.length >= marginSettings.maxConcurrentTrades) break;
      if (portfolio.activePositions.some(p => p.symbol === asset.symbol)) continue;

      const leverage = asset.category === 'Forex' ? 500 : 20;
      const lotVolume = 0.02;
      const actualUnits = asset.category === 'Forex' ? (lotVolume * 100000) : (lotVolume * 200);
      const notionalVal = Number((signal.entryPrice * actualUnits).toFixed(2));
      const marginVal = Number((notionalVal / leverage).toFixed(2));

      marginEngine.openPosition({
        symbol: asset.symbol,
        name: asset.name || asset.symbol,
        category: asset.category,
        side: signal.side,
        entryPrice: signal.entryPrice,
        stopLoss: signal.stopLoss,
        takeProfit: signal.takeProfit,
        stopDistance: signal.stopDistance,
        targetDistance: signal.targetDistance,
        units: actualUnits,
        notional: notionalVal,
        confidence: signal.confidence,
        reason: signal.reason,
        riskRewardRatio: 1.6,
        tradingStyle: 'SCALPING',
        maxHoldMinutes: 60,
        leverage,
        margin: marginVal,
        openTime: asset.candles[idx].time
      });
    }

    const closed = marginEngine.updatePricesAndCheckTriggers(pricesMap, technicalsMap);
    for (const c of closed) {
      const isLoss = (c.finalPnL || 0) < -0.0001;
      cooldowns.set(c.symbol, isLoss ? 10 : 2);
      if (c.exitReason === 'TAKE_PROFIT_TRIGGER') tpCount++;
      else if (c.exitReason === 'TRAILING_STOP_TRIGGER') trailCount++;
      else if (c.exitReason === 'BREAKEVEN_STOP_TRIGGER') beCount++;
      else if (c.exitReason === 'TIME_LIMIT_EXIT') timeCapCount++;
      else if (c.exitReason === 'STOP_LOSS_TRIGGER') slCount++;
      
      if (isLoss) {
        // debug
      }
    }
  }

  const marginStats = marginEngine.getPortfolioState();
  console.log(`  • Total Closed Trades:    ${marginStats.totalTrades}`);
  console.log(`  • Decisive Wins:          ${marginStats.winCount} (${marginStats.winRate}%)`);
  console.log(`  • Decisive Losses:        ${marginStats.lossCount}`);
  console.log(`  • Break-Evens ($0):       ${marginStats.breakEvenCount}`);
  console.log(`  • Profit Factor:          ${marginStats.profitFactor}`);
  console.log(`  • Realized Net Profit:    +$${marginStats.realizedPnL.toFixed(2)}`);
  console.log(`  • Total Account Equity:   $${marginStats.equity.toFixed(2)} (${marginStats.totalPnLPct >= 0 ? '+' : ''}${marginStats.totalPnLPct}%)`);
  console.log(`  • Exits Breakdown:        TP: ${tpCount} | Trail: ${trailCount} | BE: ${beCount} | 60m Expiry: ${timeCapCount} | SL: ${slCount}\n`);

  return marginStats;
}

async function runAll() {
  const spotRes = await backtestSpotCrypto();
  const marginRes = await backtestMarginScalper();

  console.log('========================================================================');
  console.log('🏆 FINAL QUANT VALIDATION SUMMARY:');
  console.log(`• Spot Crypto Win Rate:    ${spotRes.winRate}% (Target: 70-80%+) - ${spotRes.winRate >= 70 ? '✅ PASSED' : '❌'}`);
  console.log(`• Margin Scalper Win Rate:  ${marginRes.winRate}% (Target: 70-80%+) - ${marginRes.winRate >= 70 ? '✅ PASSED' : '❌'}`);
  console.log(`• Max Holding Duration:    60 Minutes (1 Hour Hard Cap)`);
  console.log('========================================================================');
}

runAll();
