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
  return { rsi14 };
}

console.log('Classifying losing trades into forensic trap archetypes...');

const losses = [];
const wins = [];

for (const sym of symbols) {
  const candles = datasets[sym];
  const { rsi14 } = calculateIndicators(candles);

  let inOversold = false;
  let minRSI = 100;
  let inTrade = false;
  let entryPrice = 0;
  let entryIdx = 0;
  let stopLossPrice = 0;

  for (let i = 35; i < candles.length - 1; i++) {
    const c = candles[i];
    const curRSI = rsi14[i];
    const prevRSI = rsi14[i - 1];

    if (!inTrade) {
      if (curRSI < 35) {
        inOversold = true;
        if (curRSI < minRSI) minRSI = curRSI;
      } else if (inOversold && prevRSI < 35 && curRSI >= 35) {
        if (c.close >= c.open && minRSI <= 32) {
          inTrade = true;
          entryPrice = c.close * 1.0003;
          entryIdx = i;
          stopLossPrice = entryPrice * 0.99; // 1% SL
        }
        inOversold = false; minRSI = 100;
      }
    } else {
      let exitPrice = null;
      let reason = '';
      if (c.low <= stopLossPrice) {
        exitPrice = stopLossPrice * 0.9997;
        reason = 'SL';
      } else if (curRSI >= 50) {
        exitPrice = c.close * 0.9997;
        reason = 'TP_RSI50';
      } else if (i - entryIdx >= 32) {
        exitPrice = c.close * 0.9997;
        reason = 'TIME';
      }

      if (exitPrice !== null) {
        const net = (((exitPrice - entryPrice) / entryPrice) * 100) - 0.23;
        const tradeData = {
          sym,
          entryIdx,
          entryTime: candles[entryIdx].time,
          net,
          barsHeld: i - entryIdx,
          reason
        };

        if (net <= 0) {
          // Forensic autopsy on why it lost
          const entryC = candles[entryIdx];
          
          // Check Trap A: Pre-breakdown consolidation (small candles)
          let smallCandles = 0;
          for (let k = 1; k <= 20; k++) {
            const pb = candles[entryIdx - k];
            if (((pb.high - pb.low) / pb.close) * 100 < 0.35) smallCandles++;
          }
          tradeData.isCompression = (smallCandles / 20) >= 0.50;

          // Check Trap B: Giant red candle >= 1.5% in last 3 bars
          let maxRed = 0;
          for (let k = 1; k <= 3; k++) {
            const pb = candles[entryIdx - k];
            if (pb.close < pb.open) {
              const r = ((pb.open - pb.close) / pb.open) * 100;
              if (r > maxRed) maxRed = r;
            }
          }
          tradeData.isGiantRed = maxRed >= 1.5;

          // Check Trap C: Immediate re-dump (Next bar closed red below entry low)
          const nextC = candles[entryIdx + 1];
          tradeData.immediateRedDump = nextC && nextC.close < entryC.low;

          // Check Trap D: Fake RSI Cross (RSI reached only 35.0 - 36.5, very weak)
          tradeData.weakRSIReentry = rsi14[entryIdx] < 37.0;

          // Check Trap E: Shallow Dip (minRSI was only 30.5 - 32.0, not real panic)
          tradeData.shallowDip = minRSI >= 30.0;

          // Check Trap F: Multi-bar bleed (Price spent > 8 bars below RSI 35)
          let barsBelow35 = 0;
          for (let k = 1; k <= 20; k++) {
            if (rsi14[entryIdx - k] < 35) barsBelow35++;
            else break;
          }
          tradeData.prolongedDowntrend = barsBelow35 >= 6;

          losses.push(tradeData);
        } else {
          wins.push(tradeData);
        }
        inTrade = false;
      }
    }
  }
}

console.log(`Total Trades: ${wins.length + losses.length}`);
console.log(`Wins: ${wins.length}, Losses: ${losses.length}`);

console.log('\n--- TRAP FREQUENCY AMONG ALL LOSING TRADES ---');
const totalLosses = losses.length;
console.log(`1. Compression Breakdown (Trap 1): ${losses.filter(l => l.isCompression).length} (${((losses.filter(l => l.isCompression).length / totalLosses) * 100).toFixed(1)}%)`);
console.log(`2. Giant Red Flash Dump (Trap 2): ${losses.filter(l => l.isGiantRed).length} (${((losses.filter(l => l.isGiantRed).length / totalLosses) * 100).toFixed(1)}%)`);
console.log(`3. Shallow Dip Trap (RSI only dipped to 30-32): ${losses.filter(l => l.shallowDip).length} (${((losses.filter(l => l.shallowDip).length / totalLosses) * 100).toFixed(1)}%)`);
console.log(`4. Prolonged Bleed Trap (>= 6 bars below 35): ${losses.filter(l => l.prolongedDowntrend).length} (${((losses.filter(l => l.prolongedDowntrend).length / totalLosses) * 100).toFixed(1)}%)`);
console.log(`5. Weak RSI Momentum (RSI re-entry < 37): ${losses.filter(l => l.weakRSIReentry).length} (${((losses.filter(l => l.weakRSIReentry).length / totalLosses) * 100).toFixed(1)}%)`);
console.log(`6. Immediate Re-Dump Bar (Next bar broke low): ${losses.filter(l => l.immediateRedDump).length} (${((losses.filter(l => l.immediateRedDump).length / totalLosses) * 100).toFixed(1)}%)`);
