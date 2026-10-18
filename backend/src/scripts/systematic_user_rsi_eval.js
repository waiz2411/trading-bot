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
        close: Number(c.close || c[4])
      })).filter(c => c.openTime >= 1767225600000 && !isNaN(c.close));

      parsed.sort((a, b) => a.openTime - b.openTime);
      if (parsed.length > 2000) datasets[sym] = parsed;
    }
  } catch (_) {}
}

const symbols = Object.keys(datasets);

function resampleTo4H(c15m) {
  const buckets = new Map();
  for (const c of c15m) {
    const b = c.openTime - (c.openTime % (4 * 3600 * 1000));
    let group = buckets.get(b);
    if (!group) { group = []; buckets.set(b, group); }
    group.push(c);
  }
  const c4h = [];
  for (const [openTime, slice] of buckets.entries()) {
    c4h.push({
      openTime,
      close: slice[slice.length - 1].close
    });
  }
  c4h.sort((a, b) => a.openTime - b.openTime);
  return c4h;
}

function calculateIndicators(candles) {
  const len = candles.length;
  const closes = candles.map(c => c.close);
  const ema21 = new Float64Array(len);
  const ema50 = new Float64Array(len);
  const rsi14 = new Float64Array(len);
  const rsiSMA14 = new Float64Array(len);

  const k21 = 2 / 22, k50 = 2 / 51;
  let e21 = closes[0], e50 = closes[0];
  for (let i = 0; i < len; i++) {
    const cl = closes[i];
    e21 = i === 0 ? cl : cl * k21 + e21 * (1 - k21);
    e50 = i === 0 ? cl : cl * k50 + e50 * (1 - k50);
    ema21[i] = e21; ema50[i] = e50;
  }

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
    let sum = 0;
    for (let j = 0; j < 14; j++) sum += rsi14[i - j];
    rsiSMA14[i] = sum / 14;
  }

  return { ema21, ema50, rsi14, rsiSMA14 };
}

const sym15m = {};
const sym4h = {};

for (const sym of symbols) {
  const c15 = datasets[sym];
  sym15m[sym] = { candles: c15, tech: calculateIndicators(c15), timeMap: new Map() };
  c15.forEach((c, i) => sym15m[sym].timeMap.set(c.openTime, i));

  const c4 = resampleTo4H(c15);
  sym4h[sym] = { candles: c4, tech: calculateIndicators(c4), timeMap: new Map() };
  c4.forEach((c, i) => sym4h[sym].timeMap.set(c.openTime, i));
}

const feeRate = 0.0010;
const slipRate = 0.0003;

function evaluateSetup(opts) {
  let trades = 0, wins = 0, losses = 0;
  let totalNetReturn = 0;
  let winSum = 0, lossSum = 0;

  for (const sym of symbols) {
    const s15 = sym15m[sym];
    const s4 = sym4h[sym];
    const c15 = s15.candles;
    const rsi = s15.tech.rsi14;
    const rsiMA = s15.tech.rsiSMA14;
    const ema50 = s15.tech.ema50;

    let inTrade = false;
    let entryPrice = 0;
    let entryIdx = 0;
    let stopLossPrice = 0;
    let dipLowest = Infinity;

    for (let i = 50; i < c15.length; i++) {
      const c = c15[i];
      const curRSI = rsi[i];
      const prevRSI = rsi[i - 1];

      if (!inTrade) {
        if (curRSI < 35) {
          if (c.low < dipLowest) dipLowest = c.low;
        }

        // Re-entry condition
        const reentered = prevRSI < 35 && curRSI >= 35;
        if (!reentered) continue;

        // Optional Filters
        if (opts.requireAboveEMA50 && c.close < ema50[i]) continue;
        if (opts.requireRSIAfterYellow && curRSI < rsiMA[i]) continue;
        if (opts.require4HBull) {
          const fourHourBucket = (c.openTime - (c.openTime % (4 * 3600 * 1000))) - (4 * 3600 * 1000);
          const c4Idx = s4.timeMap.get(fourHourBucket);
          if (c4Idx === undefined || c4Idx < 50) continue;
          if (s4.tech.ema21[c4Idx] <= s4.tech.ema50[c4Idx] || s4.candles[c4Idx].close <= s4.tech.ema50[c4Idx]) continue;
        }

        inTrade = true;
        entryPrice = c.close * (1 + slipRate);
        entryIdx = i;

        if (opts.slType === 'swing_low' && dipLowest < entryPrice) {
          stopLossPrice = dipLowest * 0.997; // 0.3% below dip low
        } else {
          stopLossPrice = entryPrice * (1 - opts.slPct / 100);
        }
        dipLowest = Infinity;
      } else {
        let exitPrice = null;

        // Check SL
        if (c.low <= stopLossPrice) {
          exitPrice = stopLossPrice * (1 - slipRate);
        }
        // Check Exit Condition
        else if (opts.exitType === 'rsi_50' && curRSI >= 50) {
          exitPrice = c.close * (1 - slipRate);
        }
        else if (opts.exitType === 'rsi_50_or_profit_trail') {
          // If RSI reaches 50, only exit if net positive, else trail or hold
          if (curRSI >= 50 && c.close > entryPrice * 1.005) {
            exitPrice = c.close * (1 - slipRate);
          }
        }
        else if (opts.exitType === 'fixed_tp' && c.high >= entryPrice * (1 + opts.tpPct / 100)) {
          exitPrice = entryPrice * (1 + opts.tpPct / 100) * (1 - slipRate);
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
            winSum += net;
          } else {
            losses++;
            lossSum += net;
          }
          totalNetReturn += net;
          inTrade = false;
        }
      }
    }
  }

  const winRate = trades > 0 ? (wins / trades) * 100 : 0;
  const avgWin = wins > 0 ? winSum / wins : 0;
  const avgLoss = losses > 0 ? lossSum / losses : 0;
  const avgNet = trades > 0 ? totalNetReturn / trades : 0;

  return {
    name: opts.name,
    trades,
    wins,
    losses,
    winRate: winRate.toFixed(1) + '%',
    avgWin: '+' + avgWin.toFixed(2) + '%',
    avgLoss: avgLoss.toFixed(2) + '%',
    avgNet: (avgNet >= 0 ? '+' : '') + avgNet.toFixed(2) + '%',
    totalNetROI: (totalNetReturn >= 0 ? '+' : '') + totalNetReturn.toFixed(1) + '%'
  };
}

const tests = [
  { name: '1. Exact User Baseline: RSI 35->50, SL 2.0%', exitType: 'rsi_50', slType: 'fixed', slPct: 2.0 },
  { name: '2. User Setup with Swing Low SL', exitType: 'rsi_50', slType: 'swing_low', slPct: 2.0 },
  { name: '3. User Setup + 15m Price > EMA 50', exitType: 'rsi_50', slType: 'fixed', slPct: 1.5, requireAboveEMA50: true },
  { name: '4. User Setup + 4H Bull Trend', exitType: 'rsi_50', slType: 'fixed', slPct: 2.0, require4HBull: true },
  { name: '5. User Setup + RSI > Yellow MA', exitType: 'rsi_50', slType: 'fixed', slPct: 2.0, requireRSIAfterYellow: true },
  { name: '6. User Setup + 4H Bull + RSI 50 Exit only if in profit', exitType: 'rsi_50_or_profit_trail', slType: 'fixed', slPct: 2.0, require4HBull: true },
  { name: '7. User Setup + 4H Bull + Fixed 1.5% TP (instead of early RSI 50 exit)', exitType: 'fixed_tp', tpPct: 1.5, slType: 'fixed', slPct: 2.0, require4HBull: true },
  { name: '8. User Setup + 4H Bull + Fixed 2.5% TP', exitType: 'fixed_tp', tpPct: 2.5, slType: 'fixed', slPct: 2.0, require4HBull: true },
  { name: '9. User Setup + 4H Bull + Fixed 3.5% TP', exitType: 'fixed_tp', tpPct: 3.5, slType: 'fixed', slPct: 2.0, require4HBull: true }
];

const results = tests.map(evaluateSetup);
console.table(results);
