import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';

const cacheDir = './src/data/binance_cache';
const outDir = 'C:/Users/waizt/.gemini/antigravity/brain/9240cc1b-f576-4996-a196-552f1f9e4603';

console.log('=== TESTING NO-SAFETY-ORDER COMPOUNDING SIMULATOR ($100 START) ===');

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
    rsi14: calculateRSI14(rawDatasets[sym]),
    ema50: calculateEMA(rawDatasets[sym].map(c => c.close), 50)
  };
}

const feeRate = 0.0010; // 0.10% each side
const slipRate = 0.00015; // 0.015% slippage

/**
 * Single-Order Sequential Compounding Simulator
 * Starts with $100. Every trade allocates 100% of current capital (or fixed fraction).
 * When in a trade, waits until it exits before taking the next best signal.
 */
function simulateCompounding(cfg) {
  const initialBalance = cfg.startBalance || 100.0;
  let currentBalance = initialBalance;

  // Gather all valid signals chronologically across all coins
  const allSignals = [];

  for (const sym of Object.keys(rawDatasets)) {
    const candles = rawDatasets[sym];
    const rsi = coinIndicators[sym].rsi14;
    const len = candles.length;

    for (let i = 50; i < len; i++) {
      const c = candles[i];

      // BTC Market Guard
      if (cfg.btcGuard) {
        const btcIdx = btcMap.get(c.openTime);
        if (btcIdx !== undefined) {
          if (btcRSI[btcIdx] < 35 || btc15[btcIdx].close < btcEMA200[btcIdx]) continue;
        }
      }

      // Signal: RSI < 32 and green reversal
      if (rsi[i - 1] < 32 && rsi[i] >= 30 && c.close >= c.open) {
        allSignals.push({
          symbol: sym,
          candleIdx: i,
          openTime: c.openTime,
          time: c.time,
          entryPrice: c.close * (1 + slipRate)
        });
      }
    }
  }

  // Sort signals chronologically
  allSignals.sort((a, b) => a.openTime - b.openTime);

  // Sequential execution
  const completedTrades = [];
  let nextAvailableTime = 0;

  for (const sig of allSignals) {
    // If we are currently holding a trade, we cannot enter another one until it finishes!
    if (sig.openTime < nextAvailableTime) continue;

    const sym = sig.symbol;
    const candles = rawDatasets[sym];
    const startIdx = sig.candleIdx;
    const entryPrice = sig.entryPrice;
    const tpPrice = entryPrice * (1 + cfg.tpPct / 100);
    const slPrice = entryPrice * (1 - cfg.slPct / 100);

    let exitPrice = null;
    let exitTime = '';
    let exitReason = '';
    let exitOpenTime = 0;

    for (let j = startIdx + 1; j < candles.length && j <= startIdx + (cfg.maxBars || 192); j++) {
      const bar = candles[j];

      // Check Take Profit
      if (bar.high >= tpPrice) {
        exitPrice = tpPrice * (1 - slipRate);
        exitTime = bar.time;
        exitOpenTime = bar.openTime;
        exitReason = `Take Profit Hit (+${cfg.tpPct}%)`;
        break;
      }
      // Check Stop Loss
      else if (bar.low <= slPrice) {
        exitPrice = slPrice * (1 - slipRate);
        exitTime = bar.time;
        exitOpenTime = bar.openTime;
        exitReason = `Stop Loss Hit (-${cfg.slPct}%)`;
        break;
      }
    }

    // If max bars reached without hitting TP or SL
    if (exitPrice === null) {
      const lastBar = candles[Math.min(candles.length - 1, startIdx + (cfg.maxBars || 192))];
      exitPrice = lastBar.close * (1 - slipRate);
      exitTime = lastBar.time;
      exitOpenTime = lastBar.openTime;
      exitReason = 'Time Limit Exit';
    }

    // Calculate Compounded PnL
    const tradeCapital = currentBalance;
    const coinUnits = tradeCapital / entryPrice;
    const grossExitUSD = coinUnits * exitPrice;
    const buyFee = tradeCapital * feeRate;
    const sellFee = grossExitUSD * feeRate;
    const totalFees = buyFee + sellFee;
    const netPnLUSD = grossExitUSD - tradeCapital - totalFees;
    const netReturnPct = (netPnLUSD / tradeCapital) * 100;

    const startBalanceBeforeTrade = currentBalance;
    currentBalance = currentBalance + netPnLUSD;

    const durationHours = ((exitOpenTime - sig.openTime) / (3600 * 1000)).toFixed(1);

    completedTrades.push({
      tradeId: completedTrades.length + 1,
      symbol: sym,
      entryTime: sig.time,
      exitTime: exitTime,
      durationHours: Number(durationHours),
      entryPrice: Number(entryPrice.toFixed(4)),
      exitPrice: Number(exitPrice.toFixed(4)),
      startBalance: Number(startBalanceBeforeTrade.toFixed(2)),
      tradeSizeUSD: Number(tradeCapital.toFixed(2)),
      feesPaidUSD: Number(totalFees.toFixed(2)),
      netPnLUSD: Number(netPnLUSD.toFixed(2)),
      netReturnPct: Number(netReturnPct.toFixed(2)),
      endBalance: Number(currentBalance.toFixed(2)),
      cumReturnPct: Number((((currentBalance - initialBalance) / initialBalance) * 100).toFixed(2)),
      outcome: netPnLUSD > 0 ? 'WIN' : 'LOSS',
      exitReason
    });

    nextAvailableTime = exitOpenTime;
  }

  const total = completedTrades.length;
  const wins = completedTrades.filter(t => t.outcome === 'WIN').length;
  const losses = completedTrades.filter(t => t.outcome === 'LOSS').length;
  const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : '0.0';
  const totalNetUSD = currentBalance - initialBalance;
  const totalNetPct = ((currentBalance - initialBalance) / initialBalance) * 100;

  return {
    name: cfg.name,
    trades: total,
    wins,
    losses,
    winRate: winRate + '%',
    startBalance: '$' + initialBalance.toFixed(2),
    endBalance: '$' + currentBalance.toFixed(2),
    netGainPct: (totalNetPct > 0 ? '+' : '') + totalNetPct.toFixed(2) + '%',
    completedTrades
  };
}

const tests = [
  // Test 1: +0.8% TP, 1.0% SL
  { name: '1. Fast Target (+0.8% TP, 1.0% SL)', tpPct: 0.8, slPct: 1.0, btcGuard: true },
  // Test 2: +1.2% TP, 1.2% SL (1:1 R:R)
  { name: '2. Balanced 1:1 R:R (+1.2% TP, 1.2% SL)', tpPct: 1.2, slPct: 1.2, btcGuard: true },
  // Test 3: +1.5% TP, 1.0% SL (1.5:1 R:R)
  { name: '3. Asymmetric (+1.5% TP, 1.0% SL)', tpPct: 1.5, slPct: 1.0, btcGuard: true },
  // Test 4: +2.0% TP, 1.5% SL
  { name: '4. Swing Target (+2.0% TP, 1.5% SL)', tpPct: 2.0, slPct: 1.5, btcGuard: true },
  // Test 5: +2.5% TP, 1.8% SL
  { name: '5. High Target (+2.5% TP, 1.8% SL)', tpPct: 2.5, slPct: 1.8, btcGuard: true }
];

const results = tests.map(simulateCompounding);
console.table(results.map(r => ({
  Config: r.name,
  Trades: r.trades,
  Wins: r.wins,
  Losses: r.losses,
  WinRate: r.winRate,
  Start: r.startBalance,
  End: r.endBalance,
  'Net Gain': r.netGainPct
})));
