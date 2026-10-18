import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';

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
      time: new Date(openTime).toISOString(),
      open: slice[0].open,
      high: Math.max(...slice.map(c => c.high)),
      low: Math.min(...slice.map(c => c.low)),
      close: slice[slice.length - 1].close,
      volume: slice.reduce((acc, c) => acc + c.volume, 0)
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

  // RSI-based MA (Yellow line: 14 SMA of RSI)
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

// Configurations to test
const configs = [
  { name: '1. Pure Raw RSI 35->50 (No Filter, SL 2.0%)', slPct: 2.0, filterTrend: false, filterRSIMA: false },
  { name: '2. Raw RSI 35->50 + RSI MA Yellow Cross (SL 2.0%)', slPct: 2.0, filterTrend: false, filterRSIMA: true },
  { name: '3. RSI 35->50 + 4H Bull Trend (SL 2.0%)', slPct: 2.0, filterTrend: true, filterRSIMA: false },
  { name: '4. RSI 35->50 + 4H Bull Trend + Yellow MA Cross (SL 2.0%)', slPct: 2.0, filterTrend: true, filterRSIMA: true },
  { name: '5. RSI 35->50 + 4H Bull Trend (SL 1.5% Tight)', slPct: 1.5, filterTrend: true, filterRSIMA: false },
  { name: '6. RSI 35->50 + 4H Bull Trend (SL 1.2% Tight)', slPct: 1.2, filterTrend: true, filterRSIMA: false },
  { name: '7. RSI 35->50 + 4H Bull Trend (SL 2.5% Wide)', slPct: 2.5, filterTrend: true, filterRSIMA: false },
  { name: '8. RSI 35->50 + 4H Bull + Break-Even at +0.6% (SL 1.5%)', slPct: 1.5, filterTrend: true, filterRSIMA: false, beTrigger: 0.6, beLock: 0.15 }
];

const summary = [];

for (const cfg of configs) {
  let trades = 0;
  let wins = 0;
  let losses = 0;
  let grossSum = 0;
  let netSum = 0;
  let winReturns = [];
  let lossReturns = [];

  for (const sym of symbols) {
    const s15 = sym15m[sym];
    const s4 = sym4h[sym];
    const c15 = s15.candles;
    const rsi = s15.tech.rsi14;
    const rsiMA = s15.tech.rsiSMA14;

    let inTrade = false;
    let entryPrice = 0;
    let entryIdx = 0;
    let stopLossPrice = 0;
    let peakPrice = 0;
    let slAdjusted = false;

    for (let i = 50; i < c15.length; i++) {
      const c = c15[i];
      const curRSI = rsi[i];
      const prevRSI = rsi[i - 1];

      if (!inTrade) {
        // Entry Trigger: Purple line re-enters 35 from below
        const reentered35 = prevRSI < 35 && curRSI >= 35;
        if (!reentered35) continue;

        // RSI MA filter (purple above yellow)
        if (cfg.filterRSIMA && curRSI < rsiMA[i]) continue;

        // 4H Trend filter
        if (cfg.filterTrend) {
          const fourHourBucket = (c.openTime - (c.openTime % (4 * 3600 * 1000))) - (4 * 3600 * 1000);
          const c4Idx = s4.timeMap.get(fourHourBucket);
          if (c4Idx === undefined || c4Idx < 50) continue;
          const is4hBull = s4.tech.ema21[c4Idx] > s4.tech.ema50[c4Idx] && s4.candles[c4Idx].close > s4.tech.ema50[c4Idx];
          if (!is4hBull) continue;
        }

        inTrade = true;
        entryPrice = c.close * (1 + slipRate);
        entryIdx = i;
        stopLossPrice = entryPrice * (1 - cfg.slPct / 100);
        peakPrice = entryPrice;
        slAdjusted = false;
      } else {
        // In trade
        if (c.high > peakPrice) peakPrice = c.high;
        const peakGain = ((peakPrice - entryPrice) / entryPrice) * 100;

        // Break-even adjustment
        if (cfg.beTrigger && peakGain >= cfg.beTrigger && !slAdjusted) {
          const beStop = entryPrice * (1 + cfg.beLock / 100);
          if (beStop > stopLossPrice) {
            stopLossPrice = beStop;
            slAdjusted = true;
          }
        }

        let exitPrice = null;

        // Check SL
        if (c.low <= stopLossPrice) {
          exitPrice = stopLossPrice * (1 - slipRate);
        }
        // Check Take Profit at RSI 50
        else if (curRSI >= 50) {
          exitPrice = c.close * (1 - slipRate);
        }
        // Safety timeout after 32 bars (8 hours)
        else if (i - entryIdx >= 32) {
          exitPrice = c.close * (1 - slipRate);
        }

        if (exitPrice !== null) {
          const grossPct = ((exitPrice - entryPrice) / entryPrice) * 100;
          const netPct = grossPct - (feeRate * 2 * 100) - (slipRate * 100);

          trades++;
          if (netPct > 0) {
            wins++;
            winReturns.push(netPct);
          } else {
            losses++;
            lossReturns.push(netPct);
          }
          grossSum += grossPct;
          netSum += netPct;
          inTrade = false;
        }
      }
    }
  }

  const winRate = trades > 0 ? (wins / trades) * 100 : 0;
  const avgWin = winReturns.length ? (winReturns.reduce((a, b) => a + b, 0) / winReturns.length) : 0;
  const avgLoss = lossReturns.length ? (lossReturns.reduce((a, b) => a + b, 0) / lossReturns.length) : 0;
  const avgNet = trades > 0 ? netSum / trades : 0;

  summary.push({
    Config: cfg.name,
    Trades: trades,
    Wins: wins,
    Losses: losses,
    'Win Rate': winRate.toFixed(1) + '%',
    'Avg Win': '+' + avgWin.toFixed(2) + '%',
    'Avg Loss': avgLoss.toFixed(2) + '%',
    'Avg Trade Net': (avgNet >= 0 ? '+' : '') + avgNet.toFixed(2) + '%',
    'Total Net ROI': (netSum >= 0 ? '+' : '') + netSum.toFixed(1) + '%'
  });
}

console.log('\n========================================================================');
console.log('   DEEP DIVE: USER TRADINGVIEW RSI 35 RE-ENTRY -> 50 MIDLINE EXIT');
console.log('========================================================================\n');
console.table(summary);
