import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cacheDir = path.resolve(__dirname, '../data/binance_cache');

console.log('Loading 2026 Binance 15m candles for Forensic Trap Analysis...');
const files = fs.readdirSync(cacheDir).filter(f => f.endsWith('.json'));
const datasets = {};

for (const file of files) {
  const sym = file.split('_')[0];
  if (sym === 'PAXGUSDT' || sym === 'FDUSDUSDT' || sym === 'USDCUSDT') continue;
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
console.log(`Loaded ${symbols.length} altcoins + BTCUSDT.`);

function resampleTo4H(c15m) {
  const buckets = new Map();
  for (const c of c15m) {
    const b = c.openTime - (c.openTime % (4 * 3600 * 1000));
    let g = buckets.get(b);
    if (!g) { g = []; buckets.set(b, g); }
    g.push(c);
  }
  const c4h = [];
  for (const [openTime, slice] of buckets.entries()) {
    c4h.push({ openTime, close: slice[slice.length - 1].close });
  }
  c4h.sort((a, b) => a.openTime - b.openTime);
  return c4h;
}

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
  const volumes = candles.map(c => c.volume);
  const rsi14 = new Float64Array(len);
  const rsiSMA14 = new Float64Array(len);
  const volSMA20 = new Float64Array(len);
  const ema20 = calculateEMA(closes, 20);
  const ema50 = calculateEMA(closes, 50);

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

  // RSI Yellow SMA 14 (from user screenshot)
  for (let i = 27; i < len; i++) {
    let s = 0;
    for (let j = 0; j < 14; j++) s += rsi14[i - j];
    rsiSMA14[i] = s / 14;
  }

  // Volume SMA 20
  for (let i = 19; i < len; i++) {
    let s = 0;
    for (let j = 0; j < 20; j++) s += volumes[i - j];
    volSMA20[i] = s / 20;
  }

  return { rsi14, rsiSMA14, volSMA20, ema20, ema50 };
}

// 4H Data for Trend Filter
const sym15m = {};
const sym4h = {};

for (const sym of [...symbols, 'BTCUSDT']) {
  if (!datasets[sym]) continue;
  const c15 = datasets[sym];
  sym15m[sym] = { candles: c15, tech: calculateIndicators(c15), timeMap: new Map() };
  c15.forEach((c, idx) => sym15m[sym].timeMap.set(c.openTime, idx));

  const c4 = resampleTo4H(c15);
  const ema50 = calculateEMA(c4.map(c => c.close), 50);
  const ema21 = calculateEMA(c4.map(c => c.close), 21);
  const map4 = new Map();
  c4.forEach((c, idx) => map4.set(c.openTime, idx));
  sym4h[sym] = { candles: c4, ema21, ema50, map4 };
}

console.log('Running forensic analysis on losing vs winning trades...');

// Evaluate all potential trap filters
const trapFilters = [
  { name: '0. Baseline (Trap 1 & 2 Active, 2h Cooldown)' },
  
  // TRAP 3: Macro Bear Trap (Coin 4H Close < 4H EMA 50)
  { name: '1. + Filter Trap 3: Macro Bull Only (Coin 4H Close > 4H EMA 50)', filter4HBull: true },
  
  // TRAP 4: Bitcoin Dump Trap (BTC 15m is red and below BTC EMA 20)
  { name: '2. + Filter Trap 4: BTC Safe Market (BTC 4H Close > EMA 50)', filterBTCBull: true },
  
  // TRAP 5: Weak Bounce / Low Volume Trap (Volume must be >= 1.1x 20-period VolSMA)
  { name: '3. + Filter Trap 5: High Volume Buyer Spike (Vol >= 1.1x SMA)', filterVolumeSpike: true },
  
  // TRAP 6: Upper Wick Rejection Trap (Close must be in the upper 40% of the candle range)
  { name: '4. + Filter Trap 6: Strong Bullish Close (Upper wick <= 30% of range)', filterStrongClose: true },
  
  // TRAP 7: RSI Momentum Trap (Purple RSI line must be ABOVE Yellow RSI MA line!)
  { name: '5. + Filter Trap 7: Yellow Line Cross (Purple RSI > Yellow RSI SMA)', filterRSIAboveYellow: true },
  
  // COMBINATIONS TOWARDS 70-80% WIN RATE
  { name: '6. Combination A: Macro 4H Bull + Yellow Line Cross', filter4HBull: true, filterRSIAboveYellow: true },
  { name: '7. Combination B: Macro 4H Bull + BTC Safe + Strong Close', filter4HBull: true, filterBTCBull: true, filterStrongClose: true },
  { name: '8. Combination C: 4H Bull + BTC Safe + Yellow Cross + Vol Spike', filter4HBull: true, filterBTCBull: true, filterRSIAboveYellow: true, filterVolumeSpike: true },
  { name: '9. Master Fortress: 4H Bull + Strong Close + Yellow Cross + Vol Spike', filter4HBull: true, filterStrongClose: true, filterRSIAboveYellow: true, filterVolumeSpike: true }
];

const feeRate = 0.0010;
const slipRate = 0.0003;

const auditResults = [];

for (const tf of trapFilters) {
  let trades = 0, wins = 0, losses = 0, totalNet = 0;
  let winSum = 0, lossSum = 0;

  for (const sym of symbols) {
    const s15 = sym15m[sym];
    const s4 = sym4h[sym];
    const btc4 = sym4h['BTCUSDT'];
    const { candles, tech } = s15;
    const { rsi14, rsiSMA14, volSMA20, ema20, ema50 } = tech;

    let inOversold = false;
    let minRSI = 100;
    let dipLowestPrice = Infinity;
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
          if (c.low < dipLowestPrice) dipLowestPrice = c.low;
        } else if (inOversold && prevRSI < 35 && curRSI >= 35) {
          if (minRSI <= 32 && c.close >= c.open) {
            
            // TRAP 1 (Compression)
            let smallCount = 0;
            for (let k = 1; k <= 24; k++) {
              if (((candles[i - k].high - candles[i - k].low) / candles[i - k].close) * 100 < 0.35) smallCount++;
            }
            if (smallCount / 24 >= 0.60) {
              inOversold = false; minRSI = 100; dipLowestPrice = Infinity;
              continue;
            }

            // TRAP 2 (Giant Red Dump >= 1.5%)
            let giantRed = false;
            for (let k = 1; k <= 4; k++) {
              const pb = candles[i - k];
              if (pb.close < pb.open && ((pb.open - pb.close) / pb.open) * 100 >= 1.5) { giantRed = true; break; }
            }
            if (giantRed) {
              inOversold = false; minRSI = 100; dipLowestPrice = Infinity;
              continue;
            }

            // NEW TRAP 3: Macro 4H Bear Trap
            if (tf.filter4HBull) {
              const b4 = (c.openTime - (c.openTime % (4 * 3600 * 1000))) - (4 * 3600 * 1000);
              const idx4 = s4.map4.get(b4);
              if (idx4 === undefined || s4.candles[idx4].close <= s4.ema50[idx4]) {
                inOversold = false; minRSI = 100; dipLowestPrice = Infinity;
                continue;
              }
            }

            // NEW TRAP 4: BTC Safe Market Trap
            if (tf.filterBTCBull && btc4) {
              const b4 = (c.openTime - (c.openTime % (4 * 3600 * 1000))) - (4 * 3600 * 1000);
              const btcIdx4 = btc4.map4.get(b4);
              if (btcIdx4 === undefined || btc4.candles[btcIdx4].close <= btc4.ema50[btcIdx4]) {
                inOversold = false; minRSI = 100; dipLowestPrice = Infinity;
                continue;
              }
            }

            // NEW TRAP 5: Weak Volume Trap
            if (tf.filterVolumeSpike) {
              if (volSMA20[i] > 0 && (c.volume / volSMA20[i]) < 1.10) {
                inOversold = false; minRSI = 100; dipLowestPrice = Infinity;
                continue;
              }
            }

            // NEW TRAP 6: Upper Wick Rejection Trap
            if (tf.filterStrongClose) {
              const range = c.high - c.low;
              const upperWick = c.high - Math.max(c.open, c.close);
              if (range > 0 && (upperWick / range) > 0.30) {
                inOversold = false; minRSI = 100; dipLowestPrice = Infinity;
                continue;
              }
            }

            // NEW TRAP 7: Yellow Line Cross (Purple RSI > Yellow RSI SMA 14)
            if (tf.filterRSIAboveYellow) {
              if (curRSI <= rsiSMA14[i]) {
                inOversold = false; minRSI = 100; dipLowestPrice = Infinity;
                continue;
              }
            }

            // ALL TRAPS CLEARED -> EXECUTE ENTRY
            inTrade = true;
            entryPrice = c.close * (1 + slipRate);
            entryIdx = i;

            const swingSL = dipLowestPrice * 0.998;
            const maxSL = entryPrice * 0.985; // 1.5% max SL
            stopLossPrice = Math.max(swingSL, maxSL);
          }

          inOversold = false;
          minRSI = 100;
          dipLowestPrice = Infinity;
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
          const net = gross - (feeRate * 2 * 100) - (slipRate * 100);

          trades++;
          if (net > 0) {
            wins++;
            winSum += net;
          } else {
            losses++;
            lossSum += net;
          }
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

  auditResults.push({
    Configuration: tf.name,
    Trades: trades,
    Wins: wins,
    Losses: losses,
    'Win Rate': winRate.toFixed(1) + '%',
    'Avg Win': '+' + avgWin.toFixed(2) + '%',
    'Avg Loss': avgLoss.toFixed(2) + '%',
    'Avg Net/Trade': (avgNet >= 0 ? '+' : '') + avgNet.toFixed(2) + '%',
    'Total Net Gain': (totalNet >= 0 ? '+' : '') + totalNet.toFixed(1) + '%'
  });
}

console.log('\n========================================================================================');
console.log('   STEP-BY-STEP TRAP ELIMINATION AUDIT (FULL 2026 YEAR ACROSS ALL ALTCOINS)');
console.log('========================================================================================\n');
console.table(auditResults);
