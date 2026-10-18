import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cacheDir = path.resolve(__dirname, '../data/binance_cache');

console.log('Loading 2026 Binance 15m historical candles...');
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
console.log(`Loaded ${symbols.length} altcoin datasets.`);

function calculateIndicators(candles) {
  const len = candles.length;
  const closes = candles.map(c => c.close);
  const rsi14 = new Float64Array(len);
  const atr14 = new Float64Array(len);

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

  // ATR (14)
  let trSum = 0;
  for (let i = 1; i <= 14 && i < len; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    );
    trSum += tr;
  }
  let prevATR = trSum / 14;
  atr14[14] = prevATR;
  for (let i = 15; i < len; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    );
    prevATR = (prevATR * 13 + tr) / 14;
    atr14[i] = prevATR;
  }

  return { rsi14, atr14 };
}

const feeRate = 0.0010; // 0.10% each way = 0.20% round trip
const slipRate = 0.0003; // 0.03% execution slippage

function runCooldownBacktest(opts) {
  const { cooldownBars, slType, maxSlPct, fixedSlPct } = opts;
  const allTrades = [];
  let totalGrossGain = 0;
  let totalNetGain = 0;
  let wins = 0;
  let losses = 0;
  let winAmounts = [];
  let lossAmounts = [];

  for (const sym of symbols) {
    const candles = datasets[sym];
    const { rsi14, atr14 } = calculateIndicators(candles);

    let inOversold = false;
    let minRSI = 100;
    let dipLowestPrice = Infinity;
    let inTrade = false;
    let entryPrice = 0;
    let entryIdx = 0;
    let stopLossPrice = 0;
    let cooldownUntilIdx = -1;

    for (let i = 25; i < candles.length - 1; i++) {
      const c = candles[i];
      const curRSI = rsi14[i];
      const prevRSI = rsi14[i - 1];

      // Check if coin is in cooldown after hitting stop loss
      if (i < cooldownUntilIdx) {
        continue;
      }

      if (!inTrade) {
        if (curRSI < 35) {
          inOversold = true;
          if (curRSI < minRSI) minRSI = curRSI;
          if (c.low < dipLowestPrice) dipLowestPrice = c.low;
        } else if (inOversold && prevRSI < 35 && curRSI >= 35) {
          if (minRSI <= 32) {
            const candleRangePct = ((c.high - c.low) / c.close) * 100;
            const atrPct = (atr14[i] / c.close) * 100;

            if (candleRangePct >= 0.40 && atrPct >= 0.40 && c.close >= c.open) {
              inTrade = true;
              entryPrice = c.close * (1 + slipRate);
              entryIdx = i;

              if (slType === 'swing_low') {
                const swingSL = dipLowestPrice * 0.998;
                const maxSL = entryPrice * (1 - maxSlPct / 100);
                stopLossPrice = Math.max(swingSL, maxSL);
              } else {
                stopLossPrice = entryPrice * (1 - fixedSlPct / 100);
              }
            }
          }

          inOversold = false;
          minRSI = 100;
          dipLowestPrice = Infinity;
        }
      } else {
        // Active trade
        let exitPrice = null;
        let exitReason = null;

        // 1. Check Stop Loss
        if (c.low <= stopLossPrice) {
          exitPrice = stopLossPrice * (1 - slipRate);
          exitReason = 'STOP_LOSS';
          // Trigger Cooldown Lockout for next N bars!
          cooldownUntilIdx = i + cooldownBars;
        }
        // 2. Check RSI Middle Dotted Line (50) Touch
        else if (curRSI >= 50) {
          exitPrice = c.close * (1 - slipRate);
          exitReason = 'RSI_50_MIDLINE';
        }
        // 3. Max hold timeout (8 hours)
        else if (i - entryIdx >= 32) {
          exitPrice = c.close * (1 - slipRate);
          exitReason = 'TIMEOUT_8H';
        }

        if (exitPrice !== null) {
          const grossGainPct = ((exitPrice - entryPrice) / entryPrice) * 100;
          const netGainPct = grossGainPct - (feeRate * 2 * 100) - (slipRate * 100);

          totalGrossGain += grossGainPct;
          totalNetGain += netGainPct;

          if (netGainPct > 0) {
            wins++;
            winAmounts.push(netGainPct);
          } else {
            losses++;
            lossAmounts.push(netGainPct);
          }

          allTrades.push({
            symbol: sym,
            entryTime: candles[entryIdx].time,
            exitTime: c.time,
            entryPrice,
            exitPrice,
            exitReason,
            grossGainPct,
            netGainPct,
            durationMin: (i - entryIdx) * 15,
            monthKey: candles[entryIdx].time.slice(0, 7)
          });

          inTrade = false;
          inOversold = false;
          minRSI = 100;
          dipLowestPrice = Infinity;
        }
      }
    }
  }

  const totalTrades = allTrades.length;
  const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
  const avgWin = wins > 0 ? (winAmounts.reduce((a, b) => a + b, 0) / wins) : 0;
  const avgLoss = losses > 0 ? (lossAmounts.reduce((a, b) => a + b, 0) / losses) : 0;
  const avgNet = totalTrades > 0 ? totalNetGain / totalTrades : 0;

  return {
    name: opts.name,
    totalTrades,
    wins,
    losses,
    winRate: winRate.toFixed(1) + '%',
    avgWin: '+' + avgWin.toFixed(2) + '%',
    avgLoss: avgLoss.toFixed(2) + '%',
    avgNet: (avgNet >= 0 ? '+' : '') + avgNet.toFixed(2) + '%',
    totalNetGain: (totalNetGain >= 0 ? '+' : '') + totalNetGain.toFixed(1) + '%',
    allTrades
  };
}

console.log('Testing Cooldown configurations across all 93 altcoins in 2026...\n');

const configs = [
  { name: '1. Baseline: No Cooldown (Swing Low max 1.5%)', cooldownBars: 0, slType: 'swing_low', maxSlPct: 1.5 },
  { name: '2. 2-Hour Cooldown (8 bars) after Stop Loss', cooldownBars: 8, slType: 'swing_low', maxSlPct: 1.5 },
  { name: '3. 3-Hour Cooldown (12 bars) after Stop Loss', cooldownBars: 12, slType: 'swing_low', maxSlPct: 1.5 },
  { name: '4. 4-Hour Cooldown (16 bars) after Stop Loss', cooldownBars: 16, slType: 'swing_low', maxSlPct: 1.5 },
  { name: '5. Baseline: No Cooldown (Fixed 1.0% SL)', cooldownBars: 0, slType: 'fixed', fixedSlPct: 1.0 },
  { name: '6. 2-Hour Cooldown (8 bars) with Fixed 1.0% SL', cooldownBars: 8, slType: 'fixed', fixedSlPct: 1.0 },
  { name: '7. 3-Hour Cooldown (12 bars) with Fixed 1.0% SL', cooldownBars: 12, slType: 'fixed', fixedSlPct: 1.0 }
];

const results = configs.map(runCooldownBacktest);

console.log('========================================================================================');
console.log('   IMPACT OF 2-HOUR / 3-HOUR POST-STOP-LOSS COOLDOWN ON 93 BINANCE ALTCOINS');
console.log('   Strategy: RSI 35 Re-Entry -> RSI 50 Midline Exit | 0.20% Binance Fees + Slippage');
console.log('========================================================================================\n');

console.table(results.map(r => ({
  Configuration: r.name,
  Trades: r.totalTrades,
  Wins: r.wins,
  Losses: r.losses,
  'Win Rate': r.winRate,
  'Avg Win': r.avgWin,
  'Avg Loss': r.avgLoss,
  'Avg Net/Trade': r.avgNet,
  'Total Net Gain': r.totalNetGain
})));

// Export clean Excel report
const wb = XLSX.utils.book_new();

const summaryRows = [
  ['NEXUS QUANT - POST-STOP-LOSS COOLDOWN AUDIT (2026 FULL YEAR)'],
  ['Strategy', '15m RSI(14) dips < 32 then re-enters >= 35 | Exit on RSI 50 Midline touch'],
  ['Cooldown Rule', 'When a coin hits Stop Loss, that specific coin is locked out from trading for 2 to 3 hours'],
  ['Binance Friction', '0.20% Round-trip Spot Fee + 0.03% Slippage per trade'],
  ['Universe Tested', `${symbols.length} Binance Halal Altcoins`],
  [],
  ['COOLDOWN COMPARISON SUMMARY'],
  ['Configuration', 'Total Trades', 'Wins', 'Losses', 'Win Rate (%)', 'Avg Win (Net)', 'Avg Loss (Net)', 'Avg Net / Trade', 'Total Net Gain (%)']
];

results.forEach(r => {
  summaryRows.push([r.name, r.totalTrades, r.wins, r.losses, r.winRate, r.avgWin, r.avgLoss, r.avgNet, r.totalNetGain]);
});

XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), 'Cooldown Summary');

// Pick 3-Hour Cooldown (Variant 3) for trade log
const best3h = results[2];
const tradeHeaders = ['Trade #', 'Symbol', 'Entry Time (UTC)', 'Exit Time (UTC)', 'Duration (min)', 'Entry Price', 'Exit Price', 'Exit Reason', 'Gross Return (%)', 'Net Return (%)'];
const tradeRows = [tradeHeaders];
best3h.allTrades.forEach((t, i) => {
  tradeRows.push([
    i + 1,
    t.symbol,
    t.entryTime,
    t.exitTime,
    t.durationMin,
    t.entryPrice,
    t.exitPrice,
    t.exitReason,
    Number(t.grossGainPct.toFixed(2)),
    Number(t.netGainPct.toFixed(2))
  ]);
});
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(tradeRows), '3-Hour Cooldown Trades');

const outPath = path.resolve(__dirname, '../../nexus_quant_user_cooldown_rsi_audit.xlsx');
XLSX.writeFile(wb, outPath);

// Copy to brain directory for user
const brainPath = 'C:\\Users\\waizt\\.gemini\\antigravity\\brain\\9240cc1b-f576-4996-a196-552f1f9e4603\\nexus_quant_user_cooldown_rsi_audit.xlsx';
fs.copyFileSync(outPath, brainPath);
console.log(`\nExcel Report saved to: ${outPath}`);
console.log(`Copied to brain directory: ${brainPath}`);
