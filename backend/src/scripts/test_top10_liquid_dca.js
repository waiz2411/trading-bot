import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';

const cacheDir = './src/data/binance_cache';
const outDir = 'C:/Users/waizt/.gemini/antigravity/brain/9240cc1b-f576-4996-a196-552f1f9e4603';

console.log('=== TESTING TOP 10 LIQUID COINS + BTC MARKET SHIELD DCA ===');

const top10Symbols = ['ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'AVAXUSDT', 'LINKUSDT', 'NEARUSDT', 'SUIUSDT', 'LTCUSDT'];
const rawDatasets = {};

for (const sym of top10Symbols) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(cacheDir, `${sym}_15m_60d.json`), 'utf8'));
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
    rawDatasets[sym] = parsed;
  } catch (_) {}
}

// BTC Data
const rawBTC = JSON.parse(fs.readFileSync(path.join(cacheDir, 'BTCUSDT_15m_60d.json'), 'utf8'));
const btc15 = rawBTC.map(c => ({
  openTime: c.openTime || c[0],
  close: Number(c.close || c[4])
})).filter(c => c.openTime >= 1767225600000 && !isNaN(c.close));
btc15.sort((a, b) => a.openTime - b.openTime);

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

const btcEMA200 = calculateEMA(btc15.map(c => c.close), 200);
const btcRSI = calculateRSI14(btc15);
const btcMap = new Map();
btc15.forEach((c, idx) => btcMap.set(c.openTime, idx));

const coinIndicators = {};
for (const sym of Object.keys(rawDatasets)) {
  coinIndicators[sym] = {
    rsi14: calculateRSI14(rawDatasets[sym])
  };
}

const feeRate = 0.0010;
const slipRate = 0.00015;

function simulateTop10DCA(cfg) {
  const deals = [];
  const dailyPnL = new Map();

  for (const sym of Object.keys(rawDatasets)) {
    const candles = rawDatasets[sym];
    const rsi = coinIndicators[sym].rsi14;
    const len = candles.length;

    let inDeal = false;
    let entries = [];
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
        // BTC Market Guard: Don't open new deals if BTC is in freefall (RSI < 35 or Close < EMA200)
        if (cfg.btcGuard) {
          const btcIdx = btcMap.get(c.openTime);
          if (btcIdx !== undefined) {
            if (btcRSI[btcIdx] < 35 || btc15[btcIdx].close < btcEMA200[btcIdx]) continue;
          }
        }

        // Deal Entry: RSI < 32 and green reversal
        if (rsi[i - 1] < 32 && rsi[i] >= 30 && c.close >= c.open) {
          inDeal = true;
          dealStartTime = c.time;
          dealStartIdx = i;
          soCount = 0;

          const basePrice = c.close * (1 + slipRate);
          const baseCost = 100;
          const baseSize = baseCost / basePrice;

          entries = [{ price: basePrice, size: baseSize, cost: baseCost }];
          totalCost = baseCost;
          totalSize = baseSize;
          avgEntryPrice = basePrice;

          nextSOPrice = basePrice * (1 - cfg.soStepPct / 100);
          if (cfg.emergencySL) emergencySLPrice = basePrice * (1 - cfg.emergencySL / 100);
        }
      } else {
        let dealExitPrice = null;
        let dealExitReason = '';

        // Take Profit from average entry price
        const targetPrice = avgEntryPrice * (1 + cfg.tpPct / 100);
        if (c.high >= targetPrice) {
          dealExitPrice = targetPrice * (1 - slipRate);
          dealExitReason = `Take Profit Hit (+${cfg.tpPct}%)`;
        }
        // Emergency SL
        else if (cfg.emergencySL && c.low <= emergencySLPrice) {
          dealExitPrice = emergencySLPrice * (1 - slipRate);
          dealExitReason = `Emergency SL Hit (-${cfg.emergencySL}%)`;
          cooldownUntil = i + 12;
        }
        // Safety Order Fill
        else if (soCount < cfg.maxSO && c.low <= nextSOPrice) {
          soCount++;
          const fillPrice = nextSOPrice * (1 + slipRate);
          const nextCost = 100 * Math.pow(cfg.soVolumeScale, soCount);
          const nextSize = nextCost / fillPrice;

          entries.push({ price: fillPrice, size: nextSize, cost: nextCost });
          totalCost += nextCost;
          totalSize += nextSize;
          avgEntryPrice = totalCost / totalSize;

          const nextStep = cfg.soStepPct * Math.pow(cfg.soStepScale || 1.2, soCount);
          nextSOPrice = fillPrice * (1 - nextStep / 100);

          if (cfg.emergencySL) {
            emergencySLPrice = avgEntryPrice * (1 - (cfg.emergencySL / 100));
          }
        }
        // Max Time Limit Exit
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
            outcome: netPnLDollar > 0 ? 'WIN' : 'LOSS',
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

const suite = [
  // Model A: Top 10 Coins, Raw (+0.8% TP, 2 SOs @ 1.8% step)
  {
    name: 'A. Top 10 Liquid Coins (+0.8% TP, 2 SOs @ 1.8% step, 6% SL)',
    tpPct: 0.8,
    soStepPct: 1.8,
    maxSO: 2,
    soVolumeScale: 1.5,
    emergencySL: 6.0,
    btcGuard: false
  },
  // Model B: Top 10 Coins + BTC Guard (+0.8% TP, 2 SOs @ 1.8% step, 6% SL)
  {
    name: 'B. Top 10 Liquid + BTC Guard (+0.8% TP, 2 SOs @ 1.8% step, 6% SL)',
    tpPct: 0.8,
    soStepPct: 1.8,
    maxSO: 2,
    soVolumeScale: 1.5,
    emergencySL: 6.0,
    btcGuard: true
  },
  // Model C: Top 10 Coins + BTC Guard (+1.2% TP, 3 SOs @ 2.0% step, 10% SL)
  {
    name: 'C. Top 10 Liquid + BTC Guard (+1.2% TP, 3 SOs @ 2.0% step, 10% SL)',
    tpPct: 1.2,
    soStepPct: 2.0,
    maxSO: 3,
    soVolumeScale: 1.5,
    emergencySL: 10.0,
    btcGuard: true
  },
  // Model D: Top 10 Coins + BTC Guard (+0.7% TP, 3 SOs @ 1.5% step, No hard SL, 5-day horizon)
  {
    name: 'D. Top 10 Liquid + BTC Guard (+0.7% TP, 3 SOs @ 1.5% step, 5-day horizon)',
    tpPct: 0.7,
    soStepPct: 1.5,
    maxSO: 3,
    soVolumeScale: 1.5,
    emergencySL: null,
    btcGuard: true,
    maxBars: 480
  }
];

console.log('Running Top 10 Liquid DCA suite...');
const results = suite.map(simulateTop10DCA);

console.log('\n========================================================================================================================');
console.log('   TOP 10 LIQUID COINS SPOT DCA RESULTS (2026 AUDIT WITH REAL 0.20% FEES)');
console.log('========================================================================================================================\n');

console.table(results.map(r => ({
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

// Save Excel
const wb = XLSX.utils.book_new();
const summarySheet = results.map(r => ({
  'Configuration': r.name,
  'Total Deals': r.deals,
  'Deals/Day': r.dealsPerDay,
  'Wins': r.wins,
  'Losses': r.losses,
  'Win Rate': r.winRate,
  'Avg Net Return/Deal': r.avgNetPct,
  'Avg Win': r.avgWinUSD,
  'Avg Loss': r.avgLossUSD,
  'Profit Factor': r.profitFactor,
  'Profitable Days': r.profitableDays,
  'Total Net Profit': r.totalNetUSD
}));
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summarySheet), 'Top 10 DCA Comparison');

// Export Deal Log of Model D
const dealRows = results[3].dealList.map((d, idx) => ({
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
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dealRows), 'Model D Deal Log');

const outPath = path.join(outDir, 'nexus_quant_top10_liquid_dca_audit.xlsx');
XLSX.writeFile(wb, outPath);
console.log('Saved Top 10 DCA workbook to:', outPath);
