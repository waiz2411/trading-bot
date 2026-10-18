import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';

const cacheDir = './src/data/binance_cache';
const outDir = 'C:/Users/waizt/.gemini/antigravity/brain/9240cc1b-f576-4996-a196-552f1f9e4603';

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
console.log('Testing Relative Strength Momentum across', allSymbols.length, 'coins...');

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

function calculateATR(candles, p = 14) {
  const len = candles.length;
  const atr = new Float64Array(len);
  let trSum = 0;
  for (let i = 1; i <= p && i < len; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    );
    trSum += tr;
  }
  atr[p] = trSum / p;
  for (let i = p + 1; i < len; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    );
    atr[i] = (atr[i - 1] * (p - 1) + tr) / p;
  }
  return atr;
}

// 15-minute data with 24h rolling return (96 bars = 24h)
const btc15 = rawDatasets['BTCUSDT'];
const btcReturn24h = new Float64Array(btc15.length);
for (let i = 96; i < btc15.length; i++) {
  btcReturn24h[i] = ((btc15[i].close - btc15[i - 96].close) / btc15[i - 96].close) * 100;
}
const btcTimeMap = new Map();
btc15.forEach((c, idx) => btcTimeMap.set(c.openTime, idx));

const coinData = {};
for (const sym of allSymbols) {
  const c = rawDatasets[sym];
  const closes = c.map(x => x.close);
  const ret24h = new Float64Array(c.length);
  for (let i = 96; i < c.length; i++) {
    ret24h[i] = ((closes[i] - closes[i - 96]) / closes[i - 96]) * 100;
  }
  coinData[sym] = {
    candles: c,
    ema20: calculateEMA(closes, 20),
    ema50: calculateEMA(closes, 50),
    ema200: calculateEMA(closes, 200),
    atr14: calculateATR(c, 14),
    ret24h
  };
}

const feeRoundTrip = 0.20;
const slipRate = 0.00015;

function runRelativeStrengthTest(minOutperformancePct, targetR, maxSLPct) {
  const trades = [];
  const dailyPnL = new Map();

  for (const sym of allSymbols) {
    const d = coinData[sym];
    const candles = d.candles;
    const len = candles.length;
    const ema20 = d.ema20;
    const ema50 = d.ema50;
    const ema200 = d.ema200;
    const atr = d.atr14;
    const ret24 = d.ret24h;

    let inTrade = false;
    let entryPrice = 0;
    let entryTime = '';
    let entryIdx = 0;
    let sl = 0;
    let tp = 0;
    let beActive = false;
    let cooldownUntil = 0;

    for (let i = 120; i < len; i++) {
      const c = candles[i];
      if (i < cooldownUntil) continue;

      if (!inTrade) {
        // BTC comparison
        const btcIdx = btcTimeMap.get(c.openTime);
        if (btcIdx === undefined) continue;
        const btcPerf = btcReturn24h[btcIdx];
        const coinPerf = ret24[i];

        // 1. RELATIVE STRENGTH LEADER CONDITION:
        // Coin is crushing BTC by at least minOutperformancePct AND coin is up > 2% over 24h
        if (coinPerf > 2.0 && (coinPerf - btcPerf) >= minOutperformancePct) {
          // 2. Trend alignment: Close > EMA 50 AND EMA 20 > EMA 50
          if (c.close > ema50[i] && ema20[i] > ema50[i]) {
            // 3. Pullback to EMA 20: low touches EMA 20, closes green
            const touched = c.low <= ema20[i] * 1.002 && c.close >= ema20[i];
            const green = c.close >= c.open;

            if (touched && green) {
              inTrade = true;
              entryPrice = c.close * (1 + slipRate);
              entryTime = c.time;
              entryIdx = i;
              beActive = false;

              const slDist = Math.max(entryPrice * 0.015, Math.min(entryPrice * (maxSLPct / 100), atr[i] * 1.5));
              sl = entryPrice - slDist;
              tp = entryPrice + (slDist * targetR);
            }
          }
        }
      } else {
        const peakGain = ((c.high - entryPrice) / entryPrice) * 100;
        // Ratchet to BE at 1R
        if (!beActive && peakGain >= ((entryPrice - sl) / entryPrice) * 100) {
          beActive = true;
          sl = entryPrice * 1.0025;
        }

        let exitPrice = null;
        let exitReason = '';

        if (c.low <= sl) {
          exitPrice = sl * (1 - slipRate);
          exitReason = beActive ? 'BE Guard' : 'Stop Loss';
          if (!beActive) cooldownUntil = i + 4;
        } else if (c.high >= tp) {
          exitPrice = tp * (1 - slipRate);
          exitReason = 'Take Profit Target';
        } else if (i - entryIdx >= 48) {
          exitPrice = c.close * (1 - slipRate);
          exitReason = 'Time Limit';
        }

        if (exitPrice !== null) {
          const gross = ((exitPrice - entryPrice) / entryPrice) * 100;
          const net = gross - feeRoundTrip - (slipRate * 2 * 100);

          trades.push({
            symbol: sym,
            entryTime,
            exitTime: c.time,
            entryPrice,
            exitPrice,
            netReturnPct: Number(net.toFixed(2)),
            exitReason
          });

          const day = c.time.split('T')[0];
          if (!dailyPnL.has(day)) dailyPnL.set(day, 0);
          dailyPnL.set(day, dailyPnL.get(day) + net);

          inTrade = false;
        }
      }
    }
  }

  trades.sort((a, b) => new Date(a.entryTime).getTime() - new Date(b.entryTime).getTime());
  let cum = 0;
  for (let t of trades) {
    cum += t.netReturnPct;
    t.cumNet = Number(cum.toFixed(2));
  }

  const total = trades.length;
  const wins = trades.filter(t => t.netReturnPct > 0.05).length;
  const be = trades.filter(t => t.netReturnPct >= -0.05 && t.netReturnPct <= 0.05).length;
  const losses = trades.filter(t => t.netReturnPct < -0.05).length;
  const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : '0.0';
  const totalNet = trades.reduce((acc, t) => acc + t.netReturnPct, 0);
  const winSum = trades.filter(t => t.netReturnPct > 0.05).reduce((acc, t) => acc + t.netReturnPct, 0);
  const lossSum = Math.abs(trades.filter(t => t.netReturnPct < -0.05).reduce((acc, t) => acc + t.netReturnPct, 0));
  const pf = lossSum > 0 ? (winSum / lossSum).toFixed(2) : (winSum > 0 ? '999.00' : '0.00');
  const avgWin = wins > 0 ? '+' + (winSum / wins).toFixed(2) + '%' : '0.00%';
  const avgLoss = losses > 0 ? '-' + (lossSum / losses).toFixed(2) + '%' : '0.00%';

  const days = Array.from(dailyPnL.keys()).sort();
  let posDays = 0;
  for (const d of days) {
    if (dailyPnL.get(d) > 0) posDays++;
  }
  const dayWinRate = days.length > 0 ? ((posDays / days.length) * 100).toFixed(1) : '0.0';

  return {
    name: `Outperf >= +${minOutperformancePct}%, ${targetR}R Target, maxSL ${maxSLPct}%`,
    trades: total,
    tradesPerDay: days.length > 0 ? (total / days.length).toFixed(1) : '0.0',
    wins,
    losses,
    be,
    winRate: winRate + '%',
    avgWin,
    avgLoss,
    profitFactor: pf,
    profitableDays: `${posDays}/${days.length} (${dayWinRate}%)`,
    totalNetGain: (totalNet > 0 ? '+' : '') + totalNet.toFixed(2) + '%',
    trades
  };
}

const tests = [
  runRelativeStrengthTest(5.0, 1.5, 2.0),
  runRelativeStrengthTest(7.0, 2.0, 2.0),
  runRelativeStrengthTest(10.0, 2.0, 2.5),
  runRelativeStrengthTest(12.0, 2.5, 2.5)
];

console.table(tests.map(t => ({
  Model: t.name,
  Trades: t.trades,
  'Trades/Day': t.tradesPerDay,
  Wins: t.wins,
  Losses: t.losses,
  'Win Rate': t.winRate,
  'Avg Win': t.avgWin,
  'Avg Loss': t.avgLoss,
  'Profit Factor': t.profitFactor,
  'Profitable Days': t.profitableDays,
  'Total Net Gain': t.totalNetGain
})));

// Save best
const best = tests.sort((a, b) => parseFloat(b.profitFactor) - parseFloat(a.profitFactor))[0];
console.log('\nBest Relative Strength Model:', best.name);

const wb = XLSX.utils.book_new();
const summarySheet = tests.map(t => ({
  'Model Name': t.name,
  'Total Trades': t.trades,
  'Trades/Day': t.tradesPerDay,
  'Wins': t.wins,
  'Losses': t.losses,
  'Win Rate': t.winRate,
  'Avg Win': t.avgWin,
  'Avg Loss': t.avgLoss,
  'Profit Factor': t.profitFactor,
  'Profitable Days': t.profitableDays,
  'Total Net Gain': t.totalNetGain
}));
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summarySheet), 'RS Momentum Summary');

const tradeLog = best.trades.map((t, idx) => ({
  'Trade #': idx + 1,
  'Symbol': t.symbol,
  'Entry Time (UTC)': t.entryTime,
  'Entry Price ($)': Number(t.entryPrice.toFixed(4)),
  'Exit Time (UTC)': t.exitTime,
  'Exit Price ($)': Number(t.exitPrice.toFixed(4)),
  'Exit Reason': t.exitReason,
  'Net Return (%)': t.netReturnPct,
  'Cumulative Net (%)': t.cumNet,
  'Outcome': t.netReturnPct > 0.05 ? 'WIN' : (t.netReturnPct >= -0.05 ? 'BREAK-EVEN' : 'LOSS')
}));
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(tradeLog), 'Best Model Trade Log');

const outFilePath = path.join(outDir, 'nexus_quant_relative_strength_momentum.xlsx');
XLSX.writeFile(wb, outFilePath);
console.log('Saved to:', outFilePath);
