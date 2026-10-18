import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cacheDir = path.resolve(__dirname, '../data/binance_cache');

console.log('--- TESTING MULTI-TIMEFRAME CONFLUENCE: 1H RSI OVERSOLD + 15M ENTRY TRIGGER ---');

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

const symData = {};

for (const sym of symbols) {
  const c15 = rawDatasets[sym];
  const rsi15 = calculateRSI14(c15);

  const c1h = resampleCandles(c15, 60);
  const rsi1h = calculateRSI14(c1h);
  const map1h = new Map();
  c1h.forEach((c, idx) => map1h.set(c.openTime, idx));

  symData[sym] = { c15, rsi15, c1h, rsi1h, map1h };
}

const feeRate = 0.0010;
const slipRate = 0.0003;

// Experiments:
// 1. Baseline 15m (15m RSI < 30 re-entry, 15m RSI 50 exit, 1.2% SL)
// 2. MTF Confluence A: 1H RSI < 38 + 15m RSI < 30 re-entry (1.2% SL, Exit at 15m RSI 50)
// 3. MTF Confluence B: 1H RSI < 35 + 15m RSI < 30 re-entry (1.5% SL, Exit at 15m RSI 50)
// 4. MTF Confluence C: 1H RSI < 35 + 15m RSI < 30 re-entry (1.5% SL, Exit at 15m RSI 55)
// 5. MTF Confluence D: 1H RSI < 35 + 15m RSI < 30 re-entry (1.5% SL, Exit at 1H RSI 50!)
// 6. MTF Confluence E: 1H RSI < 35 + 15m RSI < 30 re-entry (1.5% SL, Fixed +2.5% TP)
// 7. MTF Confluence F: 1H RSI < 35 + 15m RSI < 30 re-entry (1.5% SL, Fixed +3.0% TP)
// 8. MTF Confluence G: 1H RSI < 35 + 15m RSI < 30 re-entry (2.0% SL, Fixed +3.5% TP)

const tests = [
  { name: '1. Baseline 15m (No 1H filter, 1.2% SL, Exit 15m RSI 50)', req1hRSI: 100, slPct: 1.2, exitType: '15m_50' },
  { name: '2. MTF Confluence A: 1H RSI < 38 (1.2% SL, Exit 15m RSI 50)', req1hRSI: 38, slPct: 1.2, exitType: '15m_50' },
  { name: '3. MTF Confluence B: 1H RSI < 35 (1.5% SL, Exit 15m RSI 50)', req1hRSI: 35, slPct: 1.5, exitType: '15m_50' },
  { name: '4. MTF Confluence C: 1H RSI < 35 (1.5% SL, Exit 15m RSI 55)', req1hRSI: 35, slPct: 1.5, exitType: '15m_55' },
  { name: '5. MTF Confluence D: 1H RSI < 35 (1.5% SL, Exit 1H RSI 50)', req1hRSI: 35, slPct: 1.5, exitType: '1h_50' },
  { name: '6. MTF Confluence E: 1H RSI < 35 (1.5% SL, Fixed +2.5% TP)', req1hRSI: 35, slPct: 1.5, exitType: 'TP_2.5' },
  { name: '7. MTF Confluence F: 1H RSI < 35 (1.5% SL, Fixed +3.0% TP)', req1hRSI: 35, slPct: 1.5, exitType: 'TP_3.0' },
  { name: '8. MTF Confluence G: 1H RSI < 35 (2.0% SL, Fixed +3.5% TP)', req1hRSI: 35, slPct: 2.0, exitType: 'TP_3.5' },
  { name: '9. MTF Confluence H: 1H RSI < 32 (2.0% SL, Fixed +3.0% TP)', req1hRSI: 32, slPct: 2.0, exitType: 'TP_3.0' }
];

const results = [];

for (const t of tests) {
  let trades = 0, wins = 0, losses = 0, winSum = 0, lossSum = 0, totalNet = 0;

  for (const sym of symbols) {
    const { c15, rsi15, c1h, rsi1h, map1h } = symData[sym];

    let inOversold = false;
    let minRSI = 100;
    let inTrade = false;
    let entryPrice = 0;
    let entryIdx = 0;
    let stopLossPrice = 0;
    let cooldownUntil = -1;

    for (let i = 35; i < c15.length - 1; i++) {
      const c = c15[i];
      const curRSI = rsi15[i];
      const prevRSI = rsi15[i - 1];

      if (i < cooldownUntil) continue;

      // Find corresponding 1H candle (completed prior 1H bar)
      const b1 = (c.openTime - (c.openTime % (3600 * 1000))) - (3600 * 1000);
      const idx1h = map1h.get(b1);
      const cur1hRSI = idx1h !== undefined ? rsi1h[idx1h] : 50;

      if (!inTrade) {
        if (curRSI < 30) {
          inOversold = true;
          if (curRSI < minRSI) minRSI = curRSI;
        } else if (inOversold && prevRSI < 30 && curRSI >= 30) {
          if (c.close >= c.open && cur1hRSI < t.req1hRSI) {
            inTrade = true;
            entryPrice = c.close * (1 + slipRate);
            entryIdx = i;
            stopLossPrice = entryPrice * (1 - t.slPct / 100);
          }
          inOversold = false;
          minRSI = 100;
        }
      } else {
        let exitPrice = null;

        // Check SL
        if (c.low <= stopLossPrice) {
          exitPrice = stopLossPrice * (1 - slipRate);
          cooldownUntil = i + 6;
        }
        // Exits
        else if (t.exitType === '15m_50' && curRSI >= 50) {
          exitPrice = c.close * (1 - slipRate);
        } else if (t.exitType === '15m_55' && curRSI >= 55) {
          exitPrice = c.close * (1 - slipRate);
        } else if (t.exitType === '1h_50' && cur1hRSI >= 50) {
          exitPrice = c.close * (1 - slipRate);
        } else if (t.exitType === 'TP_2.5' && c.high >= entryPrice * 1.025) {
          exitPrice = entryPrice * 1.025 * (1 - slipRate);
        } else if (t.exitType === 'TP_3.0' && c.high >= entryPrice * 1.030) {
          exitPrice = entryPrice * 1.030 * (1 - slipRate);
        } else if (t.exitType === 'TP_3.5' && c.high >= entryPrice * 1.035) {
          exitPrice = entryPrice * 1.035 * (1 - slipRate);
        } else if (i - entryIdx >= 32) {
          exitPrice = c.close * (1 - slipRate);
        }

        if (exitPrice !== null) {
          const gross = ((exitPrice - entryPrice) / entryPrice) * 100;
          const net = gross - 0.23;

          trades++;
          if (net > 0) { wins++; winSum += net; } else { losses++; lossSum += net; }
          totalNet += net;
          inTrade = false;
        }
      }
    }
  }

  const winRate = trades > 0 ? (wins / trades) * 100 : 0;
  const avgWin = wins > 0 ? winSum / wins : 0;
  const avgLoss = losses > 0 ? lossSum / losses : 0;
  const avgNet = trades > 0 ? totalNet / trades : 0;
  const daily = (trades / 289).toFixed(1);
  const profitFactor = Math.abs(lossSum) > 0 ? Math.abs(winSum / lossSum) : 999;

  results.push({
    Strategy: t.name,
    Trades: trades,
    'Trades/Day': daily,
    Wins: wins,
    Losses: losses,
    'Win Rate': winRate.toFixed(1) + '%',
    'Avg Win': '+' + avgWin.toFixed(2) + '%',
    'Avg Loss': avgLoss.toFixed(2) + '%',
    'Reward:Risk': avgLoss !== 0 ? (avgWin / Math.abs(avgLoss)).toFixed(2) : 'N/A',
    'Profit Factor': profitFactor.toFixed(2),
    'Avg Net/Trade': (avgNet >= 0 ? '+' : '') + avgNet.toFixed(2) + '%',
    'Total Net Gain': (totalNet >= 0 ? '+' : '') + totalNet.toFixed(1) + '%'
  });
}

console.log('\n====================================================================================================================================');
console.log('   MULTI-TIMEFRAME CONFLUENCE BREAKTHROUGH MATRIX (1H MACRO DIP + 15M ENTRY TRIGGER)');
console.log('====================================================================================================================================\n');
console.table(results);
