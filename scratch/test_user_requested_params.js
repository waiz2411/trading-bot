import fs from 'fs';
import path from 'path';
import { calculateTechnicalMetrics, calculateEMA } from '../backend/src/services/technicalAnalysis.js';
import { isHalalCompliant } from '../backend/src/services/halalFilter.js';
import { WATCHLIST } from '../backend/src/config/assets.js';

const CACHE_DIR = path.resolve('scratch/kline_cache');
const FEE_RATE = 0.0010; // Binance spot fee: 0.10% each side = 0.20% round-trip

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

// Build BTC 15m candles (every 3 x 5m candles)
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
  if (!ema20) return false;

  if (currentBtc15m.close < ema20) return false;

  const isRed = currentBtc15m.close < currentBtc15m.open;
  const recentVols = btc15mCandles.slice(fifteenMinIdx - 20, fifteenMinIdx).map(c => c.volume);
  const avgVol = recentVols.reduce((a, b) => a + b, 0) / 20;

  if (isRed && currentBtc15m.volume >= avgVol * 1.5) {
    return false;
  }

  return true;
}

function calculateRelativeStrength(candles, btcCandles, i) {
  if (i < 48) return null;

  const currentCoinPrice = candles[i].close;
  const currentBtcPrice = btcCandles[i].close;

  const coin1hPrice = candles[i - 12].close;
  const btc1hPrice = btcCandles[i - 12].close;
  const coinRet1h = ((currentCoinPrice - coin1hPrice) / coin1hPrice) * 100;
  const btcRet1h = ((currentBtcPrice - btc1hPrice) / btc1hPrice) * 100;
  const rs1h = coinRet1h - btcRet1h;

  const coin4hPrice = candles[i - 48].close;
  const btc4hPrice = btcCandles[i - 48].close;
  const coinRet4h = ((currentCoinPrice - coin4hPrice) / coin4hPrice) * 100;
  const btcRet4h = ((currentBtcPrice - btc4hPrice) / btc4hPrice) * 100;
  const rs4h = coinRet4h - btcRet4h;

  const compositeRS = (rs1h * 0.6) + (rs4h * 0.4);
  return { compositeRS, rs1h, rs4h };
}

function runBacktestScenario({
  label,
  tpPct,
  slPct,
  maxHoldHours = 4,
  useStructuralExit = true,
  useBreakEvenLock = false,
  initialBalance = 22.0,
  maxSlots = 4
}) {
  const maxHoldCandles = maxHoldHours * 12; // 12 candles per hour on 5m = 48 candles for 4h

  let cash = initialBalance;
  let activePositions = [];
  const closedTrades = [];
  let peakBalance = initialBalance;
  let maxDD = 0;
  const lastTradeIdx = {};

  const totalCandles = btcCandles.length;

  for (let i = 50; i < totalCandles - 1; i++) {
    // 1. Process active positions exits
    const remaining = [];
    for (const pos of activePositions) {
      const sym = symbolTechnicals.find(s => s.binanceSymbol === pos.binanceSymbol);
      const c = sym.candles[i];
      const tech = sym.techMap[i];

      let exitPrice = null;
      let exitReason = null;

      // Optional: Break-even lock if price gained +1.5%
      if (useBreakEvenLock && !pos.beLocked) {
        if (c.high >= pos.entryPrice * 1.015) {
          pos.stopPrice = pos.entryPrice * 1.002; // Move SL to entry + 0.20% fee buffer
          pos.beLocked = true;
        }
      }

      // Check Take Profit
      if (c.high >= pos.targetPrice) {
        exitPrice = pos.targetPrice;
        exitReason = 'TAKE_PROFIT';
      }
      // Check Stop Loss
      else if (c.low <= pos.stopPrice) {
        exitPrice = pos.stopPrice;
        exitReason = pos.beLocked ? 'BREAK_EVEN_EXIT' : 'STOP_LOSS';
      }
      // Check Structural Break: Price breaks below 5m 20 EMA
      else if (useStructuralExit && tech && tech.ema21 && c.close < tech.ema21 * 0.998) {
        if (i - pos.entryIdx >= 3) { // After 15m
          exitPrice = c.close;
          exitReason = 'STRUCTURAL_BREAK';
        }
      }
      // Check 4-Hour Safety Cap (48 candles)
      else if (i - pos.entryIdx >= maxHoldCandles) {
        exitPrice = c.close;
        exitReason = '4H_SAFETY_TIMEOUT';
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

    // 2. Open new entries
    const openSlots = maxSlots - activePositions.length;
    if (openSlots > 0 && cash >= 2.0) {
      // BTC Health Gate
      if (!isBtcHealthy(i)) continue;

      // RS Scanner
      const rsCandidates = [];
      for (const item of symbolTechnicals) {
        const { asset, binanceSymbol, candles } = item;
        if (activePositions.some(p => p.binanceSymbol === binanceSymbol)) continue;
        if (lastTradeIdx[binanceSymbol] && (i - lastTradeIdx[binanceSymbol]) < 18) continue; // 90m cooldown

        const rs = calculateRelativeStrength(candles, btcCandles, i);
        if (rs && rs.compositeRS > 0) {
          rsCandidates.push({ ...item, compositeRS: rs.compositeRS });
        }
      }

      rsCandidates.sort((a, b) => b.compositeRS - a.compositeRS);
      const top3Leaders = rsCandidates.slice(0, 3);

      // Volume Ignition Trigger
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

          // Compute target & stop prices
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
            units,
            beLocked: false
          });
        }
      }
    }
  }

  // Calculate metrics
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
    tpPct: `+${tpPct}%`,
    slPct: `-${slPct}%`,
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

console.log('Running backtest scenarios...');

const results = [
  // Scenario 1: TP +2.5%, SL -1.2%, Structural Break exit enabled, 4h safety cap
  runBacktestScenario({
    label: 'A: TP +2.5% | SL -1.2% (with 20 EMA Break & 4h Cap)',
    tpPct: 2.5,
    slPct: 1.2,
    maxHoldHours: 4,
    useStructuralExit: true
  }),

  // Scenario 2: TP +3.0%, SL -1.2%, Structural Break exit enabled, 4h safety cap
  runBacktestScenario({
    label: 'B: TP +3.0% | SL -1.2% (with 20 EMA Break & 4h Cap)',
    tpPct: 3.0,
    slPct: 1.2,
    maxHoldHours: 4,
    useStructuralExit: true
  }),

  // Scenario 3: TP +3.5%, SL -1.2%, Structural Break exit enabled, 4h safety cap
  runBacktestScenario({
    label: 'C: TP +3.5% | SL -1.2% (with 20 EMA Break & 4h Cap)',
    tpPct: 3.5,
    slPct: 1.2,
    maxHoldHours: 4,
    useStructuralExit: true
  }),

  // Scenario 4: Pure TP +2.5% / SL -1.2% (NO EMA break, purely let it hit TP/SL or 4h safety cap)
  runBacktestScenario({
    label: 'D: TP +2.5% | SL -1.2% (Pure TP/SL/4h Timer, No EMA Break)',
    tpPct: 2.5,
    slPct: 1.2,
    maxHoldHours: 4,
    useStructuralExit: false
  }),

  // Scenario 5: Pure TP +3.0% / SL -1.2% (NO EMA break, purely let it hit TP/SL or 4h safety cap)
  runBacktestScenario({
    label: 'E: TP +3.0% | SL -1.2% (Pure TP/SL/4h Timer, No EMA Break)',
    tpPct: 3.0,
    slPct: 1.2,
    maxHoldHours: 4,
    useStructuralExit: false
  }),

  // Scenario 6: Pure TP +3.5% / SL -1.2% (NO EMA break, purely let it hit TP/SL or 4h safety cap)
  runBacktestScenario({
    label: 'F: TP +3.5% | SL -1.2% (Pure TP/SL/4h Timer, No EMA Break)',
    tpPct: 3.5,
    slPct: 1.2,
    maxHoldHours: 4,
    useStructuralExit: false
  }),

  // Scenario 7: TP +3.0% | SL -1.2% + Break-Even Lock at +1.5%
  runBacktestScenario({
    label: 'G: TP +3.0% | SL -1.2% + Break-Even Lock @ +1.5%',
    tpPct: 3.0,
    slPct: 1.2,
    maxHoldHours: 4,
    useStructuralExit: true,
    useBreakEvenLock: true
  })
];

console.log('\n======================================================');
console.log('BACKTEST COMPARISON: AUG 1 - OCT 1 ($22 Starting Capital, 4 Slots)');
console.log('======================================================');
console.log(JSON.stringify(results, null, 2));
