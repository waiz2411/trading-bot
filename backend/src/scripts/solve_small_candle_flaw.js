import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cacheDir = path.resolve(__dirname, '../data/binance_cache');

const files = fs.readdirSync(cacheDir).filter(f => f.endsWith('.json'));
const datasets = {};

for (const file of files) {
  const sym = file.split('_')[0];
  if (sym === 'BTCUSDT' || sym === 'PAXGUSDT') continue;
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
      if (parsed.length > 2000) datasets[sym] = parsed;
    }
  } catch (_) {}
}

const symbols = Object.keys(datasets);

function calculateIndicators(candles) {
  const len = candles.length;
  const closes = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume);
  const rsi = new Float64Array(len);
  const volSMA = new Float64Array(len);
  const avgRangePct = new Float64Array(len);

  let avgG = 0, avgL = 0;
  for (let i = 1; i <= 14 && i < len; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) avgG += d; else avgL += Math.abs(d);
  }
  avgG /= 14; avgL /= 14;
  rsi[14] = avgL === 0 ? 100 : 100 - (100 / (1 + avgG / avgL));
  for (let i = 15; i < len; i++) {
    const d = closes[i] - closes[i - 1];
    avgG = (avgG * 13 + (d > 0 ? d : 0)) / 14;
    avgL = (avgL * 13 + (d < 0 ? Math.abs(d) : 0)) / 14;
    rsi[i] = avgL === 0 ? 100 : 100 - (100 / (1 + avgG / avgL));
  }

  for (let i = 19; i < len; i++) {
    let vSum = 0;
    let rSum = 0;
    for (let j = 0; j < 20; j++) {
      vSum += volumes[i - j];
      const c = candles[i - j];
      rSum += ((c.high - c.low) / c.close) * 100;
    }
    volSMA[i] = vSum / 20;
    avgRangePct[i] = rSum / 20;
  }

  return { rsi, volSMA, avgRangePct };
}

const symData = {};
for (const sym of symbols) {
  const c = datasets[sym];
  symData[sym] = { candles: c, tech: calculateIndicators(c) };
}

const feeRate = 0.0010;
const slipRate = 0.0003;
const SL_PCT = 1.0;

const testFilters = [
  { name: '1. Raw User Setup (No Filters, SL 1.0%, Exit RSI 50)' },
  { name: '2. Filter: Green Candle Only (Close > Open)', requireGreen: true },
  { name: '3. Filter: Candle Body >= 0.4% (Kill Micro-Candles)', minBodyPct: 0.4 },
  { name: '4. Filter: Recent 20-bar Avg Range >= 0.6% (Active Coin)', minAvgRange: 0.6 },
  { name: '5. Filter: Volume Surge >= 1.3x VolSMA', minVolRatio: 1.3 },
  { name: '6. Filter: Green Candle + Body >= 0.4% + Active Coin (Avg Range >= 0.6%)', requireGreen: true, minBodyPct: 0.4, minAvgRange: 0.6 },
  { name: '7. Filter: Green Hammer Wick (Lower Wick >= 35%) + Body >= 0.3%', requireGreen: true, minLowerWickRatio: 0.35, minBodyPct: 0.3 },
  { name: '8. Filter: All Above + Volume Surge >= 1.2x', requireGreen: true, minBodyPct: 0.3, minAvgRange: 0.5, minVolRatio: 1.2 }
];

const results = [];

for (const tf of testFilters) {
  let trades = 0, wins = 0, losses = 0, netSum = 0;
  let winAmounts = [], lossAmounts = [];

  for (const sym of symbols) {
    const { candles, tech } = symData[sym];
    const { rsi, volSMA, avgRangePct } = tech;

    let inTrade = false;
    let entryPrice = 0;
    let entryIdx = 0;
    let stopLossPrice = 0;

    for (let i = 25; i < candles.length - 1; i++) {
      const c = candles[i];
      const curRSI = rsi[i];
      const prevRSI = rsi[i - 1];

      if (!inTrade) {
        if (prevRSI < 35 && curRSI >= 35) {
          const bodyPct = (Math.abs(c.close - c.open) / c.close) * 100;
          const range = c.high - c.low;
          const lowerWick = Math.min(c.open, c.close) - c.low;
          const lowerWickRatio = range > 0 ? (lowerWick / range) : 0;
          const volRatio = volSMA[i] > 0 ? (c.volume / volSMA[i]) : 1;

          if (tf.requireGreen && c.close <= c.open) continue;
          if (tf.minBodyPct && bodyPct < tf.minBodyPct) continue;
          if (tf.minAvgRange && avgRangePct[i] < tf.minAvgRange) continue;
          if (tf.minVolRatio && volRatio < tf.minVolRatio) continue;
          if (tf.minLowerWickRatio && lowerWickRatio < tf.minLowerWickRatio) continue;

          inTrade = true;
          entryPrice = c.close * (1 + slipRate);
          entryIdx = i;
          stopLossPrice = entryPrice * (1 - SL_PCT / 100);
        }
      } else {
        let exitPrice = null;

        // 1% SL
        if (c.low <= stopLossPrice) {
          exitPrice = stopLossPrice * (1 - slipRate);
        }
        // RSI 50 Midline touch
        else if (curRSI >= 50) {
          exitPrice = c.close * (1 - slipRate);
        }
        // Timeout
        else if (i - entryIdx >= 32) {
          exitPrice = c.close * (1 - slipRate);
        }

        if (exitPrice !== null) {
          const gross = ((exitPrice - entryPrice) / entryPrice) * 100;
          const net = gross - (feeRate * 2 * 100) - (slipRate * 100);

          trades++;
          if (net > 0) {
            wins++;
            winAmounts.push(net);
          } else {
            losses++;
            lossAmounts.push(net);
          }
          netSum += net;
          inTrade = false;
        }
      }
    }
  }

  const winRate = trades > 0 ? (wins / trades) * 100 : 0;
  const avgWin = wins > 0 ? (winAmounts.reduce((a, b) => a + b, 0) / wins) : 0;
  const avgLoss = losses > 0 ? (lossAmounts.reduce((a, b) => a + b, 0) / losses) : 0;
  const avgNet = trades > 0 ? netSum / trades : 0;

  results.push({
    Filter: tf.name,
    Trades: trades,
    Wins: wins,
    Losses: losses,
    'Win Rate': winRate.toFixed(1) + '%',
    'Avg Win': '+' + avgWin.toFixed(2) + '%',
    'Avg Loss': avgLoss.toFixed(2) + '%',
    'Avg Net/Trade': (avgNet >= 0 ? '+' : '') + avgNet.toFixed(2) + '%',
    'Total Net PnL': (netSum >= 0 ? '+' : '') + netSum.toFixed(1) + '%'
  });
}

console.log('\n========================================================================================');
console.log('   SOLVING THE "SMALL CANDLE" FLAW: BACKTESTING CANDLE SIZE & VOLATILITY FILTERS');
console.log('   Strategy: RSI 35 Re-Entry -> RSI 50 Midline Touch | Exact 1.0% Stop Loss | 0.23% Fees');
console.log('========================================================================================\n');
console.table(results);
