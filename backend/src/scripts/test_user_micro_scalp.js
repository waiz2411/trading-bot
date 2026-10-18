import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cacheDir = path.resolve(__dirname, '../data/binance_cache');

console.log('Testing User Hypothesis: 0.5% - 1.0% Micro-Scalping with High Daily Frequency...');

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
  const ema9 = new Float64Array(len);
  const ema21 = new Float64Array(len);
  const rsi14 = new Float64Array(len);

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
  return { ema9, ema21, rsi14 };
}

const symData = {};
for (const sym of symbols) {
  const c = datasets[sym];
  symData[sym] = { candles: c, tech: calculateTech(c), timeMap: new Map() };
  c.forEach((bar, idx) => symData[sym].timeMap.set(bar.openTime, idx));
}

const timeSource = datasets['ETHUSDT'] || datasets[symbols[0]];

function testMicroScalp(tp, sl, maxSlots, maxHoldBars, name) {
  let balance = 100.0;
  let grossWinsDollar = 0;
  let grossLossesDollar = 0;
  let totalFeesPaid = 0;
  const activeTrades = [];
  const closedTrades = [];
  const dailyTradesCount = {};

  const feeRate = 0.0010; // 0.10% buy + 0.10% sell = 0.20% round trip
  const slipRate = 0.0003; // Conservative 0.03% slippage

  for (let tIdx = 50; tIdx < timeSource.length; tIdx++) {
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

      if (c.low <= pos.entryPrice * (1 - sl / 100)) {
        exitPrice = pos.entryPrice * (1 - sl / 100) * (1 - slipRate);
        exitReason = 'STOP_LOSS';
      } else if (c.high >= pos.entryPrice * (1 + tp / 100)) {
        exitPrice = pos.entryPrice * (1 + tp / 100) * (1 - slipRate);
        exitReason = 'TAKE_PROFIT';
      } else if (pos.barsHeld >= maxHoldBars) {
        exitPrice = c.close * (1 - slipRate);
        exitReason = 'TIME_LIMIT';
      }

      if (exitPrice !== null) {
        const notional = pos.notional;
        const grossReturnPct = ((exitPrice - pos.entryPrice) / pos.entryPrice) * 100;
        const grossGain = notional * (grossReturnPct / 100);
        const fees = notional * feeRate * 2;
        const netPnL = grossGain - fees;

        if (grossGain > 0) grossWinsDollar += grossGain;
        else grossLossesDollar += Math.abs(grossGain);
        totalFeesPaid += fees;

        balance = Number((balance + netPnL).toFixed(2));
        dailyTradesCount[dateStr] = (dailyTradesCount[dateStr] || 0) + 1;

        closedTrades.push({
          netPnL,
          grossGain,
          fees,
          returnPct: (netPnL / notional) * 100,
          exitReason
        });

        activeTrades.splice(pIdx, 1);
      }
    }

    // High frequency entry scan: enter whenever a coin has a green 15m candle with mild momentum
    if (activeTrades.length < maxSlots) {
      for (const sym of symbols) {
        if (activeTrades.length >= maxSlots) break;
        if (activeTrades.some(t => t.symbol === sym)) continue;

        const sObj = symData[sym];
        if (!sObj) continue;
        const idx = sObj.timeMap.get(openTime);
        if (idx === undefined || idx < 20) continue;

        const c = sObj.candles[idx];
        const prevC = sObj.candles[idx - 1];

        // Green candle momentum: close > open and close > prev high
        if (c.close > c.open && c.close > prevC.close && sObj.tech.rsi14[idx] >= 45 && sObj.tech.rsi14[idx] <= 70) {
          const slotSize = Math.max(5.0, balance / maxSlots);
          activeTrades.push({
            symbol: sym,
            entryPrice: c.close * (1 + slipRate),
            notional: slotSize,
            barsHeld: 0
          });
        }
      }
    }
  }

  const totalTrades = closedTrades.length;
  const wins = closedTrades.filter(t => t.netPnL > 0.001);
  const losses = closedTrades.filter(t => t.netPnL < -0.001);
  const winRate = totalTrades > 0 ? (wins.length / totalTrades) * 100 : 0;
  const tradedDays = Object.keys(dailyTradesCount).length;
  const avgTradesPerDay = Number((totalTrades / (tradedDays || 1)).toFixed(1));

  return {
    name,
    tp: `${tp}%`,
    sl: `${sl}%`,
    totalTrades,
    avgTradesPerDay,
    winRate: `${winRate.toFixed(1)}%`,
    grossWinLoss: `$${grossWinsDollar.toFixed(1)} / -$${grossLossesDollar.toFixed(1)}`,
    totalFeesPaid: `$${totalFeesPaid.toFixed(2)}`,
    finalBalance: `$${balance.toFixed(2)}`,
    netROI: `${((balance - 100) / 100 * 100).toFixed(1)}%`
  };
}

const tests = [
  testMicroScalp(0.5, 0.5, 5, 4, '0.5% TP / 0.5% SL (Equal Risk/Reward)'),
  testMicroScalp(0.5, 1.0, 5, 4, '0.5% TP / 1.0% SL (Wider Stop)'),
  testMicroScalp(0.8, 0.8, 5, 6, '0.8% TP / 0.8% SL (Equal Risk/Reward)'),
  testMicroScalp(1.0, 1.0, 5, 8, '1.0% TP / 1.0% SL (Equal Risk/Reward)'),
  testMicroScalp(1.2, 0.8, 5, 8, '1.2% TP / 0.8% SL (Positive R:R)')
];

console.table(tests);
