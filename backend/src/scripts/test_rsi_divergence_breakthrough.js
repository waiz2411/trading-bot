import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cacheDir = path.resolve(__dirname, '../data/binance_cache');

console.log('--- TESTING RSI BULLISH DIVERGENCE QUANT BREAKTHROUGH ---');

const files = fs.readdirSync(cacheDir).filter(f => f.endsWith('.json'));
const rawDatasets = {};

for (const file of files) {
  const sym = file.split('_')[0];
  if (['PAXGUSDT', 'FDUSDUSDT', 'USDCUSDT'].includes(sym)) continue;
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(cacheDir, file), 'utf8'));
    if (Array.isArray(raw) && raw.length > 5000) {
      const parsed = raw.map(c => ({
        openTime: c.openTime || c[0],
        time: c.time || new Date(c.openTime || c[0]).toISOString(),
        open: Number(c.open || c[1]),
        high: Number(c.high || c[2]),
        low: Number(c.low || c[3]),
        close: Number(c.close || c[4]),
        volume: Number(c.volume || c[5])
      })).filter(c => c.openTime >= 1767225600000 && !isNaN(c.close));

      parsed.sort((a, b) => a.openTime - b.openTime);
      if (parsed.length > 2000) rawDatasets[sym] = parsed;
    }
  } catch (_) {}
}

const symbols = Object.keys(rawDatasets).filter(s => s !== 'BTCUSDT');

function resampleCandles(c15m, targetMinutes) {
  const stepMs = targetMinutes * 60 * 1000;
  const buckets = new Map();
  for (const c of c15m) {
    const bucket = c.openTime - (c.openTime % stepMs);
    let arr = buckets.get(bucket);
    if (!arr) { arr = []; buckets.set(bucket, arr); }
    arr.push(c);
  }
  const resampled = [];
  for (const [openTime, slice] of buckets.entries()) {
    let open = slice[0].open;
    let high = -Infinity;
    let low = Infinity;
    let close = slice[slice.length - 1].close;
    let volume = 0;
    for (const c of slice) {
      if (c.high > high) high = c.high;
      if (c.low < low) low = c.low;
      volume += c.volume;
    }
    resampled.push({ openTime, time: new Date(openTime).toISOString(), open, high, low, close, volume });
  }
  resampled.sort((a, b) => a.openTime - b.openTime);
  return resampled;
}

function calculateRSI14(candles) {
  const len = candles.length;
  const closes = candles.map(c => c.close);
  const rsi14 = new Float64Array(len);

  let avgG = 0, avgL = 0;
  for (let i = 1; i <= 14 && i < len; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) avgG += d; else avgL += Math.abs(d);
  }
  avgG /= 14; avgL /= 14;
  rsi14[14] = avgL === 0 ? 100 : 100 - (100 / (1 + avgG / avgL));
  for (let i = 15; i < len; i++) {
    const d = closes[i] - closes[i - 1];
    avgG = (avgG * 13 + (d > 0 ? d : 0)) / 14;
    avgL = (avgL * 13 + (d < 0 ? Math.abs(d) : 0)) / 14;
    rsi14[i] = avgL === 0 ? 100 : 100 - (100 / (1 + avgG / avgL));
  }
  return rsi14;
}

const tfDatasets = {
  '15m': {},
  '30m': {},
  '1h': {}
};

for (const sym of symbols) {
  const c15 = rawDatasets[sym];
  tfDatasets['15m'][sym] = { candles: c15, rsi: calculateRSI14(c15) };

  const c30 = resampleCandles(c15, 30);
  tfDatasets['30m'][sym] = { candles: c30, rsi: calculateRSI14(c30) };

  const c1h = resampleCandles(c15, 60);
  tfDatasets['1h'][sym] = { candles: c1h, rsi: calculateRSI14(c1h) };
}

const feeRate = 0.0010;
const slipRate = 0.0003;

// Detect Bullish RSI Divergence:
// Within the last 15 candles:
// 1. Previous Low: candle A has low PA and RSI < 35
// 2. Current Low: candle B has low PB < PA (Lower Low in price)
// 3. BUT RSI at candle B > RSI at candle A (Higher Low in RSI!)
// 4. Entry triggered when candle B closes green and RSI crosses up!

function evaluateDivergenceStrategy(tf, slPct, tpPct, exitRSI) {
  const store = tfDatasets[tf];
  let trades = 0, wins = 0, losses = 0, winSum = 0, lossSum = 0, totalNet = 0;
  const dailyGainMap = new Map();

  for (const sym of symbols) {
    const { candles, rsi } = store[sym];

    let inTrade = false;
    let entryPrice = 0;
    let entryIdx = 0;
    let stopLossPrice = 0;
    let cooldownUntil = -1;

    for (let i = 25; i < candles.length - 1; i++) {
      const c = candles[i];
      const curRSI = rsi[i];

      if (i < cooldownUntil) continue;

      if (!inTrade) {
        // Check for Bullish Divergence in last 12 bars
        if (c.close >= c.open && curRSI >= 30 && curRSI <= 48) {
          let hasDivergence = false;
          let lowestPricePrior = Infinity;
          let rsiAtPriorLow = 0;
          let priorLowIdx = -1;

          // Find lowest dip in bars 3 to 14
          for (let k = 3; k <= 14; k++) {
            const pb = candles[i - k];
            if (pb.low < lowestPricePrior && rsi[i - k] < 35) {
              lowestPricePrior = pb.low;
              rsiAtPriorLow = rsi[i - k];
              priorLowIdx = i - k;
            }
          }

          if (priorLowIdx !== -1) {
            // Check recent dip (bars 0 to 2)
            const recentLowest = Math.min(candles[i].low, candles[i - 1].low);
            const recentMinRSI = Math.min(rsi[i], rsi[i - 1]);

            // Price makes lower low OR double bottom within 0.3%, but RSI is higher!
            if (recentLowest <= lowestPricePrior * 1.003 && recentMinRSI > rsiAtPriorLow + 2.0) {
              hasDivergence = true;
            }
          }

          if (hasDivergence) {
            inTrade = true;
            entryPrice = c.close * (1 + slipRate);
            entryIdx = i;
            stopLossPrice = entryPrice * (1 - slPct / 100);
          }
        }
      } else {
        let exitPrice = null;

        if (c.low <= stopLossPrice) {
          exitPrice = stopLossPrice * (1 - slipRate);
          cooldownUntil = i + 4;
        } else if (exitRSI && curRSI >= exitRSI) {
          exitPrice = c.close * (1 - slipRate);
        } else if (tpPct && c.high >= entryPrice * (1 + tpPct / 100)) {
          exitPrice = entryPrice * (1 + tpPct / 100) * (1 - slipRate);
        } else if (i - entryIdx >= 24) {
          exitPrice = c.close * (1 - slipRate);
        }

        if (exitPrice !== null) {
          const gross = ((exitPrice - entryPrice) / entryPrice) * 100;
          const net = gross - 0.23;

          trades++;
          if (net > 0) { wins++; winSum += net; } else { losses++; lossSum += net; }
          totalNet += net;

          const dateStr = c.time.slice(0, 10);
          dailyGainMap.set(dateStr, (dailyGainMap.get(dateStr) || 0) + net);

          inTrade = false;
        }
      }
    }
  }

  const winRate = trades > 0 ? (wins / trades) * 100 : 0;
  const avgWin = wins > 0 ? winSum / wins : 0;
  const avgLoss = losses > 0 ? lossSum / losses : 0;
  const avgNet = trades > 0 ? totalNet / trades : 0;
  const profitFactor = Math.abs(lossSum) > 0 ? Math.abs(winSum / lossSum) : 999;
  const dailyTrades = (trades / 289).toFixed(1);

  const dailyReturns = Array.from(dailyGainMap.values());
  const profitableDays = dailyReturns.filter(r => r > 0).length;
  const totalTradingDays = dailyReturns.length;
  const dailyWinRate = totalTradingDays > 0 ? ((profitableDays / totalTradingDays) * 100).toFixed(1) + '%' : '0%';

  return {
    Timeframe: tf,
    'SL / TP Target': tpPct ? `${slPct}% SL / +${tpPct}% TP` : `${slPct}% SL / RSI ${exitRSI} TP`,
    Trades: trades,
    'Trades/Day': dailyTrades,
    Wins: wins,
    Losses: losses,
    'Win Rate': winRate.toFixed(1) + '%',
    'Avg Win': '+' + avgWin.toFixed(2) + '%',
    'Avg Loss': avgLoss.toFixed(2) + '%',
    'Reward:Risk': avgLoss !== 0 ? (avgWin / Math.abs(avgLoss)).toFixed(2) : 'N/A',
    'Profit Factor': profitFactor.toFixed(2),
    'Profitable Days': `${profitableDays}/${totalTradingDays} (${dailyWinRate})`,
    'Total Net Gain': (totalNet >= 0 ? '+' : '') + totalNet.toFixed(1) + '%'
  };
}

const divTests = [
  // 15m Divergence
  { tf: '15m', slPct: 1.2, tpPct: null, exitRSI: 50 },
  { tf: '15m', slPct: 1.5, tpPct: 2.0, exitRSI: null },
  { tf: '15m', slPct: 1.5, tpPct: 2.5, exitRSI: null },

  // 30m Divergence
  { tf: '30m', slPct: 1.8, tpPct: null, exitRSI: 50 },
  { tf: '30m', slPct: 1.8, tpPct: 2.5, exitRSI: null },
  { tf: '30m', slPct: 2.0, tpPct: 3.0, exitRSI: null },

  // 1H Divergence
  { tf: '1h', slPct: 2.5, tpPct: null, exitRSI: 50 },
  { tf: '1h', slPct: 2.5, tpPct: 3.5, exitRSI: null },
  { tf: '1h', slPct: 2.5, tpPct: 4.0, exitRSI: null }
];

console.log('Running RSI Bullish Divergence tests...');
const divResults = divTests.map(t => ({
  Strategy: `RSI Divergence (${t.tf})`,
  ...evaluateDivergenceStrategy(t.tf, t.slPct, t.tpPct, t.exitRSI)
}));

console.log('\n====================================================================================================================================');
console.log('   RSI BULLISH DIVERGENCE QUANT RESULTS (INSTITUTIONAL MOMENTUM EXHAUSTION TRIGGER)');
console.log('====================================================================================================================================\n');
console.table(divResults);
