import fs from 'fs';
import path from 'path';
import { calculateTechnicalMetrics, calculateEMA } from '../backend/src/services/technicalAnalysis.js';
import { isHalalCompliant } from '../backend/src/services/halalFilter.js';
import { WATCHLIST } from '../backend/src/config/assets.js';

const CACHE_DIR = path.resolve('scratch/kline_cache');
const FEE_RATE = 0.0010; // Binance spot fee: 0.10% entry + 0.10% exit = 0.20% round-trip

// 1. Load BTC candles
const btcRaw = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'BTCUSDT_5m_aug_oct_2026.json'), 'utf8'));
const btcCandles = btcRaw.map(k => ({
  time: new Date(k[0]).toISOString(),
  timestamp: k[0],
  open: parseFloat(k[1]),
  high: parseFloat(k[2]),
  low: parseFloat(k[3]),
  close: parseFloat(k[4]),
  volume: parseFloat(k[5]),
  quoteVolume: parseFloat(k[7])
}));

// Build BTC 15m candles
const btc15mCandles = [];
for (let i = 0; i < btcCandles.length; i += 3) {
  const slice = btcCandles.slice(i, i + 3);
  if (slice.length === 3) {
    btc15mCandles.push({
      time: slice[0].time,
      timestamp: slice[0].timestamp,
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

// 2. Load all Halal altcoins
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
      quoteVolume: parseFloat(k[7])
    }));
    const techMap = new Array(candles.length);
    for (let i = 50; i < candles.length; i++) {
      techMap[i] = calculateTechnicalMetrics(candles.slice(i - 49, i + 1));
    }
    symbolTechnicals.push({ asset, binanceSymbol, candles, techMap });
  }
}

console.log(`Loaded BTC 15m data and ${symbolTechnicals.length} Halal altcoins.`);

function isBtcHealthy(fiveMinIdx) {
  const fifteenMinIdx = Math.floor(fiveMinIdx / 3);
  if (fifteenMinIdx < 20 || fifteenMinIdx >= btc15mCandles.length) return false;

  const currentBtc15m = btc15mCandles[fifteenMinIdx];
  const ema20 = btc15mEma20[fifteenMinIdx];
  if (!ema20 || currentBtc15m.close < ema20) return false;

  const isRed = currentBtc15m.close < currentBtc15m.open;
  const recentVols = btc15mCandles.slice(fifteenMinIdx - 20, fifteenMinIdx).map(c => c.volume);
  const avgVol = recentVols.reduce((a, b) => a + b, 0) / 20;

  if (isRed && currentBtc15m.volume >= avgVol * 1.5) return false;

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

function runBacktest({
  label,
  tpPct = 1.5,
  slPct = 1.0,
  maxHoldHours = 4,
  useStructuralExit = false,
  initialBalance = 22.0,
  maxSlots = 4
}) {
  const maxHoldCandles = maxHoldHours * 12; // 48 candles for 4 hours

  let cash = initialBalance;
  let activePositions = [];
  const closedTrades = [];
  let peakBalance = initialBalance;
  let maxDD = 0;
  const lastTradeIdx = {};

  const totalCandles = btcCandles.length;

  for (let i = 50; i < totalCandles - 1; i++) {
    // 1. Process exits
    const remaining = [];
    for (const pos of activePositions) {
      const sym = symbolTechnicals.find(s => s.binanceSymbol === pos.binanceSymbol);
      const c = sym.candles[i];
      const tech = sym.techMap[i];

      let exitPrice = null;
      let exitReason = null;

      // Check Take Profit (+1.5%)
      if (c.high >= pos.targetPrice) {
        exitPrice = pos.targetPrice;
        exitReason = 'TAKE_PROFIT';
      }
      // Check Stop Loss (-1.0%)
      else if (c.low <= pos.stopPrice) {
        exitPrice = pos.stopPrice;
        exitReason = 'STOP_LOSS';
      }
      // Structural Break (optional)
      else if (useStructuralExit && tech && tech.ema21 && c.close < tech.ema21 * 0.998) {
        if (i - pos.entryIdx >= 3) {
          exitPrice = c.close;
          exitReason = 'STRUCTURAL_BREAK';
        }
      }
      // Max 4-hour holding limit (48 candles)
      else if (i - pos.entryIdx >= maxHoldCandles) {
        exitPrice = c.close;
        exitReason = '4H_MAX_HOLD_TIMEOUT';
      }

      if (exitPrice !== null) {
        const grossReturn = (exitPrice - pos.entryPrice) / pos.entryPrice;
        const grossPnL = grossReturn * pos.notional;
        const totalFee = (pos.notional + exitPrice * pos.units) * FEE_RATE;
        const netPnL = grossPnL - totalFee;

        cash = Number((cash + pos.notional + netPnL).toFixed(4));
        if (cash < 0) cash = 0;

        const currentEquity = cash + remaining.reduce((acc, p) => acc + p.notional, 0);
        if (currentEquity > peakBalance) peakBalance = currentEquity;
        const dd = ((peakBalance - currentEquity) / peakBalance) * 100;
        if (dd > maxDD) maxDD = dd;

        closedTrades.push({
          symbol: pos.symbol,
          entryTime: pos.entryTime,
          exitTime: c.time,
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

    // 2. Open new trades
    const openSlots = maxSlots - activePositions.length;
    if (openSlots > 0 && cash >= 2.0) {
      if (!isBtcHealthy(i)) continue;

      const rsCandidates = [];
      for (const item of symbolTechnicals) {
        const { asset, binanceSymbol, candles } = item;
        if (activePositions.some(p => p.binanceSymbol === binanceSymbol)) continue;
        if (lastTradeIdx[binanceSymbol] && (i - lastTradeIdx[binanceSymbol]) < 18) continue; // 90m cooldown

        const rs = calculateRelativeStrength(candles, btcCandles, i);
        if (rs && rs > 0) {
          rsCandidates.push({ ...item, compositeRS: rs });
        }
      }

      rsCandidates.sort((a, b) => b.compositeRS - a.compositeRS);
      const top3Leaders = rsCandidates.slice(0, 3);

      const validEntries = [];
      for (const leader of top3Leaders) {
        const c = leader.candles[i];
        const tech = leader.techMap[i];
        if (!tech) continue;

        const atrPct = (tech.atr / c.close) * 100;
        if (atrPct <= 0.50) continue;

        if (!tech.volSma20 || c.volume < tech.volSma20 * 2.5) continue;

        const isGreen = c.close > c.open;
        if (!isGreen) continue;

        const candleRange = c.high - c.low;
        if (candleRange > 0 && c.close < c.low + candleRange * 0.45) continue;

        if (tech.ema21 && c.close < tech.ema21) continue;

        validEntries.push({ leader, candle: c, tech, atrPct });
      }

      if (validEntries.length > 0) {
        const slotsToFill = Math.min(openSlots, validEntries.length);
        const totalEquity = cash + activePositions.reduce((acc, p) => acc + p.notional, 0);
        const targetSlotSize = Number((totalEquity / maxSlots).toFixed(2));

        for (let s = 0; s < slotsToFill; s++) {
          const notional = Number(Math.min(targetSlotSize, cash).toFixed(2));
          if (notional < 1.0) break;

          const chosen = validEntries[s];
          const entryPrice = chosen.candle.close;
          cash = Number((cash - notional).toFixed(4));
          const units = notional / entryPrice;

          const targetPrice = entryPrice * (1 + tpPct / 100);
          const stopPrice = entryPrice * (1 - slPct / 100);

          lastTradeIdx[chosen.leader.binanceSymbol] = i;

          activePositions.push({
            symbol: chosen.leader.asset.symbol,
            binanceSymbol: chosen.leader.binanceSymbol,
            entryIdx: i,
            entryTime: chosen.candle.time,
            entryPrice,
            targetPrice,
            stopPrice,
            notional,
            units
          });
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
  const finalBalance = Number((cash + activePositions.reduce((a, p) => a + p.notional, 0)).toFixed(2));
  const netProfit = Number((finalBalance - initialBalance).toFixed(2));
  const roiPct = Number(((netProfit / initialBalance) * 100).toFixed(1));

  const exitBreakdown = {};
  closedTrades.forEach(t => {
    exitBreakdown[t.exitReason] = (exitBreakdown[t.exitReason] || 0) + 1;
  });

  return {
    label,
    initialBalance: `$${initialBalance.toFixed(2)}`,
    finalBalance: `$${finalBalance.toFixed(2)}`,
    netProfit: `$${netProfit.toFixed(2)}`,
    roiPct: `${roiPct}%`,
    maxDrawdown: `${maxDD.toFixed(1)}%`,
    totalTrades,
    tradesPerDay: Number((totalTrades / 61).toFixed(1)),
    wins,
    losses,
    winRate: `${winRate}%`,
    profitFactor,
    exitBreakdown
  };
}

console.log('Running backtest for 1.5% TP and 1.0% SL (4-Hour Max Hold)...');

const res1 = runBacktest({
  label: 'Pure TP (+1.5%) / SL (-1.0%) with 4-Hour Max Hold',
  tpPct: 1.5,
  slPct: 1.0,
  maxHoldHours: 4,
  useStructuralExit: false,
  initialBalance: 22.0,
  maxSlots: 4
});

const res2 = runBacktest({
  label: 'TP (+1.5%) / SL (-1.0%) with 5m 20 EMA Break & 4-Hour Max Hold',
  tpPct: 1.5,
  slPct: 1.0,
  maxHoldHours: 4,
  useStructuralExit: true,
  initialBalance: 22.0,
  maxSlots: 4
});

console.log('\n======================================================');
console.log('RESULTS: 1.5% TP and 1.0% SL (4-Hour Maximum Hold)');
console.log('======================================================');
console.log(JSON.stringify([res1, res2], null, 2));
