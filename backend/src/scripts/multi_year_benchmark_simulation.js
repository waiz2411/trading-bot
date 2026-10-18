import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cacheDir = path.resolve(__dirname, '../data/multi_year_cache');

const SYMBOLS = [
  'ETHUSDT',
  'BNBUSDT',
  'ADAUSDT',
  'LTCUSDT',
  'LINKUSDT',
  'SOLUSDT',
  'DOGEUSDT',
  'XRPUSDT',
  'ETCUSDT'
];

function resampleTo4H(c15m) {
  const buckets = new Map();
  for (const c of c15m) {
    const b = c.openTime - (c.openTime % (4 * 3600 * 1000));
    let group = buckets.get(b);
    if (!group) { group = []; buckets.set(b, group); }
    group.push(c);
  }
  const c4h = [];
  for (const [openTime, slice] of buckets.entries()) {
    c4h.push({
      openTime,
      time: new Date(openTime).toISOString(),
      open: slice[0].open,
      high: Math.max(...slice.map(c => c.high)),
      low: Math.min(...slice.map(c => c.low)),
      close: slice[slice.length - 1].close,
      volume: slice.reduce((acc, c) => acc + c.volume, 0)
    });
  }
  c4h.sort((a, b) => a.openTime - b.openTime);
  return c4h;
}

function calculateTech(candles) {
  const len = candles.length;
  const closes = candles.map(c => c.close);
  const ema21 = new Float64Array(len);
  const ema50 = new Float64Array(len);
  const rsi14 = new Float64Array(len);

  const k21 = 2 / 22, k50 = 2 / 51;
  let e21 = closes[0], e50 = closes[0];
  for (let i = 0; i < len; i++) {
    const cl = closes[i];
    e21 = i === 0 ? cl : cl * k21 + e21 * (1 - k21);
    e50 = i === 0 ? cl : cl * k50 + e50 * (1 - k50);
    ema21[i] = e21; ema50[i] = e50;
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
  return { ema21, ema50, rsi14 };
}

console.log('Loading cached multi-year datasets...');
const btcRaw = JSON.parse(fs.readFileSync(path.join(cacheDir, 'BTCUSDT_15m_2020_2026.json'), 'utf8'));
const btc4 = resampleTo4H(btcRaw);
const btcTech4 = calculateTech(btc4);
const btcMap4 = new Map();
btc4.forEach((c, idx) => btcMap4.set(c.openTime, idx));

const sym15m = {};
const sym4h = {};

for (const sym of SYMBOLS) {
  const p = path.join(cacheDir, `${sym}_15m_2020_2026.json`);
  if (!fs.existsSync(p)) continue;
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  const tech15 = calculateTech(raw);
  const map15 = new Map();
  raw.forEach((c, i) => map15.set(c.openTime, i));
  sym15m[sym] = { candles: raw, tech: tech15, timeMap: map15 };

  const c4 = resampleTo4H(raw);
  const tech4 = calculateTech(c4);
  const map4 = new Map();
  c4.forEach((c, i) => map4.set(c.openTime, i));
  sym4h[sym] = { candles: c4, tech: tech4, timeMap: map4 };
}

function runSimulation(config) {
  const { name, tp, sl, beTrigger, beLock, trTrigger, trDist, maxHoldBars, feeRate, slipRate } = config;
  let balance = 100.0;
  let activeTrades = [];
  const closedTrades = [];
  const monthlyData = {};

  const timeline = btcRaw.map(c => c.openTime);

  for (let tIdx = 100; tIdx < timeline.length; tIdx++) {
    const openTime = timeline[tIdx];
    const date = new Date(openTime);
    const year = date.getUTCFullYear();
    const monthKey = `${year}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

    if (!monthlyData[monthKey]) {
      monthlyData[monthKey] = {
        month: monthKey,
        year,
        startBalance: balance,
        trades: 0,
        wins: 0,
        losses: 0,
        netProfitDollar: 0
      };
    }

    // Exits
    for (let pIdx = activeTrades.length - 1; pIdx >= 0; pIdx--) {
      const pos = activeTrades[pIdx];
      const sObj = sym15m[pos.symbol];
      if (!sObj) continue;
      const cIdx = sObj.timeMap.get(openTime);
      if (cIdx === undefined) continue;

      const c = sObj.candles[cIdx];
      pos.barsHeld++;

      let exitPrice = null;
      let exitReason = null;

      if (c.low <= pos.currentStop) {
        exitPrice = pos.currentStop * (1 - slipRate);
        exitReason = pos.slAdjusted ? 'BE_STOP' : 'HARD_SL';
      } else if (c.high >= pos.entryPrice * (1 + tp / 100)) {
        exitPrice = pos.entryPrice * (1 + tp / 100) * (1 - slipRate);
        exitReason = 'TAKE_PROFIT';
      } else if (pos.barsHeld >= maxHoldBars) {
        exitPrice = c.close * (1 - slipRate);
        exitReason = 'TIME_EXIT';
      } else {
        const peakGain = ((c.high - pos.entryPrice) / pos.entryPrice) * 100;
        if (c.high > pos.peakPrice) pos.peakPrice = c.high;

        if (trTrigger && peakGain >= trTrigger) {
          const trStop = pos.peakPrice * (1 - trDist / 100);
          if (trStop > pos.currentStop) {
            pos.currentStop = trStop;
            pos.slAdjusted = true;
          }
        } else if (beTrigger && peakGain >= beTrigger) {
          const beStop = pos.entryPrice * (1 + beLock / 100);
          if (beStop > pos.currentStop) {
            pos.currentStop = beStop;
            pos.slAdjusted = true;
          }
        }
      }

      if (exitPrice !== null) {
        const notional = pos.notional;
        const grossReturnPct = ((exitPrice - pos.entryPrice) / pos.entryPrice) * 100;
        const grossGain = notional * (grossReturnPct / 100);
        const fees = notional * feeRate * 2;
        const netPnL = grossGain - fees;

        balance = Number((balance + netPnL).toFixed(2));

        const tradeMonth = pos.entryTime.slice(0, 7);
        if (monthlyData[tradeMonth]) {
          monthlyData[tradeMonth].trades++;
          if (netPnL > 0) monthlyData[tradeMonth].wins++;
          else monthlyData[tradeMonth].losses++;
          monthlyData[tradeMonth].netProfitDollar += netPnL;
        }

        closedTrades.push({
          symbol: pos.symbol,
          entryTime: pos.entryTime,
          exitTime: c.time,
          exitPrice,
          exitReason,
          netPnL,
          grossReturnPct,
          netReturnPct: grossReturnPct - (feeRate * 2 * 100) - (slipRate * 100),
          durationMin: pos.barsHeld * 15,
          year,
          monthKey,
          balanceAfter: balance
        });

        activeTrades.splice(pIdx, 1);
      }
    }

    // Entries: 1 active trade at a time, fully compounding
    if (activeTrades.length < 1) {
      const fourHourBucket = (openTime - (openTime % (4 * 3600 * 1000))) - (4 * 3600 * 1000);
      const btcIdx4 = btcMap4.get(fourHourBucket);
      if (btcIdx4 !== undefined && btcIdx4 >= 50 && btc4[btcIdx4].close < btcTech4.ema50[btcIdx4]) {
        // BTC Macro Bear regime: skip trading to preserve capital
        continue;
      }

      let bestCand = null;
      let highestScore = -Infinity;

      for (const sym of SYMBOLS) {
        const c15Obj = sym15m[sym];
        const c4Obj = sym4h[sym];
        if (!c15Obj || !c4Obj) continue;

        const idx15 = c15Obj.timeMap.get(openTime);
        const idx4 = c4Obj.timeMap.get(fourHourBucket);
        if (idx15 === undefined || idx15 < 20 || idx4 === undefined || idx4 < 50) continue;

        const is4hBull = c4Obj.tech.ema21[idx4] > c4Obj.tech.ema50[idx4] && c4Obj.candles[idx4].close > c4Obj.tech.ema50[idx4];
        if (!is4hBull) continue;

        const c15 = c15Obj.candles[idx15];
        const rsi15 = c15Obj.tech.rsi14[idx15];
        if (rsi15 > 30) continue;

        const candleRange = c15.high - c15.low;
        if (candleRange <= 0) continue;
        const lowerWick = Math.min(c15.open, c15.close) - c15.low;
        if ((lowerWick / candleRange) < 0.35) continue;

        const score = (50 - rsi15) * 2;
        if (score > highestScore) {
          highestScore = score;
          bestCand = { symbol: sym, price: c15.close * (1 + slipRate), time: c15.time };
        }
      }

      if (bestCand) {
        activeTrades.push({
          symbol: bestCand.symbol,
          entryPrice: bestCand.price,
          entryTime: bestCand.time,
          notional: balance,
          peakPrice: bestCand.price,
          currentStop: bestCand.price * (1 - sl / 100),
          slAdjusted: false,
          barsHeld: 0
        });
      }
    }
  }

  // Yearly Summary
  const years = [2020, 2021, 2022, 2023, 2024, 2025, 2026];
  const yearlyStats = [];

  let prevBal = 100.0;
  for (const y of years) {
    const yTrades = closedTrades.filter(t => t.year === y);
    const wins = yTrades.filter(t => t.netPnL > 0);
    const endBal = yTrades.length > 0 ? yTrades[yTrades.length - 1].balanceAfter : prevBal;
    const growthPct = prevBal > 0 ? ((endBal - prevBal) / prevBal) * 100 : 0;

    yearlyStats.push({
      year: y,
      trades: yTrades.length,
      wins: wins.length,
      winRate: yTrades.length > 0 ? ((wins.length / yTrades.length) * 100).toFixed(1) + '%' : '0%',
      startBalance: '$' + prevBal.toFixed(2),
      endBalance: '$' + endBal.toFixed(2),
      growthPct: (growthPct >= 0 ? '+' : '') + growthPct.toFixed(1) + '%'
    });
    prevBal = endBal;
  }

  return { name, finalBalance: balance, totalTrades: closedTrades.length, yearlyStats, closedTrades, monthlyData };
}

console.log('Running Option B (6.0% Macro Alpha Scalper) across 2020-2026...');
const resB = runSimulation({
  name: 'Option B (6.0% Macro Alpha)',
  tp: 6.0,
  sl: 2.0,
  beTrigger: 2.0,
  beLock: 0.25,
  trTrigger: 3.5,
  trDist: 1.2,
  maxHoldBars: 32, // 8h
  feeRate: 0.0010,
  slipRate: 0.0003
});

console.log('Running Option A (3.0% Fast Scalp) across 2020-2026...');
const resA = runSimulation({
  name: 'Option A (3.0% Fast Scalp)',
  tp: 3.0,
  sl: 1.5,
  beTrigger: 1.5,
  beLock: 0.25,
  trTrigger: null,
  trDist: null,
  maxHoldBars: 16, // 4h
  feeRate: 0.0010,
  slipRate: 0.0003
});

console.log('\n=============================================================');
console.log('OPTION B (6.0% MACRO ALPHA SCALPER) - 7-YEAR AUDIT');
console.log('=============================================================');
console.table(resB.yearlyStats);
console.log(`Final Compounded Balance: $${resB.finalBalance.toFixed(2)} (from $100)`);

console.log('\n=============================================================');
console.log('OPTION A (3.0% FAST SCALP) - 7-YEAR AUDIT');
console.log('=============================================================');
console.table(resA.yearlyStats);
console.log(`Final Compounded Balance: $${resA.finalBalance.toFixed(2)} (from $100)`);

// Export Excel with complete monthly and trade breakdown
const wb = XLSX.utils.book_new();

// Sheet 1: Comparison
const compAoa = [
  ['NEXUS QUANT 7-YEAR MULTI-CYCLE AUDIT (2020 - 2026)'],
  ['Assets Tested', SYMBOLS.join(', ')],
  ['BTC Macro Regime', 'Trading strictly paused when BTC 4H Close < BTC 4H EMA 50'],
  ['Fees & Slippage', '0.20% Round-trip Binance Spot Fee + 0.03% Slippage per trade'],
  [],
  ['OPTION B (6.0% Macro Alpha Scalper) - YEARLY PERFORMANCE'],
  ['Year', 'Trades', 'Wins', 'Win Rate', 'Start Balance', 'End Balance', 'Annual Return']
];

for (const y of resB.yearlyStats) {
  compAoa.push([y.year, y.trades, y.wins, y.winRate, y.startBalance, y.endBalance, y.growthPct]);
}
compAoa.push(['7-Year Total', resB.totalTrades, '', '', '$100.00', '$' + resB.finalBalance.toFixed(2), '+' + (((resB.finalBalance - 100)/100)*100).toFixed(1) + '%']);

compAoa.push([]);
compAoa.push(['OPTION A (3.0% Fast Scalper) - YEARLY PERFORMANCE']);
compAoa.push(['Year', 'Trades', 'Wins', 'Win Rate', 'Start Balance', 'End Balance', 'Annual Return']);
for (const y of resA.yearlyStats) {
  compAoa.push([y.year, y.trades, y.wins, y.winRate, y.startBalance, y.endBalance, y.growthPct]);
}
compAoa.push(['7-Year Total', resA.totalTrades, '', '', '$100.00', '$' + resA.finalBalance.toFixed(2), '+' + (((resA.finalBalance - 100)/100)*100).toFixed(1) + '%']);

const wsComp = XLSX.utils.aoa_to_sheet(compAoa);
XLSX.utils.book_append_sheet(wb, wsComp, 'Multi-Year Summary');

// Sheet 2: Option B Trades
const tradesB = [
  ['Trade #', 'Symbol', 'Entry Time', 'Exit Time', 'Duration (min)', 'Exit Price', 'Exit Reason', 'Net PnL ($)', 'Net Return (%)', 'Balance After']
];
resB.closedTrades.forEach((t, i) => {
  tradesB.push([i + 1, t.symbol, t.entryTime, t.exitTime, t.durationMin, t.exitPrice, t.exitReason, Number(t.netPnL.toFixed(2)), Number(t.netReturnPct.toFixed(2)), t.balanceAfter]);
});
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(tradesB), 'Option B Trades');

// Sheet 3: Option A Trades
const tradesA = [
  ['Trade #', 'Symbol', 'Entry Time', 'Exit Time', 'Duration (min)', 'Exit Price', 'Exit Reason', 'Net PnL ($)', 'Net Return (%)', 'Balance After']
];
resA.closedTrades.forEach((t, i) => {
  tradesA.push([i + 1, t.symbol, t.entryTime, t.exitTime, t.durationMin, t.exitPrice, t.exitReason, Number(t.netPnL.toFixed(2)), Number(t.netReturnPct.toFixed(2)), t.balanceAfter]);
});
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(tradesA), 'Option A Trades');

const outPath = path.resolve(__dirname, '../../nexus_quant_multi_year_7yr_compounding_report.xlsx');
XLSX.writeFile(wb, outPath);

// Copy to brain
const brainPath = 'C:\\Users\\waizt\\.gemini\\antigravity\\brain\\9240cc1b-f576-4996-a196-552f1f9e4603\\nexus_quant_multi_year_7yr_compounding_report.xlsx';
fs.copyFileSync(outPath, brainPath);
console.log('Saved report to:', outPath);
