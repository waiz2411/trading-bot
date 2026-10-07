import fs from 'fs';
import path from 'path';
import { calculateTechnicalMetrics, calculateEMA, calculateRSI } from '../backend/src/services/technicalAnalysis.js';
import { isHalalCompliant } from '../backend/src/services/halalFilter.js';
import { WATCHLIST } from '../backend/src/config/assets.js';

const CACHE_DIR = path.resolve('scratch/kline_cache');
const FEE_RATE = 0.0010;

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

// Build BTC 15m
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

// Load all altcoins
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

function isBtcHealthy(fiveMinIdx) {
  const fifteenMinIdx = Math.floor(fiveMinIdx / 3);
  if (fifteenMinIdx < 20 || fifteenMinIdx >= btc15mCandles.length) return false;
  const currentBtc15m = btc15mCandles[fifteenMinIdx];
  const ema20 = btc15mEma20[fifteenMinIdx];
  return ema20 && currentBtc15m.close >= ema20;
}

// Function to test any custom setup across the entire 2-month dataset
function testSetup(name, conditionFn, { tpPct = 1.5, slPct = 1.0, maxHoldCandles = 48 }) {
  let trades = [];
  const lastTradeIdx = {};

  for (let i = 200; i < btcCandles.length - maxHoldCandles; i++) {
    if (!isBtcHealthy(i)) continue;

    for (const sym of symbolTechnicals) {
      if (lastTradeIdx[sym.binanceSymbol] && (i - lastTradeIdx[sym.binanceSymbol]) < 24) continue; // 2h cooldown

      const match = conditionFn(sym, i);
      if (!match) continue;

      // Found entry!
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
        exitReason = 'TIMEOUT';
      }

      const grossReturn = (exitPrice - entryPrice) / entryPrice;
      const netReturn = grossReturn - (2 * FEE_RATE);

      trades.push({
        symbol: sym.asset.symbol,
        netReturn,
        isWin: netReturn > 0,
        exitReason
      });

      lastTradeIdx[sym.binanceSymbol] = i;
    }
  }

  const wins = trades.filter(t => t.isWin).length;
  const total = trades.length;
  const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : 0;
  const avgReturn = total > 0 ? ((trades.reduce((a, b) => a + b.netReturn, 0) / total) * 100).toFixed(2) : 0;
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
    losses: total - wins,
    winRate: `${winRate}%`,
    profitFactor,
    avgNetReturnPerTrade: `${avgReturn}%`
  };
}

console.log('Testing multiple high-probability setup models...');

const results = [
  // Setup 0: Current model (Chasing 2.5x volume green candle)
  testSetup('0. Current Model: Random 2.5x Volume Green Candle', (sym, i) => {
    const c = sym.candles[i];
    const prevVols = sym.candles.slice(i - 20, i).map(x => x.volume);
    const avgVol = prevVols.reduce((a, b) => a + b, 0) / 20;
    return c.volume >= avgVol * 2.5 && c.close > c.open;
  }, { tpPct: 1.5, slPct: 1.0 }),

  // Setup 1: High-Timeframe Trend Pullback to 5m 50 EMA
  // Condition: In strong uptrend (EMA 50 > EMA 200), price dips to EMA 50 and prints a green bullish rejection candle, RSI was oversold (< 42)
  testSetup('1. Bull Trend Dip to 50 EMA (RSI < 42 Bounce)', (sym, i) => {
    const c = sym.candles[i];
    const prevC = sym.candles[i - 1];
    const ema50 = sym.ema50[i];
    const ema200 = sym.ema200[i];
    const rsi = sym.rsi14[i];
    const prevRsi = sym.rsi14[i - 1];

    if (!ema50 || !ema200 || ema50 <= ema200) return false; // Must be in macro uptrend
    if (prevC.low > ema50 * 1.005) return false; // Must have touched/dipped near EMA 50
    if (c.close <= ema50) return false; // Must close back above EMA 50
    if (c.close <= c.open) return false; // Must be green confirmation candle
    if (prevRsi > 45) return false; // Was recently pulled back / oversold
    return true;
  }, { tpPct: 1.5, slPct: 1.0 }),

  // Setup 2: 4-Hour / 24-Hour Resistance Breakout
  // Price breaks above the 48-period (4-hour) highest high with 2x volume expansion
  testSetup('2. 4-Hour Range Breakout (48-candle high with volume)', (sym, i) => {
    const c = sym.candles[i];
    const recentHighs = sym.candles.slice(i - 48, i).map(x => x.high);
    const max4hHigh = Math.max(...recentHighs);
    if (c.close <= max4hHigh) return false; // Breakout!

    const prevVols = sym.candles.slice(i - 20, i).map(x => x.volume);
    const avgVol = prevVols.reduce((a, b) => a + b, 0) / 20;
    if (c.volume < avgVol * 2.0) return false; // Volume confirmed breakout
    return true;
  }, { tpPct: 1.5, slPct: 1.0 }),

  // Setup 3: Volatility Squeeze Breakout (Bollinger Band / Donchian Squeeze)
  // Low volatility consolidation over 30 candles (6x ATR < 3%), followed by breakout
  testSetup('3. Volatility Squeeze Breakout (Consolidation -> Expansion)', (sym, i) => {
    const c = sym.candles[i];
    const window = sym.candles.slice(i - 36, i); // 3-hour consolidation window
    const highest = Math.max(...window.map(x => x.high));
    const lowest = Math.min(...window.map(x => x.low));
    const rangePct = ((highest - lowest) / lowest) * 100;

    if (rangePct > 2.0) return false; // Must be a tight squeeze (less than 2% range for 3 hours!)
    if (c.close <= highest) return false; // Squeeze breakout to upside!

    const prevVols = window.map(x => x.volume);
    const avgVol = prevVols.reduce((a, b) => a + b, 0) / prevVols.length;
    if (c.volume < avgVol * 2.5) return false; // Ignition out of squeeze
    return true;
  }, { tpPct: 1.5, slPct: 1.0 }),

  // Setup 4: Golden Trend Alignment (Triple EMA Alignment 9 > 21 > 50 > 200) + 21 EMA Pullback
  testSetup('4. Institutional Triple EMA Pullback (9 > 21 > 50 > 200 dip to 21 EMA)', (sym, i) => {
    const c = sym.candles[i];
    const prevC = sym.candles[i - 1];
    const ema9 = sym.ema9[i];
    const ema21 = sym.ema21[i];
    const ema50 = sym.ema50[i];
    const ema200 = sym.ema200[i];

    if (!ema9 || !ema21 || !ema50 || !ema200) return false;
    // Perfect institutional fan
    if (!(ema9 > ema21 && ema21 > ema50 && ema50 > ema200)) return false;

    // Price wicked below 21 EMA and closes above 9 EMA / 21 EMA
    if (prevC.low > ema21 * 1.002) return false;
    if (c.close <= ema21) return false;
    if (c.close <= c.open) return false; // Green rejection candle
    return true;
  }, { tpPct: 1.5, slPct: 1.0 }),

  // Setup 5: Oversold Capitulation Bounce (RSI < 25 bounce with volume in BTC bull regime)
  testSetup('5. Oversold Capitulation Reversal (RSI < 25 Hammer)', (sym, i) => {
    const c = sym.candles[i];
    const rsi = sym.rsi14[i];
    const prevRsi = sym.rsi14[i - 1];
    if (prevRsi > 28) return false; // Deep oversold panic
    if (c.close <= c.open) return false; // Green reversal candle
    if (rsi <= prevRsi) return false; // RSI hooked up

    const lowerWick = Math.min(c.open, c.close) - c.low;
    const body = Math.abs(c.close - c.open);
    if (lowerWick < body) return false; // Hammer rejection wick
    return true;
  }, { tpPct: 1.5, slPct: 1.0 })
];

console.log('\n======================================================');
console.log('SETUP WIN RATE COMPARISON (AUG 1 - OCT 1 BINANCE SPOT)');
console.log('TP: +1.5% | SL: -1.0% | Max 4h Hold');
console.log('======================================================');
console.log(JSON.stringify(results, null, 2));
