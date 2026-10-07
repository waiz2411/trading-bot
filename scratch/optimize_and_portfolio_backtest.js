import fs from 'fs';
import path from 'path';
import { WATCHLIST } from '../backend/src/config/assets.js';
import { calculateTechnicalMetrics } from '../backend/src/services/technicalAnalysis.js';
import { evaluateSpotConfluence } from '../backend/src/services/strategyEngine.js';

const CACHE_DIR = path.resolve('scratch/kline_cache');
const FEE_RATE = 0.0010; // 0.10% per side = 0.20% round trip
const FEE_PCT = 0.20;

// Load all 30 coins
const cryptos = WATCHLIST.filter(a => a.category === 'Crypto');
const symbolData = [];

for (const asset of cryptos) {
  const baseAsset = asset.baseAsset || asset.symbol.replace(/[-_/]/g, '').replace(/USD$/, '');
  const binanceSymbol = `${baseAsset}USDT`;
  const cacheFile = path.join(CACHE_DIR, `${binanceSymbol}_5m_aug_oct_2026.json`);
  if (fs.existsSync(cacheFile)) {
    const raw = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    const candles = raw.map(k => ({
      time: new Date(k[0]).toISOString(),
      timestamp: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
      quoteVolume: parseFloat(k[7])
    }));
    symbolData.push({ asset, binanceSymbol, candles });
  }
}

console.log(`Loaded ${symbolData.length} symbols for optimization.`);

// Grid search parameters
const configs = [
  // TP, SL, MaxHoldMins, requireMacroTrend, requireMacdBullish, minConf
  { tp: 0.8, sl: 0.8, holdMins: 45, macroTrend: false, macdBull: false, minConf: 85, name: 'TP 0.8% / SL 0.8% (45m)' },
  { tp: 1.0, sl: 0.8, holdMins: 45, macroTrend: false, macdBull: false, minConf: 85, name: 'TP 1.0% / SL 0.8% (45m)' },
  { tp: 1.2, sl: 0.8, holdMins: 60, macroTrend: false, macdBull: false, minConf: 85, name: 'TP 1.2% / SL 0.8% (60m)' },
  { tp: 1.4, sl: 0.9, holdMins: 60, macroTrend: false, macdBull: false, minConf: 85, name: 'TP 1.4% / SL 0.9% (60m)' },
  { tp: 1.5, sl: 1.0, holdMins: 60, macroTrend: false, macdBull: false, minConf: 85, name: 'TP 1.5% / SL 1.0% (60m)' },
  // With Trend / MACD Filter
  { tp: 1.2, sl: 0.8, holdMins: 60, macroTrend: true, macdBull: true, minConf: 85, name: 'TP 1.2% / SL 0.8% (60m + Trend + MACD)' },
  { tp: 1.4, sl: 0.9, holdMins: 60, macroTrend: true, macdBull: true, minConf: 85, name: 'TP 1.4% / SL 0.9% (60m + Trend + MACD)' },
  { tp: 1.5, sl: 1.0, holdMins: 60, macroTrend: true, macdBull: true, minConf: 85, name: 'TP 1.5% / SL 1.0% (60m + Trend + MACD)' },
  { tp: 1.6, sl: 1.0, holdMins: 60, macroTrend: true, macdBull: true, minConf: 90, name: 'TP 1.6% / SL 1.0% (60m + Trend + MACD 90% Conf)' }
];

// Pre-compute technical metrics at each candle index for speed
console.log('Pre-calculating technicals cache across 30 coins...');
const symbolTechnicals = symbolData.map(({ asset, binanceSymbol, candles }) => {
  const techMap = new Array(candles.length);
  for (let i = 50; i < candles.length; i++) {
    const windowCandles = candles.slice(i - 49, i + 1);
    techMap[i] = calculateTechnicalMetrics(windowCandles);
  }
  return { asset, binanceSymbol, candles, techMap };
});
console.log('Technicals pre-calculated.');

// Function to test portfolio simulation with starting balance ($10)
function runPortfolioSimulation(cfg, initialBalance = 10.0, maxSlots = 1) {
  const holdCandles = Math.round(cfg.holdMins / 5);
  const minCandles = symbolTechnicals[0].candles.length;
  
  let balance = initialBalance;
  let activePositions = []; // [{ symbol, entryPrice, targetPrice, stopPrice, units, notional, entryIdx, entryTime }]
  const closedTrades = [];
  let peakBalance = initialBalance;
  let maxDrawdownPct = 0;

  for (let i = 50; i < minCandles - holdCandles; i++) {
    // 1. Check exits on active positions
    const remainingPositions = [];
    for (const pos of activePositions) {
      const symObj = symbolTechnicals.find(s => s.binanceSymbol === pos.binanceSymbol);
      const currentCandle = symObj.candles[i];
      const candlesElapsed = i - pos.entryIdx;

      let exitPrice = null;
      let exitReason = null;

      const hitTP = currentCandle.high >= pos.targetPrice;
      const hitSL = currentCandle.low <= pos.stopPrice;

      if (hitTP && hitSL) {
        if (currentCandle.open >= pos.entryPrice) {
          exitPrice = pos.targetPrice;
          exitReason = 'TAKE_PROFIT_TRIGGER';
        } else {
          exitPrice = pos.stopPrice;
          exitReason = 'STOP_LOSS_TRIGGER';
        }
      } else if (hitTP) {
        exitPrice = pos.targetPrice;
        exitReason = 'TAKE_PROFIT_TRIGGER';
      } else if (hitSL) {
        exitPrice = pos.stopPrice;
        exitReason = 'STOP_LOSS_TRIGGER';
      } else if (candlesElapsed >= holdCandles) {
        exitPrice = currentCandle.close;
        exitReason = '60M_TIME_EXPIRY';
      }

      if (exitPrice !== null) {
        // Trade closed!
        const grossReturnPct = ((exitPrice - pos.entryPrice) / pos.entryPrice);
        const grossPnL = grossReturnPct * pos.notional;
        const exitNotional = exitPrice * pos.units;
        const totalFee = (pos.notional * FEE_RATE) + (exitNotional * FEE_RATE);
        const netPnL = grossPnL - totalFee;

        balance = Number((balance + pos.notional + netPnL).toFixed(4));
        if (balance > peakBalance) peakBalance = balance;
        const dd = ((peakBalance - balance) / peakBalance) * 100;
        if (dd > maxDrawdownPct) maxDrawdownPct = dd;

        closedTrades.push({
          symbol: pos.symbol,
          entryTime: pos.entryTime,
          exitTime: currentCandle.time,
          entryPrice: pos.entryPrice,
          exitPrice,
          exitReason,
          grossPnL: Number(grossPnL.toFixed(4)),
          fee: Number(totalFee.toFixed(4)),
          netPnL: Number(netPnL.toFixed(4)),
          pnlPercent: Number(((netPnL / pos.notional) * 100).toFixed(2)),
          isWin: netPnL > 0.0001,
          balanceAfter: Number(balance.toFixed(2))
        });
      } else {
        remainingPositions.push(pos);
      }
    }
    activePositions = remainingPositions;

    // 2. Open new trades if slots available and balance > 0.50
    if (activePositions.length < maxSlots && balance >= 1.0) {
      const candidates = [];

      for (const { asset, binanceSymbol, candles, techMap } of symbolTechnicals) {
        // Avoid duplicate coin position
        if (activePositions.some(p => p.binanceSymbol === binanceSymbol)) continue;

        const currentCandle = candles[i];
        const technicals = techMap[i];
        if (!technicals) continue;

        // Custom filters
        if (cfg.macroTrend && technicals.ema200 && currentCandle.close < technicals.ema200) {
          continue; // Must be above 200 EMA
        }
        if (cfg.macdBull && technicals.macd && technicals.macd.histogram <= 0) {
          continue; // MACD histogram must be positive
        }

        const mockAsset = {
          ...asset,
          price: currentCandle.close,
          quoteVolume: currentCandle.quoteVolume,
          candles: candles.slice(i - 49, i + 1)
        };

        const signal = evaluateSpotConfluence(mockAsset, technicals, {
          stopLossPct: cfg.sl,
          takeProfitPct: cfg.tp,
          allowHighVolatility: asset.isHighVolatility ?? true,
          minConfidenceThreshold: cfg.minConf
        });

        if (signal && signal.action === 'STRONG_BUY') {
          candidates.push({
            asset,
            binanceSymbol,
            currentCandle,
            signal
          });
        }
      }

      if (candidates.length > 0) {
        // Sort candidates by winProbability / confidence / volume
        candidates.sort((a, b) => {
          const winA = a.signal.winProbability ?? a.signal.confidence;
          const winB = b.signal.winProbability ?? b.signal.confidence;
          if (Math.abs(winB - winA) >= 0.5) return winB - winA;
          return (b.signal.rawScore || 0) - (a.signal.rawScore || 0);
        });

        const openSlots = maxSlots - activePositions.length;
        const availableCash = balance;
        const portionSize = Number((availableCash / openSlots).toFixed(2));

        for (let s = 0; s < Math.min(openSlots, candidates.length); s++) {
          const best = candidates[s];
          const entryPrice = best.currentCandle.close;
          const notional = Number(Math.min(portionSize, balance).toFixed(2));
          if (notional < 1.0) break;

          balance = Number((balance - notional).toFixed(4));
          const units = notional / entryPrice;
          const targetPrice = entryPrice * (1 + cfg.tp / 100);
          const stopPrice = entryPrice * (1 - cfg.sl / 100);

          activePositions.push({
            symbol: best.asset.symbol,
            binanceSymbol: best.binanceSymbol,
            entryPrice,
            targetPrice,
            stopPrice,
            units,
            notional,
            entryIdx: i,
            entryTime: best.currentCandle.time
          });
        }
      }
    }
  }

  // Aggregate results
  const totalTrades = closedTrades.length;
  const wins = closedTrades.filter(t => t.isWin).length;
  const losses = closedTrades.filter(t => !t.isWin).length;
  const winRate = totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(1) : 0;
  const netProfitDollars = balance - initialBalance;
  const roiPct = ((netProfitDollars / initialBalance) * 100).toFixed(1);
  const tpExits = closedTrades.filter(t => t.exitReason === 'TAKE_PROFIT_TRIGGER').length;
  const slExits = closedTrades.filter(t => t.exitReason === 'STOP_LOSS_TRIGGER').length;
  const timeExits = closedTrades.filter(t => t.exitReason === '60M_TIME_EXPIRY').length;

  return {
    name: cfg.name,
    cfg,
    initialBalance: `$${initialBalance.toFixed(2)}`,
    finalBalance: `$${balance.toFixed(2)}`,
    netProfitDollars: `${netProfitDollars >= 0 ? '+' : ''}$${netProfitDollars.toFixed(2)}`,
    roiPct: `${roiPct}%`,
    totalTrades,
    tradesPerDay: (totalTrades / 61).toFixed(1),
    wins,
    losses,
    winRate: `${winRate}%`,
    maxDrawdownPct: `${maxDrawdownPct.toFixed(1)}%`,
    tpExits: `${tpExits} (${((tpExits / totalTrades) * 100 || 0).toFixed(1)}%)`,
    slExits: `${slExits} (${((slExits / totalTrades) * 100 || 0).toFixed(1)}%)`,
    timeExits: `${timeExits} (${((timeExits / totalTrades) * 100 || 0).toFixed(1)}%)`,
    closedTradesSample: closedTrades.slice(-10)
  };
}

console.log('\nRunning Grid Evaluation on 61-day dataset with $10 starting capital...\n');
const results = configs.map(c => runPortfolioSimulation(c, 10.0, 1));

console.log('\n======================================================');
console.log('GRID SEARCH SUMMARY: STARTING BALANCE $10.00 (61 DAYS)');
console.log('======================================================');
for (const r of results) {
  console.log(`[${r.name}]`);
  console.log(`  Final Balance: ${r.finalBalance} (${r.netProfitDollars} / ${r.roiPct})`);
  console.log(`  Trades: ${r.totalTrades} (${r.tradesPerDay}/day) | Win Rate: ${r.winRate} (${r.wins}W / ${r.losses}L)`);
  console.log(`  Max Drawdown: ${r.maxDrawdownPct}`);
  console.log(`  Exits -> TP: ${r.tpExits} | SL: ${r.slExits} | 60m Time: ${r.timeExits}`);
  console.log('------------------------------------------------------');
}

fs.writeFileSync('scratch/grid_results.json', JSON.stringify(results, null, 2), 'utf8');
