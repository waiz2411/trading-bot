import fs from 'fs';
import path from 'path';
import { calculateEMA, calculateRSI } from '../backend/src/services/technicalAnalysis.js';
import { isHalalCompliant } from '../backend/src/services/halalFilter.js';
import { WATCHLIST } from '../backend/src/config/assets.js';

const CACHE_DIR = path.resolve('scratch/kline_cache');
const FEE_RATE = 0.00075; // 0.15% round-trip

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

// Build BTC 1h
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

    // 1h candles for each coin
    const closes1h = [];
    for (let c = 0; c < candles.length; c += 12) {
      const sl = candles.slice(c, c + 12);
      if (sl.length === 12) closes1h.push(sl[11].close);
    }
    const ema20_1h = calculateEMA(closes1h, 20);
    const ema50_1h = calculateEMA(closes1h, 50);

    symbolData.push({
      asset,
      binanceSymbol,
      candles,
      ema9,
      ema21,
      ema50,
      ema200,
      rsi14,
      ema20_1h,
      ema50_1h
    });
  }
}

console.log(`Loaded ${symbolData.length} altcoins with 1h + 5m metrics.`);

// Let's test a targeted strategy designed for >= 70% win rate:
// Multi-Timeframe Alignment:
// 1. 1h Trend: Bullish (1h EMA 20 > 1h EMA 50)
// 2. 5m Trend: Bullish (5m EMA 21 > 5m EMA 50)
// 3. Entry: Dip into 21/50 EMA band when 5m RSI dips < 40 (Oversold Dip in Strong Trend)
// 4. Target: Quick mean-reversion pop to recent high or +0.8% - +1.2%
// 5. Stop Loss: 1.2% - 1.5% below entry

function evaluateStrategyGrid(tpPct, slPct, rsiMax, min1hTrend = true) {
  let trades = [];
  const lastTradeIdx = {};
  const maxHoldCandles = 24; // 2 hours max

  for (let i = 288; i < btcCandles.length - maxHoldCandles; i++) {
    // BTC 1h regime: BTC must be above 1h 50 EMA
    const oneHourIdx = Math.floor(i / 12);
    if (btc1hEma50[oneHourIdx] && btcCandles[i].close < btc1hEma50[oneHourIdx]) continue;

    for (const sym of symbolData) {
      if (lastTradeIdx[sym.binanceSymbol] && (i - lastTradeIdx[sym.binanceSymbol]) < 12) continue;

      const c = sym.candles[i];
      const prevC = sym.candles[i - 1];
      const ema9 = sym.ema9[i];
      const ema21 = sym.ema21[i];
      const ema50 = sym.ema50[i];
      const rsi = sym.rsi14[i];

      // 1h trend alignment
      if (min1hTrend) {
        const coin1hEma20 = sym.ema20_1h[oneHourIdx];
        const coin1hEma50 = sym.ema50_1h[oneHourIdx];
        if (!coin1hEma20 || !coin1hEma50 || coin1hEma20 <= coin1hEma50) continue;
      }

      // 5m trend alignment
      if (!ema21 || !ema50 || ema21 <= ema50) continue;

      // Price pulled back to EMA 21 / 50 support zone
      if (prevC.low > ema21 * 1.002) continue;
      if (c.close < ema50 * 0.995) continue; // Don't buy if completely collapsed below 50 EMA

      // RSI condition
      if (rsi > rsiMax) continue;

      // Bullish confirmation: green candle or hammer rejecting support
      if (c.close <= c.open) continue;

      const entryPrice = c.close;
      const targetPrice = entryPrice * (1 + tpPct / 100);
      const stopPrice = entryPrice * (1 - slPct / 100);

      let exitPrice = null;
      for (let f = 1; f <= maxHoldCandles; f++) {
        const fc = sym.candles[i + f];
        if (fc.high >= targetPrice) {
          exitPrice = targetPrice;
          break;
        } else if (fc.low <= stopPrice) {
          exitPrice = stopPrice;
          break;
        }
      }

      if (!exitPrice) {
        exitPrice = sym.candles[i + maxHoldCandles].close;
      }

      const grossReturn = (exitPrice - entryPrice) / entryPrice;
      const netReturn = grossReturn - (2 * FEE_RATE);

      trades.push({ netReturn, isWin: netReturn > 0 });
      lastTradeIdx[sym.binanceSymbol] = i;
    }
  }

  const total = trades.length;
  const wins = trades.filter(t => t.isWin).length;
  const winRate = total > 0 ? Number(((wins / total) * 100).toFixed(1)) : 0;
  const totalNet = trades.reduce((a, b) => a + b.netReturn, 0);
  const totalProfit = trades.filter(t => t.netReturn > 0).reduce((a, b) => a + b.netReturn, 0);
  const totalLoss = Math.abs(trades.filter(t => t.netReturn <= 0).reduce((a, b) => a + b.netReturn, 0));
  const profitFactor = totalLoss > 0 ? Number((totalProfit / totalLoss).toFixed(2)) : 0;

  return {
    tpPct: `+${tpPct}%`,
    slPct: `-${slPct}%`,
    rsiMax,
    totalTrades: total,
    tradesPerDay: Number((total / 61).toFixed(1)),
    wins,
    losses: total - wins,
    winRate: `${winRate}%`,
    profitFactor,
    totalNetGain: `${(totalNet * 100).toFixed(1)}%`
  };
}

console.log('Testing Parameter Combinations for 70%+ Win Rate:');

const testCases = [
  evaluateStrategyGrid(0.6, 1.2, 45, true),
  evaluateStrategyGrid(0.7, 1.4, 42, true),
  evaluateStrategyGrid(0.8, 1.5, 40, true),
  evaluateStrategyGrid(0.8, 1.8, 38, true),
  evaluateStrategyGrid(0.9, 1.8, 38, true),
  evaluateStrategyGrid(1.0, 2.0, 36, true),
  evaluateStrategyGrid(0.6, 1.5, 40, true),
  evaluateStrategyGrid(0.7, 1.5, 38, true)
];

console.log(JSON.stringify(testCases, null, 2));
