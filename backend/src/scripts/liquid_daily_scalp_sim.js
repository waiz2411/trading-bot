import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cacheDir = path.resolve(__dirname, '../data/binance_cache');

console.log('Testing Daily Scalping Portfolio Engine (RSI 30 -> 50, Break-Even Guard, 3-8 Trades/Day)...');

// Select Top 25 Most Active & Liquid Binance Altcoins
const activeCoins = [
  'SOLUSDT', 'AVAXUSDT', 'ARBUSDT', 'NEARUSDT', 'LINKUSDT', 'APTUSDT', 'SUIUSDT',
  'INJUSDT', 'DOGEUSDT', 'LTCUSDT', 'ETHUSDT', 'BNBUSDT', 'OPUSDT', 'ZKUSDT',
  'TIAUSDT', 'SEIUSDT', 'FETUSDT', 'RENDERUSDT', 'WIFUSDT', 'PEPEUSDT', 'GALAUSDT',
  'FTMUSDT', 'MATICUSDT', 'POLUSDT', 'ICPUSDT'
];

const datasets = {};
for (const sym of activeCoins) {
  const files = fs.readdirSync(cacheDir).filter(f => f.startsWith(`${sym}_`));
  if (files.length > 0) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(cacheDir, files[0]), 'utf8'));
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
}

const symbols = Object.keys(datasets);
console.log(`Loaded ${symbols.length} top liquid active altcoins for Daily Scalping.`);

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

// Test multiple Daily Scalper Models on Top Liquid Coins:
// Model 1: Direct 30->50 with 1.2% SL
// Model 2: Direct 30->50 with 1.5% SL
// Model 3: Direct 30->50 + BE Guard when price gains +0.60% (locks Entry + 0.25% net)
// Model 4: Direct 30->50 + Stalling Guard (if held > 4 bars and candle is red, exit near BE)
// Model 5: Direct 30->50 + 50% Profit Scale at RSI 50 + Trail 50% Runner

const models = [
  { name: '1. Liquid Altcoins: 30 Re-entry, 50 Mid Exit, 1.2% SL', slPct: 1.2, beTrigger: 0, partialScale: false },
  { name: '2. Liquid Altcoins: 30 Re-entry, 50 Mid Exit, 1.5% SL', slPct: 1.5, beTrigger: 0, partialScale: false },
  { name: '3. Liquid Altcoins: + BE Guard at +0.65% Gain (Locks Entry + Fees)', slPct: 1.5, beTrigger: 0.65, partialScale: false },
  { name: '4. Liquid Altcoins: + BE Guard at +0.75% Gain (Locks Entry + Fees)', slPct: 1.5, beTrigger: 0.75, partialScale: false },
  { name: '5. Liquid Altcoins: + 50% at RSI 50 + Trail Runner (Locks Profit)', slPct: 1.5, beTrigger: 0.75, partialScale: true }
];

const results = [];
const tradeLogs = {};

for (const m of models) {
  let trades = 0, wins = 0, breakEvens = 0, losses = 0;
  let winSum = 0, lossSum = 0, totalNet = 0;
  const log = [];

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
    let peakGainPct = 0;
    let cooldownUntilIdx = -1;
    let partialProfitNet = 0;
    let partialExecuted = false;

    for (let i = 35; i < candles.length - 1; i++) {
      const c = candles[i];
      const curRSI = rsi[i];
      const prevRSI = rsi[i - 1];

      if (i < cooldownUntilIdx) continue;

      if (!inTrade) {
        // Lower limit is 30
        if (curRSI < 30) {
          inOversold = true;
          if (curRSI < minRSI) minRSI = curRSI;
        } else if (inOversold && prevRSI < 30 && curRSI >= 30) {
          if (c.close >= c.open) {
            inTrade = true;
            entryPrice = c.close * (1 + slipRate);
            entryIdx = i;
            currentSL = entryPrice * (1 - m.slPct / 100);
            beActivated = false;
            peakGainPct = 0;
            partialProfitNet = 0;
            partialExecuted = false;
          }
          inOversold = false;
          minRSI = 100;
        }
      } else {
        const highPrice = c.high;
        const gainPct = ((highPrice - entryPrice) / entryPrice) * 100;
        if (gainPct > peakGainPct) peakGainPct = gainPct;

        // BE Guard
        if (m.beTrigger > 0 && !beActivated && peakGainPct >= m.beTrigger) {
          beActivated = true;
          currentSL = entryPrice * 1.0025; // Covers round-trip Binance fee + tiny buffer
        }

        let exitPrice = null;
        let exitReason = '';

        // Check SL or BE
        if (c.low <= currentSL) {
          exitPrice = currentSL * (1 - slipRate);
          exitReason = beActivated ? 'BREAK_EVEN_GUARD' : 'STOP_LOSS';
          if (!beActivated) cooldownUntilIdx = i + 8; // 2 hour cooldown on real SL
        }
        // Partial scale at RSI 50
        else if (m.partialScale && !partialExecuted && curRSI >= 50) {
          partialExecuted = true;
          const gross50 = ((c.close * (1 - slipRate) - entryPrice) / entryPrice) * 100;
          partialProfitNet = (gross50 - 0.23) * 0.50; // Lock 50% profit
          currentSL = entryPrice * 1.0025; // Move SL to BE for remainder
          beActivated = true;
        }
        // Full exit at RSI 50
        else if (!m.partialScale && curRSI >= 50) {
          exitPrice = c.close * (1 - slipRate);
          exitReason = 'RSI_50_MIDLINE';
        }
        // Runner exit for partial scale model: RSI >= 65 or max 8h
        else if (m.partialScale && partialExecuted) {
          if (curRSI >= 65) {
            exitPrice = c.close * (1 - slipRate);
            exitReason = 'RSI_65_RUNNER';
          } else if (i - entryIdx >= 32) {
            exitPrice = c.close * (1 - slipRate);
            exitReason = 'TIME_EXIT_8H';
          }
        }
        // Max time exit
        else if (i - entryIdx >= 32) {
          exitPrice = c.close * (1 - slipRate);
          exitReason = 'TIME_EXIT_8H';
        }

        if (exitPrice !== null) {
          const gross = ((exitPrice - entryPrice) / entryPrice) * 100;
          const remainPortion = partialExecuted ? 0.50 : 1.0;
          const net = partialProfitNet + ((gross - 0.23) * remainPortion);

          trades++;
          if (net > 0.05) {
            wins++;
            winSum += net;
          } else if (net >= -0.05 && net <= 0.05) {
            breakEvens++;
            wins++;
            winSum += net;
          } else {
            losses++;
            lossSum += net;
          }
          totalNet += net;

          log.push({
            symbol: sym,
            entryTime: candles[entryIdx].time,
            exitTime: c.time,
            entryPrice,
            exitPrice,
            peakGainPct,
            barsHeld: i - entryIdx,
            reason: exitReason,
            netPct: net,
            isWin: net >= -0.05
          });

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
    Configuration: m.name,
    'Total Trades': trades,
    'Trades / Day': dailyTrades,
    Wins: wins,
    'Break-Evens': breakEvens,
    Losses: losses,
    'Win Rate': winRate.toFixed(1) + '%',
    'Avg Win': '+' + avgWin.toFixed(2) + '%',
    'Avg Loss': avgLoss.toFixed(2) + '%',
    'Avg Net/Trade': (avgNet >= 0 ? '+' : '') + avgNet.toFixed(2) + '%',
    'Total Net': (totalNet >= 0 ? '+' : '') + totalNet.toFixed(1) + '%'
  });

  tradeLogs[m.name] = log;
}

console.log('\n======================================================================================================');
console.log('   TOP LIQUID ALTCOINS DAILY SCALPING (RSI 30 -> 50)');
console.log('======================================================================================================\n');
console.table(results);

// Export Excel
const wb = XLSX.utils.book_new();

const summaryAOA = [
  ['NEXUS QUANT - TOP LIQUID ALTCOINS DAILY SCALPING AUDIT (RSI 30/50)'],
  ['Coins Audited', `${symbols.length} Top Active Binance Coins (SOL, AVAX, ARB, NEAR, LINK, SUI, ZK, etc.)`],
  ['Settings', 'RSI Length 14, LowerLimit 30, MiddleLimit 50 (Smoothed MA Disabled)'],
  ['Round-Trip Fees', '0.20% Binance Spot Fee + 0.03% Slippage per trade'],
  [],
  ['PERFORMANCE BREAKDOWN'],
  ['Configuration', 'Total Trades', 'Trades / Day', 'Wins', 'Break-Evens', 'Losses', 'Win Rate (%)', 'Avg Win (%)', 'Avg Loss (%)', 'Avg Net/Trade (%)', 'Total Net Gain (%)']
];

results.forEach(r => {
  summaryAOA.push([
    r.Configuration,
    r['Total Trades'],
    r['Trades / Day'],
    r.Wins,
    r['Break-Evens'],
    r.Losses,
    r['Win Rate'],
    r['Avg Win'],
    r['Avg Loss'],
    r['Avg Net/Trade'],
    r['Total Net']
  ]);
});

XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryAOA), 'Daily Scalping Liquid Altcoins');

const outPath = path.resolve(__dirname, '../../nexus_quant_liquid_daily_scalp_30_50.xlsx');
XLSX.writeFile(wb, outPath);

const brainPath = 'C:\\Users\\waizt\\.gemini\\antigravity\\brain\\9240cc1b-f576-4996-a196-552f1f9e4603\\nexus_quant_liquid_daily_scalp_30_50.xlsx';
fs.copyFileSync(outPath, brainPath);

console.log(`\nWorkbook saved to:\n1. ${outPath}\n2. ${brainPath}`);
