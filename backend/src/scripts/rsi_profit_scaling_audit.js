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

  // EMA 9 for trailing exit
  const ema9 = new Float64Array(len);
  const k9 = 2 / 10;
  let e9 = closes[0];
  for (let i = 0; i < len; i++) {
    e9 = i === 0 ? closes[i] : closes[i] * k9 + e9 * (1 - k9);
    ema9[i] = e9;
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
    let s = 0;
    for (let j = 0; j < 14; j++) s += rsi14[i - j];
    rsiSMA14[i] = s / 14;
  }

  return { rsi14, rsiSMA14, ema9 };
}

const symData = {};
for (const sym of symbols) {
  symData[sym] = { candles: datasets[sym], tech: calculateIndicators(datasets[sym]) };
}

console.log('Testing Trailing & Target Scaling Beyond RSI 50...');

const feeRate = 0.0010;
const slipRate = 0.0003;

const exitMethods = [
  { name: '1. User Original: 100% Exit at RSI 50', type: 'ORIGINAL_RSI_50' },
  { name: '2. 50% at RSI 50 + 50% at RSI 65 (SL to BE at RSI 50)', type: 'SCALE_RSI_65' },
  { name: '3. 50% at RSI 50 + 50% at RSI 70 (Upper Band)', type: 'SCALE_RSI_70' },
  { name: '4. 50% at RSI 50 + 50% Trail EMA 9 (SL to BE at RSI 50)', type: 'SCALE_TRAIL_EMA9' },
  { name: '5. Ride Full Bounce to RSI 60 (SL to BE at RSI 50)', type: 'FULL_RSI_60' },
  { name: '6. Ride Full Bounce to RSI 65 (SL to BE at RSI 50)', type: 'FULL_RSI_65' }
];

const results = [];

for (const em of exitMethods) {
  let trades = 0, wins = 0, losses = 0, totalNet = 0, winSum = 0, lossSum = 0;

  for (const sym of symbols) {
    const { candles, tech } = symData[sym];
    const { rsi14, rsiSMA14, ema9 } = tech;

    let inOversold = false;
    let minRSI = 100;
    let barsInOversold = 0;
    let inTrade = false;
    let entryPrice = 0;
    let entryIdx = 0;
    let stopLossPrice = 0;
    let cooldownUntilIdx = -1;

    let rsi50Reached = false;
    let partialSold = false;
    let partialProfitNet = 0;

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
        } else if (inOversold && prevRSI < 35 && curRSI >= 35) {
          if (minRSI <= 32 && c.close >= c.open) {
            // Trap 1: Compression
            let smallCount = 0;
            for (let k = 1; k <= 24; k++) {
              if (((candles[i - k].high - candles[i - k].low) / candles[i - k].close) * 100 < 0.35) smallCount++;
            }
            if (smallCount / 24 >= 0.60) {
              inOversold = false; minRSI = 100; barsInOversold = 0; continue;
            }

            // Trap 2: Giant red dump >= 1.5%
            let giantRed = false;
            for (let k = 1; k <= 4; k++) {
              const pb = candles[i - k];
              if (pb.close < pb.open && ((pb.open - pb.close) / pb.open) * 100 >= 1.5) { giantRed = true; break; }
            }
            if (giantRed) {
              inOversold = false; minRSI = 100; barsInOversold = 0; continue;
            }

            // V-Shape: Max 3 bars below 35
            if (barsInOversold > 3) {
              inOversold = false; minRSI = 100; barsInOversold = 0; continue;
            }

            // Purple RSI > Yellow SMA 14
            if (curRSI <= rsiSMA14[i]) {
              inOversold = false; minRSI = 100; barsInOversold = 0; continue;
            }

            // Enter Trade
            inTrade = true;
            entryPrice = c.close * (1 + slipRate);
            entryIdx = i;
            stopLossPrice = entryPrice * 0.985; // 1.5% SL
            rsi50Reached = false;
            partialSold = false;
            partialProfitNet = 0;
          }

          inOversold = false;
          minRSI = 100;
          barsInOversold = 0;
        }
      } else {
        if (em.type === 'ORIGINAL_RSI_50') {
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
            const net = gross - 0.23;
            trades++;
            if (net > 0) { wins++; winSum += net; } else { losses++; lossSum += net; }
            totalNet += net;
            inTrade = false;
          }
        } else if (em.type === 'SCALE_RSI_65' || em.type === 'SCALE_RSI_70') {
          const targetRSI = em.type === 'SCALE_RSI_65' ? 65 : 70;

          if (!rsi50Reached && curRSI >= 50) {
            rsi50Reached = true;
            partialSold = true;
            const gross50 = ((c.close * (1 - slipRate) - entryPrice) / entryPrice) * 100;
            partialProfitNet = (gross50 - 0.23) * 0.50;
            stopLossPrice = entryPrice * 1.0025;
          }

          let exitRemainderPrice = null;
          if (c.low <= stopLossPrice) {
            exitRemainderPrice = stopLossPrice * (1 - slipRate);
            if (!rsi50Reached) cooldownUntilIdx = i + 8;
          } else if (rsi50Reached && curRSI >= targetRSI) {
            exitRemainderPrice = c.close * (1 - slipRate);
          } else if (i - entryIdx >= 32) {
            exitRemainderPrice = c.close * (1 - slipRate);
          }

          if (exitRemainderPrice !== null) {
            const grossRem = ((exitRemainderPrice - entryPrice) / entryPrice) * 100;
            const netRem = (grossRem - 0.23) * (partialSold ? 0.50 : 1.0);
            const totalTradeNet = partialProfitNet + netRem;

            trades++;
            if (totalTradeNet > 0) { wins++; winSum += totalTradeNet; } else { losses++; lossSum += totalTradeNet; }
            totalNet += totalTradeNet;
            inTrade = false;
          }
        } else if (em.type === 'SCALE_TRAIL_EMA9') {
          if (!rsi50Reached && curRSI >= 50) {
            rsi50Reached = true;
            partialSold = true;
            const gross50 = ((c.close * (1 - slipRate) - entryPrice) / entryPrice) * 100;
            partialProfitNet = (gross50 - 0.23) * 0.50;
            stopLossPrice = entryPrice * 1.0025;
          }

          let exitRemainderPrice = null;
          if (c.low <= stopLossPrice) {
            exitRemainderPrice = stopLossPrice * (1 - slipRate);
            if (!rsi50Reached) cooldownUntilIdx = i + 8;
          } else if (rsi50Reached && c.close < ema9[i]) {
            exitRemainderPrice = c.close * (1 - slipRate);
          } else if (i - entryIdx >= 32) {
            exitRemainderPrice = c.close * (1 - slipRate);
          }

          if (exitRemainderPrice !== null) {
            const grossRem = ((exitRemainderPrice - entryPrice) / entryPrice) * 100;
            const netRem = (grossRem - 0.23) * (partialSold ? 0.50 : 1.0);
            const totalTradeNet = partialProfitNet + netRem;

            trades++;
            if (totalTradeNet > 0) { wins++; winSum += totalTradeNet; } else { losses++; lossSum += totalTradeNet; }
            totalNet += totalTradeNet;
            inTrade = false;
          }
        } else if (em.type === 'FULL_RSI_60' || em.type === 'FULL_RSI_65') {
          const targetRSI = em.type === 'FULL_RSI_60' ? 60 : 65;
          if (!rsi50Reached && curRSI >= 50) {
            rsi50Reached = true;
            stopLossPrice = entryPrice * 1.0025;
          }

          let exitPrice = null;
          if (c.low <= stopLossPrice) {
            exitPrice = stopLossPrice * (1 - slipRate);
            if (!rsi50Reached) cooldownUntilIdx = i + 8;
          } else if (curRSI >= targetRSI) {
            exitPrice = c.close * (1 - slipRate);
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
  }

  const winRate = trades > 0 ? (wins / trades) * 100 : 0;
  const avgWin = wins > 0 ? winSum / wins : 0;
  const avgLoss = losses > 0 ? lossSum / losses : 0;
  const avgNet = trades > 0 ? totalNet / trades : 0;

  results.push({
    'Exit Mechanism': em.name,
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
console.log('   PROFIT SCALING BEYOND RSI 50 vs ORIGINAL RSI 50 EXIT AUDIT');
console.log('========================================================================================\n');
console.table(results);
