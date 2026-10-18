import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cacheDir = path.resolve(__dirname, '../data/binance_cache');

console.log('Running Compounded Monthly Simulation for Option B (6.0% Macro Alpha Scalper)...');

const files = fs.readdirSync(cacheDir).filter(f => f.endsWith('.json'));
const datasets = {};

for (const file of files) {
  const sym = file.split('_')[0];
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
      if (parsed.length > 1000) datasets[sym] = parsed;
    }
  } catch (_) {}
}

const symbols = Object.keys(datasets).filter(s => s !== 'BTCUSDT' && s !== 'PAXGUSDT');

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

function resampleTo4H(c15m) {
  const c4h = [];
  for (let i = 0; i < c15m.length; i += 16) {
    const slice = c15m.slice(i, i + 16);
    if (slice.length === 16) {
      c4h.push({
        openTime: slice[0].openTime,
        time: slice[0].time,
        open: slice[0].open,
        high: Math.max(...slice.map(c => c.high)),
        low: Math.min(...slice.map(c => c.low)),
        close: slice[15].close,
        volume: slice.reduce((acc, c) => acc + c.volume, 0)
      });
    }
  }
  return c4h;
}

const sym15m = {};
const sym4h = {};

for (const sym of [...symbols, 'BTCUSDT']) {
  if (!datasets[sym]) continue;
  const c15 = datasets[sym];
  sym15m[sym] = { candles: c15, tech: calculateTech(c15), timeMap: new Map() };
  c15.forEach((c, i) => sym15m[sym].timeMap.set(c.openTime, i));

  const c4 = resampleTo4H(c15);
  sym4h[sym] = { candles: c4, tech: calculateTech(c4), timeMap: new Map() };
  c4.forEach((c, i) => sym4h[sym].timeMap.set(c.openTime, i));
}

const timeSource = sym15m['BTCUSDT'].candles;
const sortedTimes = timeSource.map(c => c.openTime);

function simulateCompounding(initialCapital = 100.0) {
  const tp = 6.0;
  const sl = 2.0;
  const beTrigger = 2.0;
  const beLock = 0.25;
  const trTrigger = 3.5;
  const trDist = 1.2;
  const maxHoldBars = 32; // 8 hours

  let balance = initialCapital;
  let peakBalance = balance;
  let maxDD = 0;
  const activeTrades = [];
  const closedTrades = [];
  const monthlyData = {};

  const feeRate = 0.0010;
  const slipRate = 0.0003;

  for (let tIdx = 50; tIdx < sortedTimes.length; tIdx++) {
    const openTime = sortedTimes[tIdx];
    const dateStr = timeSource[tIdx].time.split('T')[0];
    const monthStr = dateStr.slice(0, 7);

    if (!monthlyData[monthStr]) {
      monthlyData[monthStr] = {
        month: monthStr,
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

      if (c.low <= pos.currentStop) {
        exitPrice = pos.currentStop * (1 - slipRate);
      } else if (c.high >= pos.entryPrice * (1 + tp / 100)) {
        exitPrice = pos.entryPrice * (1 + tp / 100) * (1 - slipRate);
      } else if (pos.barsHeld >= maxHoldBars) {
        exitPrice = c.close * (1 - slipRate);
      } else {
        const peakGain = ((c.high - pos.entryPrice) / pos.entryPrice) * 100;
        if (c.high > pos.peakPrice) pos.peakPrice = c.high;

        if (trTrigger && peakGain >= trTrigger) {
          const trStop = pos.peakPrice * (1 - trDist / 100);
          if (trStop > pos.currentStop) pos.currentStop = trStop;
        } else if (beTrigger && peakGain >= beTrigger) {
          const beStop = pos.entryPrice * (1 + beLock / 100);
          if (beStop > pos.currentStop) pos.currentStop = beStop;
        }
      }

      if (exitPrice !== null) {
        const notional = pos.notional;
        const grossReturnPct = ((exitPrice - pos.entryPrice) / pos.entryPrice) * 100;
        const grossGain = notional * (grossReturnPct / 100);
        const fees = notional * feeRate * 2;
        const netPnL = grossGain - fees;

        balance = Number((balance + netPnL).toFixed(2));
        if (balance > peakBalance) peakBalance = balance;
        const dd = peakBalance > 0 ? ((peakBalance - balance) / peakBalance) * 100 : 0;
        if (dd > maxDD) maxDD = dd;

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
          netPnL,
          balanceAfter: balance
        });

        activeTrades.splice(pIdx, 1);
      }
    }

    // Entries with dynamic compounding position size
    if (activeTrades.length < 1) {
      const nearest4hTime = openTime - (openTime % (4 * 3600 * 1000));
      const btc4 = sym4h['BTCUSDT'];
      const btcIdx4 = btc4.timeMap.get(nearest4hTime);
      if (btcIdx4 !== undefined && btcIdx4 >= 50 && btc4.candles[btcIdx4].close < btc4.tech.ema50[btcIdx4]) {
        continue;
      }

      let bestCand = null;
      let highestScore = -Infinity;

      for (const sym of symbols) {
        const c15Obj = sym15m[sym];
        const c4Obj = sym4h[sym];
        if (!c15Obj || !c4Obj) continue;

        const idx15 = c15Obj.timeMap.get(openTime);
        const idx4 = c4Obj.timeMap.get(nearest4hTime);
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
          notional: balance, // 100% Compounding into active position
          peakPrice: bestCand.price,
          currentStop: bestCand.price * (1 - sl / 100),
          barsHeld: 0
        });
      }
    }
  }

  // Calculate monthly stats
  const months = Object.keys(monthlyData).sort();
  let currentRunningBal = initialCapital;

  const tableRows = [];
  for (const m of months) {
    const data = monthlyData[m];
    const startBal = Number(currentRunningBal.toFixed(2));
    const profit = Number(data.netProfitDollar.toFixed(2));
    const endBal = Number((startBal + profit).toFixed(2));
    const monthlyReturnPct = Number(((profit / startBal) * 100).toFixed(2));
    currentRunningBal = endBal;

    tableRows.push({
      month: m,
      startBal,
      profit,
      endBal,
      monthlyReturnPct,
      trades: data.trades,
      wins: data.wins,
      losses: data.losses,
      winRate: data.trades > 0 ? Number(((data.wins / data.trades) * 100).toFixed(1)) : 0
    });
  }

  return {
    initialCapital,
    finalBalance: Number(currentRunningBal.toFixed(2)),
    totalProfit: Number((currentRunningBal - initialCapital).toFixed(2)),
    roiPct: Number((((currentRunningBal - initialCapital) / initialCapital) * 100).toFixed(2)),
    maxDD: Number(maxDD.toFixed(1)),
    tableRows
  };
}

const sim100 = simulateCompounding(100.0);
const sim10 = simulateCompounding(10.0);

console.log('\n========================================================================');
console.log('--- OPTION B (6.0% ALPHA SCALPER) COMPOUNDED MONTHLY BREAKDOWN ($100) ---');
console.log('========================================================================');
console.table(sim100.tableRows.map(r => ({
  'Month': r.month,
  'Start Capital ($)': `$${r.startBal.toFixed(2)}`,
  'Monthly Return (%)': `${r.monthlyReturnPct >= 0 ? '+' : ''}${r.monthlyReturnPct.toFixed(2)}%`,
  'Net Profit ($)': `${r.profit >= 0 ? '+' : ''}$${r.profit.toFixed(2)}`,
  'End Capital ($)': `$${r.endBal.toFixed(2)}`,
  'Trades': r.trades,
  'Win Rate (%)': `${r.winRate}%`,
  'Status': r.profit >= 0 ? 'PROFIT 🟢' : 'PULLBACK 🔴'
})));

console.log('\n========================================================================');
console.log('--- OPTION B (6.0% ALPHA SCALPER) COMPOUNDED MONTHLY BREAKDOWN ($10) ---');
console.log('========================================================================');
console.table(sim10.tableRows.map(r => ({
  'Month': r.month,
  'Start Capital ($)': `$${r.startBal.toFixed(2)}`,
  'Monthly Return (%)': `${r.monthlyReturnPct >= 0 ? '+' : ''}${r.monthlyReturnPct.toFixed(2)}%`,
  'Net Profit ($)': `${r.profit >= 0 ? '+' : ''}$${r.profit.toFixed(2)}`,
  'End Capital ($)': `$${r.endBal.toFixed(2)}`,
  'Trades': r.trades,
  'Win Rate (%)': `${r.winRate}%`,
  'Status': r.profit >= 0 ? 'PROFIT 🟢' : 'PULLBACK 🔴'
})));

console.log(`\nFinal Compounded Summary ($100): $100 -> $${sim100.finalBalance} (+${sim100.roiPct}% Net ROI) | Max Drawdown: ${sim100.maxDD}%`);
console.log(`Final Compounded Summary ($10): $10 -> $${sim10.finalBalance} (+${sim10.roiPct}% Net ROI) | Max Drawdown: ${sim10.maxDD}%\n`);

// Export to Excel
const wb = XLSX.utils.book_new();

const ws100 = XLSX.utils.json_to_sheet(sim100.tableRows.map(r => ({
  'Month': r.month,
  'Starting Balance ($)': r.startBal,
  'Monthly Net Return (%)': `${r.monthlyReturnPct >= 0 ? '+' : ''}${r.monthlyReturnPct}%`,
  'Monthly Profit ($)': r.profit,
  'Ending Balance ($)': r.endBal,
  'Trades Executed': r.trades,
  'Wins': r.wins,
  'Losses': r.losses,
  'Win Rate (%)': `${r.winRate}%`
})));
XLSX.utils.book_append_sheet(wb, ws100, 'Compounding $100 Start');

const ws10 = XLSX.utils.json_to_sheet(sim10.tableRows.map(r => ({
  'Month': r.month,
  'Starting Balance ($)': r.startBal,
  'Monthly Net Return (%)': `${r.monthlyReturnPct >= 0 ? '+' : ''}${r.monthlyReturnPct}%`,
  'Monthly Profit ($)': r.profit,
  'Ending Balance ($)': r.endBal,
  'Trades Executed': r.trades,
  'Wins': r.wins,
  'Losses': r.losses,
  'Win Rate (%)': `${r.winRate}%`
})));
XLSX.utils.book_append_sheet(wb, ws10, 'Compounding $10 Start');

const outPath = path.resolve(__dirname, '../../../nexus_quant_option_b_compounding_report.xlsx');
XLSX.writeFile(wb, outPath);

const brainDest = 'C:\\Users\\waizt\\.gemini\\antigravity\\brain\\9240cc1b-f576-4996-a196-552f1f9e4603\\nexus_quant_option_b_compounding_report.xlsx';
try {
  fs.copyFileSync(outPath, brainDest);
} catch (_) {}

console.log('Compounded Excel report saved at: ' + outPath);
