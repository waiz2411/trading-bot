import fs from 'fs';
import path from 'path';
import { calculateTechnicalMetrics, calculateEMA } from '../backend/src/services/technicalAnalysis.js';
import { isHalalCompliant } from '../backend/src/services/halalFilter.js';
import { WATCHLIST } from '../backend/src/config/assets.js';

const CACHE_DIR = path.resolve('scratch/kline_cache');
const FEE_RATE = 0.0010; // 0.10% maker/taker (0.20% round trip)

// Load BTC klines
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

// Build BTC 15m candles from 5m candles (every 3 candles = 1 15m candle)
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

// Load all Halal altcoin candles
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

// Check BTC Health Gate at 5m candle index `i`
function isBtcHealthy(fiveMinIdx) {
  const fifteenMinIdx = Math.floor(fiveMinIdx / 3);
  if (fifteenMinIdx < 20 || fifteenMinIdx >= btc15mCandles.length) return false;

  const currentBtc15m = btc15mCandles[fifteenMinIdx];
  const ema20 = btc15mEma20[fifteenMinIdx];
  if (!ema20) return false;

  // 1. BTC Price must be >= 15m 20 EMA
  if (currentBtc15m.close < ema20) return false;

  // 2. Heavy sell volume check (recent 15m candle must not be a massive dump candle)
  const isRed = currentBtc15m.close < currentBtc15m.open;
  // Calculate 20-period volume average on 15m
  const recentVols = btc15mCandles.slice(fifteenMinIdx - 20, fifteenMinIdx).map(c => c.volume);
  const avgVol = recentVols.reduce((a, b) => a + b, 0) / 20;

  if (isRed && currentBtc15m.volume >= avgVol * 1.5) {
    return false; // Heavy sell volume
  }

  return true;
}

// Relative Strength Calculation vs BTC over 1h (12 candles) and 4h (48 candles)
function calculateRelativeStrength(candles, btcCandles, i) {
  if (i < 48) return null;

  const currentCoinPrice = candles[i].close;
  const currentBtcPrice = btcCandles[i].close;

  // 1-hour returns (12 candles)
  const coin1hPrice = candles[i - 12].close;
  const btc1hPrice = btcCandles[i - 12].close;
  const coinRet1h = ((currentCoinPrice - coin1hPrice) / coin1hPrice) * 100;
  const btcRet1h = ((currentBtcPrice - btc1hPrice) / btc1hPrice) * 100;
  const rs1h = coinRet1h - btcRet1h;

  // 4-hour returns (48 candles)
  const coin4hPrice = candles[i - 48].close;
  const btc4hPrice = btcCandles[i - 48].close;
  const coinRet4h = ((currentCoinPrice - coin4hPrice) / coin4hPrice) * 100;
  const btcRet4h = ((currentBtcPrice - btc4hPrice) / btc4hPrice) * 100;
  const rs4h = coinRet4h - btcRet4h;

  // Composite Relative Strength Score
  const compositeRS = (rs1h * 0.6) + (rs4h * 0.4);
  return { compositeRS, rs1h, rs4h };
}

function runThreePillarsBacktest(initialBalance = 22.0, maxSlots = 4) {
  const TP_PCT = 1.5; // +1.5% TP
  const SL_PCT = 0.9; // -0.9% SL

  let cash = initialBalance;
  let activePositions = [];
  const closedTrades = [];
  let peakBalance = initialBalance;
  let maxDD = 0;
  const lastTradeIdx = {};

  const totalCandles = btcCandles.length;

  for (let i = 50; i < totalCandles - 1; i++) {
    // 1. Check exits on active positions (TP, SL, or Structural Break below 5m 20 EMA)
    const remaining = [];
    for (const pos of activePositions) {
      const sym = symbolTechnicals.find(s => s.binanceSymbol === pos.binanceSymbol);
      const c = sym.candles[i];
      const tech = sym.techMap[i];

      let exitPrice = null;
      let exitReason = null;

      // Take Profit Check
      if (c.high >= pos.targetPrice) {
        exitPrice = pos.targetPrice;
        exitReason = 'TAKE_PROFIT';
      }
      // Stop Loss Check
      else if (c.low <= pos.stopPrice) {
        exitPrice = pos.stopPrice;
        exitReason = 'STOP_LOSS';
      }
      // Structural Break Check: Candle closed below 5m 20 EMA
      else if (tech && tech.ema21 && c.close < tech.ema21 * 0.998) {
        // Only if position has been open for at least 3 candles (15m) to avoid instant noise exit
        if (i - pos.entryIdx >= 3) {
          exitPrice = c.close;
          exitReason = 'STRUCTURAL_BREAK';
        }
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

    // 2. Open new trades if slots available
    const openSlots = maxSlots - activePositions.length;
    if (openSlots > 0 && cash >= 2.0) {
      // PILLAR 1: BTC Health Gate
      if (!isBtcHealthy(i)) {
        continue; // Abort all new Long entries immediately!
      }

      // PILLAR 2: Relative Strength Scanner (Find Top 3 Leaders)
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
      const top3Leaders = rsCandidates.slice(0, 3); // Isolate Top 3 Leaders

      // PILLAR 3: Volume Ignition Trigger
      const validEntries = [];
      for (const leader of top3Leaders) {
        const c = leader.candles[i];
        const tech = leader.techMap[i];
        if (!tech) continue;

        // ATR% > 0.5%
        const atrPct = (tech.atr / c.close) * 100;
        if (atrPct <= 0.50) continue;

        // Volume >= 2.5x 20-period volume SMA
        if (!tech.volSma20 || c.volume < tech.volSma20 * 2.5) continue;

        // Bullish candle confirmation (green candle, close in top 50% of range, price > EMA 20)
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

          lastTradeIdx[chosen.leader.binanceSymbol] = i;

          activePositions.push({
            symbol: chosen.leader.asset.symbol,
            binanceSymbol: chosen.leader.binanceSymbol,
            entryPrice,
            targetPrice: entryPrice * (1 + TP_PCT / 100),
            stopPrice: entryPrice * (1 - SL_PCT / 100),
            units,
            notional,
            entryIdx: i,
            entryTime: chosen.candle.time
          });
        }
      }
    }
  }

  const remainingEquity = activePositions.reduce((acc, p) => acc + p.notional, 0);
  const finalEquity = Number((cash + remainingEquity).toFixed(2));
  const netProfit = Number((finalEquity - initialBalance).toFixed(2));
  const roiPct = Number(((netProfit / initialBalance) * 100).toFixed(1));

  const totalTrades = closedTrades.length;
  const wins = closedTrades.filter(t => t.isWin).length;
  const losses = closedTrades.filter(t => !t.isWin).length;
  const winRate = totalTrades > 0 ? Number(((wins / totalTrades) * 100).toFixed(1)) : 0;

  const tpExits = closedTrades.filter(t => t.exitReason === 'TAKE_PROFIT').length;
  const slExits = closedTrades.filter(t => t.exitReason === 'STOP_LOSS').length;
  const sbExits = closedTrades.filter(t => t.exitReason === 'STRUCTURAL_BREAK').length;

  const grossProfit = closedTrades.filter(t => t.netPnL > 0).reduce((acc, t) => acc + t.netPnL, 0);
  const grossLoss = Math.abs(closedTrades.filter(t => t.netPnL < 0).reduce((acc, t) => acc + t.netPnL, 0));
  const profitFactor = grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(2)) : 'N/A';

  return {
    initialBalance: `$${initialBalance.toFixed(2)}`,
    finalBalance: `$${finalEquity.toFixed(2)}`,
    netProfit: `${netProfit >= 0 ? '+' : ''}$${netProfit.toFixed(2)}`,
    roiPct: `${roiPct}%`,
    maxDrawdown: `${maxDD.toFixed(1)}%`,
    totalTrades,
    tradesPerDay: Number((totalTrades / 61).toFixed(1)),
    wins,
    losses,
    winRate: `${winRate}%`,
    profitFactor,
    exitBreakdown: {
      takeProfit: `${tpExits} (${((tpExits / totalTrades) * 100 || 0).toFixed(1)}%)`,
      stopLoss: `${slExits} (${((slExits / totalTrades) * 100 || 0).toFixed(1)}%)`,
      structuralBreak: `${sbExits} (${((sbExits / totalTrades) * 100 || 0).toFixed(1)}%)`
    },
    sampleTrades: closedTrades.slice(-8)
  };
}

console.log('\n======================================================');
console.log('RESULTS: THREE PILLARS (BTC GATE + RS LEADERS + VOLUME IGNITION)');
console.log('TP: +1.5% | SL: -0.9% | No Blind Timer (Exits on TP, SL, or 20 EMA Break)');
console.log('Starting Capital: $22.00 | 4 Slots');
console.log('======================================================');
const result = runThreePillarsBacktest(22.0, 4);
console.log(JSON.stringify(result, null, 2));
