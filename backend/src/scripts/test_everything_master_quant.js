import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cacheDir = path.resolve(__dirname, '../data/binance_cache');

console.log('========================================================================================');
console.log('   THE "TEST EVERYTHING" QUANT RESEARCH ENGINE: DISCOVERING DAILY PROFITABILITY');
console.log('========================================================================================\n');

const files = fs.readdirSync(cacheDir).filter(f => f.endsWith('.json'));
const rawDatasets = {};

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
      if (parsed.length > 2000) rawDatasets[sym] = parsed;
    }
  } catch (_) {}
}

const allSymbols = Object.keys(rawDatasets).filter(s => s !== 'BTCUSDT');
console.log(`Loaded ${allSymbols.length} altcoin datasets.`);

// Top 25 Liquid Active Altcoins
const topLiquidSymbols = [
  'SOLUSDT', 'AVAXUSDT', 'ARBUSDT', 'NEARUSDT', 'LINKUSDT', 'APTUSDT', 'SUIUSDT',
  'INJUSDT', 'DOGEUSDT', 'LTCUSDT', 'ETHUSDT', 'BNBUSDT', 'OPUSDT', 'ZKUSDT',
  'TIAUSDT', 'SEIUSDT', 'FETUSDT', 'RENDERUSDT', 'WIFUSDT', 'PEPEUSDT', 'GALAUSDT',
  'FTMUSDT', 'MATICUSDT', 'POLUSDT', 'ICPUSDT'
].filter(s => rawDatasets[s] !== undefined);

function resampleCandles(c15m, targetMinutes) {
  const stepMs = targetMinutes * 60 * 1000;
  const buckets = new Map();
  for (const c of c15m) {
    const bucket = c.openTime - (c.openTime % stepMs);
    let arr = buckets.get(bucket);
    if (!arr) { arr = []; buckets.set(bucket, arr); }
    arr.push(c);
  }
  const resampled = [];
  for (const [openTime, slice] of buckets.entries()) {
    let open = slice[0].open;
    let high = -Infinity;
    let low = Infinity;
    let close = slice[slice.length - 1].close;
    let volume = 0;
    for (const c of slice) {
      if (c.high > high) high = c.high;
      if (c.low < low) low = c.low;
      volume += c.volume;
    }
    resampled.push({ openTime, time: new Date(openTime).toISOString(), open, high, low, close, volume });
  }
  resampled.sort((a, b) => a.openTime - b.openTime);
  return resampled;
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
  const volSMA20 = new Float64Array(len);
  const ema50 = calculateEMA(closes, 50);
  const ema100 = calculateEMA(closes, 100);
  const ema200 = calculateEMA(closes, 200);

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

  for (let i = 19; i < len; i++) {
    let s = 0;
    for (let j = 0; j < 20; j++) s += volumes[i - j];
    volSMA20[i] = s / 20;
  }

  return { rsi14, volSMA20, ema50, ema100, ema200 };
}

// Build precomputed multi-timeframe structures
const multiTF = { '15m': {}, '30m': {}, '1h': {} };

for (const sym of allSymbols) {
  const c15 = rawDatasets[sym];
  multiTF['15m'][sym] = { candles: c15, tech: calculateIndicators(c15) };

  const c30 = resampleCandles(c15, 30);
  multiTF['30m'][sym] = { candles: c30, tech: calculateIndicators(c30) };

  const c1h = resampleCandles(c15, 60);
  multiTF['1h'][sym] = { candles: c1h, tech: calculateIndicators(c1h) };
}

// Also BTC
const btc15 = rawDatasets['BTCUSDT'];
const btc1h = resampleCandles(btc15, 60);
const btcData1h = { candles: btc1h, tech: calculateIndicators(btc1h) };
const btcMap1h = new Map();
btc1h.forEach((c, idx) => btcMap1h.set(c.openTime, idx));

const feeRate = 0.0010;
const slipRate = 0.0003;

// Strategy Evaluation Engine
function evaluateStrategy(cfg) {
  const targetTF = cfg.tf;
  const store = multiTF[targetTF];
  const symList = cfg.liquidOnly ? topLiquidSymbols : allSymbols;

  let trades = 0, wins = 0, breakEvens = 0, losses = 0;
  let winSum = 0, lossSum = 0, totalNet = 0;
  const dailyGainMap = new Map(); // Date -> Net %

  for (const sym of symList) {
    if (!store[sym]) continue;
    const { candles, tech } = store[sym];
    const { rsi14, volSMA20, ema50, ema100, ema200 } = tech;

    let inOversold = false;
    let minRSI = 100;
    let barsInOversold = 0;
    let inTrade = false;
    let entryPrice = 0;
    let entryIdx = 0;
    let currentSL = 0;
    let beActivated = false;
    let rsi50Reached = false;
    let partialSold = false;
    let partialProfitNet = 0;
    let cooldownUntil = -1;

    for (let i = 35; i < candles.length - 1; i++) {
      const c = candles[i];
      const curRSI = rsi14[i];
      const prevRSI = rsi14[i - 1];

      if (i < cooldownUntil) continue;

      if (!inTrade) {
        if (curRSI < 30) {
          inOversold = true;
          barsInOversold++;
          if (curRSI < minRSI) minRSI = curRSI;
        } else if (inOversold && prevRSI < 30 && curRSI >= 30) {
          if (c.close >= c.open) {
            // Filter 1: Fast V-Shape (Max bars in oversold)
            if (cfg.maxBarsOversold && barsInOversold > cfg.maxBarsOversold) {
              inOversold = false; minRSI = 100; barsInOversold = 0; continue;
            }

            // Filter 2: Volume confirmation
            if (cfg.volSpike && volSMA20[i] > 0 && c.volume < volSMA20[i] * 1.15) {
              inOversold = false; minRSI = 100; barsInOversold = 0; continue;
            }

            // Filter 3: Trend Alignment (Close > EMA 100 or EMA 200)
            if (cfg.trendFilter === 'EMA100' && c.close <= ema100[i]) {
              inOversold = false; minRSI = 100; barsInOversold = 0; continue;
            }
            if (cfg.trendFilter === 'EMA200' && c.close <= ema200[i]) {
              inOversold = false; minRSI = 100; barsInOversold = 0; continue;
            }

            // Filter 4: BTC Safe Market
            if (cfg.btcSafe) {
              const btcBucket = c.openTime - (c.openTime % (3600 * 1000));
              const btcIdx = btcMap1h.get(btcBucket);
              if (btcIdx !== undefined && btcData1h.candles[btcIdx].close <= btcData1h.tech.ema50[btcIdx]) {
                inOversold = false; minRSI = 100; barsInOversold = 0; continue;
              }
            }

            // Enter Trade
            inTrade = true;
            entryPrice = c.close * (1 + slipRate);
            entryIdx = i;
            currentSL = entryPrice * (1 - cfg.slPct / 100);
            beActivated = false;
            rsi50Reached = false;
            partialSold = false;
            partialProfitNet = 0;
          }
          inOversold = false;
          minRSI = 100;
          barsInOversold = 0;
        }
      } else {
        const peakGain = ((c.high - entryPrice) / entryPrice) * 100;

        // Break-Even Guard Logic
        if (cfg.beAtGain && !beActivated && peakGain >= cfg.beAtGain) {
          beActivated = true;
          currentSL = entryPrice * 1.0025; // Locks in round-trip fees + 0.25% net buffer
        }

        // Two-Stage De-Risking at RSI 50
        if (cfg.twoStageAt50 && !rsi50Reached && curRSI >= 50) {
          rsi50Reached = true;
          partialSold = true;
          const gross50 = ((c.close * (1 - slipRate) - entryPrice) / entryPrice) * 100;
          partialProfitNet = (gross50 - 0.23) * 0.50; // Bank 50% profit
          currentSL = entryPrice * 1.0025; // Ratchet remaining 50% to BE!
          beActivated = true;
        }

        let exitPrice = null;

        // Check SL or BE
        if (c.low <= currentSL) {
          exitPrice = currentSL * (1 - slipRate);
          if (!beActivated) cooldownUntil = i + (cfg.cooldownBars || 4);
        }
        // Fixed Take Profit
        else if (cfg.fixedTP && c.high >= entryPrice * (1 + cfg.fixedTP / 100)) {
          exitPrice = entryPrice * (1 + cfg.fixedTP / 100) * (1 - slipRate);
        }
        // RSI 50 Full Exit
        else if (cfg.exitRSI === 50 && !cfg.twoStageAt50 && curRSI >= 50) {
          exitPrice = c.close * (1 - slipRate);
        }
        // Two-Stage Runner Target (RSI 65)
        else if (cfg.twoStageAt50 && partialSold && curRSI >= 65) {
          exitPrice = c.close * (1 - slipRate);
        }
        // Max Time Limit
        else if (i - entryIdx >= (cfg.maxBarsHeld || 24)) {
          exitPrice = c.close * (1 - slipRate);
        }

        if (exitPrice !== null) {
          const gross = ((exitPrice - entryPrice) / entryPrice) * 100;
          const portion = partialSold ? 0.50 : 1.0;
          const net = partialProfitNet + ((gross - 0.23) * portion);

          trades++;
          if (net > 0.05) { wins++; winSum += net; }
          else if (net >= -0.05 && net <= 0.05) { breakEvens++; wins++; winSum += net; }
          else { losses++; lossSum += net; }
          totalNet += net;

          // Track daily profit
          const dateStr = c.time.slice(0, 10);
          dailyGainMap.set(dateStr, (dailyGainMap.get(dateStr) || 0) + net);

          inTrade = false;
        }
      }
    }
  }

  const winRate = trades > 0 ? (wins / trades) * 100 : 0;
  const avgWin = wins > 0 ? winSum / wins : 0;
  const avgLoss = losses > 0 ? lossSum / losses : 0;
  const avgNet = trades > 0 ? totalNet / trades : 0;
  const profitFactor = Math.abs(lossSum) > 0 ? Math.abs(winSum / lossSum) : 999;
  const dailyTrades = (trades / 289).toFixed(1);

  // Daily Profit Consistency
  const dailyReturns = Array.from(dailyGainMap.values());
  const profitableDays = dailyReturns.filter(r => r > 0).length;
  const totalTradingDays = dailyReturns.length;
  const dailyWinRate = totalTradingDays > 0 ? ((profitableDays / totalTradingDays) * 100).toFixed(1) + '%' : '0%';

  return {
    Configuration: cfg.name,
    Timeframe: cfg.tf,
    Trades: trades,
    'Trades/Day': dailyTrades,
    Wins: wins,
    BreakEvens: breakEvens,
    Losses: losses,
    'Win Rate': winRate.toFixed(1) + '%',
    'Avg Win': '+' + avgWin.toFixed(2) + '%',
    'Avg Loss': avgLoss.toFixed(2) + '%',
    'Profit Factor': profitFactor.toFixed(2),
    'Profitable Days': `${profitableDays}/${totalTradingDays} (${dailyWinRate})`,
    'Total Net Gain': (totalNet >= 0 ? '+' : '') + totalNet.toFixed(1) + '%'
  };
}

// COMPREHENSIVE EXPERIMENT SPECTRUM
const experimentSuite = [
  // 1. Raw Baselines
  { name: '1. 15m Raw 30->50 Baseline (All 93 Coins)', tf: '15m', slPct: 1.0, exitRSI: 50 },
  { name: '2. 30m Raw 30->50 Baseline (All 93 Coins)', tf: '30m', slPct: 1.5, exitRSI: 50 },
  { name: '3. 1H Raw 30->50 Baseline (All 93 Coins)', tf: '1h', slPct: 2.5, exitRSI: 50 },

  // 2. Liquid Altcoins Focus (The Top 25 Volume Leaders)
  { name: '4. 30m Liquid Altcoins (Raw 30->50, 1.5% SL)', tf: '30m', slPct: 1.5, exitRSI: 50, liquidOnly: true },
  { name: '5. 30m Liquid Altcoins + Fast V-Shape (Max 2 bars below 30)', tf: '30m', slPct: 1.5, exitRSI: 50, liquidOnly: true, maxBarsOversold: 2 },
  { name: '6. 30m Liquid Altcoins + BE Guard at +0.80% Gain', tf: '30m', slPct: 1.8, exitRSI: 50, liquidOnly: true, beAtGain: 0.80 },

  // 3. Two-Stage De-Risking (50% Banked at 50 + Trail 50% Runner)
  { name: '7. 30m Liquid Altcoins: Two-Stage at RSI 50 (50% Profit + BE SL + Trail)', tf: '30m', slPct: 1.8, twoStageAt50: true, liquidOnly: true },
  { name: '8. 1H Liquid Altcoins: Two-Stage at RSI 50 (50% Profit + BE SL + Trail)', tf: '1h', slPct: 2.5, twoStageAt50: true, liquidOnly: true },

  // 4. Trend-Confirmed Daily Scalper (Trading dips in Uptrends)
  { name: '9. 30m Liquid Altcoins + Trend (Close > EMA100) + Two-Stage Exit', tf: '30m', slPct: 2.0, twoStageAt50: true, liquidOnly: true, trendFilter: 'EMA100' },
  { name: '10. 1H Liquid Altcoins + Trend (Close > EMA100) + Two-Stage Exit', tf: '1h', slPct: 2.5, twoStageAt50: true, liquidOnly: true, trendFilter: 'EMA100' },

  // 5. Asymmetric High-Target Daily Scalper (Fixed +3.0% TP, 1.8% SL)
  { name: '11. 30m Liquid Altcoins + Fixed +2.5% TP (1.5% SL, BE at +1.0%)', tf: '30m', slPct: 1.5, fixedTP: 2.5, beAtGain: 1.0, liquidOnly: true },
  { name: '12. 1H Liquid Altcoins + Fixed +3.5% TP (2.0% SL, BE at +1.5%)', tf: '1h', slPct: 2.0, fixedTP: 3.5, beAtGain: 1.5, liquidOnly: true },
  { name: '13. 1H Liquid Altcoins + BTC Safe + Trend EMA100 + Two-Stage Exit', tf: '1h', slPct: 2.5, twoStageAt50: true, liquidOnly: true, trendFilter: 'EMA100', btcSafe: true }
];

console.log('Running all comprehensive experiments...');
const suiteResults = experimentSuite.map(cfg => evaluateStrategy(cfg));

console.log('\n====================================================================================================================================================');
console.log('   MASTER QUANT RESULTS: WHAT MAKES US DAILY PROFITABLE (FULL 2026 AUDIT WITH 0.20% BINANCE FEES)');
console.log('====================================================================================================================================================\n');
console.table(suiteResults);

// Export to Excel
const wb = XLSX.utils.book_new();

const summaryAOA = [
  ['NEXUS QUANT - HOW TO MAKE DAILY PROFIT (MASTER STRATEGY AUDIT 2026)'],
  ['Core Objective', 'Achieve consistent daily profitability across Binance Altcoins using RSI re-entry, risk engineering, and trailing profits'],
  ['Exchange Friction Applied', '0.20% Round-trip Binance Spot Fee + 0.03% Slippage per trade'],
  [],
  ['EXPERIMENT SUITE RESULTS'],
  ['Configuration', 'Timeframe', 'Trades', 'Trades/Day', 'Wins', 'Break-Evens', 'Losses', 'Win Rate (%)', 'Avg Win (%)', 'Avg Loss (%)', 'Profit Factor', 'Profitable Days (%)', 'Total Net Gain (%)']
];

suiteResults.forEach(r => {
  summaryAOA.push([
    r.Configuration,
    r.Timeframe,
    r.Trades,
    r['Trades/Day'],
    r.Wins,
    r.BreakEvens,
    r.Losses,
    r['Win Rate'],
    r['Avg Win'],
    r['Avg Loss'],
    r['Profit Factor'],
    r['Profitable Days'],
    r['Total Net Gain']
  ]);
});

XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryAOA), 'Daily Profit Master Results');

const outPath = path.resolve(__dirname, '../../nexus_quant_make_daily_profitable_master_report.xlsx');
XLSX.writeFile(wb, outPath);

const brainPath = 'C:\\Users\\waizt\\.gemini\\antigravity\\brain\\9240cc1b-f576-4996-a196-552f1f9e4603\\nexus_quant_make_daily_profitable_master_report.xlsx';
fs.copyFileSync(outPath, brainPath);

console.log(`\nMaster Report saved to:\n1. ${outPath}\n2. ${brainPath}`);
