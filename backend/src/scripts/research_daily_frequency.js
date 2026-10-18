import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cacheDir = path.resolve(__dirname, '../data/binance_cache');

console.log('Loading candle datasets for high-frequency daily strategy research...');

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
console.log(`Loaded ${symbols.length} altcoin datasets.`);

// Helper: Calculate Indicators (EMA 9, EMA 21, EMA 50, RSI 14, ATR 14, BB 20)
function calculateIndicators(candles) {
  const len = candles.length;
  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);

  const ema9 = new Float64Array(len);
  const ema21 = new Float64Array(len);
  const ema50 = new Float64Array(len);
  const rsi14 = new Float64Array(len);
  const atr14 = new Float64Array(len);
  const bbLower = new Float64Array(len);
  const bbUpper = new Float64Array(len);
  const bbMid = new Float64Array(len);

  const k9 = 2 / 10;
  const k21 = 2 / 22;
  const k50 = 2 / 51;

  let e9 = closes[0], e21 = closes[0], e50 = closes[0];
  for (let i = 0; i < len; i++) {
    const cl = closes[i];
    e9 = i === 0 ? cl : cl * k9 + e9 * (1 - k9);
    e21 = i === 0 ? cl : cl * k21 + e21 * (1 - k21);
    e50 = i === 0 ? cl : cl * k50 + e50 * (1 - k50);
    ema9[i] = e9;
    ema21[i] = e21;
    ema50[i] = e50;
  }

  // RSI
  let avgG = 0, avgL = 0;
  for (let i = 1; i <= 14 && i < len; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) avgG += diff; else avgL += Math.abs(diff);
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

  // ATR 14
  let trSum = 0;
  for (let i = 1; i <= 14 && i < len; i++) {
    const tr = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
    trSum += tr;
  }
  let prevAtr = trSum / 14;
  atr14[14] = prevAtr;

  for (let i = 15; i < len; i++) {
    const tr = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
    prevAtr = (prevAtr * 13 + tr) / 14;
    atr14[i] = prevAtr;
  }

  // Bollinger Bands 20
  for (let i = 19; i < len; i++) {
    let sum = 0;
    for (let j = 0; j < 20; j++) sum += closes[i - j];
    const mean = sum / 20;
    let varSum = 0;
    for (let j = 0; j < 20; j++) varSum += Math.pow(closes[i - j] - mean, 2);
    const std = Math.sqrt(varSum / 20);
    bbMid[i] = mean;
    bbUpper[i] = mean + 2 * std;
    bbLower[i] = mean - 2 * std;
  }

  return { ema9, ema21, ema50, rsi14, atr14, bbLower, bbUpper, bbMid };
}

const symData = {};
for (const sym of [...symbols, 'BTCUSDT']) {
  if (!datasets[sym]) continue;
  const c = datasets[sym];
  symData[sym] = {
    candles: c,
    ind: calculateIndicators(c),
    timeMap: new Map()
  };
  c.forEach((bar, idx) => symData[sym].timeMap.set(bar.openTime, idx));
}

const timeSource = symData['BTCUSDT'].candles;
console.log(`Total 15m bars to evaluate: ${timeSource.length}`);

// We want to test different strategies specifically aimed at DAILY ACTIVITY:
// Strategy 1: "Intraday BB Mean Reversion" (Dip below BB Lower + RSI < 35 + Rebound green candle) -> TP 2.5%, SL 1.8%
// Strategy 2: "15m EMA Trend Pullback" (EMA9 > EMA21, price tests EMA21, bullish green close) -> TP 2.8%, SL 2.0%
// Strategy 3: "Intraday VWAP/Support Rebound" (Oversold RSI < 30 on 15m, RSI curling up) -> TP 3.0%, SL 2.0%
// Strategy 4: "Multi-Slot Active Scalp" (Hold up to 3 slots, TP 2.5%, SL 1.8%, Trailing 1.5% dist 0.6%)

function simulateStrategy(name, config) {
  let balance = 100.0;
  let peakBalance = balance;
  let maxDD = 0;
  const activeTrades = [];
  const closedTrades = [];
  const dailyPnL = {};

  const feeRate = 0.0010; // 0.10% Binance spot fee
  const slipRate = 0.0005; // 0.05% slippage

  for (let tIdx = 50; tIdx < timeSource.length; tIdx++) {
    const bar = timeSource[tIdx];
    const openTime = bar.openTime;
    const dateStr = bar.time.split('T')[0];

    // Manage exits
    for (let pIdx = activeTrades.length - 1; pIdx >= 0; pIdx--) {
      const pos = activeTrades[pIdx];
      const sObj = symData[pos.symbol];
      if (!sObj) continue;
      const cIdx = sObj.timeMap.get(openTime);
      if (cIdx === undefined) continue;

      const c = sObj.candles[cIdx];
      pos.barsHeld++;

      let exitPrice = null;
      let exitReason = null;

      if (c.low <= pos.currentStop) {
        exitPrice = pos.currentStop * (1 - slipRate);
        exitReason = pos.currentStop > pos.entryPrice ? 'TRAILING' : 'STOP_LOSS';
      } else if (c.high >= pos.entryPrice * (1 + config.tp / 100)) {
        exitPrice = pos.entryPrice * (1 + config.tp / 100) * (1 - slipRate);
        exitReason = 'TAKE_PROFIT';
      } else if (pos.barsHeld >= config.maxHoldBars) {
        exitPrice = c.close * (1 - slipRate);
        exitReason = 'TIME_LIMIT';
      } else {
        const peakGainPct = ((c.high - pos.entryPrice) / pos.entryPrice) * 100;
        if (c.high > pos.peakPrice) pos.peakPrice = c.high;

        if (config.trailingTrigger && peakGainPct >= config.trailingTrigger) {
          const trStop = pos.peakPrice * (1 - config.trailingDist / 100);
          if (trStop > pos.currentStop) pos.currentStop = trStop;
        } else if (config.beTrigger && peakGainPct >= config.beTrigger) {
          const beStop = pos.entryPrice * (1 + config.beLock / 100);
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

        dailyPnL[dateStr] = (dailyPnL[dateStr] || 0) + netPnL;

        closedTrades.push({
          symbol: pos.symbol,
          entryPrice: pos.entryPrice,
          exitPrice,
          netPnL,
          returnPct: (netPnL / notional) * 100,
          exitReason,
          date: dateStr
        });

        activeTrades.splice(pIdx, 1);
      }
    }

    // Check entry if slots available
    if (activeTrades.length < config.maxSlots) {
      // BTC check
      if (config.useBtc) {
        const btcIdx = symData['BTCUSDT'].timeMap.get(openTime);
        if (btcIdx !== undefined) {
          const btcC = symData['BTCUSDT'].candles[btcIdx];
          const btcEma = symData['BTCUSDT'].ind.ema50[btcIdx];
          if (btcC.close < btcEma * 0.985) continue; // Skip if BTC is dumping >1.5% below 50 EMA
        }
      }

      let bestCand = null;
      let highestScore = -Infinity;

      for (const sym of symbols) {
        if (activeTrades.some(t => t.symbol === sym)) continue;
        const sObj = symData[sym];
        if (!sObj) continue;
        const idx = sObj.timeMap.get(openTime);
        if (idx === undefined || idx < 50) continue;

        const c = sObj.candles[idx];
        const prevC = sObj.candles[idx - 1];
        const ind = sObj.ind;

        let match = false;
        let score = 0;

        if (config.type === 'BB_REVERSION') {
          // Low touched or pierced lower Bollinger Band, RSI oversold, candle closed green
          const touchedLower = c.low <= ind.bbLower[idx] * 1.002;
          const rsiOversold = ind.rsi14[idx] <= 36;
          const greenReversal = c.close > c.open && c.close > ind.bbLower[idx];
          if (touchedLower && rsiOversold && greenReversal) {
            match = true;
            score = (40 - ind.rsi14[idx]) * 3 + ((c.close - c.open) / c.open) * 100;
          }
        } else if (config.type === 'EMA_PULLBACK') {
          // 15m trend: EMA9 > EMA21 > EMA50, price pulled back to EMA21, closed green
          const trend = ind.ema9[idx] > ind.ema21[idx] && ind.ema21[idx] > ind.ema50[idx];
          const pulledBack = c.low <= ind.ema21[idx] * 1.003 && c.close >= ind.ema21[idx] * 0.998;
          const greenClose = c.close > c.open;
          const rsiHealthy = ind.rsi14[idx] >= 42 && ind.rsi14[idx] <= 58;
          if (trend && pulledBack && greenClose && rsiHealthy) {
            match = true;
            score = (ind.ema9[idx] / ind.ema50[idx]) * 10 + (60 - ind.rsi14[idx]);
          }
        } else if (config.type === 'OVERSOLD_BOUNCE') {
          // RSI dropped below 30, and current bar creates higher low or green hammer
          const wasOversold = ind.rsi14[idx - 1] <= 30 || ind.rsi14[idx] <= 32;
          const greenBar = c.close > c.open;
          const wick = (Math.min(c.open, c.close) - c.low) / (c.high - c.low || 1);
          if (wasOversold && greenBar && (wick >= 0.30 || c.close > prevC.high)) {
            match = true;
            score = (35 - ind.rsi14[idx]) * 2 + wick * 10;
          }
        }

        if (match && score > highestScore) {
          highestScore = score;
          bestCand = {
            symbol: sym,
            entryPrice: c.close * (1 + slipRate),
            time: c.time
          };
        }
      }

      if (bestCand) {
        const slotSize = balance / config.maxSlots;
        activeTrades.push({
          symbol: bestCand.symbol,
          entryPrice: bestCand.entryPrice,
          notional: slotSize,
          peakPrice: bestCand.entryPrice,
          currentStop: bestCand.entryPrice * (1 - config.sl / 100),
          barsHeld: 0
        });
      }
    }
  }

  // Calculate stats
  const totalTrades = closedTrades.length;
  const wins = closedTrades.filter(t => t.netPnL > 0.001);
  const losses = closedTrades.filter(t => t.netPnL < -0.001);
  const winRate = totalTrades > 0 ? (wins.length / totalTrades) * 100 : 0;
  const totalProfit = wins.reduce((acc, t) => acc + t.netPnL, 0);
  const totalLoss = Math.abs(losses.reduce((acc, t) => acc + t.netPnL, 0));
  const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : totalProfit;
  const roi = ((balance - 100) / 100) * 100;

  const tradedDays = Object.keys(dailyPnL).length;
  const profitableDays = Object.values(dailyPnL).filter(v => v > 0.01).length;
  const losingDays = Object.values(dailyPnL).filter(v => v < -0.01).length;

  return {
    name,
    roi: Number(roi.toFixed(2)),
    finalBalance: Number(balance.toFixed(2)),
    totalTrades,
    winRate: Number(winRate.toFixed(1)),
    profitFactor: Number(profitFactor.toFixed(2)),
    maxDD: Number(maxDD.toFixed(1)),
    tradedDays,
    totalDays: 290,
    profitableDays,
    losingDays,
    tradesPerDay: Number((totalTrades / (tradedDays || 1)).toFixed(1)),
    dailyConsistencyPct: Number(((profitableDays / (tradedDays || 1)) * 100).toFixed(1))
  };
}

console.log('\n--- Running Simulations for Daily Frequency Setups ---');

const results = [];

// Test configurations
results.push(simulateStrategy('BB Reversion (TP 2.5% / SL 1.8% / 1 Slot)', {
  type: 'BB_REVERSION', tp: 2.5, sl: 1.8, beTrigger: 1.5, beLock: 0.25, trailingTrigger: null, maxHoldBars: 24, maxSlots: 1, useBtc: true
}));

results.push(simulateStrategy('BB Reversion (TP 3.0% / SL 2.0% / 2 Slots)', {
  type: 'BB_REVERSION', tp: 3.0, sl: 2.0, beTrigger: 1.8, beLock: 0.25, trailingTrigger: 2.2, trailingDist: 0.8, maxHoldBars: 32, maxSlots: 2, useBtc: true
}));

results.push(simulateStrategy('EMA 15m Trend Pullback (TP 2.5% / SL 1.8% / 2 Slots)', {
  type: 'EMA_PULLBACK', tp: 2.5, sl: 1.8, beTrigger: 1.4, beLock: 0.25, trailingTrigger: null, maxHoldBars: 24, maxSlots: 2, useBtc: true
}));

results.push(simulateStrategy('EMA 15m Trend Pullback (TP 3.0% / SL 2.2% / 3 Slots)', {
  type: 'EMA_PULLBACK', tp: 3.0, sl: 2.2, beTrigger: 1.8, beLock: 0.25, trailingTrigger: 2.2, trailingDist: 0.8, maxHoldBars: 32, maxSlots: 3, useBtc: true
}));

results.push(simulateStrategy('15m Oversold Bounce (TP 2.8% / SL 2.0% / 2 Slots)', {
  type: 'OVERSOLD_BOUNCE', tp: 2.8, sl: 2.0, beTrigger: 1.6, beLock: 0.25, trailingTrigger: 2.0, trailingDist: 0.7, maxHoldBars: 24, maxSlots: 2, useBtc: true
}));

results.push(simulateStrategy('15m Oversold Bounce (TP 3.5% / SL 2.0% / 3 Slots)', {
  type: 'OVERSOLD_BOUNCE', tp: 3.5, sl: 2.0, beTrigger: 2.0, beLock: 0.25, trailingTrigger: 2.5, trailingDist: 0.9, maxHoldBars: 32, maxSlots: 3, useBtc: true
}));

console.log('\n--- RESEARCH RESULTS ---');
console.table(results);
