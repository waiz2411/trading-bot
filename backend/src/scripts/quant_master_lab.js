import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cacheDir = path.resolve(__dirname, '../data/binance_cache');

console.log('Loading 2026 Binance datasets for all Halal coins...');

const files = fs.readdirSync(cacheDir).filter(f => f.endsWith('.json'));
const datasets = {};
let btcCandles = null;

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
      if (parsed.length > 1000) {
        datasets[sym] = parsed;
        if (sym === 'BTCUSDT') btcCandles = parsed;
      }
    }
  } catch (_) {}
}

const symbols = Object.keys(datasets).filter(s => s !== 'BTCUSDT' && s !== 'PAXGUSDT');
console.log(`Loaded ${symbols.length} altcoin datasets + BTCUSDT.`);

// Technicals Helper
function calculateEMAsAndRSI(candles) {
  const len = candles.length;
  const closes = candles.map(c => c.close);
  const ema9 = new Float64Array(len);
  const ema21 = new Float64Array(len);
  const ema50 = new Float64Array(len);
  const ema200 = new Float64Array(len);
  const rsi14 = new Float64Array(len);
  const volSma20 = new Float64Array(len);

  const k9 = 2 / 10;
  const k21 = 2 / 22;
  const k50 = 2 / 51;
  const k200 = 2 / 201;

  let e9 = closes[0], e21 = closes[0], e50 = closes[0], e200 = closes[0];

  for (let i = 0; i < len; i++) {
    const cl = closes[i];
    e9 = i === 0 ? cl : (cl * k9) + (e9 * (1 - k9));
    e21 = i === 0 ? cl : (cl * k21) + (e21 * (1 - k21));
    e50 = i === 0 ? cl : (cl * k50) + (e50 * (1 - k50));
    e200 = i === 0 ? cl : (cl * k200) + (e200 * (1 - k200));

    ema9[i] = e9;
    ema21[i] = e21;
    ema50[i] = e50;
    ema200[i] = e200;

    // Volume SMA 20
    if (i >= 19) {
      let vSum = 0;
      for (let j = 0; j < 20; j++) vSum += candles[i - j].volume;
      volSma20[i] = vSum / 20;
    } else {
      volSma20[i] = candles[i].volume;
    }
  }

  // RSI 14 Wilder
  let avgG = 0, avgL = 0;
  for (let i = 1; i <= 14 && i < len; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) avgG += diff;
    else avgL += Math.abs(diff);
  }
  avgG /= 14;
  avgL /= 14;
  rsi14[14] = avgL === 0 ? 100 : 100 - (100 / (1 + avgG / avgL));

  for (let i = 15; i < len; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgG = (avgG * 13 + gain) / 14;
    avgL = (avgL * 13 + loss) / 14;
    rsi14[i] = avgL === 0 ? 100 : 100 - (100 / (1 + avgG / avgL));
  }

  return { ema9, ema21, ema50, ema200, rsi14, volSma20 };
}

// Resample 15m candles to 1H candles
function resampleTo1H(c15m) {
  const c1h = [];
  for (let i = 0; i < c15m.length; i += 4) {
    const slice = c15m.slice(i, i + 4);
    if (slice.length === 4) {
      c1h.push({
        openTime: slice[0].openTime,
        time: slice[0].time,
        open: slice[0].open,
        high: Math.max(...slice.map(c => c.high)),
        low: Math.min(...slice.map(c => c.low)),
        close: slice[3].close,
        volume: slice.reduce((acc, c) => acc + c.volume, 0)
      });
    }
  }
  return c1h;
}

// Resample 15m candles to 4H candles
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

console.log('Pre-calculating Multi-Timeframe Technicals (15m, 1H, 4H)...');
const sym15mTech = {};
const sym1hTech = {};
const sym4hTech = {};

for (const sym of [...symbols, 'BTCUSDT']) {
  const c15 = datasets[sym];
  if (!c15) continue;
  sym15mTech[sym] = { candles: c15, tech: calculateEMAsAndRSI(c15), timeMap: new Map() };
  c15.forEach((c, i) => sym15mTech[sym].timeMap.set(c.openTime, i));

  const c1h = resampleTo1H(c15);
  sym1hTech[sym] = { candles: c1h, tech: calculateEMAsAndRSI(c1h), timeMap: new Map() };
  c1h.forEach((c, i) => sym1hTech[sym].timeMap.set(c.openTime, i));

  const c4h = resampleTo4H(c15);
  sym4hTech[sym] = { candles: c4h, tech: calculateEMAsAndRSI(c4h), timeMap: new Map() };
  c4h.forEach((c, i) => sym4hTech[sym].timeMap.set(c.openTime, i));
}

console.log('Technicals pre-calculated successfully.\n');

// Generic Simulator Function
function simulateStrategy(params) {
  const {
    name,
    timeframe = '15m', // '15m' | '1h' | '4h'
    maxSlots = 2,
    takeProfitPct = 12.0,
    stopLossPct = 3.5,
    breakEvenTriggerPct = 3.5,
    breakEvenLockPct = 0.5,
    trailingTriggerPct = 6.0,
    trailingDistancePct = 2.5,
    maxHoldBars = 96,
    feeRatePct = 0.10,
    slippagePct = 0.05,
    entryRule = () => false
  } = params;

  let balance = 100.0;
  let peakBalance = balance;
  let maxDrawdownPct = 0;
  const activeTrades = [];
  const closedTrades = [];
  const dailyPnL = {};

  const timeSource = timeframe === '4h' ? sym4hTech['BTCUSDT'].candles : (timeframe === '1h' ? sym1hTech['BTCUSDT'].candles : sym15mTech['BTCUSDT'].candles);
  const feeRate = feeRatePct / 100;
  const slipRate = slippagePct / 100;

  for (let tIdx = 0; tIdx < timeSource.length; tIdx++) {
    const bar = timeSource[tIdx];
    const openTime = bar.openTime;
    const dateStr = bar.time.slice(0, 10);

    // 1. Manage Active Positions
    for (let pIdx = activeTrades.length - 1; pIdx >= 0; pIdx--) {
      const pos = activeTrades[pIdx];
      const entryObj = timeframe === '4h' ? sym4hTech[pos.symbol] : (timeframe === '1h' ? sym1hTech[pos.symbol] : sym15mTech[pos.symbol]);
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

        if (peakGain >= breakEvenTriggerPct && !pos.isBE) {
          const bePrice = pos.entryPrice * (1 + breakEvenLockPct / 100);
          if (bePrice > pos.currentStop) {
            pos.currentStop = bePrice;
            pos.isBE = true;
          }
        }

        if (peakGain >= trailingTriggerPct) {
          const trPrice = pos.peakPrice * (1 - trailingDistancePct / 100);
          if (trPrice > pos.currentStop) {
            pos.currentStop = trPrice;
            pos.isTrailing = true;
          }
        }

        if (takeProfitPct > 0 && candle.high >= pos.entryPrice * (1 + takeProfitPct / 100)) {
          exitPrice = pos.entryPrice * (1 + takeProfitPct / 100);
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

        dailyPnL[dateStr] = (dailyPnL[dateStr] || 0) + netPnL;

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

    // 2. Scan for Entry Signals if slots open
    if (activeTrades.length < maxSlots) {
      let bestCandidate = null;
      let highestScore = -Infinity;

      for (const sym of symbols) {
        if (activeTrades.some(t => t.symbol === sym)) continue;
        const entryObj = timeframe === '4h' ? sym4hTech[sym] : (timeframe === '1h' ? sym1hTech[sym] : sym15mTech[sym]);
        if (!entryObj) continue;

        const cIdx = entryObj.timeMap.get(openTime);
        if (cIdx === undefined || cIdx < 50) continue;

        const candle = entryObj.candles[cIdx];
        const tech = entryObj.tech;

        const ruleResult = entryRule({
          sym,
          cIdx,
          candle,
          tech,
          sym15m: sym15mTech[sym],
          sym1h: sym1hTech[sym],
          sym4h: sym4hTech[sym],
          btc15m: sym15mTech['BTCUSDT'],
          btc1h: sym1hTech['BTCUSDT'],
          btc4h: sym4hTech['BTCUSDT'],
          openTime
        });

        if (ruleResult && ruleResult.isMatch) {
          if (ruleResult.score > highestScore) {
            highestScore = ruleResult.score;
            bestCandidate = {
              symbol: sym,
              entryPrice: candle.close * (1 + slipRate),
              entryTime: candle.time
            };
          }
        }
      }

      if (bestCandidate) {
        const notionalPerSlot = balance / maxSlots;
        activeTrades.push({
          symbol: bestCandidate.symbol,
          entryPrice: bestCandidate.entryPrice,
          entryTime: bestCandidate.entryTime,
          notional: notionalPerSlot,
          peakPrice: bestCandidate.entryPrice,
          currentStop: bestCandidate.entryPrice * (1 - stopLossPct / 100),
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

// -------------------------------------------------------------
// STRATEGY EXPERIMENTS SUITE
// -------------------------------------------------------------
console.log('Running Quant Strategy Experiments across 2026...\n');

const experiments = [
  // Experiment 1: 4H Macro Trend Following (Asymmetric R:R)
  // Rationale: Altcoins on 4H trend legs run +15% to +40%. Risk 3.5% to make 15% with trailing.
  {
    name: '4H Asymmetric Trend Following (15% TP, 3.5% SL, 6% Trail)',
    timeframe: '4h',
    maxSlots: 2,
    takeProfitPct: 18.0,
    stopLossPct: 3.5,
    breakEvenTriggerPct: 4.5,
    breakEvenLockPct: 0.5,
    trailingTriggerPct: 6.5,
    trailingDistancePct: 2.5,
    maxHoldBars: 45, // 45 * 4h = 7.5 days
    entryRule: ({ cIdx, candle, tech, btc4h, openTime }) => {
      // BTC 4H > 50 EMA
      const btcIdx = btc4h.timeMap.get(openTime);
      if (btcIdx !== undefined && btcIdx >= 50 && btc4h.candles[btcIdx].close < btc4h.tech.ema50[btcIdx]) return { isMatch: false };

      // Trend: EMA 9 > EMA 21 > EMA 50
      const isTrend = tech.ema9[cIdx] > tech.ema21[cIdx] && tech.ema21[cIdx] > tech.ema50[cIdx];
      // Price pulls back to 9 EMA or 21 EMA
      const isDip = candle.low <= tech.ema9[cIdx] * 1.01 && candle.close >= tech.ema21[cIdx] * 0.99;
      const isBullish = candle.close > candle.open;
      const rsi = tech.rsi14[cIdx];
      const isHealthyRsi = rsi >= 45 && rsi <= 62;

      if (isTrend && isDip && isBullish && isHealthyRsi) {
        return { isMatch: true, score: (65 - rsi) * 2 + (tech.ema9[cIdx] / tech.ema50[cIdx]) * 10 };
      }
      return { isMatch: false };
    }
  },

  // Experiment 2: 1-Hour Squeeze Breakout with Volume Surge
  {
    name: '1H Volume Squeeze Breakout (8% TP, 2.5% SL, 4% Trail)',
    timeframe: '1h',
    maxSlots: 2,
    takeProfitPct: 9.0,
    stopLossPct: 2.5,
    breakEvenTriggerPct: 3.0,
    breakEvenLockPct: 0.3,
    trailingTriggerPct: 4.5,
    trailingDistancePct: 1.8,
    maxHoldBars: 48, // 48 hours
    entryRule: ({ cIdx, candle, tech, btc1h, openTime }) => {
      const btcIdx = btc1h.timeMap.get(openTime);
      if (btcIdx !== undefined && btcIdx >= 50 && btc1h.candles[btcIdx].close < btc1h.tech.ema50[btcIdx]) return { isMatch: false };

      // 1H Donchian 24-period breakout with 2x RVOL
      const high24 = Math.max(...tech.ema9 ? [tech.ema9[cIdx]] : [candle.high]); // placeholder
      const rvol = tech.volSma20[cIdx] > 0 ? candle.volume / tech.volSma20[cIdx] : 1;
      const isBreak = candle.close > tech.ema9[cIdx] && candle.close > tech.ema21[cIdx] && tech.ema9[cIdx] > tech.ema21[cIdx];
      const rsi = tech.rsi14[cIdx];

      if (isBreak && rvol >= 1.8 && rsi >= 50 && rsi <= 68 && candle.close > candle.open) {
        return { isMatch: true, score: rvol * 5 + rsi };
      }
      return { isMatch: false };
    }
  },

  // Experiment 3: Multi-Timeframe Deep Oversold Panic Dip (Buy Panic Dips in Macro Bull Trend)
  {
    name: '4H Bull Trend + 15m Panic Dip Rebound (6% TP, 2.2% SL)',
    timeframe: '15m',
    maxSlots: 2,
    takeProfitPct: 6.0,
    stopLossPct: 2.2,
    breakEvenTriggerPct: 2.2,
    breakEvenLockPct: 0.3,
    trailingTriggerPct: 3.5,
    trailingDistancePct: 1.2,
    maxHoldBars: 32, // 8 hours
    entryRule: ({ cIdx, candle, tech, sym4h, btc4h, openTime }) => {
      // Macro Filter: BTC 4H is above EMA 50
      const btcIdx = btc4h.timeMap.get(openTime);
      if (btcIdx !== undefined && btcIdx >= 50 && btc4h.candles[btcIdx].close < btc4h.tech.ema50[btcIdx]) return { isMatch: false };

      // Coin 4H Macro Filter: 4H EMA 21 > 4H EMA 50 (Coin is in overall macro uptrend!)
      const c4hIdx = sym4h.timeMap.get(openTime);
      if (c4hIdx === undefined || c4hIdx < 50) return { isMatch: false };
      const is4hBull = sym4h.tech.ema21[c4hIdx] > sym4h.tech.ema50[c4hIdx] && sym4h.candles[c4hIdx].close > sym4h.tech.ema50[c4hIdx];
      if (!is4hBull) return { isMatch: false };

      // 15m Entry: Extreme oversold panic drop (RSI < 30) with lower wick hammer rejection
      const rsi = tech.rsi14[cIdx];
      const isOversold = rsi <= 30;
      const hasHammerWick = (candle.close - candle.low) >= (candle.high - candle.low) * 0.45;

      if (isOversold && hasHammerWick) {
        return { isMatch: true, score: 50 - rsi };
      }
      return { isMatch: false };
    }
  },

  // Experiment 4: 1H Dynamic Trend Pullback (Asymmetric 10% TP, 3.0% SL)
  {
    name: '1H Dynamic Trend Pullback (10% TP, 3.0% SL, 4.5% Trail)',
    timeframe: '1h',
    maxSlots: 2,
    takeProfitPct: 10.0,
    stopLossPct: 3.0,
    breakEvenTriggerPct: 3.2,
    breakEvenLockPct: 0.4,
    trailingTriggerPct: 5.0,
    trailingDistancePct: 2.0,
    maxHoldBars: 72, // 3 days
    entryRule: ({ cIdx, candle, tech, btc1h, openTime }) => {
      const btcIdx = btc1h.timeMap.get(openTime);
      if (btcIdx !== undefined && btcIdx >= 50 && btc1h.candles[btcIdx].close < btc1h.tech.ema50[btcIdx]) return { isMatch: false };

      const isTrend = tech.ema9[cIdx] > tech.ema21[cIdx] && tech.ema21[cIdx] > tech.ema50[cIdx];
      const isRetest = candle.low <= tech.ema21[cIdx] * 1.008 && candle.close >= tech.ema21[cIdx] * 0.995;
      const rsi = tech.rsi14[cIdx];

      if (isTrend && isRetest && rsi >= 42 && rsi <= 56 && candle.close > candle.open) {
        return { isMatch: true, score: (60 - rsi) * 2 + (tech.ema9[cIdx] / tech.ema50[cIdx]) * 10 };
      }
      return { isMatch: false };
    }
  }
];

const results = [];
for (const exp of experiments) {
  const t0 = Date.now();
  const res = simulateStrategy(exp);
  const dur = ((Date.now() - t0) / 1000).toFixed(1);
  results.push(res);
  console.log(`[${dur}s] ${res.name}:`);
  console.log(`  ROI: ${res.roiPct >= 0 ? '+' : ''}${res.roiPct}%, Balance: $${res.finalBalance}, Trades: ${res.trades}, WinRate: ${res.winRate}%, ActiveDays: ${res.activeDays}/289, PF: ${res.profitFactor}, MaxDD: ${res.maxDrawdownPct}%\n`);
}

fs.writeFileSync(path.resolve(__dirname, 'quant_lab_results.json'), JSON.stringify(results.map(r => ({
  name: r.name,
  roiPct: r.roiPct,
  finalBalance: r.finalBalance,
  trades: r.trades,
  wins: r.wins,
  losses: r.losses,
  be: r.be,
  winRate: r.winRate,
  profitFactor: r.profitFactor,
  maxDrawdownPct: r.maxDrawdownPct,
  activeDays: r.activeDays
})), null, 2));

console.log('Results saved to quant_lab_results.json.');
