import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cacheDir = path.resolve(__dirname, '../data/binance_cache');
const outDir = 'C:/Users/waizt/.gemini/antigravity/brain/9240cc1b-f576-4996-a196-552f1f9e4603';

console.log('========================================================================');
console.log('   BACKTESTING PBINVESTING: "THE ONLY 2 INDICATORS I USE" (VWAP + 8 EMA)');
console.log('========================================================================');

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
console.log(`Loaded ${allSymbols.length} altcoins.`);

const liquidSymbols = [
  'SOLUSDT', 'AVAXUSDT', 'SUIUSDT', 'NEARUSDT', 'APTUSDT', 'ARBUSDT', 'LINKUSDT',
  'INJUSDT', 'DOGEUSDT', 'LTCUSDT', 'ETHUSDT', 'BNBUSDT', 'OPUSDT', 'ZKUSDT',
  'TIAUSDT', 'SEIUSDT', 'FETUSDT', 'RENDERUSDT', 'WIFUSDT', 'PEPEUSDT', 'GALAUSDT',
  'FTMUSDT', 'MATICUSDT', 'POLUSDT', 'ICPUSDT'
].filter(s => rawDatasets[s] !== undefined);

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

// Calculate Intraday VWAP resetting daily at 00:00:00 UTC
function calculateDailyVWAP(candles) {
  const len = candles.length;
  const vwap = new Float64Array(len);
  let cumPV = 0;
  let cumVol = 0;
  let lastDay = -1;

  for (let i = 0; i < len; i++) {
    const c = candles[i];
    const day = Math.floor(c.openTime / (86400 * 1000));

    if (day !== lastDay) {
      // New day reset
      cumPV = 0;
      cumVol = 0;
      lastDay = day;
    }

    const typicalPrice = (c.high + c.low + c.close) / 3;
    cumPV += typicalPrice * c.volume;
    cumVol += c.volume;

    vwap[i] = cumVol > 0 ? cumPV / cumVol : c.close;
  }
  return vwap;
}

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

// Build precomputed structures for 15m and 30m
const tfData = { '15m': {}, '30m': {} };

for (const sym of allSymbols) {
  const c15 = rawDatasets[sym];
  tfData['15m'][sym] = {
    candles: c15,
    vwap: calculateDailyVWAP(c15),
    ema8: calculateEMA(c15.map(c => c.close), 8)
  };

  const c30 = resampleCandles(c15, 30);
  tfData['30m'][sym] = {
    candles: c30,
    vwap: calculateDailyVWAP(c30),
    ema8: calculateEMA(c30.map(c => c.close), 8)
  };
}

const feeRoundTrip = 0.20; // 0.10% buy + 0.10% sell
const slipRate = 0.00015; // 0.015% slippage

/**
 * Backtest PBInvesting VWAP + 8 EMA Strategy
 * 
 * Rules from PB's Video:
 * 1. Trend Rule: NEVER take longs under VWAP (Close > VWAP).
 * 2. Setup A (VWAP Retest): Price pulls back to VWAP from above.
 *    - Candle low tests VWAP (Low <= VWAP * 1.004 and Close >= VWAP).
 *    - Rejection / Green confirmation (Close >= Open).
 * 3. Setup B (8 EMA Momentum Retest): During trend above VWAP, price pulls back to 8 EMA.
 *    - Low <= EMA8 and Close >= EMA8.
 * 4. Stop Loss:
 *    - Hard Stop Loss below VWAP (or fixed % like 1.5% - 2.0%). "If it got under VWAP, take the loss."
 * 5. Exit Rule (The 8 EMA Trail):
 *    - PB's Rule: "As long as the stock stays above the EMA on a 5-minute, then I'll stay in... when it breaks under the EMA, that's where you exit."
 *    - Exit when candle closes BELOW 8 EMA (Close < EMA8).
 */
function simulatePBStrategy(cfg) {
  const targetSymbols = cfg.liquidOnly ? liquidSymbols : allSymbols;
  const tf = cfg.tf;
  const trades = [];
  const dailyPnL = new Map();

  for (const sym of targetSymbols) {
    const data = tfData[tf][sym];
    const candles = data.candles;
    const vwap = data.vwap;
    const ema8 = data.ema8;
    const len = candles.length;

    let inTrade = false;
    let entryPrice = 0;
    let entryTime = '';
    let entryIdx = 0;
    let stopLossPrice = 0;
    let cooldownUntil = 0;
    let entryType = '';

    // Warmup 50 bars
    for (let i = 50; i < len; i++) {
      const c = candles[i];
      const prevC = candles[i - 1];
      const curVWAP = vwap[i];
      const curEMA = ema8[i];

      if (i < cooldownUntil) continue;

      if (!inTrade) {
        // Must be above VWAP
        if (c.close > curVWAP) {
          let trigger = false;

          // SETUP 1: VWAP Retest / Bounce (Primary PB Setup)
          if (cfg.useVWAPBounce) {
            // Price low touched or came within 0.3% of VWAP, but candle closed above VWAP and is green
            const touchedVWAP = c.low <= curVWAP * 1.003 && c.close >= curVWAP;
            const greenCandle = c.close >= c.open;
            if (touchedVWAP && greenCandle) {
              trigger = true;
              entryType = 'VWAP Bounce / Retest';
            }
          }

          // SETUP 2: 8 EMA Pullback / Continuation
          if (!trigger && cfg.useEMAPullback) {
            // Price is above VWAP by at least 0.5%, touched 8 EMA, closed above 8 EMA and green
            const touchedEMA = c.low <= curEMA * 1.001 && c.close >= curEMA;
            const aboveVWAP = c.close >= curVWAP * 1.005;
            const greenCandle = c.close >= c.open;
            if (touchedEMA && aboveVWAP && greenCandle) {
              trigger = true;
              entryType = '8 EMA Pullback Continuation';
            }
          }

          if (trigger) {
            inTrade = true;
            entryPrice = c.close * (1 + slipRate);
            entryTime = c.time;
            entryIdx = i;

            // Stop loss: either fixed % or just below VWAP (capped by maxSL)
            if (cfg.slMode === 'VWAP_BASED') {
              const vwapSL = curVWAP * 0.995; // 0.5% below VWAP
              const distPct = ((entryPrice - vwapSL) / entryPrice) * 100;
              // Cap SL between 1.0% and cfg.maxSL
              const effectiveSLDist = Math.max(1.0, Math.min(cfg.maxSL || 2.5, distPct));
              stopLossPrice = entryPrice * (1 - effectiveSLDist / 100);
            } else {
              stopLossPrice = entryPrice * (1 - (cfg.fixedSL || 2.0) / 100);
            }
          }
        }
      } else {
        // IN TRADE
        let exitPrice = null;
        let exitReason = '';

        // 1. Check Stop Loss
        if (c.low <= stopLossPrice) {
          exitPrice = stopLossPrice * (1 - slipRate);
          exitReason = `Stop Loss Hit (-${(((entryPrice - stopLossPrice)/entryPrice)*100).toFixed(1)}%)`;
          cooldownUntil = i + (cfg.cooldownBars || 4);
        }
        // 2. PB's 8 EMA Trailing Exit (Close < 8 EMA)
        // Give trade at least 1 bar before checking 8 EMA exit
        else if (i > entryIdx && c.close < curEMA) {
          exitPrice = c.close * (1 - slipRate);
          exitReason = 'PB 8-EMA Break Below Exit';
        }
        // 3. Optional Profit Target (if configured)
        else if (cfg.takeProfitPct && c.high >= entryPrice * (1 + cfg.takeProfitPct / 100)) {
          exitPrice = entryPrice * (1 + cfg.takeProfitPct / 100) * (1 - slipRate);
          exitReason = `Target TP Hit (+${cfg.takeProfitPct}%)`;
        }
        // 4. Max Duration Limit (e.g., 24 bars = 6 hours on 15m)
        else if (i - entryIdx >= (cfg.maxBarsHeld || 24)) {
          exitPrice = c.close * (1 - slipRate);
          exitReason = 'Max Time Limit Exit';
        }

        if (exitPrice !== null) {
          const gross = ((exitPrice - entryPrice) / entryPrice) * 100;
          const net = gross - feeRoundTrip - (slipRate * 2 * 100);

          const durationHours = ((c.openTime - candles[entryIdx].openTime) / (3600 * 1000)).toFixed(1);
          const dayKey = c.time.split('T')[0];

          trades.push({
            tradeId: trades.length + 1,
            symbol: sym,
            timeframe: tf,
            entryType,
            entryTime,
            entryPrice: Number(entryPrice.toFixed(4)),
            exitTime: c.time,
            exitPrice: Number(exitPrice.toFixed(4)),
            durationHours: Number(durationHours),
            exitReason,
            grossReturnPct: Number(gross.toFixed(2)),
            feeDeductedPct: 0.23,
            netReturnPct: Number(net.toFixed(2)),
            outcome: net > 0.05 ? 'WIN' : (net >= -0.05 ? 'BREAK-EVEN' : 'LOSS')
          });

          if (!dailyPnL.has(dayKey)) dailyPnL.set(dayKey, 0);
          dailyPnL.set(dayKey, dailyPnL.get(dayKey) + net);

          inTrade = false;
        }
      }
    }
  }

  trades.sort((a, b) => new Date(a.entryTime).getTime() - new Date(b.entryTime).getTime());
  let runningEquity = 0;
  for (let t of trades) {
    runningEquity += t.netReturnPct;
    t.cumNetReturnPct = Number(runningEquity.toFixed(2));
  }

  const totalTrades = trades.length;
  const wins = trades.filter(t => t.outcome === 'WIN').length;
  const be = trades.filter(t => t.outcome === 'BREAK-EVEN').length;
  const losses = trades.filter(t => t.outcome === 'LOSS').length;
  const winRate = totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(1) : '0.0';
  const totalNet = trades.reduce((acc, t) => acc + t.netReturnPct, 0);
  const winSum = trades.filter(t => t.netReturnPct > 0.05).reduce((acc, t) => acc + t.netReturnPct, 0);
  const lossSum = Math.abs(trades.filter(t => t.netReturnPct < -0.05).reduce((acc, t) => acc + t.netReturnPct, 0));
  const profitFactor = lossSum > 0 ? (winSum / lossSum).toFixed(2) : (winSum > 0 ? '999.00' : '0.00');

  const days = Array.from(dailyPnL.keys());
  let profitableDays = 0;
  for (const d of days) {
    if (dailyPnL.get(d) > 0) profitableDays++;
  }

  return {
    name: cfg.name,
    tf,
    totalTrades,
    tradesPerDay: days.length > 0 ? (totalTrades / days.length).toFixed(1) : '0.0',
    wins,
    be,
    losses,
    winRate: winRate + '%',
    avgWin: wins > 0 ? '+' + (winSum / wins).toFixed(2) + '%' : '0.00%',
    avgLoss: losses > 0 ? '-' + (lossSum / losses).toFixed(2) + '%' : '0.00%',
    profitFactor,
    totalNetGain: (totalNet > 0 ? '+' : '') + totalNet.toFixed(2) + '%',
    profitableDays: `${profitableDays}/${days.length} (${days.length > 0 ? ((profitableDays/days.length)*100).toFixed(1) : 0}%)`,
    trades
  };
}

// EXPERIMENT SUITE FOR PB'S STRATEGY
const experiments = [
  // 1. Pure PB Setup: VWAP Bounce on 15m (All Coins)
  {
    name: '1. PB Pure VWAP Bounce (15m, All Coins, 8 EMA Trail)',
    tf: '15m',
    useVWAPBounce: true,
    useEMAPullback: false,
    slMode: 'VWAP_BASED',
    maxSL: 2.0,
    cooldownBars: 4,
    maxBarsHeld: 24
  },
  // 2. Pure PB Setup: VWAP Bounce on 15m (Liquid Altcoins Only)
  {
    name: '2. PB Pure VWAP Bounce (15m, Liquid Coins, 8 EMA Trail)',
    tf: '15m',
    liquidOnly: true,
    useVWAPBounce: true,
    useEMAPullback: false,
    slMode: 'VWAP_BASED',
    maxSL: 2.0,
    cooldownBars: 4,
    maxBarsHeld: 24
  },
  // 3. PB Combined: VWAP Bounce + 8 EMA Pullback (15m, Liquid Coins)
  {
    name: '3. PB VWAP + 8 EMA Pullback (15m, Liquid Coins, 8 EMA Trail)',
    tf: '15m',
    liquidOnly: true,
    useVWAPBounce: true,
    useEMAPullback: true,
    slMode: 'VWAP_BASED',
    maxSL: 2.0,
    cooldownBars: 4,
    maxBarsHeld: 24
  },
  // 4. PB on 30m Candles (Liquid Coins)
  {
    name: '4. PB Pure VWAP Bounce (30m, Liquid Coins, 8 EMA Trail)',
    tf: '30m',
    liquidOnly: true,
    useVWAPBounce: true,
    useEMAPullback: false,
    slMode: 'VWAP_BASED',
    maxSL: 2.5,
    cooldownBars: 2,
    maxBarsHeld: 24
  },
  // 5. PB VWAP Bounce with +2.5% Target Take-Profit (15m, Liquid Coins)
  {
    name: '5. PB VWAP Bounce + Fixed +2.5% TP (15m, Liquid Coins, 8 EMA Trail)',
    tf: '15m',
    liquidOnly: true,
    useVWAPBounce: true,
    useEMAPullback: false,
    takeProfitPct: 2.5,
    slMode: 'VWAP_BASED',
    maxSL: 2.0,
    cooldownBars: 4,
    maxBarsHeld: 24
  }
];

console.log('Running backtests across all models...');
const results = experiments.map(cfg => simulatePBStrategy(cfg));

console.log('\n====================================================================================================================================');
console.log('   PBINVESTING VWAP + 8 EMA QUANTITATIVE AUDIT RESULTS (BINANCE 2026 SPOT - REAL 0.20% FEES DEDUCTED)');
console.log('====================================================================================================================================\n');

console.table(results.map(r => ({
  Strategy: r.name,
  TF: r.tf,
  Trades: r.totalTrades,
  'Trades/Day': r.tradesPerDay,
  Wins: r.wins,
  Losses: r.losses,
  'Win Rate': r.winRate,
  'Avg Win': r.avgWin,
  'Avg Loss': r.avgLoss,
  'Profit Factor': r.profitFactor,
  'Profitable Days': r.profitableDays,
  'Total Net Gain': r.totalNetGain
})));

// Generate Excel Workbook
const wb = XLSX.utils.book_new();

const summaryRows = [
  { 'PBINVESTING STRATEGY AUDIT': 'Video Analyzed', 'VALUE': 'The ONLY 2 Indicators I use to make $4351/Day Trading (PBInvesting)' },
  { 'PBINVESTING STRATEGY AUDIT': 'Indicator 1', 'VALUE': 'Intraday VWAP (Volume Weighted Average Price) - Never long below VWAP, Buy VWAP Retests' },
  { 'PBINVESTING STRATEGY AUDIT': 'Indicator 2', 'VALUE': '8 EMA (Exponential Moving Average) - Dynamic Trailing Stop, Exit when candle closes below 8 EMA' },
  { 'PBINVESTING STRATEGY AUDIT': 'Exchange Fees Deducted', 'VALUE': '0.20% Round-trip Binance Spot Fee + 0.03% Slippage per trade' },
  {},
  { 'PBINVESTING STRATEGY AUDIT': 'MODEL COMPARISON RESULTS' },
  {
    'PBINVESTING STRATEGY AUDIT': 'Configuration',
    'VALUE': 'Timeframe',
    '__EMPTY': 'Trades',
    '__EMPTY_1': 'Trades/Day',
    '__EMPTY_2': 'Wins',
    '__EMPTY_3': 'Losses',
    '__EMPTY_4': 'Win Rate (%)',
    '__EMPTY_5': 'Avg Win (%)',
    '__EMPTY_6': 'Avg Loss (%)',
    '__EMPTY_7': 'Profit Factor',
    '__EMPTY_8': 'Profitable Days (%)',
    '__EMPTY_9': 'Total Net Gain (%)'
  }
];

results.forEach(r => {
  summaryRows.push({
    'PBINVESTING STRATEGY AUDIT': r.name,
    'VALUE': r.tf,
    '__EMPTY': r.totalTrades,
    '__EMPTY_1': r.tradesPerDay,
    '__EMPTY_2': r.wins,
    '__EMPTY_3': r.losses,
    '__EMPTY_4': r.winRate,
    '__EMPTY_5': r.avgWin,
    '__EMPTY_6': r.avgLoss,
    '__EMPTY_7': r.profitFactor,
    '__EMPTY_8': r.profitableDays,
    '__EMPTY_9': r.totalNetGain
  });
});

XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), 'PB Strategy Comparison');

// Export Trade Logs for Model 2 (Liquid Coins VWAP Bounce)
const model2Trades = results[1].trades.map(t => ({
  'Trade #': t.tradeId,
  'Symbol': t.symbol,
  'Timeframe': t.timeframe,
  'Entry Setup': t.entryType,
  'Entry Time (UTC)': t.entryTime,
  'Entry Price ($)': t.entryPrice,
  'Exit Time (UTC)': t.exitTime,
  'Exit Price ($)': t.exitPrice,
  'Duration (Hours)': t.durationHours,
  'Exit Reason': t.exitReason,
  'Gross Return (%)': t.grossReturnPct,
  'Round-trip Fee (%)': t.feeDeductedPct,
  'Net Return (%)': t.netReturnPct,
  'Cumulative Net (%)': t.cumNetReturnPct,
  'Outcome': t.outcome
}));
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(model2Trades), 'Model 2 Trade Log (Liquid 15m)');

// Export Trade Logs for Model 3 (VWAP + 8 EMA Pullback)
const model3Trades = results[2].trades.map(t => ({
  'Trade #': t.tradeId,
  'Symbol': t.symbol,
  'Timeframe': t.timeframe,
  'Entry Setup': t.entryType,
  'Entry Time (UTC)': t.entryTime,
  'Entry Price ($)': t.entryPrice,
  'Exit Time (UTC)': t.exitTime,
  'Exit Price ($)': t.exitPrice,
  'Duration (Hours)': t.durationHours,
  'Exit Reason': t.exitReason,
  'Gross Return (%)': t.grossReturnPct,
  'Round-trip Fee (%)': t.feeDeductedPct,
  'Net Return (%)': t.netReturnPct,
  'Cumulative Net (%)': t.cumNetReturnPct,
  'Outcome': t.outcome
}));
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(model3Trades), 'Model 3 Trade Log (VWAP+EMA)');

const excelPath = path.join(outDir, 'nexus_quant_pbinvesting_vwap_8ema_audit.xlsx');
XLSX.writeFile(wb, excelPath);
console.log('\nSaved complete Excel workbook to:', excelPath);
