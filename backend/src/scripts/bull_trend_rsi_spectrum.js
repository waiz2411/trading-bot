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

function calculateEMA(closes, p) {
  const ema = new Float64Array(closes.length);
  const k = 2 / (p + 1);
  let e = closes[0];
  for (let i = 0; i < closes.length; i++) {
    e = i === 0 ? closes[i] : closes[i] * k + e * (1 - k);
    ema[i] = e;
  }
  return ema;
}

function calculateIndicators(candles) {
  const len = candles.length;
  const closes = candles.map(c => c.close);
  const rsi14 = new Float64Array(len);
  const rsiSMA14 = new Float64Array(len);
  const ema200 = calculateEMA(closes, 200);

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

  return { rsi14, rsiSMA14, ema200 };
}

const feeRate = 0.0010;
const slipRate = 0.0003;

// Let's test a spectrum of Bull Trend filters to see how to scale to 70%-80% win rate across more trades
const variations = [
  { name: '1. Strict: minRSI<=30, bars<=2, Yellow, Close>EMA200, SL 2%', maxMinRSI: 30, maxBars: 2, yellow: true, slPct: 2.0 },
  { name: '2. Strict: minRSI<=30, bars<=2, Yellow, Close>EMA200, SL 2.5%', maxMinRSI: 30, maxBars: 2, yellow: true, slPct: 2.5 },
  { name: '3. Expanded: minRSI<=31, bars<=3, Yellow, Close>EMA200, SL 2.5%', maxMinRSI: 31, maxBars: 3, yellow: true, slPct: 2.5 },
  { name: '4. Expanded: minRSI<=31, bars<=3, Yellow, Close>EMA200, SL 3.0%', maxMinRSI: 31, maxBars: 3, yellow: true, slPct: 3.0 },
  { name: '5. Wider: minRSI<=32, bars<=3, Yellow, Close>EMA200, SL 2.5%', maxMinRSI: 32, maxBars: 3, yellow: true, slPct: 2.5 },
  { name: '6. Wider: minRSI<=32, bars<=3, Yellow, Close>EMA200, SL 3.0%', maxMinRSI: 32, maxBars: 3, yellow: true, slPct: 3.0 },
  { name: '7. Ultra-Safe: Swing Low SL (max 2.5%) + minRSI<=31, bars<=3', maxMinRSI: 31, maxBars: 3, yellow: true, slType: 'SWING_LOW', slPct: 2.5 }
];

const report = [];

for (const v of variations) {
  let trades = 0, wins = 0, losses = 0, winSum = 0, lossSum = 0, totalNet = 0;
  const coinStats = {};

  for (const sym of symbols) {
    const candles = datasets[sym];
    const { rsi14, rsiSMA14, ema200 } = calculateIndicators(candles);

    let inOversold = false;
    let minRSI = 100;
    let dipLowestPrice = Infinity;
    let barsInOversold = 0;
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
          barsInOversold++;
          if (curRSI < minRSI) minRSI = curRSI;
          if (c.low < dipLowestPrice) dipLowestPrice = c.low;
        } else if (inOversold && prevRSI < 35 && curRSI >= 35) {
          if (minRSI <= v.maxMinRSI && c.close >= c.open) {
            // Trap 1: Compression
            let smallCount = 0;
            for (let k = 1; k <= 24; k++) {
              if (((candles[i - k].high - candles[i - k].low) / candles[i - k].close) * 100 < 0.35) smallCount++;
            }
            if (smallCount / 24 >= 0.60) {
              inOversold = false; minRSI = 100; dipLowestPrice = Infinity; barsInOversold = 0; continue;
            }

            // Trap 2: Giant red dump >= 1.5%
            let giantRed = false;
            for (let k = 1; k <= 4; k++) {
              const pb = candles[i - k];
              if (pb.close < pb.open && ((pb.open - pb.close) / pb.open) * 100 >= 1.5) { giantRed = true; break; }
            }
            if (giantRed) {
              inOversold = false; minRSI = 100; dipLowestPrice = Infinity; barsInOversold = 0; continue;
            }

            // V-Shape: Max bars below 35
            if (barsInOversold > v.maxBars) {
              inOversold = false; minRSI = 100; dipLowestPrice = Infinity; barsInOversold = 0; continue;
            }

            // Purple RSI > Yellow SMA 14
            if (v.yellow && curRSI <= rsiSMA14[i]) {
              inOversold = false; minRSI = 100; dipLowestPrice = Infinity; barsInOversold = 0; continue;
            }

            // Bull Trend: Close > EMA 200
            if (c.close <= ema200[i]) {
              inOversold = false; minRSI = 100; dipLowestPrice = Infinity; barsInOversold = 0; continue;
            }

            // Enter Trade
            inTrade = true;
            entryPrice = c.close * (1 + slipRate);
            entryIdx = i;

            if (v.slType === 'SWING_LOW') {
              const swingSL = dipLowestPrice * 0.998;
              const maxSL = entryPrice * (1 - v.slPct / 100);
              stopLossPrice = Math.max(swingSL, maxSL);
            } else {
              stopLossPrice = entryPrice * (1 - v.slPct / 100);
            }
          }

          inOversold = false;
          minRSI = 100;
          dipLowestPrice = Infinity;
          barsInOversold = 0;
        }
      } else {
        let exitPrice = null;

        if (c.low <= stopLossPrice) {
          exitPrice = stopLossPrice * (1 - slipRate);
          cooldownUntilIdx = i + 8; // 2 hour cooldown on SL
        } else if (curRSI >= 50) {
          exitPrice = c.close * (1 - slipRate);
        } else if (i - entryIdx >= 32) {
          exitPrice = c.close * (1 - slipRate);
        }

        if (exitPrice !== null) {
          const gross = ((exitPrice - entryPrice) / entryPrice) * 100;
          const net = gross - 0.23;

          trades++;
          if (net > 0) {
            wins++;
            winSum += net;
          } else {
            losses++;
            lossSum += net;
          }
          totalNet += net;

          if (!coinStats[sym]) coinStats[sym] = { wins: 0, trades: 0 };
          coinStats[sym].trades++;
          if (net > 0) coinStats[sym].wins++;

          inTrade = false;
        }
      }
    }
  }

  const winRate = trades > 0 ? (wins / trades) * 100 : 0;
  const avgWin = wins > 0 ? winSum / wins : 0;
  const avgLoss = losses > 0 ? lossSum / losses : 0;
  const avgNet = trades > 0 ? totalNet / trades : 0;

  report.push({
    Configuration: v.name,
    Trades: trades,
    Wins: wins,
    Losses: losses,
    'Win Rate': winRate.toFixed(1) + '%',
    'Avg Win': '+' + avgWin.toFixed(2) + '%',
    'Avg Loss': avgLoss.toFixed(2) + '%',
    'Avg Net/Trade': (avgNet >= 0 ? '+' : '') + avgNet.toFixed(2) + '%',
    'Total Net': (totalNet >= 0 ? '+' : '') + totalNet.toFixed(1) + '%'
  });
}

console.table(report);
