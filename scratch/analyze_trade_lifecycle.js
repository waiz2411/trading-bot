import fs from 'fs';
import path from 'path';

// Let's analyze trade lifecycles from scratch/test_user_requested_params.js
// We will track for every trade:
// 1. Max favorable excursion (MFE): what was the highest % gain during the trade?
// 2. Max adverse excursion (MAE): what was the deepest drawdown?
// 3. Did it dump immediately after the 5m volume spike?

import { calculateTechnicalMetrics, calculateEMA } from '../backend/src/services/technicalAnalysis.js';
import { isHalalCompliant } from '../backend/src/services/halalFilter.js';
import { WATCHLIST } from '../backend/src/config/assets.js';

const CACHE_DIR = path.resolve('scratch/kline_cache');
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
    const techMap = new Array(candles.length);
    for (let i = 50; i < candles.length; i++) {
      techMap[i] = calculateTechnicalMetrics(candles.slice(i - 49, i + 1));
    }
    symbolTechnicals.push({ asset, binanceSymbol, candles, techMap });
  }
}

function isBtcHealthy(fiveMinIdx) {
  const fifteenMinIdx = Math.floor(fiveMinIdx / 3);
  if (fifteenMinIdx < 20 || fifteenMinIdx >= btc15mCandles.length) return false;
  const currentBtc15m = btc15mCandles[fifteenMinIdx];
  const ema20 = btc15mEma20[fifteenMinIdx];
  if (!ema20 || currentBtc15m.close < ema20) return false;
  return true;
}

function calculateRelativeStrength(candles, btcCandles, i) {
  if (i < 48) return null;
  const currentCoinPrice = candles[i].close;
  const currentBtcPrice = btcCandles[i].close;
  const coin1hPrice = candles[i - 12].close;
  const btc1hPrice = btcCandles[i - 12].close;
  const rs1h = ((currentCoinPrice - coin1hPrice) / coin1hPrice) * 100 - ((currentBtcPrice - btc1hPrice) / btc1hPrice) * 100;
  const coin4hPrice = candles[i - 48].close;
  const btc4hPrice = btcCandles[i - 48].close;
  const rs4h = ((currentCoinPrice - coin4hPrice) / coin4hPrice) * 100 - ((currentBtcPrice - btc4hPrice) / btc4hPrice) * 100;
  return (rs1h * 0.6) + (rs4h * 0.4);
}

// Track MFE distribution across all entries
const mfeStats = [];
let instantDumpCount = 0; // dropped below entry within 1-2 candles

for (let i = 50; i < btcCandles.length - 48; i++) {
  if (!isBtcHealthy(i)) continue;

  const rsCandidates = [];
  for (const item of symbolTechnicals) {
    const rs = calculateRelativeStrength(item.candles, btcCandles, i);
    if (rs && rs > 0) rsCandidates.push({ ...item, compositeRS: rs });
  }
  rsCandidates.sort((a, b) => b.compositeRS - a.compositeRS);
  const top3 = rsCandidates.slice(0, 3);

  for (const leader of top3) {
    const c = leader.candles[i];
    const tech = leader.techMap[i];
    if (!tech) continue;
    const atrPct = (tech.atr / c.close) * 100;
    if (atrPct <= 0.50) continue;
    if (!tech.volSma20 || c.volume < tech.volSma20 * 2.5) continue;
    if (c.close <= c.open) continue;
    if (tech.ema21 && c.close < tech.ema21) continue;

    // We found an entry trigger! Let's examine what happens over the next 48 candles (4 hours)
    const entryPrice = c.close;
    let maxHigh = entryPrice;
    let minLow = entryPrice;
    let candlesToMaxHigh = 0;
    let candlesToMinLow = 0;

    for (let f = 1; f <= 48; f++) {
      const futureCandle = leader.candles[i + f];
      if (!futureCandle) break;
      if (futureCandle.high > maxHigh) {
        maxHigh = futureCandle.high;
        candlesToMaxHigh = f;
      }
      if (futureCandle.low < minLow) {
        minLow = futureCandle.low;
        candlesToMinLow = f;
      }
    }

    const maxGainPct = ((maxHigh - entryPrice) / entryPrice) * 100;
    const maxLossPct = ((entryPrice - minLow) / entryPrice) * 100;

    // Check candle 1 and candle 2 immediately after entry
    const c1 = leader.candles[i + 1];
    const c2 = leader.candles[i + 2];
    const nextCandleDumping = c1 && (c1.close < entryPrice || c1.low < entryPrice * 0.99);

    mfeStats.push({
      symbol: leader.asset.symbol,
      maxGainPct,
      maxLossPct,
      candlesToMaxHigh,
      candlesToMinLow,
      nextCandleDumping
    });
  }
}

console.log(`Analyzed ${mfeStats.length} volume ignition trigger events.`);

const avgMaxGain = mfeStats.reduce((a, b) => a + b.maxGainPct, 0) / mfeStats.length;
const avgMaxLoss = mfeStats.reduce((a, b) => a + b.maxLossPct, 0) / mfeStats.length;

const reached1PctGain = mfeStats.filter(s => s.maxGainPct >= 1.0).length;
const reached1_5PctGain = mfeStats.filter(s => s.maxGainPct >= 1.5).length;
const reached2PctGain = mfeStats.filter(s => s.maxGainPct >= 2.0).length;
const reached2_5PctGain = mfeStats.filter(s => s.maxGainPct >= 2.5).length;
const reached3PctGain = mfeStats.filter(s => s.maxGainPct >= 3.0).length;
const reached3_5PctGain = mfeStats.filter(s => s.maxGainPct >= 3.5).length;

const dropped1Pct = mfeStats.filter(s => s.maxLossPct >= 1.0).length;
const dropped1_2Pct = mfeStats.filter(s => s.maxLossPct >= 1.2).length;
const dropped1_5Pct = mfeStats.filter(s => s.maxLossPct >= 1.5).length;

const immediateRedCandle = mfeStats.filter(s => s.nextCandleDumping).length;

console.log(`\n--- MFE & DRAWDOWN DIAGNOSTICS ---`);
console.log(`Average Max Gain within 4h: +${avgMaxGain.toFixed(2)}%`);
console.log(`Average Max Drawdown within 4h: -${avgMaxLoss.toFixed(2)}%`);
console.log(`Immediate Red/Dump candle right after entry: ${immediateRedCandle} (${((immediateRedCandle / mfeStats.length) * 100).toFixed(1)}%)`);

console.log(`\nMax Gain Milestones reached before 4h:`);
console.log(`- Reached >= +1.0% gain: ${reached1PctGain} (${((reached1PctGain / mfeStats.length) * 100).toFixed(1)}%)`);
console.log(`- Reached >= +1.5% gain: ${reached1_5PctGain} (${((reached1_5PctGain / mfeStats.length) * 100).toFixed(1)}%)`);
console.log(`- Reached >= +2.0% gain: ${reached2PctGain} (${((reached2PctGain / mfeStats.length) * 100).toFixed(1)}%)`);
console.log(`- Reached >= +2.5% gain: ${reached2_5PctGain} (${((reached2_5PctGain / mfeStats.length) * 100).toFixed(1)}%)`);
console.log(`- Reached >= +3.0% gain: ${reached3PctGain} (${((reached3PctGain / mfeStats.length) * 100).toFixed(1)}%)`);
console.log(`- Reached >= +3.5% gain: ${reached3_5PctGain} (${((reached3_5PctGain / mfeStats.length) * 100).toFixed(1)}%)`);

console.log(`\nDrawdown Milestones reached within 4h:`);
console.log(`- Dropped >= -1.0% drawdown: ${dropped1Pct} (${((dropped1Pct / mfeStats.length) * 100).toFixed(1)}%)`);
console.log(`- Dropped >= -1.2% drawdown: ${dropped1_2Pct} (${((dropped1_2Pct / mfeStats.length) * 100).toFixed(1)}%)`);
console.log(`- Dropped >= -1.5% drawdown: ${dropped1_5Pct} (${((dropped1_5Pct / mfeStats.length) * 100).toFixed(1)}%)`);
