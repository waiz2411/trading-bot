import fs from 'fs';
import path from 'path';
import { calculateEMA, calculateRSI } from '../backend/src/services/technicalAnalysis.js';
import { isHalalCompliant } from '../backend/src/services/halalFilter.js';
import { WATCHLIST } from '../backend/src/config/assets.js';

const CACHE_DIR = path.resolve('scratch/kline_cache');
const FEE_RATE = 0.00075; // 0.075% maker/taker with BNB discount (0.15% round-trip)

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

// Build BTC 1h & 15m trend
const btc1hCandles = [];
for (let i = 0; i < btcCandles.length; i += 12) {
  const slice = btcCandles.slice(i, i + 12);
  if (slice.length === 12) {
    btc1hCandles.push({
      time: slice[0].time,
      close: slice[11].close
    });
  }
}
const btc1hCloses = btc1hCandles.map(c => c.close);
const btc1hEma20 = calculateEMA(btc1hCloses, 20);
const btc1hEma50 = calculateEMA(btc1hCloses, 50);

// 2. Load all altcoins
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
    const ema200 = calculateEMA(closes, 200);
    const rsi14 = calculateRSI(closes, 14);

    symbolData.push({
      asset,
      binanceSymbol,
      candles,
      ema9,
      ema21,
      ema50,
      ema200,
      rsi14
    });
  }
}

console.log(`Loaded ${symbolData.length} Halal altcoins.`);

// Test function for our dynamic hot-ticker scalper
function testHotCoinEngine({
  name,
  min24hGain = 3.0,       // Must be up at least +3% in last 24h (Hot leader!)
  minRvol1h = 2.0,        // 1h relative volume >= 2.0x normal
  tpPct = 1.0,            // Scalp TP
  slPct = 1.2,            // Scalp SL
  trailingTriggerPct = 0, // Trailing trigger (0 if disabled)
  trailDistPct = 0.4,
  maxHoldCandles = 12,    // 1-hour max hold (12 x 5m candles)
  entryType = 'PULLBACK'  // 'PULLBACK' | 'BREAKOUT'
}) {
  let initialBalance = 22.0;
  let cash = initialBalance;
  let activePositions = [];
  const closedTrades = [];
  let peakBalance = initialBalance;
  let maxDD = 0;
  const lastTradeIdx = {};
  const maxSlots = 4;

  const totalCandles = btcCandles.length;

  for (let i = 288; i < totalCandles - maxHoldCandles; i++) { // 288 candles = 24h
    // 1. Process active positions
    const remaining = [];
    for (const pos of activePositions) {
      const sym = symbolData.find(s => s.binanceSymbol === pos.binanceSymbol);
      const c = sym.candles[i];

      if (c.high > pos.peakPrice) {
        pos.peakPrice = c.high;
        if (trailingTriggerPct > 0) {
          const gain = ((pos.peakPrice - pos.entryPrice) / pos.entryPrice) * 100;
          if (gain >= trailingTriggerPct) {
            const newStop = pos.peakPrice * (1 - trailDistPct / 100);
            if (newStop > pos.stopPrice) pos.stopPrice = newStop;
          }
        }
      }

      let exitPrice = null;
      let exitReason = null;

      if (c.high >= pos.targetPrice) {
        exitPrice = pos.targetPrice;
        exitReason = 'TAKE_PROFIT';
      } else if (c.low <= pos.stopPrice) {
        exitPrice = pos.stopPrice;
        exitReason = pos.peakPrice > pos.entryPrice * 1.008 ? 'TRAIL_STOP' : 'STOP_LOSS';
      } else if (i - pos.entryIdx >= maxHoldCandles) {
        exitPrice = c.close;
        exitReason = 'TIME_CAP';
      }

      if (exitPrice !== null) {
        const grossReturn = (exitPrice - pos.entryPrice) / pos.entryPrice;
        const grossPnL = grossReturn * pos.notional;
        const totalFee = (pos.notional + exitPrice * pos.units) * FEE_RATE; // 0.15% round trip
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

    // BTC 1h regime: BTC must not be in a deep dump (BTC > 1h 50 EMA)
    const oneHourIdx = Math.floor(i / 12);
    if (btc1hEma50[oneHourIdx] && btcCandles[i].close < btc1hEma50[oneHourIdx] * 0.99) {
      continue; // BTC in dump
    }

    // Dynamic Hot-Coin Scanner across all Halal coins
    const hotLeaders = [];
    for (const item of symbolData) {
      if (activePositions.some(p => p.binanceSymbol === item.binanceSymbol)) continue;
      if (lastTradeIdx[item.binanceSymbol] && (i - lastTradeIdx[item.binanceSymbol]) < 12) continue; // 1h cooldown

      const c = item.candles[i];
      const c24hAgo = item.candles[i - 288];
      const gain24h = ((c.close - c24hAgo.close) / c24hAgo.close) * 100;

      // 1. Must be a top gainer (> min24hGain)
      if (gain24h < min24hGain) continue;

      // 2. Volume expansion: 1h volume vs 24h average hourly volume
      const recent1hVols = item.candles.slice(i - 12, i).map(x => x.quoteVolume || x.volume * x.close);
      const sum1h = recent1hVols.reduce((a, b) => a + b, 0);
      const past24hVols = item.candles.slice(i - 288, i).map(x => x.quoteVolume || x.volume * x.close);
      const avgHourly = past24hVols.reduce((a, b) => a + b, 0) / 24;
      const rvol = avgHourly > 0 ? (sum1h / avgHourly) : 1;

      if (rvol < minRvol1h) continue;

      hotLeaders.push({ ...item, gain24h, rvol });
    }

    // Sort to isolate the hottest leader
    hotLeaders.sort((a, b) => (b.gain24h * b.rvol) - (a.gain24h * a.rvol));
    const topLeaders = hotLeaders.slice(0, 3);

    const validEntries = [];
    for (const leader of topLeaders) {
      const c0 = leader.candles[i];
      const c1 = leader.candles[i - 1];
      const ema9 = leader.ema9[i];
      const ema21 = leader.ema21[i];
      const ema50 = leader.ema50[i];

      if (entryType === 'PULLBACK') {
        // Bullish Pullback Entry: Coin is hot, pulls back to 9/21 EMA, and prints green reversal
        if (!ema9 || !ema21 || ema9 <= ema21) continue;
        // Previous candle dipped near or below 9 EMA
        if (c1.low > ema9 * 1.004) continue;
        // Current candle reclaims and closes green
        if (c0.close <= ema9 || c0.close <= c0.open) continue;
        validEntries.push({ leader, candle: c0 });
      } else if (entryType === 'MICRO_BREAKOUT') {
        // Micro-Breakout: Price breaks above the high of the last 6 candles (30m)
        const recentHighs = leader.candles.slice(i - 6, i).map(x => x.high);
        const maxRecent = Math.max(...recentHighs);
        if (c0.close <= maxRecent) continue;
        if (c0.close <= c0.open) continue; // Green candle
        validEntries.push({ leader, candle: c0 });
      }
    }

    if (validEntries.length > 0) {
      const slotsToFill = Math.min(openSlots, validEntries.length);
      const totalEquity = cash + activePositions.reduce((a, p) => a + p.notional, 0);
      const targetSlotSize = Number((totalEquity / maxSlots).toFixed(2));

      for (let s = 0; s < slotsToFill; s++) {
        const notional = Number(Math.min(targetSlotSize, cash).toFixed(2));
        if (notional < 1.0) break;

        const chosen = validEntries[s];
        const entryPrice = chosen.candle.close;
        const units = notional / entryPrice;
        const targetPrice = entryPrice * (1 + tpPct / 100);
        const stopPrice = entryPrice * (1 - slPct / 100);

        cash = Number((cash - notional).toFixed(4));
        lastTradeIdx[chosen.leader.binanceSymbol] = i;

        activePositions.push({
          symbol: chosen.leader.asset.symbol,
          binanceSymbol: chosen.leader.binanceSymbol,
          entryIdx: i,
          entryPrice,
          targetPrice,
          stopPrice,
          notional,
          units,
          peakPrice: entryPrice
        });
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

console.log('Testing Hot-Ticker Scalper Configurations on Aug 1 - Oct 1 Data:');

const configurations = [
  // 1. Hot Pullback (+5% 24h, 1.5x RVOL): TP +1.0%, SL -1.0%
  testHotCoinEngine({
    name: '1. Hot Pullback (24h > +5%): TP +1.0% | SL -1.0%',
    min24hGain: 5.0,
    minRvol1h: 1.5,
    tpPct: 1.0,
    slPct: 1.0,
    entryType: 'PULLBACK'
  }),

  // 2. Hot Pullback (+5% 24h, 1.5x RVOL): TP +1.2% | SL -0.9%
  testHotCoinEngine({
    name: '2. Hot Pullback (24h > +5%): TP +1.2% | SL -0.9%',
    min24hGain: 5.0,
    minRvol1h: 1.5,
    tpPct: 1.2,
    slPct: 0.9,
    entryType: 'PULLBACK'
  }),

  // 3. Hot Pullback (+8% 24h, 2.0x RVOL): TP +1.0% | SL -0.8%
  testHotCoinEngine({
    name: '3. Super-Hot Pullback (24h > +8%, RVOL > 2x): TP +1.0% | SL -0.8%',
    min24hGain: 8.0,
    minRvol1h: 2.0,
    tpPct: 1.0,
    slPct: 0.8,
    entryType: 'PULLBACK'
  }),

  // 4. Hot Micro-Breakout (+5% 24h): TP +1.2% | SL -1.0%
  testHotCoinEngine({
    name: '4. Hot Micro-Breakout (24h > +5%): TP +1.2% | SL -1.0%',
    min24hGain: 5.0,
    minRvol1h: 1.5,
    tpPct: 1.2,
    slPct: 1.0,
    entryType: 'MICRO_BREAKOUT'
  }),

  // 5. Hot Pullback (+4% 24h, 2.0x RVOL) with Trailing: Trigger +0.8%, Trail 0.3%
  testHotCoinEngine({
    name: '5. Hot Pullback with Trailing: Trigger +0.8%, Trail 0.3%',
    min24hGain: 4.0,
    minRvol1h: 1.5,
    tpPct: 2.5,
    slPct: 1.0,
    trailingTriggerPct: 0.8,
    trailDistPct: 0.3,
    entryType: 'PULLBACK'
  })
];

console.log(JSON.stringify(configurations, null, 2));
