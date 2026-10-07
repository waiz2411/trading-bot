import fs from 'fs';
import path from 'path';
import { calculateEMA, calculateRSI } from '../backend/src/services/technicalAnalysis.js';
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

// Build BTC 1h candles (every 12 x 5m candles)
const btc1hCandles = [];
for (let i = 0; i < btcCandles.length; i += 12) {
  const slice = btcCandles.slice(i, i + 12);
  if (slice.length === 12) {
    btc1hCandles.push({
      time: slice[0].time,
      open: slice[0].open,
      high: Math.max(...slice.map(c => c.high)),
      low: Math.min(...slice.map(c => c.low)),
      close: slice[11].close,
      volume: slice.reduce((acc, c) => acc + c.volume, 0)
    });
  }
}
const btc1hCloses = btc1hCandles.map(c => c.close);
const btc1hEma20 = calculateEMA(btc1hCloses, 20);
const btc1hEma50 = calculateEMA(btc1hCloses, 50);

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

    const closes = candles.map(c => c.close);
    const ema20 = calculateEMA(closes, 20);
    const ema50 = calculateEMA(closes, 50);
    const ema200 = calculateEMA(closes, 200);

    symbolTechnicals.push({
      asset,
      binanceSymbol,
      candles,
      ema20,
      ema50,
      ema200
    });
  }
}

function runTrendRunnerBacktest(initialBalance = 22.0, maxSlots = 2) {
  let cash = initialBalance;
  let activePositions = [];
  const closedTrades = [];
  let peakBalance = initialBalance;
  let maxDD = 0;
  const lastTradeIdx = {};

  for (let i = 288; i < btcCandles.length - 1; i++) { // 288 = 24h
    // BTC 1h regime
    const oneHourIdx = Math.floor(i / 12);
    const isBtcBull = btc1hEma20[oneHourIdx] && btc1hEma50[oneHourIdx] && btc1hEma20[oneHourIdx] > btc1hEma50[oneHourIdx];

    // Exits
    const remaining = [];
    for (const pos of activePositions) {
      const sym = symbolTechnicals.find(s => s.binanceSymbol === pos.binanceSymbol);
      const c = sym.candles[i];

      if (c.high > pos.peakPrice) {
        pos.peakPrice = c.high;
        // Dynamic Trailing: once gain >= 2.5%, trail stop at 1.5% below peak
        const currentGain = ((pos.peakPrice - pos.entryPrice) / pos.entryPrice) * 100;
        if (currentGain >= 2.5) {
          const trailStop = pos.peakPrice * 0.985;
          if (trailStop > pos.stopPrice) pos.stopPrice = trailStop;
        }
      }

      let exitPrice = null;
      let exitReason = null;

      // Hard Take Profit at +6.0%
      if (c.high >= pos.targetPrice) {
        exitPrice = pos.targetPrice;
        exitReason = 'TAKE_PROFIT_RUNNER';
      } else if (c.low <= pos.stopPrice) {
        exitPrice = pos.stopPrice;
        exitReason = pos.peakPrice > pos.entryPrice * 1.025 ? 'TRAILING_STOP' : 'STOP_LOSS';
      } else if (i - pos.entryIdx >= 144) { // 12-hour max hold
        exitPrice = c.close;
        exitReason = '12H_TIMEOUT';
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

    // Entries
    if (!isBtcBull) continue;
    const openSlots = maxSlots - activePositions.length;
    if (openSlots <= 0 || cash < 5.0) continue;

    // Scan for high conviction 24h breakout leaders
    const candidates = [];
    for (const item of symbolTechnicals) {
      if (activePositions.some(p => p.binanceSymbol === item.binanceSymbol)) continue;
      if (lastTradeIdx[item.binanceSymbol] && (i - lastTradeIdx[item.binanceSymbol]) < 48) continue; // 4h cooldown

      const c = item.candles[i];
      const ema20 = item.ema20[i];
      const ema50 = item.ema50[i];
      const ema200 = item.ema200[i];

      if (!ema20 || !ema50 || !ema200) continue;
      if (ema20 <= ema50 || ema50 <= ema200) continue; // Strong trend only

      // Must be breaking the 24h high (288 candles)
      const past24hHighs = item.candles.slice(i - 288, i).map(x => x.high);
      const max24hHigh = Math.max(...past24hHighs);

      if (c.close > max24hHigh) {
        // Volume check: volume >= 3.0x 24h average
        const past24hVols = item.candles.slice(i - 288, i).map(x => x.volume);
        const avgVol = past24hVols.reduce((a, b) => a + b, 0) / 288;
        if (c.volume >= avgVol * 3.0 && c.close > c.open) {
          candidates.push({ ...item, candle: c, breakoutDiff: (c.close - max24hHigh) / max24hHigh });
        }
      }
    }

    if (candidates.length > 0) {
      candidates.sort((a, b) => b.breakoutDiff - a.breakoutDiff);
      const chosen = candidates[0];

      const notional = Number((cash / openSlots).toFixed(2));
      const entryPrice = chosen.candle.close;
      const units = notional / entryPrice;
      const targetPrice = entryPrice * 1.06; // +6.0% Target
      const stopPrice = entryPrice * 0.985;   // -1.5% Stop Loss

      cash = Number((cash - notional).toFixed(4));
      lastTradeIdx[chosen.binanceSymbol] = i;

      activePositions.push({
        symbol: chosen.asset.symbol,
        binanceSymbol: chosen.binanceSymbol,
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
    initialBalance: `$${initialBalance.toFixed(2)}`,
    finalBalance: `$${finalBalance.toFixed(2)}`,
    netProfit: `$${netProfit.toFixed(2)}`,
    roiPct: `${roiPct}%`,
    totalTrades,
    tradesPerDay: Number((totalTrades / 61).toFixed(2)),
    wins,
    losses,
    winRate: `${winRate}%`,
    profitFactor,
    maxDrawdown: `${maxDD.toFixed(1)}%`
  };
}

console.log('Results of Institutional 24h Breakout Runner (+6% Target, -1.5% Stop):');
console.log(JSON.stringify(runTrendRunnerBacktest(22.0, 2), null, 2));
