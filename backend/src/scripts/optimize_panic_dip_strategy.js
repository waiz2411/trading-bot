import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cacheDir = path.resolve(__dirname, '../data/binance_cache');

console.log('Loading 2026 Binance datasets for Panic Dip Optimization...');
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

function calculateEMAsAndRSI(candles) {
  const len = candles.length;
  const closes = candles.map(c => c.close);
  const ema21 = new Float64Array(len);
  const ema50 = new Float64Array(len);
  const rsi14 = new Float64Array(len);

  const k21 = 2 / 22;
  const k50 = 2 / 51;
  let e21 = closes[0], e50 = closes[0];

  for (let i = 0; i < len; i++) {
    const cl = closes[i];
    e21 = i === 0 ? cl : (cl * k21) + (e21 * (1 - k21));
    e50 = i === 0 ? cl : (cl * k50) + (e50 * (1 - k50));
    ema21[i] = e21;
    ema50[i] = e50;
  }

  let avgG = 0, avgL = 0;
  for (let i = 1; i <= 14 && i < len; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) avgG += diff;
    else avgL += Math.abs(diff);
  }
  avgG /= 14; avgL /= 14;
  rsi14[14] = avgL === 0 ? 100 : 100 - (100 / (1 + avgG / avgL));

  for (let i = 15; i < len; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgG = (avgG * 13 + gain) / 14;
    avgL = (avgL * 13 + loss) / 14;
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
  const c15 = datasets[sym];
  if (!c15) continue;
  sym15m[sym] = { candles: c15, tech: calculateEMAsAndRSI(c15), timeMap: new Map() };
  c15.forEach((c, i) => sym15m[sym].timeMap.set(c.openTime, i));

  const c4 = resampleTo4H(c15);
  sym4h[sym] = { candles: c4, tech: calculateEMAsAndRSI(c4), timeMap: new Map() };
  c4.forEach((c, i) => sym4h[sym].timeMap.set(c.openTime, i));
}

function runBacktest(config) {
  const {
    name,
    tp = 5.5,
    sl = 2.2,
    beTrigger = 2.2,
    beLock = 0.25,
    trTrigger = 3.5,
    trDist = 1.2,
    maxHoldBars = 32, // 8 hours
    maxRsi = 30,
    maxSlots = 2,
    hammerRatio = 0.40
  } = config;

  let balance = 100.0;
  let peakBalance = balance;
  let maxDrawdownPct = 0;
  const activeTrades = [];
  const closedTrades = [];
  const feeRate = 0.0010;
  const slipRate = 0.0005;

  const timeSource = sym15m['BTCUSDT'].candles;

  for (let tIdx = 0; tIdx < timeSource.length; tIdx++) {
    const bar = timeSource[tIdx];
    const openTime = bar.openTime;

    // 1. Manage Active Positions
    for (let pIdx = activeTrades.length - 1; pIdx >= 0; pIdx--) {
      const pos = activeTrades[pIdx];
      const entryObj = sym15m[pos.symbol];
      if (!entryObj) continue;

      const cIdx = entryObj.timeMap.get(openTime);
      if (cIdx === undefined) continue;

      const candle = entryObj.candles[cIdx];
      pos.barsHeld++;

      let exitPrice = null;
      let exitReason = null;

      if (candle.low <= pos.currentStop) {
        exitPrice = pos.currentStop * (1 - slipRate);
        exitReason = pos.isTrailing ? 'TRAILING_STOP' : (pos.isBE ? 'BREAKEVEN' : 'STOP_LOSS');
      } else {
        if (candle.high > pos.peakPrice) pos.peakPrice = candle.high;
        const peakGain = ((pos.peakPrice - pos.entryPrice) / pos.entryPrice) * 100;

        if (peakGain >= beTrigger && !pos.isBE) {
          const bePrice = pos.entryPrice * (1 + beLock / 100);
          if (bePrice > pos.currentStop) {
            pos.currentStop = bePrice;
            pos.isBE = true;
          }
        }

        if (peakGain >= trTrigger) {
          const trPrice = pos.peakPrice * (1 - trDist / 100);
          if (trPrice > pos.currentStop) {
            pos.currentStop = trPrice;
            pos.isTrailing = true;
          }
        }

        if (tp > 0 && candle.high >= pos.entryPrice * (1 + tp / 100)) {
          exitPrice = pos.entryPrice * (1 + tp / 100);
          exitReason = 'TAKE_PROFIT';
        } else if (pos.barsHeld >= maxHoldBars) {
          exitPrice = candle.close;
          exitReason = 'TIME_LIMIT';
        }
      }

      if (exitPrice !== null) {
        const notional = pos.notional;
        const grossReturnPct = ((exitPrice - pos.entryPrice) / pos.entryPrice) * 100;
        const grossGain = notional * (grossReturnPct / 100);
        const totalFees = notional * feeRate * 2;
        const netPnL = grossGain - totalFees;
        const netReturnPct = (netPnL / notional) * 100;

        balance = Number((balance + netPnL).toFixed(2));
        if (balance > peakBalance) peakBalance = balance;
        const ddDollar = peakBalance - balance;
        const ddPct = peakBalance > 0 ? (ddDollar / peakBalance) * 100 : 0;
        if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;

        closedTrades.push({
          id: closedTrades.length + 1,
          symbol: pos.symbol,
          entryTime: pos.entryTime,
          exitTime: candle.time,
          entryPrice: Number(pos.entryPrice.toFixed(4)),
          exitPrice: Number(exitPrice.toFixed(4)),
          returnPct: Number(netReturnPct.toFixed(2)),
          netPnL: Number(netPnL.toFixed(3)),
          exitReason,
          barsHeld: pos.barsHeld,
          balanceAfter: balance
        });

        activeTrades.splice(pIdx, 1);
      }
    }

    // 2. Scan Entries
    if (activeTrades.length < maxSlots) {
      // BTC 4H > 50 EMA
      const btc4 = sym4h['BTCUSDT'];
      const btcIdx = btc4.timeMap.get(openTime);
      if (btcIdx !== undefined && btcIdx >= 50 && btc4.candles[btcIdx].close < btc4.tech.ema50[btcIdx]) {
        continue;
      }

      let bestCand = null;
      let highestScore = -Infinity;

      for (const sym of symbols) {
        if (activeTrades.some(t => t.symbol === sym)) continue;
        const c15Obj = sym15m[sym];
        const c4Obj = sym4h[sym];
        if (!c15Obj || !c4Obj) continue;

        const idx15 = c15Obj.timeMap.get(openTime);
        const idx4 = c4Obj.timeMap.get(openTime);
        if (idx15 === undefined || idx15 < 50 || idx4 === undefined || idx4 < 50) continue;

        // Macro: 4H EMA 21 > EMA 50 & 4H Close > EMA 50 (confirmed bull structure)
        const is4hBull = c4Obj.tech.ema21[idx4] > c4Obj.tech.ema50[idx4] && c4Obj.candles[idx4].close > c4Obj.tech.ema50[idx4];
        if (!is4hBull) continue;

        // 15m Panic Dip
        const c15 = c15Obj.candles[idx15];
        const rsi15 = c15Obj.tech.rsi14[idx15];
        if (rsi15 > maxRsi) continue;

        const candleRange = c15.high - c15.low;
        if (candleRange <= 0) continue;
        const lowerWick = Math.min(c15.open, c15.close) - c15.low;
        const isRejection = (lowerWick / candleRange) >= hammerRatio;

        if (isRejection) {
          const score = (50 - rsi15) * 2 + (c4Obj.tech.ema21[idx4] / c4Obj.tech.ema50[idx4]) * 10;
          if (score > highestScore) {
            highestScore = score;
            bestCand = {
              symbol: sym,
              entryPrice: c15.close * (1 + slipRate),
              entryTime: c15.time
            };
          }
        }
      }

      if (bestCand) {
        const notionalPerSlot = balance / maxSlots;
        activeTrades.push({
          symbol: bestCand.symbol,
          entryPrice: bestCand.entryPrice,
          entryTime: bestCand.entryTime,
          notional: notionalPerSlot,
          peakPrice: bestCand.entryPrice,
          currentStop: bestCand.entryPrice * (1 - sl / 100),
          barsHeld: 0,
          isBE: false,
          isTrailing: false
        });
      }
    }
  }

  const wins = closedTrades.filter(t => t.netPnL > 0);
  const losses = closedTrades.filter(t => t.netPnL < 0);
  const beCount = closedTrades.filter(t => t.netPnL === 0);
  const grossWin = wins.reduce((acc, t) => acc + t.netPnL, 0);
  const grossLoss = Math.abs(losses.reduce((acc, t) => acc + t.netPnL, 0));
  const profitFactor = grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(2)) : 999;
  const activeDays = new Set(closedTrades.map(t => t.exitTime.slice(0, 10))).size;

  return {
    name,
    roiPct: Number((((balance - 100.0) / 100.0) * 100).toFixed(2)),
    finalBalance: Number(balance.toFixed(2)),
    trades: closedTrades.length,
    wins: wins.length,
    losses: losses.length,
    be: beCount.length,
    winRate: Number(((wins.length / (closedTrades.length || 1)) * 100).toFixed(1)),
    profitFactor,
    maxDrawdownPct: Number(maxDrawdownPct.toFixed(1)),
    activeDays,
    closedTrades
  };
}

// Run Grid Optimization for Panic Dip Rebound
const testCases = [
  { name: 'Panic Dip TP 5.0%, SL 2.0%, Tr 3.0%, RSI 30, 2 Slots', tp: 5.0, sl: 2.0, beTrigger: 2.0, trTrigger: 3.0, trDist: 1.0, maxRsi: 30, maxSlots: 2, maxHoldBars: 32 },
  { name: 'Panic Dip TP 5.5%, SL 2.2%, Tr 3.5%, RSI 30, 2 Slots', tp: 5.5, sl: 2.2, beTrigger: 2.2, trTrigger: 3.5, trDist: 1.2, maxRsi: 30, maxSlots: 2, maxHoldBars: 32 },
  { name: 'Panic Dip TP 6.0%, SL 2.2%, Tr 3.5%, RSI 30, 2 Slots', tp: 6.0, sl: 2.2, beTrigger: 2.2, trTrigger: 3.5, trDist: 1.2, maxRsi: 30, maxSlots: 2, maxHoldBars: 32 },
  { name: 'Panic Dip TP 6.5%, SL 2.5%, Tr 4.0%, RSI 32, 2 Slots', tp: 6.5, sl: 2.5, beTrigger: 2.5, trTrigger: 4.0, trDist: 1.2, maxRsi: 32, maxSlots: 2, maxHoldBars: 48 },
  { name: 'Panic Dip TP 7.0%, SL 2.5%, Tr 4.0%, RSI 32, 3 Slots', tp: 7.0, sl: 2.5, beTrigger: 2.5, trTrigger: 4.0, trDist: 1.2, maxRsi: 32, maxSlots: 3, maxHoldBars: 48 },
  { name: 'Panic Dip TP 6.0%, SL 2.0%, Tr 3.5%, RSI 30, 1 Slot',  tp: 6.0, sl: 2.0, beTrigger: 2.0, trTrigger: 3.5, trDist: 1.2, maxRsi: 30, maxSlots: 1, maxHoldBars: 32 },
  { name: 'Panic Dip TP 5.0%, SL 2.0%, Tr 3.0%, RSI 32, 2 Slots', tp: 5.0, sl: 2.0, beTrigger: 2.0, trTrigger: 3.0, trDist: 1.0, maxRsi: 32, maxSlots: 2, maxHoldBars: 32 }
];

console.log('\nTesting Panic Dip Configurations...');
const results = [];
for (const tc of testCases) {
  const res = runBacktest(tc);
  results.push(res);
  console.log(`[${res.name}]:`);
  console.log(`  ROI: ${res.roiPct >= 0 ? '+' : ''}${res.roiPct}%, Balance: $${res.finalBalance}, Trades: ${res.trades}, WinRate: ${res.winRate}%, PF: ${res.profitFactor}, MaxDD: ${res.maxDrawdownPct}%, ActiveDays: ${res.activeDays}/289\n`);
}

results.sort((a, b) => b.roiPct - a.roiPct);
console.log('=== BEST PANIC DIP CONFIGURATION ===');
console.log(results[0]);

fs.writeFileSync(path.resolve(__dirname, 'best_panic_dip.json'), JSON.stringify(results, null, 2));
