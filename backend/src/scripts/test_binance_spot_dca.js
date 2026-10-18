import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';

const cacheDir = './src/data/binance_cache';
const outDir = 'C:/Users/waizt/.gemini/antigravity/brain/9240cc1b-f576-4996-a196-552f1f9e4603';

console.log('=== TESTING HIGH-PROBABILITY DCA / SAFETY-ORDER SCALPING ENGINE ===');

const files = fs.readdirSync(cacheDir).filter(f => f.endsWith('.json'));
const rawDatasets = {};

for (const file of files) {
  const sym = file.split('_')[0];
  if (['PAXGUSDT', 'FDUSDUSDT', 'USDCUSDT', 'BTCUSDT'].includes(sym)) continue;
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

const symbols = Object.keys(rawDatasets);
console.log(`Loaded ${symbols.length} altcoins.`);

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

const coinIndicators = {};
for (const sym of symbols) {
  coinIndicators[sym] = {
    rsi14: calculateRSI14(rawDatasets[sym])
  };
}

const feeRate = 0.0010; // 0.10% each side
const slipRate = 0.00015;

/**
 * DCA Engine Simulation
 * @param {Object} cfg
 * - tpPct: Target net gain from average price (e.g., 0.8% or 1.0%)
 * - soStepPct: Safety order step (e.g., 1.5% drop)
 * - maxSO: Max safety orders (e.g., 2 or 3)
 * - soVolumeScale: Multiplier for safety orders (e.g., 1.5)
 * - stopLossPct: Emergency hard stop loss (e.g., -6.0% or none)
 */
function simulateDCAEngine(cfg) {
  const deals = [];
  const dailyPnL = new Map();

  for (const sym of symbols) {
    const candles = rawDatasets[sym];
    const rsi = coinIndicators[sym].rsi14;
    const len = candles.length;

    let inDeal = false;
    let entries = []; // { price, size, cost }
    let avgEntryPrice = 0;
    let totalSize = 0;
    let totalCost = 0;
    let dealStartTime = '';
    let dealStartIdx = 0;
    let nextSOPrice = 0;
    let soCount = 0;
    let emergencySLPrice = 0;
    let cooldownUntil = 0;

    for (let i = 50; i < len; i++) {
      const c = candles[i];
      if (i < cooldownUntil) continue;

      if (!inDeal) {
        // Entry Trigger: 15m RSI drops <= 30 and re-enters or touches <= 32
        if (rsi[i - 1] < 32 && rsi[i] >= 30 && c.close >= c.open) {
          inDeal = true;
          dealStartTime = c.time;
          dealStartIdx = i;
          soCount = 0;

          const basePrice = c.close * (1 + slipRate);
          const baseCost = 100; // $100 base unit
          const baseSize = baseCost / basePrice;

          entries = [{ price: basePrice, size: baseSize, cost: baseCost }];
          totalCost = baseCost;
          totalSize = baseSize;
          avgEntryPrice = basePrice;

          nextSOPrice = basePrice * (1 - cfg.soStepPct / 100);
          if (cfg.emergencySL) {
            emergencySLPrice = basePrice * (1 - cfg.emergencySL / 100);
          }
        }
      } else {
        // IN DEAL
        let dealExitPrice = null;
        let dealExitReason = '';

        // 1. Check Take Profit Target from Average Entry Price
        const targetPrice = avgEntryPrice * (1 + cfg.tpPct / 100);
        if (c.high >= targetPrice) {
          dealExitPrice = targetPrice * (1 - slipRate);
          dealExitReason = `Take Profit Hit (+${cfg.tpPct}%)`;
        }
        // 2. Check Emergency Stop Loss (if enabled)
        else if (cfg.emergencySL && c.low <= emergencySLPrice) {
          dealExitPrice = emergencySLPrice * (1 - slipRate);
          dealExitReason = `Emergency SL Hit (-${cfg.emergencySL}%)`;
          cooldownUntil = i + 8;
        }
        // 3. Check Safety Order Fill
        else if (soCount < cfg.maxSO && c.low <= nextSOPrice) {
          soCount++;
          const fillPrice = nextSOPrice * (1 + slipRate);
          const nextCost = 100 * Math.pow(cfg.soVolumeScale, soCount);
          const nextSize = nextCost / fillPrice;

          entries.push({ price: fillPrice, size: nextSize, cost: nextCost });
          totalCost += nextCost;
          totalSize += nextSize;
          avgEntryPrice = totalCost / totalSize;

          // Next Safety Order price
          const nextStep = cfg.soStepPct * Math.pow(cfg.soStepScale || 1.2, soCount);
          nextSOPrice = fillPrice * (1 - nextStep / 100);

          if (cfg.emergencySL) {
            emergencySLPrice = avgEntryPrice * (1 - (cfg.emergencySL / 100));
          }
        }
        // 4. Time Limit Exit (e.g. 5 days = 480 bars of 15m)
        else if (i - dealStartIdx >= (cfg.maxBars || 480)) {
          dealExitPrice = c.close * (1 - slipRate);
          dealExitReason = 'Max Time Horizon Exit';
        }

        if (dealExitPrice !== null) {
          const grossProceeds = totalSize * dealExitPrice;
          const feePaid = (totalCost * feeRate) + (grossProceeds * feeRate);
          const netPnLDollar = grossProceeds - totalCost - feePaid;
          const netReturnPct = (netPnLDollar / totalCost) * 100;

          const durationHours = ((c.openTime - candles[dealStartIdx].openTime) / (3600 * 1000)).toFixed(1);
          const day = c.time.split('T')[0];

          deals.push({
            symbol: sym,
            startTime: dealStartTime,
            exitTime: c.time,
            safetyOrdersFilled: soCount,
            totalInvestedUSD: Number(totalCost.toFixed(2)),
            avgEntryPrice: Number(avgEntryPrice.toFixed(4)),
            exitPrice: Number(dealExitPrice.toFixed(4)),
            netPnLDollar: Number(netPnLDollar.toFixed(2)),
            netReturnPct: Number(netReturnPct.toFixed(2)),
            durationHours: Number(durationHours),
            outcome: netReturnPct > 0 ? 'WIN' : 'LOSS',
            exitReason: dealExitReason
          });

          if (!dailyPnL.has(day)) dailyPnL.set(day, 0);
          dailyPnL.set(day, dailyPnL.get(day) + netPnLDollar);

          inDeal = false;
        }
      }
    }
  }

  deals.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  let running = 0;
  for (let d of deals) {
    running += d.netPnLDollar;
    d.cumDollar = Number(running.toFixed(2));
  }

  const total = deals.length;
  const wins = deals.filter(d => d.outcome === 'WIN').length;
  const losses = deals.filter(d => d.outcome === 'LOSS').length;
  const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : '0.0';
  const totalNetUSD = deals.reduce((acc, d) => acc + d.netPnLDollar, 0);
  const winSum = deals.filter(d => d.netPnLDollar > 0).reduce((acc, d) => acc + d.netPnLDollar, 0);
  const lossSum = Math.abs(deals.filter(d => d.netPnLDollar < 0).reduce((acc, d) => acc + d.netPnLDollar, 0));
  const pf = lossSum > 0 ? (winSum / lossSum).toFixed(2) : (winSum > 0 ? '999.00' : '0.00');

  const days = Array.from(dailyPnL.keys()).sort();
  let posDays = 0;
  for (const d of days) {
    if (dailyPnL.get(d) > 0) posDays++;
  }
  const dayWinRate = days.length > 0 ? ((posDays / days.length) * 100).toFixed(1) : '0.0';

  const avgWinUSD = wins > 0 ? (winSum / wins).toFixed(2) : '0.00';
  const avgLossUSD = losses > 0 ? (lossSum / losses).toFixed(2) : '0.00';
  const avgNetPct = total > 0 ? (deals.reduce((acc, d) => acc + d.netReturnPct, 0) / total).toFixed(2) : '0.00';

  return {
    name: cfg.name,
    deals: total,
    dealsPerDay: days.length > 0 ? (total / days.length).toFixed(1) : '0.0',
    wins,
    losses,
    winRate: winRate + '%',
    avgNetPct: (avgNetPct > 0 ? '+' : '') + avgNetPct + '%',
    avgWinUSD: '+$' + avgWinUSD,
    avgLossUSD: '-$' + avgLossUSD,
    profitFactor: pf,
    profitableDays: `${posDays}/${days.length} (${dayWinRate}%)`,
    totalNetUSD: (totalNetUSD > 0 ? '+$' : '-$') + Math.abs(totalNetUSD).toFixed(2),
    dealList: deals
  };
}

const configs = [
  // Model 1: Fast Scalp (0.8% TP, 1.5% SO Step, 2 SOs, 1.5x scale, -6% Emergency SL)
  {
    name: '1. Fast Scalp (+0.8% TP, 2 SOs @ 1.5% step, 6% SL)',
    tpPct: 0.8,
    soStepPct: 1.5,
    maxSO: 2,
    soVolumeScale: 1.5,
    emergencySL: 6.0
  },
  // Model 2: Wider Scalp (+1.2% TP, 2.0% SO Step, 2 SOs, 1.5x scale, -8% Emergency SL)
  {
    name: '2. Wider Scalp (+1.2% TP, 2 SOs @ 2.0% step, 8% SL)',
    tpPct: 1.2,
    soStepPct: 2.0,
    maxSO: 2,
    soVolumeScale: 1.5,
    emergencySL: 8.0
  },
  // Model 3: Conservative DCA (+1.5% TP, 2.5% SO Step, 3 SOs, 1.5x scale, -10% Emergency SL)
  {
    name: '3. Conservative DCA (+1.5% TP, 3 SOs @ 2.5% step, 10% SL)',
    tpPct: 1.5,
    soStepPct: 2.5,
    maxSO: 3,
    soVolumeScale: 1.5,
    emergencySL: 10.0
  },
  // Model 4: Pure Mean-Reversion (+0.6% Micro-TP, 1.2% Step, 3 SOs, No hard SL, 5-day horizon)
  {
    name: '4. Micro-TP (+0.6% Net TP, 3 SOs @ 1.2% step, 5-day time exit)',
    tpPct: 0.6,
    soStepPct: 1.2,
    maxSO: 3,
    soVolumeScale: 1.5,
    emergencySL: null,
    maxBars: 480
  }
];

console.log('Running DCA simulations across all 93 altcoins...');
const suiteResults = configs.map(simulateDCAEngine);

console.log('\n========================================================================================================================');
console.log('   BINANCE SPOT DCA / SAFETY-ORDER SCALPING QUANTITATIVE RESULTS (2026 AUDIT WITH REAL 0.20% FEES)');
console.log('========================================================================================================================\n');

console.table(suiteResults.map(r => ({
  Model: r.name,
  Deals: r.deals,
  'Deals/Day': r.dealsPerDay,
  Wins: r.wins,
  Losses: r.losses,
  'Win Rate': r.winRate,
  'Avg Net Return': r.avgNetPct,
  'Avg Win ($)': r.avgWinUSD,
  'Avg Loss ($)': r.avgLossUSD,
  'Profit Factor': r.profitFactor,
  'Profitable Days': r.profitableDays,
  'Total Net ($)': r.totalNetUSD
})));

// Save Excel workbook
const wb = XLSX.utils.book_new();

const summaryRows = [
  { 'BINANCE SPOT DCA AUDIT': 'Objective', 'VALUE': 'Achieve net positive daily profits (+0.3% - +0.8% per deal net) via high-probability Spot DCA' },
  { 'BINANCE SPOT DCA AUDIT': 'Fees Applied', 'VALUE': '0.10% Maker/Taker Buy + 0.10% Sell + 0.03% Slippage deducted from every order' },
  {},
  {
    'BINANCE SPOT DCA AUDIT': 'Model Name',
    'VALUE': 'Completed Deals',
    '__EMPTY': 'Deals/Day',
    '__EMPTY_1': 'Wins',
    '__EMPTY_2': 'Losses',
    '__EMPTY_3': 'Win Rate (%)',
    '__EMPTY_4': 'Avg Net Return/Deal (%)',
    '__EMPTY_5': 'Avg Win ($)',
    '__EMPTY_6': 'Avg Loss ($)',
    '__EMPTY_7': 'Profit Factor',
    '__EMPTY_8': 'Profitable Days (%)',
    '__EMPTY_9': 'Total Net Profit ($)'
  }
];

suiteResults.forEach(r => {
  summaryRows.push({
    'BINANCE SPOT DCA AUDIT': r.name,
    'VALUE': r.deals,
    '__EMPTY': r.dealsPerDay,
    '__EMPTY_1': r.wins,
    '__EMPTY_2': r.losses,
    '__EMPTY_3': r.winRate,
    '__EMPTY_4': r.avgNetPct,
    '__EMPTY_5': r.avgWinUSD,
    '__EMPTY_6': r.avgLossUSD,
    '__EMPTY_7': r.profitFactor,
    '__EMPTY_8': r.profitableDays,
    '__EMPTY_9': r.totalNetUSD
  });
});

XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), 'DCA Strategy Comparison');

// Export Deal Log of Model 4 and Model 1
const model4Deals = suiteResults[3].dealList.slice(0, 1000).map((d, idx) => ({
  'Deal #': idx + 1,
  'Symbol': d.symbol,
  'Start Time (UTC)': d.startTime,
  'Exit Time (UTC)': d.exitTime,
  'Safety Orders Filled': d.safetyOrdersFilled,
  'Total Invested ($)': d.totalInvestedUSD,
  'Avg Entry Price ($)': d.avgEntryPrice,
  'Exit Price ($)': d.exitPrice,
  'Net PnL ($)': d.netPnLDollar,
  'Net Return (%)': d.netReturnPct,
  'Cumulative Profit ($)': d.cumDollar,
  'Duration (Hours)': d.durationHours,
  'Outcome': d.outcome,
  'Exit Reason': d.exitReason
}));

XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(model4Deals), 'Model 4 Deal Log (1000 Deals)');

const outPath = path.join(outDir, 'nexus_quant_binance_spot_dca_audit.xlsx');
XLSX.writeFile(wb, outPath);
console.log('Saved DCA workbook to:', outPath);
