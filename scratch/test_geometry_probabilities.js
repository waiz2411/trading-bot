import fs from 'fs';
import path from 'path';
import { calculateTechnicalMetrics, calculateEMA, calculateRSI } from '../backend/src/services/technicalAnalysis.js';
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

function isBtcHealthy(fiveMinIdx) {
  const fifteenMinIdx = Math.floor(fiveMinIdx / 3);
  if (fifteenMinIdx < 20 || fifteenMinIdx >= btc15mCandles.length) return false;
  const currentBtc15m = btc15mCandles[fifteenMinIdx];
  const ema20 = btc15mEma20[fifteenMinIdx];
  return ema20 && currentBtc15m.close >= ema20;
}

function testGeometry(tpPct, slPct, label) {
  let trades = [];
  const lastTradeIdx = {};
  const maxHoldCandles = 48; // 4 hours

  for (let i = 200; i < btcCandles.length - maxHoldCandles; i++) {
    if (!isBtcHealthy(i)) continue;

    for (const sym of symbolTechnicals) {
      if (lastTradeIdx[sym.binanceSymbol] && (i - lastTradeIdx[sym.binanceSymbol]) < 24) continue;

      // Filter: In strong trend (EMA 50 > EMA 200), price dips to 21/50 EMA with green rejection
      const c = sym.candles[i];
      const prevC = sym.candles[i - 1];
      const ema50 = sym.ema50[i];
      const ema200 = sym.ema200[i];
      const rsi = sym.rsi14[i];

      if (!ema50 || !ema200 || ema50 <= ema200) continue;
      if (prevC.low > ema50 * 1.005) continue;
      if (c.close <= ema50) continue;
      if (c.close <= c.open) continue;

      const entryPrice = c.close;
      const targetPrice = entryPrice * (1 + tpPct / 100);
      const stopPrice = entryPrice * (1 - slPct / 100);

      let exitPrice = null;
      let exitReason = null;

      for (let f = 1; f <= maxHoldCandles; f++) {
        const fc = sym.candles[i + f];
        if (fc.high >= targetPrice) {
          exitPrice = targetPrice;
          exitReason = 'TP';
          break;
        } else if (fc.low <= stopPrice) {
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
        netReturn,
        isWin: netReturn > 0
      });

      lastTradeIdx[sym.binanceSymbol] = i;
    }
  }

  const wins = trades.filter(t => t.isWin).length;
  const total = trades.length;
  const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : 0;
  const totalNet = trades.reduce((a, b) => a + b.netReturn, 0);
  const profitFactor = (() => {
    const w = trades.filter(t => t.netReturn > 0).reduce((a, b) => a + b.netReturn, 0);
    const l = Math.abs(trades.filter(t => t.netReturn <= 0).reduce((a, b) => a + b.netReturn, 0));
    return l > 0 ? (w / l).toFixed(2) : 'N/A';
  })();

  return {
    label,
    tp: `+${tpPct}%`,
    sl: `-${slPct}%`,
    totalTrades: total,
    wins,
    losses: total - wins,
    winRate: `${winRate}%`,
    profitFactor,
    totalNetGain: `${(totalNet * 100).toFixed(1)}%`
  };
}

console.log('Testing Win Rates across different TP / SL Geometries:');
const geomResults = [
  testGeometry(1.5, 1.0, 'TP 1.5% vs SL 1.0% (Target 1.5x larger than Stop)'),
  testGeometry(1.0, 1.0, 'TP 1.0% vs SL 1.0% (1:1 Equal Geometry)'),
  testGeometry(1.0, 1.5, 'TP 1.0% vs SL 1.5% (Stop 1.5x larger than Target)'),
  testGeometry(0.8, 1.6, 'TP 0.8% vs SL 1.6% (Stop 2.0x larger than Target)'),
  testGeometry(0.6, 1.8, 'TP 0.6% vs SL 1.8% (Stop 3.0x larger than Target)'),
  testGeometry(0.5, 2.0, 'TP 0.5% vs SL 2.0% (Stop 4.0x larger than Target)')
];

console.log(JSON.stringify(geomResults, null, 2));
