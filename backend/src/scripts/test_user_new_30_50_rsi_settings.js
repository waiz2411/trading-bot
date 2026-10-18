import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cacheDir = path.resolve(__dirname, '../data/binance_cache');

console.log('--- TESTING NEW USER SETTINGS: RSI LOWER LIMIT 30, MID LIMIT 50, NO MA, DAILY SCALPING ---');

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
console.log(`Loaded ${symbols.length} altcoin datasets.`);

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

// We test multiple interpretations of the Break-Even Guard between Lower Limit (30) and Middle Limit (50):
// Model 1: Baseline 30->50: Buy on RSI re-entry >= 30, exit at RSI >= 50, 1% SL, NO break-even guard.
// Model 2: Break-Even Guard on Price Bounce: If price bounces +0.50% (between 30 & 50), activate BE Guard. If price falls back to Entry + 0.20%, close at BE!
// Model 3: Break-Even Guard on RSI Roll-over: If RSI reaches 40-45 (between 30 & 50) and then turns down (curRSI < prevRSI), if trade is around BE, close immediately!
// Model 4: Stalling Guard (Faulty Trade): If after 4 bars (1 hour), RSI cannot reach 50 and stays below 45, close at BE if price >= entry.
// Model 5: Combined Smart Scalp:
//          - Entry: RSI crosses back above 30 into purple box
//          - Trap 1 & 2 basic filters (no severe compression, no giant red bar >=1.5%)
//          - Take Profit: RSI touches 50
//          - BE Guard: As soon as price reaches +0.40% profit, move SL to Break-Even (+0.20% fees covered).

const models = [
  { name: '1. User New Settings Baseline (30 Re-entry, 50 Mid Exit, 1% SL, No BE)', beMode: 'NONE' },
  { name: '2. BE Guard Triggered at +0.40% Bounce (Protects Capital at Entry)', beMode: 'PRICE_0.4' },
  { name: '3. BE Guard Triggered at +0.50% Bounce (SL to Entry + Fees)', beMode: 'PRICE_0.5' },
  { name: '4. BE Guard on RSI Roll-over (RSI reached 40+ then drops)', beMode: 'RSI_ROLLOVER' },
  { name: '5. Fast Stalling Guard (4 bars held, RSI < 45, exit at BE)', beMode: 'TIME_STALL' },
  { name: '6. Master Scalper: 30 Re-entry + 50 Exit + 1.2% SL + +0.45% BE Guard', beMode: 'PRICE_0.45', slPct: 1.2 }
];

const results = [];
const allModelTrades = {};

for (const m of models) {
  let trades = 0, wins = 0, breakEvens = 0, losses = 0;
  let winSum = 0, lossSum = 0, totalNet = 0;
  const slPct = m.slPct || 1.0;
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
    let peakRSI = 0;
    let peakGainPct = 0;
    let cooldownUntilIdx = -1;

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
          // Entry when value re-enters purple area (crosses back >= 30)
          if (c.close >= c.open) {
            // Light Trap 1 (Compression check)
            let smallCount = 0;
            for (let k = 1; k <= 20; k++) {
              if (((candles[i - k].high - candles[i - k].low) / candles[i - k].close) * 100 < 0.35) smallCount++;
            }
            if (smallCount / 20 >= 0.70) {
              inOversold = false; minRSI = 100; continue;
            }

            // Light Trap 2 (Giant Red Bar >= 1.8% in last 3 bars)
            let giantDump = false;
            for (let k = 1; k <= 3; k++) {
              const pb = candles[i - k];
              if (pb.close < pb.open && ((pb.open - pb.close) / pb.open) * 100 >= 1.8) { giantDump = true; break; }
            }
            if (giantDump) {
              inOversold = false; minRSI = 100; continue;
            }

            inTrade = true;
            entryPrice = c.close * (1 + slipRate);
            entryIdx = i;
            currentSL = entryPrice * (1 - slPct / 100);
            beActivated = false;
            peakRSI = curRSI;
            peakGainPct = 0;
          }
          inOversold = false;
          minRSI = 100;
        }
      } else {
        // Trade is active
        const highPrice = c.high;
        const gainPct = ((highPrice - entryPrice) / entryPrice) * 100;
        if (gainPct > peakGainPct) peakGainPct = gainPct;
        if (curRSI > peakRSI) peakRSI = curRSI;

        // Break-Even Guard between Lower Limit (30) and Middle Limit (50)
        if (m.beMode === 'PRICE_0.4' && !beActivated && peakGainPct >= 0.40) {
          beActivated = true;
          currentSL = entryPrice * 1.0020; // Lock Entry + fees
        } else if (m.beMode === 'PRICE_0.5' && !beActivated && peakGainPct >= 0.50) {
          beActivated = true;
          currentSL = entryPrice * 1.0020;
        } else if (m.beMode === 'PRICE_0.45' && !beActivated && peakGainPct >= 0.45) {
          beActivated = true;
          currentSL = entryPrice * 1.0020;
        } else if (m.beMode === 'RSI_ROLLOVER' && !beActivated && peakRSI >= 40 && curRSI < prevRSI && curRSI < 45) {
          // If RSI rolled over between 40 and 45
          beActivated = true;
          currentSL = entryPrice * 1.0010;
        }

        let exitPrice = null;
        let exitReason = '';

        // Check SL or BE
        if (c.low <= currentSL) {
          exitPrice = currentSL * (1 - slipRate);
          exitReason = beActivated ? 'BREAK_EVEN_GUARD' : 'STOP_LOSS';
          if (!beActivated) cooldownUntilIdx = i + 8; // 2 hour cooldown on real SL
        }
        // Check Middle Limit (50) Exit
        else if (curRSI >= 50) {
          exitPrice = c.close * (1 - slipRate);
          exitReason = 'RSI_50_MIDDLE_LIMIT';
        }
        // Time Stall Guard
        else if (m.beMode === 'TIME_STALL' && (i - entryIdx >= 4) && curRSI < 45 && c.close >= entryPrice) {
          exitPrice = c.close * (1 - slipRate);
          exitReason = 'STALL_BREAK_EVEN';
        }
        // Max Time Stop (6 hours)
        else if (i - entryIdx >= 24) {
          exitPrice = c.close * (1 - slipRate);
          exitReason = 'MAX_TIME_6H';
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
  const tradesPerDay = (trades / 289).toFixed(1); // 289 days in 2026

  results.push({
    Configuration: m.name,
    'Total Trades': trades,
    'Trades / Day': tradesPerDay,
    Wins: wins,
    'Break-Evens': breakEvens,
    Losses: losses,
    'Win Rate': winRate.toFixed(1) + '%',
    'Avg Win': '+' + avgWin.toFixed(2) + '%',
    'Avg Loss': avgLoss.toFixed(2) + '%',
    'Avg Net/Trade': (avgNet >= 0 ? '+' : '') + avgNet.toFixed(2) + '%',
    'Total Net': (totalNet >= 0 ? '+' : '') + totalNet.toFixed(1) + '%'
  });

  allModelTrades[m.name] = log;
}

console.log('\n======================================================================================================');
console.log('   DAILY SCALPING AUDIT (RSI LOWER LIMIT 30 -> MIDDLE LIMIT 50 + BREAK-EVEN GUARD)');
console.log('======================================================================================================\n');
console.table(results);

// Export Excel
const wb = XLSX.utils.book_new();

const summaryAOA = [
  ['NEXUS QUANT - DAILY SCALPING RSI 30/50 WITH BREAK-EVEN GUARD (2026 AUDIT)'],
  ['Settings Applied', 'RSI Length 14, LowerLimit 30, MiddleLimit 50, UpperLimit 70 (No MA)'],
  ['Core Concept', 'Scalping daily trades on 15m RSI 30 re-entry with Break-Even Guard active between 30 and 50'],
  ['Exchange Friction', '0.20% Round-trip Binance Spot Fee + 0.03% Slippage'],
  [],
  ['CONFIGURATION COMPARISON SUMMARY'],
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

XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryAOA), 'Daily Scalping Summary');

// Model 6 Trade Log
const m6Log = allModelTrades['6. Master Scalper: 30 Re-entry + 50 Exit + 1.2% SL + +0.45% BE Guard'];
if (m6Log) {
  const tradeRows = [
    ['Trade #', 'Symbol', 'Entry Time (UTC)', 'Exit Time (UTC)', 'Entry Price', 'Exit Price', 'Peak Gain (%)', 'Bars Held', 'Exit Reason', 'Net Return (%)', 'Outcome']
  ];
  m6Log.slice(0, 500).forEach((t, i) => {
    tradeRows.push([
      i + 1,
      t.symbol,
      t.entryTime,
      t.exitTime,
      Number(t.entryPrice.toFixed(4)),
      Number(t.exitPrice.toFixed(4)),
      Number(t.peakGainPct.toFixed(2)),
      t.barsHeld,
      t.reason,
      `${t.netPct >= 0 ? '+' : ''}${t.netPct.toFixed(2)}%`,
      t.isWin ? 'WIN' : 'LOSS'
    ]);
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(tradeRows), 'Daily Scalp Trade Log (Sample)');
}

const outPath = path.resolve(__dirname, '../../nexus_quant_daily_scalp_30_50_breakeven_report.xlsx');
XLSX.writeFile(wb, outPath);

const brainPath = 'C:\\Users\\waizt\\.gemini\\antigravity\\brain\\9240cc1b-f576-4996-a196-552f1f9e4603\\nexus_quant_daily_scalp_30_50_breakeven_report.xlsx';
fs.copyFileSync(outPath, brainPath);

console.log(`\nExcel Report saved to:\n1. ${outPath}\n2. ${brainPath}`);
