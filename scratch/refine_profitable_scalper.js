import fs from 'fs';
import path from 'path';
import { calculateEMA, calculateRSI } from '../backend/src/services/technicalAnalysis.js';
import { isHalalCompliant } from '../backend/src/services/halalFilter.js';
import { WATCHLIST } from '../backend/src/config/assets.js';

const CACHE_DIR = path.resolve('scratch/kline_cache');
const FEE_RATE = 0.00075; // 0.15% round-trip BNB fee

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

// BTC 15m
const btc15mCandles = [];
for (let i = 0; i < btcCandles.length; i += 3) {
  const slice = btcCandles.slice(i, i + 3);
  if (slice.length === 3) {
    btc15mCandles.push({
      time: slice[0].time,
      close: slice[2].close
    });
  }
}
const btc15mCloses = btc15mCandles.map(c => c.close);
const btc15mEma20 = calculateEMA(btc15mCloses, 20);

const cryptos = WATCHLIST.filter(a => a.category === 'Crypto' && a.symbol !== 'BTC-USD');
const symbolData = [];

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

    const closes = candles.map(c => c.close);
    const ema9 = calculateEMA(closes, 9);
    const ema21 = calculateEMA(closes, 21);
    const ema50 = calculateEMA(closes, 50);
    const rsi14 = calculateRSI(closes, 14);

    symbolData.push({
      asset,
      binanceSymbol,
      candles,
      ema9,
      ema21,
      ema50,
      rsi14
    });
  }
}

function runSim({
  name,
  minGain24h = 4.0,
  minRvol = 1.8,
  pullbackDiscountPct = 0.6,
  tpPct = 1.5,
  slPct = 1.2,
  maxFillCandles = 3,
  maxHoldCandles = 24,
  initialBalance = 22.0,
  maxSlots = 4
}) {
  let cash = initialBalance;
  let activePositions = [];
  const closedTrades = [];
  let peakBalance = initialBalance;
  let maxDD = 0;
  const lastTradeIdx = {};

  for (let i = 288; i < btcCandles.length - maxHoldCandles; i++) {
    // 1. Process active positions
    const remaining = [];
    for (const pos of activePositions) {
      const sym = symbolData.find(s => s.binanceSymbol === pos.binanceSymbol);
      const c = sym.candles[i];

      let exitPrice = null;
      let exitReason = null;

      if (c.high >= pos.targetPrice) {
        exitPrice = pos.targetPrice;
        exitReason = 'TP';
      } else if (c.low <= pos.stopPrice) {
        exitPrice = pos.stopPrice;
        exitReason = 'SL';
      } else if (i - pos.entryIdx >= maxHoldCandles) {
        exitPrice = c.close;
        exitReason = 'TIMEOUT';
      }

      if (exitPrice !== null) {
        const grossReturn = (exitPrice - pos.entryPrice) / pos.entryPrice;
        const grossPnL = grossReturn * pos.notional;
        const totalFee = (pos.notional + exitPrice * pos.units) * FEE_RATE;
        const netPnL = grossPnL - totalFee;

        cash = Number((cash + pos.notional + netPnL).toFixed(4));
        if (cash < 0) cash = 0;

        const currentEquity = cash + remaining.reduce((a, p) => a + p.notional, 0);
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

    // 2. Open new trades
    const openSlots = maxSlots - activePositions.length;
    if (openSlots <= 0 || cash < 2.0) continue;

    // BTC 15m health gate
    const btc15mIdx = Math.floor(i / 3);
    if (btc15mEma20[btc15mIdx] && btcCandles[i].close < btc15mEma20[btc15mIdx]) continue;

    // Scan for top hot leaders
    const leaders = [];
    for (const sym of symbolData) {
      if (activePositions.some(p => p.binanceSymbol === sym.binanceSymbol)) continue;
      if (lastTradeIdx[sym.binanceSymbol] && (i - lastTradeIdx[sym.binanceSymbol]) < 18) continue;

      const c = sym.candles[i];
      const c24h = sym.candles[i - 288];
      const gain24h = ((c.close - c24h.close) / c24h.close) * 100;
      if (gain24h < minGain24h) continue;

      const recent1h = sym.candles.slice(i - 12, i).map(x => x.quoteVolume || x.volume * x.close);
      const sum1h = recent1h.reduce((a, b) => a + b, 0);
      const past24h = sym.candles.slice(i - 288, i).map(x => x.quoteVolume || x.volume * x.close);
      const avgHourly = past24h.reduce((a, b) => a + b, 0) / 24;
      const rvol = avgHourly > 0 ? (sum1h / avgHourly) : 1;
      if (rvol < minRvol) continue;

      leaders.push({ ...sym, gain24h, rvol, currentPrice: c.close });
    }

    if (leaders.length === 0) continue;
    leaders.sort((a, b) => (b.gain24h * b.rvol) - (a.gain24h * a.rvol));
    const topCandidates = leaders.slice(0, 2);

    for (const hotPick of topCandidates) {
      if (activePositions.length >= maxSlots) break;
      const c0 = hotPick.candles[i];
      if (c0.close <= c0.open) continue;

      const limitPrice = c0.close * (1 - pullbackDiscountPct / 100);

      // Check fill
      let fillIdx = null;
      for (let f = 1; f <= maxFillCandles; f++) {
        const fc = hotPick.candles[i + f];
        if (fc.low <= limitPrice) {
          fillIdx = i + f;
          break;
        }
      }

      if (!fillIdx) continue;

      const totalEquity = cash + activePositions.reduce((a, p) => a + p.notional, 0);
      const targetSlotSize = Number((totalEquity / maxSlots).toFixed(2));
      const notional = Number(Math.min(targetSlotSize, cash).toFixed(2));
      if (notional < 1.0) break;

      const entryPrice = limitPrice;
      const units = notional / entryPrice;
      const targetPrice = entryPrice * (1 + tpPct / 100);
      const stopPrice = entryPrice * (1 - slPct / 100);

      cash = Number((cash - notional).toFixed(4));
      lastTradeIdx[hotPick.binanceSymbol] = fillIdx;

      activePositions.push({
        symbol: hotPick.asset.symbol,
        binanceSymbol: hotPick.binanceSymbol,
        entryIdx: fillIdx,
        entryPrice,
        targetPrice,
        stopPrice,
        notional,
        units
      });
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

  return {
    name,
    initialBalance: `$${initialBalance.toFixed(2)}`,
    finalBalance: `$${finalBalance.toFixed(2)}`,
    netProfit: `$${netProfit.toFixed(2)}`,
    roiPct: `${roiPct}%`,
    winRate: `${winRate}%`,
    profitFactor,
    totalTrades,
    tradesPerDay: Number((totalTrades / 61).toFixed(1)),
    wins,
    losses,
    maxDrawdown: `${maxDD.toFixed(1)}%`
  };
}

console.log('Testing Refined Hot-Coin Limit Retest Engine:');

const suite = [
  runSim({
    name: '1. Hot Retest (-0.6% Limit): TP +1.5% | SL -1.2%',
    pullbackDiscountPct: 0.6,
    tpPct: 1.5,
    slPct: 1.2
  }),
  runSim({
    name: '2. Hot Retest (-0.7% Limit): TP +1.6% | SL -1.1%',
    pullbackDiscountPct: 0.7,
    tpPct: 1.6,
    slPct: 1.1
  }),
  runSim({
    name: '3. Hot Retest (-0.8% Limit): TP +1.8% | SL -1.2%',
    pullbackDiscountPct: 0.8,
    tpPct: 1.8,
    slPct: 1.2
  }),
  runSim({
    name: '4. Hot Retest (-0.8% Limit): TP +2.0% | SL -1.2%',
    pullbackDiscountPct: 0.8,
    tpPct: 2.0,
    slPct: 1.2
  }),
  runSim({
    name: '5. Deep Retest (-1.0% Limit): TP +2.2% | SL -1.2%',
    pullbackDiscountPct: 1.0,
    tpPct: 2.2,
    slPct: 1.2
  })
];

console.log(JSON.stringify(suite, null, 2));
