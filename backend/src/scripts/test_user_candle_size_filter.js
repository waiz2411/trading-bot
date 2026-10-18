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
console.log(`Loaded ${symbols.length} altcoin datasets.`);

function calculateIndicators(candles) {
  const len = candles.length;
  const closes = candles.map(c => c.close);
  const rsi14 = new Float64Array(len);
  const atr14 = new Float64Array(len);

  // RSI
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

  // ATR (14)
  let trSum = 0;
  for (let i = 1; i <= 14 && i < len; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    );
    trSum += tr;
  }
  let prevATR = trSum / 14;
  atr14[14] = prevATR;
  for (let i = 15; i < len; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    );
    prevATR = (prevATR * 13 + tr) / 14;
    atr14[i] = prevATR;
  }

  return { rsi14, atr14 };
}

const symData = {};
for (const sym of symbols) {
  const c = datasets[sym];
  symData[sym] = { candles: c, tech: calculateIndicators(c) };
}

const feeRate = 0.0010; // 0.10% each way = 0.20%
const slipRate = 0.0003;
const SL_PCT = 1.0; // User specified exact 1% Stop Loss

// Test different minimum candle size / ATR thresholds
const atrThresholds = [
  { name: 'Baseline (No Candle Size Filter)', minATR: 0 },
  { name: 'Min ATR% >= 0.3% (Filter Dead Coins)', minATR: 0.3 },
  { name: 'Min ATR% >= 0.5% (Active Coins)', minATR: 0.5 },
  { name: 'Min ATR% >= 0.7% (Volatile Coins)', minATR: 0.7 },
  { name: 'Min ATR% >= 0.9% (High Momentum Only)', minATR: 0.9 },
  { name: 'Min ATR% >= 1.2% (Extreme Volatility Only)', minATR: 1.2 },
  { name: 'Min ATR% >= 0.6% + Trigger Candle Size >= 0.8%', minATR: 0.6, minCandleRange: 0.8 }
];

const results = [];

for (const t of atrThresholds) {
  let trades = 0;
  let wins = 0;
  let losses = 0;
  let grossSum = 0;
  let netSum = 0;
  let winAmounts = [];
  let lossAmounts = [];

  for (const sym of symbols) {
    const { candles, tech } = symData[sym];
    const rsi = tech.rsi14;
    const atr = tech.atr14;

    let inTrade = false;
    let entryPrice = 0;
    let entryIdx = 0;
    let stopLossPrice = 0;

    for (let i = 20; i < candles.length - 1; i++) {
      const c = candles[i];
      const curRSI = rsi[i];
      const prevRSI = rsi[i - 1];

      if (!inTrade) {
        // Buy condition: RSI re-enters 35 from below
        if (prevRSI < 35 && curRSI >= 35) {
          const atrPct = (atr[i] / c.close) * 100;
          if (atrPct < t.minATR) continue;

          if (t.minCandleRange) {
            const candleRangePct = ((c.high - c.low) / c.close) * 100;
            if (candleRangePct < t.minCandleRange) continue;
          }

          inTrade = true;
          entryPrice = c.close * (1 + slipRate);
          entryIdx = i;
          stopLossPrice = entryPrice * (1 - SL_PCT / 100);
        }
      } else {
        // In trade
        let exitPrice = null;
        let exitReason = null;

        // 1. Check 1% Stop Loss on candle low
        if (c.low <= stopLossPrice) {
          exitPrice = stopLossPrice * (1 - slipRate);
          exitReason = 'STOP_LOSS';
        }
        // 2. Check RSI Middle Dotted Line (50) Touch
        else if (curRSI >= 50) {
          exitPrice = c.close * (1 - slipRate);
          exitReason = 'RSI_50_MIDLINE';
        }
        // 3. Max hold timeout (e.g. 32 bars = 8h)
        else if (i - entryIdx >= 32) {
          exitPrice = c.close * (1 - slipRate);
          exitReason = 'TIMEOUT';
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
          grossSum += gross;
          netSum += net;
          inTrade = false;
        }
      }
    }
  }

  const winRate = trades > 0 ? (wins / trades) * 100 : 0;
  const avgWin = wins > 0 ? (winAmounts.reduce((a, b) => a + b, 0) / wins) : 0;
  const avgLoss = losses > 0 ? (lossAmounts.reduce((a, b) => a + b, 0) / losses) : 0;
  const avgTrade = trades > 0 ? netSum / trades : 0;

  results.push({
    Filter: t.name,
    Trades: trades,
    Wins: wins,
    Losses: losses,
    'Win Rate': winRate.toFixed(1) + '%',
    'Avg Win': '+' + avgWin.toFixed(2) + '%',
    'Avg Loss': avgLoss.toFixed(2) + '%',
    'Avg Trade Net': (avgTrade >= 0 ? '+' : '') + avgTrade.toFixed(2) + '%',
    'Total Net ROI': (netSum >= 0 ? '+' : '') + netSum.toFixed(1) + '%'
  });
}

console.log('\n================================================================================');
console.log('   TESTING USER IDEA: RSI 35 RE-ENTRY -> RSI 50 EXIT WITH 1% SL');
console.log('   Impact of Filtering Small Candles / Low Volatility (ATR Filter)');
console.log('================================================================================\n');
console.table(results);
