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

    symbolData.push({
      asset,
      binanceSymbol,
      candles,
      ema9,
      ema21,
      ema50,
      ema200
    });
  }
}

function runSniperBacktest(minGain24h, minRvol, tpPct, slPct, maxHoldCandles = 12) {
  let trades = [];
  const lastTradeIdx = {};

  for (let i = 288; i < btcCandles.length - maxHoldCandles; i++) {
    const leaders = [];
    for (const sym of symbolData) {
      if (lastTradeIdx[sym.binanceSymbol] && (i - lastTradeIdx[sym.binanceSymbol]) < 24) continue;

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
    const hotPick = leaders[0];

    const c = hotPick.candles[i];
    const recentHighs = hotPick.candles.slice(i - 24, i).map(x => x.high);
    const max2h = Math.max(...recentHighs);
    if (c.close <= max2h || c.close <= c.open) continue;

    const entryPrice = c.close;
    const targetPrice = entryPrice * (1 + tpPct / 100);
    const stopPrice = entryPrice * (1 - slPct / 100);

    let exitPrice = null;
    let exitReason = null;

    for (let f = 1; f <= maxHoldCandles; f++) {
      const fc = hotPick.candles[i + f];
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
      exitPrice = hotPick.candles[i + maxHoldCandles].close;
      exitReason = 'TIMEOUT';
    }

    const grossReturn = (exitPrice - entryPrice) / entryPrice;
    const netReturn = grossReturn - (2 * FEE_RATE);

    trades.push({
      symbol: hotPick.asset.symbol,
      netReturn,
      isWin: netReturn > 0,
      exitReason
    });

    lastTradeIdx[hotPick.binanceSymbol] = i;
  }

  const total = trades.length;
  const wins = trades.filter(t => t.isWin).length;
  const winRate = total > 0 ? Number(((wins / total) * 100).toFixed(1)) : 0;
  const totalNet = trades.reduce((a, b) => a + b.netReturn, 0);
  const totalProfit = trades.filter(t => t.netReturn > 0).reduce((a, b) => a + b.netReturn, 0);
  const totalLoss = Math.abs(trades.filter(t => t.netReturn <= 0).reduce((a, b) => a + b.netReturn, 0));
  const profitFactor = totalLoss > 0 ? Number((totalProfit / totalLoss).toFixed(2)) : 0;

  return {
    minGain24h: `+${minGain24h}%`,
    minRvol: `${minRvol}x`,
    tpPct: `+${tpPct}%`,
    slPct: `-${slPct}%`,
    maxHold: `${maxHoldCandles * 5}m`,
    totalTrades: total,
    tradesPerDay: Number((total / 61).toFixed(1)),
    wins,
    losses: total - wins,
    winRate: `${winRate}%`,
    profitFactor,
    totalNetGain: `${(totalNet * 100).toFixed(1)}%`
  };
}

console.log('Testing Sniper Breakouts on Hottest Coin:');
const tests = [
  runSniperBacktest(8.0, 2.5, 1.2, 1.0, 12),
  runSniperBacktest(8.0, 2.5, 1.5, 1.0, 12),
  runSniperBacktest(10.0, 3.0, 1.5, 1.0, 12),
  runSniperBacktest(10.0, 3.0, 2.0, 1.2, 18),
  runSniperBacktest(6.0, 2.0, 1.0, 0.8, 12),
  runSniperBacktest(8.0, 2.5, 2.5, 1.2, 24)
];

console.log(JSON.stringify(tests, null, 2));
