import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cacheDir = path.resolve(__dirname, '../data/binance_cache');

console.log('Searching for strategies that achieve 3% - 7% daily profit with high daily activity...');

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
  const rsi14 = new Float64Array(len);
  const volSma20 = new Float64Array(len);

  const k9 = 2 / 10, k21 = 2 / 22;
  let e9 = closes[0], e21 = closes[0];
  for (let i = 0; i < len; i++) {
    const cl = closes[i];
    e9 = i === 0 ? cl : cl * k9 + e9 * (1 - k9);
    e21 = i === 0 ? cl : cl * k21 + e21 * (1 - k21);
    ema9[i] = e9; ema21[i] = e21;
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

  return { ema9, ema21, rsi14, volSma20 };
}

const symData = {};
for (const sym of symbols) {
  const c = datasets[sym];
  symData[sym] = { candles: c, tech: calculateTech(c), timeMap: new Map() };
  c.forEach((bar, idx) => symData[sym].timeMap.set(bar.openTime, idx));
}

const timeSource = datasets['ETHUSDT'] || datasets[symbols[0]];
const sortedTimes = timeSource.map(c => c.openTime);

function simulateAggressive(params) {
  let balance = 100.0;
  let peakBalance = balance;
  let maxDD = 0;
  const activeTrades = [];
  const closedTrades = [];
  const dailyPnL = {};

  const feeRate = 0.0010;
  const slipRate = 0.0003;

  for (let tIdx = 96; tIdx < sortedTimes.length; tIdx++) {
    const openTime = sortedTimes[tIdx];
    const dateStr = timeSource[tIdx].time.split('T')[0];

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

      if (c.low <= pos.currentStop) {
        exitPrice = pos.currentStop * (1 - slipRate);
      } else if (params.tp && c.high >= pos.entryPrice * (1 + params.tp / 100)) {
        exitPrice = pos.entryPrice * (1 + params.tp / 100) * (1 - slipRate);
      } else if (pos.barsHeld >= params.maxHoldBars) {
        exitPrice = c.close * (1 - slipRate);
      } else {
        const peakGain = ((c.high - pos.entryPrice) / pos.entryPrice) * 100;
        if (c.high > pos.peakPrice) pos.peakPrice = c.high;

        if (params.trailingTrigger && peakGain >= params.trailingTrigger) {
          const trStop = pos.peakPrice * (1 - params.trailingDist / 100);
          if (trStop > pos.currentStop) pos.currentStop = trStop;
        } else if (params.beTrigger && peakGain >= params.beTrigger) {
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
        closedTrades.push({ netPnL, date: dateStr });
        activeTrades.splice(pIdx, 1);
      }
    }

    // Entries: Top Momentum & Volume Surge (RVOL)
    if (activeTrades.length < params.maxSlots) {
      let candidates = [];

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

        if (params.strategy === 'SURGE_MOMENTUM') {
          // Surging altcoin: 24h gain >= minGain, RVOL >= minRvol, 15m candle green, RSI not overbought
          const isGreen = c.close > c.open;
          const emaTrend = tech.ema9[idx] > tech.ema21[idx];
          if (gain24h >= params.minGain && rvol >= params.minRvol && isGreen && emaTrend && rsi >= 48 && rsi <= 72) {
            candidates.push({ sym, score: rvol * 2 + gain24h, price: c.close * (1 + slipRate) });
          }
        } else if (params.strategy === 'DIP_RECOVERY') {
          // Quick dip into 9 EMA on a leader coin (gain24h >= 4%)
          const dipped = c.low <= tech.ema9[idx] * 1.002 && c.close >= tech.ema9[idx];
          const isGreen = c.close > c.open;
          if (gain24h >= 4.0 && dipped && isGreen && rsi >= 42 && rsi <= 60) {
            candidates.push({ sym, score: (60 - rsi) * 2 + gain24h, price: c.close * (1 + slipRate) });
          }
        }
      }

      candidates.sort((a, b) => b.score - a.score);

      for (const cand of candidates) {
        if (activeTrades.length >= params.maxSlots) break;
        const slotSize = Math.max(5.0, balance / params.maxSlots);
        activeTrades.push({
          symbol: cand.sym,
          entryPrice: cand.price,
          notional: slotSize,
          peakPrice: cand.price,
          currentStop: cand.price * (1 - params.sl / 100),
          barsHeld: 0
        });
      }
    }
  }

  const totalTrades = closedTrades.length;
  const wins = closedTrades.filter(t => t.netPnL > 0.001);
  const winRate = totalTrades > 0 ? (wins.length / totalTrades) * 100 : 0;
  const roi = ((balance - 100) / 100) * 100;

  const tradedDays = Object.keys(dailyPnL).length;
  const days3to7pct = Object.values(dailyPnL).filter(v => v >= 3.0).length;
  const profitableDays = Object.values(dailyPnL).filter(v => v > 0.01).length;
  const losingDays = Object.values(dailyPnL).filter(v => v < -0.01).length;

  return {
    name: params.name,
    tp: params.tp ? `${params.tp}%` : 'Trailing',
    sl: `${params.sl}%`,
    slots: params.maxSlots,
    totalTrades,
    tradedDays: `${tradedDays} / 290`,
    daysWith3to7pctPlus: days3to7pct,
    profitableDays,
    losingDays,
    winRate: `${winRate.toFixed(1)}%`,
    finalBalance: `$${balance.toFixed(2)}`,
    netROI: `${roi.toFixed(1)}%`,
    maxDD: `${maxDD.toFixed(1)}%`
  };
}

const tests = [
  // Fast TP targets with 1 to 3 slots
  { name: '1. Fast Scalp 3.5% TP / 1.8% SL (1 Slot)', strategy: 'DIP_RECOVERY', tp: 3.5, sl: 1.8, beTrigger: 1.8, beLock: 0.25, trailingTrigger: 2.5, trailingDist: 0.8, maxHoldBars: 24, maxSlots: 1 },
  { name: '2. Fast Scalp 3.5% TP / 1.8% SL (3 Slots)', strategy: 'DIP_RECOVERY', tp: 3.5, sl: 1.8, beTrigger: 1.8, beLock: 0.25, trailingTrigger: 2.5, trailingDist: 0.8, maxHoldBars: 24, maxSlots: 3 },
  { name: '3. Fast Scalp 5.0% TP / 2.0% SL (1 Slot)', strategy: 'DIP_RECOVERY', tp: 5.0, sl: 2.0, beTrigger: 2.0, beLock: 0.25, trailingTrigger: 3.0, trailingDist: 1.0, maxHoldBars: 32, maxSlots: 1 },
  { name: '4. Surge Momentum 4.0% TP / 2.0% SL (1 Slot)', strategy: 'SURGE_MOMENTUM', minGain: 5.0, minRvol: 2.0, tp: 4.0, sl: 2.0, beTrigger: 2.0, beLock: 0.25, trailingTrigger: 2.8, trailingDist: 1.0, maxHoldBars: 24, maxSlots: 1 },
  { name: '5. Surge Momentum 6.0% TP / 2.5% SL (2 Slots)', strategy: 'SURGE_MOMENTUM', minGain: 6.0, minRvol: 2.5, tp: 6.0, sl: 2.5, beTrigger: 2.5, beLock: 0.25, trailingTrigger: 3.5, trailingDist: 1.2, maxHoldBars: 32, maxSlots: 2 }
];

const results = tests.map(simulateAggressive);
console.table(results);
