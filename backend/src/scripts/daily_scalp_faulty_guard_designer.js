import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cacheDir = path.resolve(__dirname, '../data/binance_cache');

console.log('Testing Daily Scalping: RSI 30 Re-entry -> 50 Mid Exit with Faulty Trade Break-Even Guard...');

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

const symRSI = {};
for (const sym of symbols) {
  symRSI[sym] = calculateRSI14(datasets[sym]);
}

const feeRate = 0.0010;
const slipRate = 0.0003;

// What defines a "FAULTY" trade between Lower Limit 30 and Middle Limit 50?
// Let's test different quantitative definitions of "Faulty":
// Guard 1: Double Bottom Failure - RSI crossed back above 30, but on next candle RSI falls back below 30 -> Close immediately at market to avoid hitting full SL!
// Guard 2: Stalling Reversal - If after 2 candles, the candle closes RED below entry price -> Close immediately around Break-Even / small loss!
// Guard 3: Profit Protection BE - If price reaches +0.80% (well on its way to RSI 50), ratchet SL to Entry + 0.25% so if it reverses, it exits at zero loss!
// Guard 4: RSI Failure at 42-45 - RSI gets to 42-45, but makes a bearish reversal candle (upper wick or red candle) -> Exit!
// Guard 5: Synergy of Guards 1, 2, and 3.

const experiments = [
  { name: '0. Raw User Strategy (30 Re-entry, 50 Mid Exit, 1.2% SL, No Guard)' },
  { name: '1. Guard: Re-break below 30 (Failed re-entry -> instant exit)', guardSub30: true },
  { name: '2. Guard: Bearish Candle Stalled between 30 and 50', guardStallRed: true },
  { name: '3. Guard: Break-Even Ratchet after +0.80% Gain (Locks +0.25% net)', guardBE08: true },
  { name: '4. Guard: RSI Midline Failure (RSI 43+ turning down with red bar)', guardRSIFailure: true },
  { name: '5. Master Daily Scalper: Combined Faulty Guards + 1.5% SL', guardSub30: true, guardBE08: true, guardRSIFailure: true, slPct: 1.5 },
  { name: '6. Master Daily Scalper: Combined Guards + 2.0% SL', guardSub30: true, guardBE08: true, guardRSIFailure: true, slPct: 2.0 }
];

const results = [];

for (const exp of experiments) {
  let trades = 0, wins = 0, breakEvens = 0, losses = 0;
  let winSum = 0, lossSum = 0, totalNet = 0;
  const slPct = exp.slPct || 1.2;

  for (const sym of symbols) {
    const candles = datasets[sym];
    const rsi = symRSI[sym];

    let inOversold = false;
    let minRSI = 100;
    let inTrade = false;
    let entryPrice = 0;
    let entryIdx = 0;
    let currentSL = 0;
    let beActivated = false;
    let cooldownUntilIdx = -1;

    for (let i = 35; i < candles.length - 1; i++) {
      const c = candles[i];
      const curRSI = rsi[i];
      const prevRSI = rsi[i - 1];

      if (i < cooldownUntilIdx) continue;

      if (!inTrade) {
        if (curRSI < 30) {
          inOversold = true;
          if (curRSI < minRSI) minRSI = curRSI;
        } else if (inOversold && prevRSI < 30 && curRSI >= 30) {
          // Re-entry into purple box (>= 30)
          if (c.close >= c.open) {
            inTrade = true;
            entryPrice = c.close * (1 + slipRate);
            entryIdx = i;
            currentSL = entryPrice * (1 - slPct / 100);
            beActivated = false;
          }
          inOversold = false;
          minRSI = 100;
        }
      } else {
        const peakGain = ((c.high - entryPrice) / entryPrice) * 100;
        let exitPrice = null;
        let exitReason = '';

        // Guard 3: BE Ratchet when price reached +0.80%
        if (exp.guardBE08 && !beActivated && peakGain >= 0.80) {
          beActivated = true;
          currentSL = entryPrice * 1.0025; // Locks in +0.25% net profit covering all fees
        }

        // Check Hard Stop Loss or BE Hit
        if (c.low <= currentSL) {
          exitPrice = currentSL * (1 - slipRate);
          exitReason = beActivated ? 'BREAK_EVEN_GUARD' : 'STOP_LOSS';
          if (!beActivated) cooldownUntilIdx = i + 6; // 1.5 hr cooldown
        }
        // Check Target: RSI touches Middle Limit (50)
        else if (curRSI >= 50) {
          exitPrice = c.close * (1 - slipRate);
          exitReason = 'RSI_50_MIDLINE';
        }
        // Guard 1: Failed Re-entry (RSI dips back below 30 between entry and target)
        else if (exp.guardSub30 && curRSI < 30) {
          exitPrice = c.close * (1 - slipRate);
          exitReason = 'FAULTY_SUB_30_CUT';
        }
        // Guard 2: Stalled Red Candle (2 bars held and red candle below entry)
        else if (exp.guardStallRed && (i - entryIdx >= 2) && c.close < entryPrice && c.close < c.open) {
          exitPrice = c.close * (1 - slipRate);
          exitReason = 'FAULTY_STALL_RED_CUT';
        }
        // Guard 4: RSI Failure at 43+ (RSI got to 43+ then rolled down with red candle)
        else if (exp.guardRSIFailure && prevRSI >= 43 && curRSI < prevRSI && c.close < c.open) {
          exitPrice = c.close * (1 - slipRate);
          exitReason = 'FAULTY_RSI_FAILURE_CUT';
        }
        // Max Time Limit: 6 hours (24 candles)
        else if (i - entryIdx >= 24) {
          exitPrice = c.close * (1 - slipRate);
          exitReason = 'TIME_LIMIT_6H';
        }

        if (exitPrice !== null) {
          const gross = ((exitPrice - entryPrice) / entryPrice) * 100;
          const net = gross - (feeRate * 2 * 100) - (slipRate * 100);

          trades++;
          if (net > 0.05) {
            wins++;
            winSum += net;
          } else if (net >= -0.05 && net <= 0.05) {
            breakEvens++;
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
  const dailyTrades = (trades / 289).toFixed(1);

  results.push({
    Configuration: exp.name,
    'Total Trades': trades,
    'Trades/Day': dailyTrades,
    Wins: wins,
    'Break-Evens': breakEvens,
    Losses: losses,
    'Win Rate': winRate.toFixed(1) + '%',
    'Avg Win': '+' + avgWin.toFixed(2) + '%',
    'Avg Loss': avgLoss.toFixed(2) + '%',
    'Avg Net/Trade': (avgNet >= 0 ? '+' : '') + avgNet.toFixed(2) + '%',
    'Total Net': (totalNet >= 0 ? '+' : '') + totalNet.toFixed(1) + '%'
  });
}

console.log('\n======================================================================================================');
console.log('   DAILY SCALPING WITH FAULTY TRADE GUARDS (RSI 30 -> 50)');
console.log('======================================================================================================\n');
console.table(results);
