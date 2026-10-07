import fs from 'fs';
import path from 'path';
import { calculateEMA, calculateRSI } from '../backend/src/services/technicalAnalysis.js';
import { isHalalCompliant } from '../backend/src/services/halalFilter.js';
import { WATCHLIST } from '../backend/src/config/assets.js';

const CACHE_DIR = path.resolve('scratch/kline_cache');
const FEE_RATE = 0.00075; // Using BNB fee discount (0.075% maker/taker = 0.15% round trip)

// Load BTC
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
    const ema9 = calculateEMA(closes, 9);
    const ema21 = calculateEMA(closes, 21);
    const ema50 = calculateEMA(closes, 50);
    const ema200 = calculateEMA(closes, 200);
    const rsi14 = calculateRSI(closes, 14);

    symbolTechnicals.push({
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

console.log(`Loaded ${symbolTechnicals.length} altcoins.`);

// Let's test a series of genuine SCALPING strategies:
function testScalpEngine(name, entryFn, { tpPct, slPct, maxHoldCandles = 6 }) { // max 30m hold for pure scalp!
  let trades = [];
  const lastTradeIdx = {};

  for (let i = 100; i < btcCandles.length - maxHoldCandles; i++) {
    for (const sym of symbolTechnicals) {
      if (lastTradeIdx[sym.binanceSymbol] && (i - lastTradeIdx[sym.binanceSymbol]) < 12) continue; // 1h cooldown

      const shouldEnter = entryFn(sym, i);
      if (!shouldEnter) continue;

      const entryPrice = sym.candles[i].close;
      const targetPrice = entryPrice * (1 + tpPct / 100);
      const stopPrice = entryPrice * (1 - slPct / 100);

      let exitPrice = null;
      let exitReason = null;

      for (let f = 1; f <= maxHoldCandles; f++) {
        const c = sym.candles[i + f];
        if (c.high >= targetPrice) {
          exitPrice = targetPrice;
          exitReason = 'TP';
          break;
        } else if (c.low <= stopPrice) {
          exitPrice = stopPrice;
          exitReason = 'SL';
          break;
        }
      }

      if (!exitPrice) {
        exitPrice = sym.candles[i + maxHoldCandles].close;
        exitReason = 'TIME_EXIT';
      }

      const grossReturn = (exitPrice - entryPrice) / entryPrice;
      const netReturn = grossReturn - (2 * FEE_RATE);

      trades.push({
        netReturn,
        isWin: netReturn > 0
      });

      lastTradeIdx[sym.binanceSymbol] = i;
    }
  }

  const total = trades.length;
  const wins = trades.filter(t => t.isWin).length;
  const losses = total - wins;
  const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : 0;
  const totalNet = trades.reduce((a, b) => a + b.netReturn, 0);
  const profitFactor = (() => {
    const w = trades.filter(t => t.netReturn > 0).reduce((a, b) => a + b.netReturn, 0);
    const l = Math.abs(trades.filter(t => t.netReturn <= 0).reduce((a, b) => a + b.netReturn, 0));
    return l > 0 ? (w / l).toFixed(2) : 'N/A';
  })();

  return {
    name,
    totalTrades: total,
    tradesPerDay: Number((total / 61).toFixed(1)),
    wins,
    losses,
    winRate: `${winRate}%`,
    profitFactor,
    totalPnL: `${(totalNet * 100).toFixed(1)}%`
  };
}

console.log('Testing genuine scalping mechanisms...');

const results = [
  // Scalp 1: Bollinger Band Reversion / Oversold Dip in Trend
  // When price drops below lower Bollinger band (or RSI < 25) while EMA 50 > EMA 200, buy the extreme panic dip for a quick 0.8% mean-reversion bounce
  testScalpEngine('1. Mean-Reversion Dip Buy (RSI < 25 in Bull Trend)', (sym, i) => {
    const c = sym.candles[i];
    const ema50 = sym.ema50[i];
    const ema200 = sym.ema200[i];
    const rsi = sym.rsi14[i];
    if (!ema50 || !ema200 || ema50 <= ema200) return false;
    if (rsi >= 25) return false;
    if (c.close >= c.open) return false; // buy the red dump candle
    return true;
  }, { tpPct: 1.0, slPct: 1.0, maxHoldCandles: 6 }),

  // Scalp 2: 3 Consecutive Red Candles Dip into 21 EMA support
  testScalpEngine('2. 3-Red-Candle Pullback to 21 EMA in Bull Trend', (sym, i) => {
    const c0 = sym.candles[i];
    const c1 = sym.candles[i - 1];
    const c2 = sym.candles[i - 2];
    const ema21 = sym.ema21[i];
    const ema50 = sym.ema50[i];
    if (!ema21 || !ema50 || ema21 <= ema50) return false;
    // 3 red candles in a row
    if (c0.close >= c0.open || c1.close >= c1.open || c2.close >= c2.open) return false;
    // Price at 21 EMA
    if (c0.close > ema21 * 1.005 || c0.close < ema21 * 0.992) return false;
    return true;
  }, { tpPct: 0.8, slPct: 0.8, maxHoldCandles: 6 }),

  // Scalp 3: VWAP / EMA Reclaim Momentum (False breakdown recovery)
  // Candle wicked below 50 EMA, but current candle aggressively reclaims and closes green above 21 EMA with 2x volume
  testScalpEngine('3. Bear Trap / EMA Reclaim Ignition', (sym, i) => {
    const c0 = sym.candles[i];
    const c1 = sym.candles[i - 1];
    const ema21 = sym.ema21[i];
    const ema50 = sym.ema50[i];
    if (!ema21 || !ema50 || ema21 <= ema50) return false;
    // Previous candle wicked below EMA 50
    if (c1.low > ema50 * 0.998) return false;
    // Current candle strongly closes back above EMA 21
    if (c0.close <= ema21 || c0.close <= c0.open) return false;
    // Volume expansion
    const prevVols = sym.candles.slice(i - 10, i).map(x => x.volume);
    const avgVol = prevVols.reduce((a, b) => a + b, 0) / 10;
    if (c0.volume < avgVol * 2.0) return false;
    return true;
  }, { tpPct: 1.2, slPct: 0.8, maxHoldCandles: 6 })
];

console.log(JSON.stringify(results, null, 2));
