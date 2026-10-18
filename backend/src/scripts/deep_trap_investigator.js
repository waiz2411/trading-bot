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
      if (parsed.length > 2000) datasets[sym] = parsed;
    }
  } catch (_) {}
}

const symbols = Object.keys(datasets).filter(s => s !== 'BTCUSDT');

function calculateIndicators(candles) {
  const len = candles.length;
  const closes = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume);
  const rsi14 = new Float64Array(len);
  const rsiSMA14 = new Float64Array(len);
  const volSMA20 = new Float64Array(len);

  // EMAs
  const ema9 = new Float64Array(len);
  const ema21 = new Float64Array(len);
  const ema50 = new Float64Array(len);
  const ema200 = new Float64Array(len);

  function calcEMA(arr, p, out) {
    const k = 2 / (p + 1);
    let e = arr[0];
    for (let i = 0; i < len; i++) {
      e = i === 0 ? arr[i] : arr[i] * k + e * (1 - k);
      out[i] = e;
    }
  }
  calcEMA(closes, 9, ema9);
  calcEMA(closes, 21, ema21);
  calcEMA(closes, 50, ema50);
  calcEMA(closes, 200, ema200);

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

  for (let i = 27; i < len; i++) {
    let s = 0;
    for (let j = 0; j < 14; j++) s += rsi14[i - j];
    rsiSMA14[i] = s / 14;
  }

  for (let i = 19; i < len; i++) {
    let s = 0;
    for (let j = 0; j < 20; j++) s += volumes[i - j];
    volSMA20[i] = s / 20;
  }

  // ATR 14
  const atr14 = new Float64Array(len);
  let atrSum = 0;
  for (let i = 1; i < len; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    );
    if (i <= 14) {
      atrSum += tr;
      if (i === 14) atr14[14] = atrSum / 14;
    } else {
      atr14[i] = (atr14[i - 1] * 13 + tr) / 14;
    }
  }

  return { rsi14, rsiSMA14, volSMA20, ema9, ema21, ema50, ema200, atr14 };
}

const symData = {};
for (const sym of [...symbols, 'BTCUSDT']) {
  if (!datasets[sym]) continue;
  symData[sym] = { candles: datasets[sym], tech: calculateIndicators(datasets[sym]) };
}

console.log('Investigating winning vs losing trades characteristics...');

// Collect all baseline trades with rich metadata
const allTrades = [];
const feeRate = 0.0010;
const slipRate = 0.0003;

for (const sym of symbols) {
  const { candles, tech } = symData[sym];
  const { rsi14, rsiSMA14, volSMA20, ema9, ema21, ema50, ema200, atr14 } = tech;

  let inOversold = false;
  let minRSI = 100;
  let dipLowestPrice = Infinity;
  let oversoldDuration = 0;
  let inTrade = false;
  let entryPrice = 0;
  let entryIdx = 0;
  let stopLossPrice = 0;
  let cooldownUntilIdx = -1;
  let tradeMeta = null;

  for (let i = 35; i < candles.length - 1; i++) {
    const c = candles[i];
    const curRSI = rsi14[i];
    const prevRSI = rsi14[i - 1];

    if (i < cooldownUntilIdx) continue;

    if (!inTrade) {
      if (curRSI < 35) {
        inOversold = true;
        oversoldDuration++;
        if (curRSI < minRSI) minRSI = curRSI;
        if (c.low < dipLowestPrice) dipLowestPrice = c.low;
      } else if (inOversold && prevRSI < 35 && curRSI >= 35) {
        if (minRSI <= 32 && c.close >= c.open) {
          // Trap 1 check: compression
          let smallCount = 0;
          for (let k = 1; k <= 24; k++) {
            if (((candles[i - k].high - candles[i - k].low) / candles[i - k].close) * 100 < 0.35) smallCount++;
          }
          const isTrap1 = (smallCount / 24 >= 0.60);

          // Trap 2 check: giant red dump >= 1.5% in last 4 bars
          let isTrap2 = false;
          let maxRedCandlePct = 0;
          for (let k = 1; k <= 4; k++) {
            const pb = candles[i - k];
            if (pb.close < pb.open) {
              const redPct = ((pb.open - pb.close) / pb.open) * 100;
              if (redPct > maxRedCandlePct) maxRedCandlePct = redPct;
              if (redPct >= 1.5) isTrap2 = true;
            }
          }

          if (!isTrap1 && !isTrap2) {
            inTrade = true;
            entryPrice = c.close * (1 + slipRate);
            entryIdx = i;
            stopLossPrice = entryPrice * 0.99; // exact 1% SL

            tradeMeta = {
              symbol: sym,
              entryTime: c.time,
              entryIdx: i,
              entryPrice,
              stopLossPrice,
              minRSI,
              reentryRSI: curRSI,
              oversoldDuration,
              rsiAboveYellow: curRSI > rsiSMA14[i],
              rsiMinusYellow: curRSI - rsiSMA14[i],
              aboveEMA50: c.close > ema50[i],
              aboveEMA200: c.close > ema200[i],
              ema9Above21: ema9[i] > ema21[i],
              emaTrendScore: (c.close > ema9[i] ? 1 : 0) + (c.close > ema21[i] ? 1 : 0) + (c.close > ema50[i] ? 1 : 0) + (c.close > ema200[i] ? 1 : 0),
              volumeRatio: volSMA20[i] > 0 ? c.volume / volSMA20[i] : 1,
              candleBodyPct: ((c.close - c.open) / (c.high - c.low || 1)) * 100,
              atrPct: (atr14[i] / c.close) * 100,
              maxRedCandlePct
            };
          }
        }
        inOversold = false;
        minRSI = 100;
        dipLowestPrice = Infinity;
        oversoldDuration = 0;
      }
    } else {
      let exitPrice = null;
      let exitReason = '';

      if (c.low <= stopLossPrice) {
        exitPrice = stopLossPrice * (1 - slipRate);
        exitReason = 'STOP_LOSS';
        cooldownUntilIdx = i + 8; // 2 hour cooldown
      } else if (curRSI >= 50) {
        exitPrice = c.close * (1 - slipRate);
        exitReason = 'RSI_50_REACHED';
      } else if (i - entryIdx >= 32) {
        exitPrice = c.close * (1 - slipRate);
        exitReason = 'TIME_EXIT_8H';
      }

      if (exitPrice !== null) {
        const gross = ((exitPrice - entryPrice) / entryPrice) * 100;
        const net = gross - (feeRate * 2 * 100) - (slipRate * 100);
        allTrades.push({
          ...tradeMeta,
          exitTime: c.time,
          barsHeld: i - entryIdx,
          exitPrice,
          exitReason,
          grossPct: gross,
          netPct: net,
          isWin: net > 0
        });
        inTrade = false;
      }
    }
  }
}

console.log(`Total Baseline Trades logged: ${allTrades.length}`);
const wins = allTrades.filter(t => t.isWin);
const losses = allTrades.filter(t => !t.isWin);

console.log(`Wins: ${wins.length} (${((wins.length / allTrades.length) * 100).toFixed(1)}%), Losses: ${losses.length}`);

// Let's do statistical breakdown of Wins vs Losses
function getStats(arr, key) {
  const vals = arr.map(x => x[key]).filter(v => typeof v === 'number' && !isNaN(v)).sort((a, b) => a - b);
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  const median = vals[Math.floor(vals.length / 2)];
  return { avg: avg.toFixed(2), median: median.toFixed(2) };
}

console.log('\n--- FACTOR ANALYSIS: WINS vs LOSSES ---');
const factors = [
  'minRSI',
  'reentryRSI',
  'oversoldDuration',
  'rsiMinusYellow',
  'volumeRatio',
  'candleBodyPct',
  'atrPct',
  'maxRedCandlePct'
];

const factorReport = factors.map(f => ({
  Factor: f,
  'Wins Avg': getStats(wins, f).avg,
  'Wins Median': getStats(wins, f).median,
  'Losses Avg': getStats(losses, f).avg,
  'Losses Median': getStats(losses, f).median
}));
console.table(factorReport);

// Boolean factors
const boolFactors = [
  'rsiAboveYellow',
  'aboveEMA50',
  'aboveEMA200',
  'ema9Above21'
];
const boolReport = boolFactors.map(f => {
  const winTrue = wins.filter(t => t[f]).length / wins.length * 100;
  const lossTrue = losses.filter(t => t[f]).length / losses.length * 100;
  // Win rate when factor is true
  const allTrue = allTrades.filter(t => t[f]);
  const winRateWhenTrue = (allTrue.filter(t => t.isWin).length / allTrue.length) * 100;
  return {
    Factor: f,
    '% in Wins': winTrue.toFixed(1) + '%',
    '% in Losses': lossTrue.toFixed(1) + '%',
    'Trades When True': allTrue.length,
    'Win Rate When True': winRateWhenTrue.toFixed(1) + '%'
  };
});
console.table(boolReport);

// What about Symbol breakdown? Which symbols have the highest win rate?
const symStats = {};
for (const t of allTrades) {
  if (!symStats[t.symbol]) symStats[t.symbol] = { trades: 0, wins: 0, net: 0 };
  symStats[t.symbol].trades++;
  if (t.isWin) symStats[t.symbol].wins++;
  symStats[t.symbol].net += t.netPct;
}
const topSymbols = Object.entries(symStats)
  .map(([sym, st]) => ({
    symbol: sym,
    trades: st.trades,
    winRate: ((st.wins / st.trades) * 100).toFixed(1) + '%',
    netPct: ((st.net || 0)).toFixed(1) + '%'
  }))
  .sort((a, b) => parseFloat(b.winRate) - parseFloat(a.winRate));

console.log('\nTop 15 Altcoins by Win Rate:');
console.table(topSymbols.slice(0, 15));

console.log('\nBottom 15 Altcoins by Win Rate:');
console.table(topSymbols.slice(-15));

// STOP LOSS & EXIT SENSITIVITY TEST
console.log('\n--- STOP LOSS SENSITIVITY TEST (Trap 1 & 2 Filtered, 2h Cooldown) ---');
const slTests = [0.8, 1.0, 1.2, 1.5, 2.0, 2.5, 3.0];
const slReport = [];

for (const slPct of slTests) {
  let tCount = 0, wCount = 0, lCount = 0, netSum = 0, wSum = 0, lSum = 0;

  for (const sym of symbols) {
    const { candles, tech } = symData[sym];
    const { rsi14 } = tech;

    let inOversold = false;
    let minRSI = 100;
    let inTrade = false;
    let entryPrice = 0;
    let entryIdx = 0;
    let stopLossPrice = 0;
    let cooldownUntilIdx = -1;

    for (let i = 35; i < candles.length - 1; i++) {
      const c = candles[i];
      const curRSI = rsi14[i];
      const prevRSI = rsi14[i - 1];

      if (i < cooldownUntilIdx) continue;

      if (!inTrade) {
        if (curRSI < 35) {
          inOversold = true;
          if (curRSI < minRSI) minRSI = curRSI;
        } else if (inOversold && prevRSI < 35 && curRSI >= 35) {
          if (minRSI <= 32 && c.close >= c.open) {
            // Trap 1: compression
            let smallCount = 0;
            for (let k = 1; k <= 24; k++) {
              if (((candles[i - k].high - candles[i - k].low) / candles[i - k].close) * 100 < 0.35) smallCount++;
            }
            if (smallCount / 24 >= 0.60) {
              inOversold = false; minRSI = 100; continue;
            }

            // Trap 2: giant red dump >= 1.5%
            let isTrap2 = false;
            for (let k = 1; k <= 4; k++) {
              const pb = candles[i - k];
              if (pb.close < pb.open && ((pb.open - pb.close) / pb.open) * 100 >= 1.5) { isTrap2 = true; break; }
            }
            if (isTrap2) {
              inOversold = false; minRSI = 100; continue;
            }

            inTrade = true;
            entryPrice = c.close * (1 + slipRate);
            entryIdx = i;
            stopLossPrice = entryPrice * (1 - slPct / 100);
          }
          inOversold = false; minRSI = 100;
        }
      } else {
        let exitPrice = null;
        if (c.low <= stopLossPrice) {
          exitPrice = stopLossPrice * (1 - slipRate);
          cooldownUntilIdx = i + 8;
        } else if (curRSI >= 50) {
          exitPrice = c.close * (1 - slipRate);
        } else if (i - entryIdx >= 32) {
          exitPrice = c.close * (1 - slipRate);
        }

        if (exitPrice !== null) {
          const gross = ((exitPrice - entryPrice) / entryPrice) * 100;
          const net = gross - (feeRate * 2 * 100) - (slipRate * 100);
          tCount++;
          if (net > 0) {
            wCount++;
            wSum += net;
          } else {
            lCount++;
            lSum += net;
          }
          netSum += net;
          inTrade = false;
        }
      }
    }
  }

  slReport.push({
    'Stop Loss': `${slPct}%`,
    Trades: tCount,
    Wins: wCount,
    Losses: lCount,
    'Win Rate': ((wCount / tCount) * 100).toFixed(1) + '%',
    'Avg Win': '+' + (wSum / wCount).toFixed(2) + '%',
    'Avg Loss': (lSum / lCount).toFixed(2) + '%',
    'Avg Net/Trade': (netSum / tCount).toFixed(2) + '%',
    'Total Net': (netSum >= 0 ? '+' : '') + netSum.toFixed(1) + '%'
  });
}
console.table(slReport);


