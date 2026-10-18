import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cacheDir = path.resolve(__dirname, '../data/binance_cache');

console.log('Searching for profitable high-frequency / daily trading strategies...');

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
  const volumes = candles.map(c => c.volume);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);

  const ema9 = new Float64Array(len);
  const ema21 = new Float64Array(len);
  const ema50 = new Float64Array(len);
  const rsi14 = new Float64Array(len);
  const volSma20 = new Float64Array(len);
  const atr14 = new Float64Array(len);

  const k9 = 2 / 10, k21 = 2 / 22, k50 = 2 / 51;
  let e9 = closes[0], e21 = closes[0], e50 = closes[0];
  for (let i = 0; i < len; i++) {
    const cl = closes[i];
    e9 = i === 0 ? cl : cl * k9 + e9 * (1 - k9);
    e21 = i === 0 ? cl : cl * k21 + e21 * (1 - k21);
    e50 = i === 0 ? cl : cl * k50 + e50 * (1 - k50);
    ema9[i] = e9; ema21[i] = e21; ema50[i] = e50;
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

  let vSum = 0;
  for (let i = 0; i < 20 && i < len; i++) vSum += volumes[i];
  volSma20[19] = vSum / 20;
  for (let i = 20; i < len; i++) {
    vSum += volumes[i] - volumes[i - 20];
    volSma20[i] = vSum / 20;
  }

  let trSum = 0;
  for (let i = 1; i <= 14 && i < len; i++) {
    trSum += Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
  }
  let prevAtr = trSum / 14;
  atr14[14] = prevAtr;
  for (let i = 15; i < len; i++) {
    const tr = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
    prevAtr = (prevAtr * 13 + tr) / 14;
    atr14[i] = prevAtr;
  }

  return { ema9, ema21, ema50, rsi14, volSma20, atr14 };
}

const symData = {};
for (const sym of [...symbols, 'BTCUSDT']) {
  if (!datasets[sym]) continue;
  const c = datasets[sym];
  symData[sym] = { candles: c, tech: calculateTech(c), timeMap: new Map() };
  c.forEach((bar, idx) => symData[sym].timeMap.set(bar.openTime, idx));
}

const timeSource = symData['BTCUSDT'].candles;

function testSetup(params) {
  let balance = 100.0;
  let peakBalance = balance;
  let maxDD = 0;
  const activeTrades = [];
  const closedTrades = [];
  const dailyPnL = {};

  const feeRate = 0.0010;
  const slipRate = 0.0005;

  for (let tIdx = 96; tIdx < timeSource.length; tIdx++) {
    const bar = timeSource[tIdx];
    const openTime = bar.openTime;
    const dateStr = bar.time.split('T')[0];

    // Exits
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
      } else if (params.tp && c.high >= pos.entryPrice * (1 + params.tp / 100)) {
        exitPrice = pos.entryPrice * (1 + params.tp / 100) * (1 - slipRate);
        exitReason = 'TAKE_PROFIT';
      } else if (pos.barsHeld >= params.maxHoldBars) {
        exitPrice = c.close * (1 - slipRate);
        exitReason = 'TIME_LIMIT';
      } else {
        const peakGainPct = ((c.high - pos.entryPrice) / pos.entryPrice) * 100;
        if (c.high > pos.peakPrice) pos.peakPrice = c.high;

        if (params.trailingTrigger && peakGainPct >= params.trailingTrigger) {
          const trStop = pos.peakPrice * (1 - params.trailingDist / 100);
          if (trStop > pos.currentStop) pos.currentStop = trStop;
        } else if (params.beTrigger && peakGainPct >= params.beTrigger) {
          const beStop = pos.entryPrice * (1 + params.beLock / 100);
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

    // Entries
    if (activeTrades.length < params.maxSlots) {
      if (params.btcFilter) {
        const btcIdx = symData['BTCUSDT'].timeMap.get(openTime);
        if (btcIdx !== undefined) {
          const btcC = symData['BTCUSDT'].candles[btcIdx];
          const btcEma = symData['BTCUSDT'].tech.ema21[btcIdx];
          if (btcC.close < btcEma) continue;
        }
      }

      let bestCand = null;
      let highestScore = -Infinity;

      for (const sym of symbols) {
        if (activeTrades.some(t => t.symbol === sym)) continue;
        const sObj = symData[sym];
        if (!sObj) continue;
        const idx = sObj.timeMap.get(openTime);
        if (idx === undefined || idx < 96) continue;

        const c = sObj.candles[idx];
        const tech = sObj.tech;

        const past24hClose = sObj.candles[idx - 96].close;
        const gain24h = ((c.close - past24hClose) / past24hClose) * 100;
        const rvol = tech.volSma20[idx] > 0 ? c.volume / tech.volSma20[idx] : 1;
        const rsi = tech.rsi14[idx];

        let match = false;
        let score = 0;

        if (params.mode === 'MOMENTUM_RVOL') {
          // Surging momentum leader: 24h gain >= 5%, RVOL >= 2.0x, EMA 9 > 21, RSI 50-70
          const isUptrend = tech.ema9[idx] > tech.ema21[idx] && c.close > tech.ema9[idx];
          if (gain24h >= params.minGain && rvol >= params.minRvol && rsi >= 48 && rsi <= 68 && isUptrend) {
            match = true;
            score = rvol * 3 + gain24h;
          }
        } else if (params.mode === 'VOLATILITY_EXPANSION') {
          // Candle is large expansion candle (range > 1.8 * ATR), breaking 20-bar high, strong volume
          const range = c.high - c.low;
          const atr = tech.atr14[idx];
          const high20 = Math.max(...sObj.candles.slice(idx - 20, idx).map(x => x.high));
          if (range > 1.6 * atr && c.close > high20 && rvol >= 1.8 && rsi <= 72) {
            match = true;
            score = rvol * 2 + (range / atr) * 5;
          }
        } else if (params.mode === 'TREND_RETEST') {
          // Strong 24h gainer (>6%) pulling back gently to EMA 21, RSI between 45-55
          const inTrend = tech.ema9[idx] > tech.ema21[idx] && tech.ema21[idx] > tech.ema50[idx];
          const pullingBack = c.low <= tech.ema21[idx] * 1.004 && c.close >= tech.ema21[idx] * 0.996 && c.close > c.open;
          if (gain24h >= 4.0 && inTrend && pullingBack && rsi >= 44 && rsi <= 56) {
            match = true;
            score = gain24h + (60 - rsi);
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
        const slotSize = balance / params.maxSlots;
        activeTrades.push({
          symbol: bestCand.symbol,
          entryPrice: bestCand.entryPrice,
          notional: slotSize,
          peakPrice: bestCand.entryPrice,
          currentStop: bestCand.entryPrice * (1 - params.sl / 100),
          barsHeld: 0
        });
      }
    }
  }

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
    name: params.name,
    roi: Number(roi.toFixed(2)),
    finalBalance: Number(balance.toFixed(2)),
    totalTrades,
    winRate: Number(winRate.toFixed(1)),
    profitFactor: Number(profitFactor.toFixed(2)),
    maxDD: Number(maxDD.toFixed(1)),
    tradedDays,
    profitableDays,
    losingDays,
    tradesPerDay: Number((totalTrades / (tradedDays || 1)).toFixed(1)),
    dailyWinRate: Number(((profitableDays / (tradedDays || 1)) * 100).toFixed(1))
  };
}

const tests = [
  { name: 'MOMENTUM_RVOL (TP 3.0%, SL 2.0%, 2 Slots)', mode: 'MOMENTUM_RVOL', minGain: 5.0, minRvol: 2.0, tp: 3.0, sl: 2.0, beTrigger: 1.8, beLock: 0.25, trailingTrigger: 2.2, trailingDist: 0.8, maxHoldBars: 24, maxSlots: 2, btcFilter: true },
  { name: 'MOMENTUM_RVOL (TP 4.0%, SL 2.5%, 3 Slots)', mode: 'MOMENTUM_RVOL', minGain: 7.0, minRvol: 2.5, tp: 4.0, sl: 2.5, beTrigger: 2.0, beLock: 0.25, trailingTrigger: 3.0, trailingDist: 1.0, maxHoldBars: 32, maxSlots: 3, btcFilter: true },
  { name: 'VOLATILITY_EXPANSION (TP 3.0%, SL 2.0%, 2 Slots)', mode: 'VOLATILITY_EXPANSION', tp: 3.0, sl: 2.0, beTrigger: 1.8, beLock: 0.25, trailingTrigger: 2.2, trailingDist: 0.8, maxHoldBars: 24, maxSlots: 2, btcFilter: true },
  { name: 'TREND_RETEST (TP 3.0%, SL 2.0%, 2 Slots)', mode: 'TREND_RETEST', tp: 3.0, sl: 2.0, beTrigger: 1.8, beLock: 0.25, trailingTrigger: 2.2, trailingDist: 0.8, maxHoldBars: 32, maxSlots: 2, btcFilter: true },
  { name: 'TREND_RETEST (TP 4.0%, SL 2.5%, 3 Slots)', mode: 'TREND_RETEST', tp: 4.0, sl: 2.5, beTrigger: 2.0, beLock: 0.25, trailingTrigger: 2.8, trailingDist: 1.0, maxHoldBars: 32, maxSlots: 3, btcFilter: true }
];

const results = tests.map(testSetup);
console.table(results);
