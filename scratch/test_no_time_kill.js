import fs from 'fs';
import path from 'path';
import { WATCHLIST } from '../backend/src/config/assets.js';
import { calculateTechnicalMetrics } from '../backend/src/services/technicalAnalysis.js';
import { evaluateSpotConfluence } from '../backend/src/services/strategyEngine.js';

const CACHE_DIR = path.resolve('scratch/kline_cache');
const FEE_RATE = 0.0010;

const cryptos = WATCHLIST.filter(a => a.category === 'Crypto');
const symbolTechnicals = [];

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
    const techMap = new Array(candles.length);
    for (let i = 50; i < candles.length; i++) {
      techMap[i] = calculateTechnicalMetrics(candles.slice(i - 49, i + 1));
    }
    symbolTechnicals.push({ asset, binanceSymbol, candles, techMap });
  }
}

function testSetup(tp, sl, maxHoldCandles = 12) {
  let balance = 10.0;
  let activePositions = [];
  const closedTrades = [];
  let peakBalance = 10.0;
  let maxDD = 0;

  for (let i = 50; i < symbolTechnicals[0].candles.length - maxHoldCandles; i++) {
    const remaining = [];
    for (const pos of activePositions) {
      const sym = symbolTechnicals.find(s => s.binanceSymbol === pos.binanceSymbol);
      const c = sym.candles[i];
      const elapsed = i - pos.entryIdx;

      let exitPrice = null;
      let exitReason = null;

      if (c.high >= pos.targetPrice) {
        exitPrice = pos.targetPrice;
        exitReason = 'TP';
      } else if (c.low <= pos.stopPrice) {
        exitPrice = pos.stopPrice;
        exitReason = 'SL';
      } else if (maxHoldCandles && elapsed >= maxHoldCandles) {
        exitPrice = c.close;
        exitReason = 'TIME';
      }

      if (exitPrice !== null) {
        const grossReturn = (exitPrice - pos.entryPrice) / pos.entryPrice;
        const grossPnL = grossReturn * pos.notional;
        const totalFee = (pos.notional + exitPrice * pos.units) * FEE_RATE;
        const netPnL = grossPnL - totalFee;

        balance = Number((balance + pos.notional + netPnL).toFixed(4));
        if (balance > peakBalance) peakBalance = balance;
        const dd = ((peakBalance - balance) / peakBalance) * 100;
        if (dd > maxDD) maxDD = dd;

        closedTrades.push({
          symbol: pos.symbol,
          netPnL,
          isWin: netPnL > 0.0001,
          exitReason
        });
      } else {
        remaining.push(pos);
      }
    }
    activePositions = remaining;

    if (activePositions.length === 0 && balance >= 1.0) {
      const candidates = [];
      for (const { asset, binanceSymbol, candles, techMap } of symbolTechnicals) {
        const currentCandle = candles[i];
        const tech = techMap[i];
        if (!tech) continue;

        // Clean pullback bounce criteria
        const mockAsset = {
          ...asset,
          price: currentCandle.close,
          quoteVolume: currentCandle.quoteVolume,
          candles: candles.slice(i - 49, i + 1)
        };

        const signal = evaluateSpotConfluence(mockAsset, tech, {
          stopLossPct: sl,
          takeProfitPct: tp,
          allowHighVolatility: true,
          minConfidenceThreshold: 85
        });

        if (signal && signal.action === 'STRONG_BUY') {
          candidates.push({ asset, binanceSymbol, currentCandle, signal });
        }
      }

      if (candidates.length > 0) {
        candidates.sort((a, b) => (b.signal.winProbability || 0) - (a.signal.winProbability || 0));
        const best = candidates[0];
        const entryPrice = best.currentCandle.close;
        const notional = Number(balance.toFixed(2));
        balance = Number((balance - notional).toFixed(4));
        const units = notional / entryPrice;

        activePositions.push({
          symbol: best.asset.symbol,
          binanceSymbol: best.binanceSymbol,
          entryPrice,
          targetPrice: entryPrice * (1 + tp / 100),
          stopPrice: entryPrice * (1 - sl / 100),
          units,
          notional,
          entryIdx: i
        });
      }
    }
  }

  const wins = closedTrades.filter(t => t.isWin).length;
  const tpCount = closedTrades.filter(t => t.exitReason === 'TP').length;
  const slCount = closedTrades.filter(t => t.exitReason === 'SL').length;
  const timeCount = closedTrades.filter(t => t.exitReason === 'TIME').length;

  return {
    tp: `${tp}%`,
    sl: `${sl}%`,
    maxHold: maxHoldCandles ? `${maxHoldCandles * 5}m` : 'No Time Cap',
    trades: closedTrades.length,
    wins,
    losses: closedTrades.length - wins,
    winRate: `${((wins / closedTrades.length) * 100 || 0).toFixed(1)}%`,
    finalBalance: `$${balance.toFixed(2)}`,
    tpCount,
    slCount,
    timeCount
  };
}

console.log('Testing varying hold caps on $10 balance:');
console.log('TP 1.5% / SL 1.0% (60m):', testSetup(1.5, 1.0, 12));
console.log('TP 1.5% / SL 1.0% (120m):', testSetup(1.5, 1.0, 24));
console.log('TP 1.8% / SL 1.0% (60m):', testSetup(1.8, 1.0, 12));
console.log('TP 2.0% / SL 1.0% (60m):', testSetup(2.0, 1.0, 12));
