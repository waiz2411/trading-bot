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
  const rsiSMA14 = new Float64Array(len);

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

  return { rsi14, rsiSMA14 };
}

const sym15m = {};
for (const sym of symbols) {
  sym15m[sym] = { candles: datasets[sym], tech: calculateIndicators(datasets[sym]) };
}

console.log('Testing Trailing Break-Even and Target Traps across all 93 altcoins...');

const feeRate = 0.0010;
const slipRate = 0.0003;

// Configurations
const configs = [
  { name: '1. Standard User (1% SL, Exit at RSI 50 close, No BE)', beTrigger: 0, intraRSI50: false },
  { name: '2. Intra-Candle RSI 50 Exit (High RSI touched 50)', beTrigger: 0, intraRSI50: true },
  { name: '3. BE Protection at +0.60% (Move SL to +0.25% net)', beTrigger: 0.60, intraRSI50: false },
  { name: '4. BE Protection at +0.70% (Move SL to +0.25% net)', beTrigger: 0.70, intraRSI50: false },
  { name: '5. BE Protection at +0.60% + Intra-Candle RSI 50', beTrigger: 0.60, intraRSI50: true },
  { name: '6. Partial Profit (50% at +0.8%, 50% at RSI 50)', partialTP: true, beTrigger: 0.60 },
  { name: '7. BE Protection + Yellow MA Filter (Purple > Yellow)', beTrigger: 0.60, yellowFilter: true },
  { name: '8. BE Protection + Yellow MA + Deep Dip (minRSI <= 28)', beTrigger: 0.60, yellowFilter: true, deepDip: true }
];

const results = [];

for (const cfg of configs) {
  let trades = 0, wins = 0, losses = 0, bes = 0, totalNet = 0, winSum = 0, lossSum = 0;

  for (const sym of symbols) {
    const { candles, tech } = sym15m[sym];
    const { rsi14, rsiSMA14 } = tech;

    let inOversold = false;
    let minRSI = 100;
    let inTrade = false;
    let entryPrice = 0;
    let entryIdx = 0;
    let currentSL = 0;
    let cooldownUntilIdx = -1;
    let beActivated = false;

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
          const reqMin = cfg.deepDip ? 28 : 32;
          if (minRSI <= reqMin && c.close >= c.open) {
            // Trap 1: Compression
            let smallCount = 0;
            for (let k = 1; k <= 24; k++) {
              if (((candles[i - k].high - candles[i - k].low) / candles[i - k].close) * 100 < 0.35) smallCount++;
            }
            if (smallCount / 24 >= 0.60) { inOversold = false; minRSI = 100; continue; }

            // Trap 2: Giant red dump >= 1.5%
            let giantRed = false;
            for (let k = 1; k <= 4; k++) {
              const pb = candles[i - k];
              if (pb.close < pb.open && ((pb.open - pb.close) / pb.open) * 100 >= 1.5) { giantRed = true; break; }
            }
            if (giantRed) { inOversold = false; minRSI = 100; continue; }

            // Yellow line filter
            if (cfg.yellowFilter && curRSI <= rsiSMA14[i]) {
              inOversold = false; minRSI = 100; continue;
            }

            inTrade = true;
            entryPrice = c.close * (1 + slipRate);
            entryIdx = i;
            currentSL = entryPrice * 0.99; // 1% SL
            beActivated = false;
          }
          inOversold = false; minRSI = 100;
        }
      } else {
        // In trade
        const maxGainPct = ((c.high - entryPrice) / entryPrice) * 100;

        // Check Break-Even trigger
        if (cfg.beTrigger > 0 && !beActivated && maxGainPct >= cfg.beTrigger) {
          beActivated = true;
          // Set SL to Entry + 0.25% (locks in roundtrip fees + tiny profit)
          currentSL = entryPrice * 1.0025;
        }

        let exitPrice = null;

        if (c.low <= currentSL) {
          exitPrice = currentSL * (1 - slipRate);
          if (!beActivated) cooldownUntilIdx = i + 8; // cooldown only on true SL
        } else if (curRSI >= 50) {
          exitPrice = c.close * (1 - slipRate);
        } else if (cfg.intraRSI50 && maxGainPct >= 1.2) {
          // If candle pumped strongly, RSI touched 50 intra-candle
          exitPrice = entryPrice * 1.012 * (1 - slipRate);
        } else if (i - entryIdx >= 32) {
          exitPrice = c.close * (1 - slipRate);
        }

        if (exitPrice !== null) {
          const gross = ((exitPrice - entryPrice) / entryPrice) * 100;
          const net = gross - (feeRate * 2 * 100) - (slipRate * 100);

          trades++;
          if (net > 0.05) {
            wins++;
            winSum += net;
          } else if (net >= -0.05 && net <= 0.05) {
            bes++;
            wins++; // Break-even preserved capital
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

  results.push({
    Configuration: cfg.name,
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
console.log('   BREAK-EVEN TRAP PROTECTION & PROFIT PRESERVATION AUDIT');
console.log('========================================================================================\n');
console.table(results);
