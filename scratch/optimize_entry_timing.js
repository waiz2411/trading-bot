import fs from 'fs';
import path from 'path';

import { calculateTechnicalMetrics, calculateEMA } from '../backend/src/services/technicalAnalysis.js';
import { isHalalCompliant } from '../backend/src/services/halalFilter.js';
import { WATCHLIST } from '../backend/src/config/assets.js';

const CACHE_DIR = path.resolve('scratch/kline_cache');
const FEE_RATE = 0.0010;

const btcRaw = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'BTCUSDT_5m_aug_oct_2026.json'), 'utf8'));
const btcCandles = btcRaw.map(k => ({
  time: new Date(k[0]).toISOString(),
  timestamp: k[0],
  open: parseFloat(k[1]),
  high: parseFloat(k[2]),
  low: parseFloat(k[3]),
  close: parseFloat(k[4]),
  volume: parseFloat(k[5]),
}));

const btc15mCandles = [];
for (let i = 0; i < btcCandles.length; i += 3) {
  const slice = btcCandles.slice(i, i + 3);
  if (slice.length === 3) {
    btc15mCandles.push({
      time: slice[0].time,
      open: slice[0].open,
      high: Math.max(...slice.map(c => c.high)),
      low: Math.min(...slice.map(c => c.low)),
      close: slice[2].close,
      volume: slice.reduce((acc, c) => acc + c.volume, 0)
    });
  }
}
const btc15mCloses = btc15mCandles.map(c => c.close);
const btc15mEma20 = calculateEMA(btc15mCloses, 20);

const cryptos = WATCHLIST.filter(a => a.category === 'Crypto' && a.symbol !== 'BTC-USD');
const symbolTechnicals = [];

for (const asset of cryptos) {
  if (!isHalalCompliant(asset.symbol)) continue;
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
    }));
    const techMap = new Array(candles.length);
    for (let i = 50; i < candles.length; i++) {
      techMap[i] = calculateTechnicalMetrics(candles.slice(i - 49, i + 1));
    }
    symbolTechnicals.push({ asset, binanceSymbol, candles, techMap });
  }
}

function isBtcHealthy(fiveMinIdx) {
  const fifteenMinIdx = Math.floor(fiveMinIdx / 3);
  if (fifteenMinIdx < 20 || fifteenMinIdx >= btc15mCandles.length) return false;
  const currentBtc15m = btc15mCandles[fifteenMinIdx];
  const ema20 = btc15mEma20[fifteenMinIdx];
  if (!ema20 || currentBtc15m.close < ema20) return false;
  return true;
}

function calculateRelativeStrength(candles, btcCandles, i) {
  if (i < 48) return null;
  const currentCoinPrice = candles[i].close;
  const currentBtcPrice = btcCandles[i].close;
  const coin1hPrice = candles[i - 12].close;
  const btc1hPrice = btcCandles[i - 12].close;
  const rs1h = ((currentCoinPrice - coin1hPrice) / coin1hPrice) * 100 - ((currentBtcPrice - btc1hPrice) / btc1hPrice) * 100;
  const coin4hPrice = candles[i - 48].close;
  const btc4hPrice = btcCandles[i - 48].close;
  const rs4h = ((currentCoinPrice - coin4hPrice) / coin4hPrice) * 100 - ((currentBtcPrice - btc4hPrice) / btc4hPrice) * 100;
  return (rs1h * 0.6) + (rs4h * 0.4);
}

function simulateStrategy({
  name,
  entryType = 'MARKET',
  tpPct = 1.5,
  slPct = 1.2,
  useTrailing = false,
  trailTriggerPct = 1.2,
  trailDistPct = 0.5,
  maxHoldHours = 4,
  initialBalance = 22.0,
  maxSlots = 4
}) {
  let cash = initialBalance;
  let activePositions = [];
  const closedTrades = [];
  let pendingOrders = [];
  let peakBalance = initialBalance;
  let maxDD = 0;
  const lastTradeIdx = {};
  const maxHoldCandles = maxHoldHours * 12;

  for (let i = 50; i < btcCandles.length - 1; i++) {
    const stillPending = [];
    for (const po of pendingOrders) {
      if (i - po.createdIdx > 6) {
        cash = Number((cash + po.notional).toFixed(4));
        continue;
      }
      const sym = symbolTechnicals.find(s => s.binanceSymbol === po.binanceSymbol);
      const c = sym.candles[i];
      if (c.low <= po.limitPrice) {
        const entryPrice = po.limitPrice;
        const units = po.notional / entryPrice;
        const targetPrice = entryPrice * (1 + tpPct / 100);
        const stopPrice = entryPrice * (1 - slPct / 100);
        activePositions.push({
          symbol: po.symbol,
          binanceSymbol: po.binanceSymbol,
          entryIdx: i,
          entryPrice,
          targetPrice,
          stopPrice,
          notional: po.notional,
          units,
          highestPrice: entryPrice,
          isTrailing: false
        });
      } else {
        stillPending.push(po);
      }
    }
    pendingOrders = stillPending;

    const remaining = [];
    for (const pos of activePositions) {
      const sym = symbolTechnicals.find(s => s.binanceSymbol === pos.binanceSymbol);
      const c = sym.candles[i];

      if (c.high > pos.highestPrice) pos.highestPrice = c.high;

      let exitPrice = null;
      let exitReason = null;

      if (useTrailing) {
        const currentGainPct = ((pos.highestPrice - pos.entryPrice) / pos.entryPrice) * 100;
        if (currentGainPct >= trailTriggerPct) {
          pos.isTrailing = true;
          const trailingStopPrice = pos.highestPrice * (1 - trailDistPct / 100);
          if (trailingStopPrice > pos.stopPrice) pos.stopPrice = trailingStopPrice;
        }
      }

      if (c.high >= pos.targetPrice) {
        exitPrice = pos.targetPrice;
        exitReason = 'TAKE_PROFIT';
      } else if (c.low <= pos.stopPrice) {
        exitPrice = pos.stopPrice;
        exitReason = pos.isTrailing ? 'TRAILING_STOP' : 'STOP_LOSS';
      } else if (i - pos.entryIdx >= maxHoldCandles) {
        exitPrice = c.close;
        exitReason = '4H_TIMEOUT';
      }

      if (exitPrice !== null) {
        const grossReturn = (exitPrice - pos.entryPrice) / pos.entryPrice;
        const grossPnL = grossReturn * pos.notional;
        const totalFee = (pos.notional + exitPrice * pos.units) * FEE_RATE;
        const netPnL = grossPnL - totalFee;

        cash = Number((cash + pos.notional + netPnL).toFixed(4));
        if (cash < 0) cash = 0;

        const currentEquity = cash + remaining.reduce((a, p) => a + p.notional, 0) + pendingOrders.reduce((a, p) => a + p.notional, 0);
        if (currentEquity > peakBalance) peakBalance = currentEquity;
        const dd = ((peakBalance - currentEquity) / peakBalance) * 100;
        if (dd > maxDD) maxDD = dd;

        closedTrades.push({
          symbol: pos.symbol,
          entryPrice: pos.entryPrice,
          exitPrice,
          exitReason,
          netPnL: Number(netPnL.toFixed(4)),
          pnlPercent: Number(((netPnL / pos.notional) * 100).toFixed(2)),
          isWin: netPnL > 0.0001
        });
      } else {
        remaining.push(pos);
      }
    }
    activePositions = remaining;

    const openSlots = maxSlots - (activePositions.length + pendingOrders.length);
    if (openSlots > 0 && cash >= 2.0) {
      if (!isBtcHealthy(i)) continue;

      const rsCandidates = [];
      for (const item of symbolTechnicals) {
        const { asset, binanceSymbol, candles } = item;
        if (activePositions.some(p => p.binanceSymbol === binanceSymbol)) continue;
        if (pendingOrders.some(p => p.binanceSymbol === binanceSymbol)) continue;
        if (lastTradeIdx[binanceSymbol] && (i - lastTradeIdx[binanceSymbol]) < 18) continue;

        const rs = calculateRelativeStrength(candles, btcCandles, i);
        if (rs && rs > 0) rsCandidates.push({ ...item, compositeRS: rs });
      }
      rsCandidates.sort((a, b) => b.compositeRS - a.compositeRS);
      const top3 = rsCandidates.slice(0, 3);

      const validEntries = [];
      for (const leader of top3) {
        const c = leader.candles[i];
        const tech = leader.techMap[i];
        if (!tech) continue;
        const atrPct = (tech.atr / c.close) * 100;
        if (atrPct <= 0.50) continue;
        if (!tech.volSma20 || c.volume < tech.volSma20 * 2.5) continue;
        if (c.close <= c.open) continue;
        if (tech.ema21 && c.close < tech.ema21) continue;
        validEntries.push({ leader, candle: c });
      }

      if (validEntries.length > 0) {
        const slotsToFill = Math.min(openSlots, validEntries.length);
        const totalEquity = cash + activePositions.reduce((a, p) => a + p.notional, 0) + pendingOrders.reduce((a, p) => a + p.notional, 0);
        const targetSlotSize = Number((totalEquity / maxSlots).toFixed(2));

        for (let s = 0; s < slotsToFill; s++) {
          const notional = Number(Math.min(targetSlotSize, cash).toFixed(2));
          if (notional < 1.0) break;

          const chosen = validEntries[s];
          const closePrice = chosen.candle.close;
          cash = Number((cash - notional).toFixed(4));
          lastTradeIdx[chosen.leader.binanceSymbol] = i;

          if (entryType === 'PULLBACK_LIMIT') {
            const limitPrice = closePrice * 0.994; // 0.6% below the pump close
            pendingOrders.push({
              symbol: chosen.leader.asset.symbol,
              binanceSymbol: chosen.leader.binanceSymbol,
              createdIdx: i,
              limitPrice,
              notional
            });
          } else {
            const entryPrice = closePrice;
            const units = notional / entryPrice;
            const targetPrice = entryPrice * (1 + tpPct / 100);
            const stopPrice = entryPrice * (1 - slPct / 100);

            activePositions.push({
              symbol: chosen.leader.asset.symbol,
              binanceSymbol: chosen.leader.binanceSymbol,
              entryIdx: i,
              entryPrice,
              targetPrice,
              stopPrice,
              notional,
              units,
              highestPrice: entryPrice,
              isTrailing: false
            });
          }
        }
      }
    }
  }

  const totalTrades = closedTrades.length;
  const wins = closedTrades.filter(t => t.isWin).length;
  const losses = totalTrades - wins;
  const winRate = totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(1) : 0;
  const totalProfit = closedTrades.filter(t => t.isWin).reduce((a, b) => a + b.netPnL, 0);
  const totalLoss = Math.abs(closedTrades.filter(t => !t.isWin).reduce((a, b) => a + b.netPnL, 0));
  const profitFactor = totalLoss > 0 ? Number((totalProfit / totalLoss).toFixed(2)) : 0;
  const finalBalance = Number((cash + activePositions.reduce((a, p) => a + p.notional, 0) + pendingOrders.reduce((a, p) => a + p.notional, 0)).toFixed(2));
  const netProfit = Number((finalBalance - initialBalance).toFixed(2));
  const roiPct = Number(((netProfit / initialBalance) * 100).toFixed(1));

  return {
    name,
    finalBalance: `$${finalBalance.toFixed(2)}`,
    netProfit: `$${netProfit.toFixed(2)}`,
    roiPct: `${roiPct}%`,
    winRate: `${winRate}%`,
    profitFactor,
    totalTrades,
    wins,
    losses
  };
}

const comparisons = [
  simulateStrategy({ name: '1. Market: TP 1.5%, SL 1.5%', tpPct: 1.5, slPct: 1.5 }),
  simulateStrategy({ name: '2. Market: TP 1.5%, SL 2.0%', tpPct: 1.5, slPct: 2.0 }),
  simulateStrategy({ name: '3. Market: TP 2.0%, SL 2.0%', tpPct: 2.0, slPct: 2.0 }),
  simulateStrategy({ name: '4. Pullback Limit (-0.6% Retest): TP 2.0%, SL 1.2%', entryType: 'PULLBACK_LIMIT', tpPct: 2.0, slPct: 1.2 }),
  simulateStrategy({ name: '5. Pullback Limit (-0.6% Retest): TP 2.5%, SL 1.2%', entryType: 'PULLBACK_LIMIT', tpPct: 2.5, slPct: 1.2 }),
  simulateStrategy({ name: '6. Pullback Limit (-0.6% Retest): TP 3.0%, SL 1.2%', entryType: 'PULLBACK_LIMIT', tpPct: 3.0, slPct: 1.2 }),
  simulateStrategy({ name: '7. Trailing: Trigger +1.2%, Trail 0.5%, SL 1.5%', useTrailing: true, trailTriggerPct: 1.2, trailDistPct: 0.5, tpPct: 5.0, slPct: 1.5 })
];

console.log(JSON.stringify(comparisons, null, 2));
