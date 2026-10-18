import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cacheDir = path.resolve(__dirname, '../data/binance_cache');

console.log('Loading 2026 Binance datasets for Micro-Scalping Analysis...');
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

function calculateIndicators(candles) {
  const len = candles.length;
  const closes = candles.map(c => c.close);
  const rsi7 = new Float64Array(len);
  const rsi14 = new Float64Array(len);
  const ema9 = new Float64Array(len);
  const ema21 = new Float64Array(len);
  const volSma20 = new Float64Array(len);

  const k9 = 2 / 10;
  const k21 = 2 / 22;
  let e9 = closes[0], e21 = closes[0];

  for (let i = 0; i < len; i++) {
    const cl = closes[i];
    e9 = i === 0 ? cl : (cl * k9) + (e9 * (1 - k9));
    e21 = i === 0 ? cl : (cl * k21) + (e21 * (1 - k21));
    ema9[i] = e9;
    ema21[i] = e21;

    if (i >= 19) {
      let vSum = 0;
      for (let j = 0; j < 20; j++) vSum += candles[i - j].volume;
      volSma20[i] = vSum / 20;
    } else {
      volSma20[i] = candles[i].volume;
    }
  }

  // RSI 7
  let g7 = 0, l7 = 0;
  for (let i = 1; i <= 7 && i < len; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) g7 += d; else l7 += Math.abs(d);
  }
  g7 /= 7; l7 /= 7;
  rsi7[7] = l7 === 0 ? 100 : 100 - (100 / (1 + g7 / l7));
  for (let i = 8; i < len; i++) {
    const d = closes[i] - closes[i - 1];
    g7 = (g7 * 6 + (d > 0 ? d : 0)) / 7;
    l7 = (l7 * 6 + (d < 0 ? Math.abs(d) : 0)) / 7;
    rsi7[i] = l7 === 0 ? 100 : 100 - (100 / (1 + g7 / l7));
  }

  // RSI 14
  let g14 = 0, l14 = 0;
  for (let i = 1; i <= 14 && i < len; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) g14 += d; else l14 += Math.abs(d);
  }
  g14 /= 14; l14 /= 14;
  rsi14[14] = l14 === 0 ? 100 : 100 - (100 / (1 + g14 / l14));
  for (let i = 15; i < len; i++) {
    const d = closes[i] - closes[i - 1];
    g14 = (g14 * 13 + (d > 0 ? d : 0)) / 14;
    l14 = (l14 * 13 + (d < 0 ? Math.abs(d) : 0)) / 14;
    rsi14[i] = l14 === 0 ? 100 : 100 - (100 / (1 + g14 / l14));
  }

  return { rsi7, rsi14, ema9, ema21, volSma20 };
}

const symData = {};
for (const sym of [...symbols, 'BTCUSDT']) {
  const c = datasets[sym];
  if (!c) continue;
  symData[sym] = { candles: c, tech: calculateIndicators(c), timeMap: new Map() };
  c.forEach((x, i) => symData[sym].timeMap.set(x.openTime, i));
}

// Micro-Scalp Simulator
function runMicroScalp(params) {
  const {
    name,
    tpPct = 1.0, // Gross Take Profit %
    slPct = 0.8, // Gross Stop Loss %
    feePct = 0.075, // 0.075% BNB fee per side (0.15% round-trip)
    slipPct = 0.025, // 0.025% slippage per side (0.05% round-trip)
    maxHoldBars = 4, // 4 * 15m = 60 mins max hold
    maxSlots = 5,
    entryCondition = () => false
  } = params;

  let balance = 100.0;
  let peakBalance = balance;
  let maxDrawdownPct = 0;
  const activeTrades = [];
  const closedTrades = [];
  const timeSource = symData['BTCUSDT'].candles;

  const roundTripFriction = (feePct + slipPct) * 2 / 100;

  for (let tIdx = 0; tIdx < timeSource.length; tIdx++) {
    const openTime = timeSource[tIdx].openTime;

    // 1. Manage Active Positions
    for (let pIdx = activeTrades.length - 1; pIdx >= 0; pIdx--) {
      const pos = activeTrades[pIdx];
      const entryObj = symData[pos.symbol];
      if (!entryObj) continue;

      const cIdx = entryObj.timeMap.get(openTime);
      if (cIdx === undefined) continue;

      const candle = entryObj.candles[cIdx];
      pos.barsHeld++;

      let exitPrice = null;
      let exitReason = null;

      if (candle.low <= pos.entryPrice * (1 - slPct / 100)) {
        exitPrice = pos.entryPrice * (1 - slPct / 100);
        exitReason = 'STOP_LOSS';
      } else if (candle.high >= pos.entryPrice * (1 + tpPct / 100)) {
        exitPrice = pos.entryPrice * (1 + tpPct / 100);
        exitReason = 'TAKE_PROFIT';
      } else if (pos.barsHeld >= maxHoldBars) {
        exitPrice = candle.close;
        exitReason = 'TIME_LIMIT';
      }

      if (exitPrice !== null) {
        const notional = pos.notional;
        const grossReturnPct = ((exitPrice - pos.entryPrice) / pos.entryPrice) * 100;
        const grossGain = notional * (grossReturnPct / 100);
        const fees = notional * roundTripFriction;
        const netPnL = grossGain - fees;
        const netReturnPct = (netPnL / notional) * 100;

        balance = Number((balance + netPnL).toFixed(2));
        if (balance > peakBalance) peakBalance = balance;
        const ddDollar = peakBalance - balance;
        const ddPct = peakBalance > 0 ? (ddDollar / peakBalance) * 100 : 0;
        if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;

        closedTrades.push({
          symbol: pos.symbol,
          entryTime: pos.entryTime,
          exitTime: candle.time,
          netPnL: Number(netPnL.toFixed(3)),
          returnPct: Number(netReturnPct.toFixed(2)),
          exitReason
        });

        activeTrades.splice(pIdx, 1);
      }
    }

    // 2. Scan Entry
    if (activeTrades.length < maxSlots) {
      for (const sym of symbols) {
        if (activeTrades.some(t => t.symbol === sym)) continue;
        if (activeTrades.length >= maxSlots) break;

        const obj = symData[sym];
        if (!obj) continue;
        const cIdx = obj.timeMap.get(openTime);
        if (cIdx === undefined || cIdx < 20) continue;

        const candle = obj.candles[cIdx];
        const tech = obj.tech;

        if (entryCondition({ sym, cIdx, candle, tech, btc: symData['BTCUSDT'] })) {
          const notional = 10.0; // $10 per trade
          activeTrades.push({
            symbol: sym,
            entryPrice: candle.close,
            entryTime: candle.time,
            notional,
            barsHeld: 0
          });
        }
      }
    }
  }

  const wins = closedTrades.filter(t => t.netPnL > 0);
  const losses = closedTrades.filter(t => t.netPnL < 0);
  const grossWin = wins.reduce((acc, t) => acc + t.netPnL, 0);
  const grossLoss = Math.abs(losses.reduce((acc, t) => acc + t.netPnL, 0));
  const profitFactor = grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(2)) : 999;
  const activeDays = new Set(closedTrades.map(t => t.exitTime.slice(0, 10))).size;

  const totalFeesPaid = closedTrades.length * 10.0 * roundTripFriction;

  return {
    name,
    trades: closedTrades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: Number(((wins.length / (closedTrades.length || 1)) * 100).toFixed(1)),
    netProfit: Number((balance - 100.0).toFixed(2)),
    roiPct: Number((((balance - 100.0) / 100.0) * 100).toFixed(2)),
    profitFactor,
    maxDrawdownPct: Number(maxDrawdownPct.toFixed(1)),
    activeDays,
    totalFeesPaid: Number(totalFeesPaid.toFixed(2)),
    avgDailyTrades: Number((closedTrades.length / (activeDays || 1)).toFixed(1))
  };
}

console.log('Testing Micro-Scalp Profiles (Aiming for 30-100 trades/day with $0.01 - $0.05 per trade)...');

const microTests = [
  // 1. Ultra-Micro Scalp: 0.8% TP, 0.6% SL, RSI(7) < 20 (Deep snapback)
  {
    name: 'Micro-Scalp TP 0.8%, SL 0.6%, RSI7 < 20 (Snapback)',
    tpPct: 0.8,
    slPct: 0.6,
    maxHoldBars: 3, // 45m
    entryCondition: ({ tech, cIdx, candle }) => tech.rsi7[cIdx] <= 20 && candle.close > candle.open
  },
  // 2. Micro-Scalp: 1.2% TP, 0.8% SL, RSI7 < 25 + Lower Wick
  {
    name: 'Micro-Scalp TP 1.2%, SL 0.8%, RSI7 < 25 (Rejection)',
    tpPct: 1.2,
    slPct: 0.8,
    maxHoldBars: 4, // 60m
    entryCondition: ({ tech, cIdx, candle }) => {
      const isRsi = tech.rsi7[cIdx] <= 25;
      const lowerWick = Math.min(candle.open, candle.close) - candle.low;
      const range = candle.high - candle.low;
      return isRsi && range > 0 && (lowerWick / range) >= 0.4;
    }
  },
  // 3. Micro-Scalp: 1.5% TP, 1.0% SL, RSI14 < 30 + Bullish candle
  {
    name: 'Micro-Scalp TP 1.5%, SL 1.0%, RSI14 < 30',
    tpPct: 1.5,
    slPct: 1.0,
    maxHoldBars: 6, // 90m
    entryCondition: ({ tech, cIdx, candle }) => tech.rsi14[cIdx] <= 30 && candle.close > candle.open
  },
  // 4. Trend Continuation Micro-Scalp: EMA9 > EMA21, dip to EMA9, 1.0% TP, 0.7% SL
  {
    name: 'Trend Micro-Scalp TP 1.0%, SL 0.7%, 9 EMA Touch',
    tpPct: 1.0,
    slPct: 0.7,
    maxHoldBars: 4,
    entryCondition: ({ tech, cIdx, candle }) => {
      const isTrend = tech.ema9[cIdx] > tech.ema21[cIdx];
      const isTouch = candle.low <= tech.ema9[cIdx] && candle.close >= tech.ema9[cIdx];
      return isTrend && isTouch && candle.close > candle.open;
    }
  },
  // 5. Volume Surge Micro-Scalp: RVOL > 2.5x, 1.2% TP, 0.8% SL
  {
    name: 'Volume Surge Micro-Scalp TP 1.2%, SL 0.8%, RVOL > 2.5x',
    tpPct: 1.2,
    slPct: 0.8,
    maxHoldBars: 4,
    entryCondition: ({ tech, cIdx, candle }) => {
      const rvol = tech.volSma20[cIdx] > 0 ? candle.volume / tech.volSma20[cIdx] : 1;
      return rvol >= 2.5 && candle.close > candle.open && tech.rsi14[cIdx] < 60;
    }
  }
];

const results = [];
for (const mt of microTests) {
  const res = runMicroScalp(mt);
  results.push(res);
  console.log(`\n[${res.name}]:`);
  console.log(`  Total Trades: ${res.trades} across ${res.activeDays} days (Avg ${res.avgDailyTrades} trades/day)`);
  console.log(`  Win Rate: ${res.winRate}% (Wins: ${res.wins}, Losses: ${res.losses})`);
  console.log(`  Net PnL: $${res.netProfit} (ROI: ${res.roiPct}%)`);
  console.log(`  Total Fees Paid to Binance: $${res.totalFeesPaid}`);
  console.log(`  Profit Factor: ${res.profitFactor}, Max Drawdown: ${res.maxDrawdownPct}%`);
}

fs.writeFileSync(path.resolve(__dirname, 'micro_scalp_feasibility.json'), JSON.stringify(results, null, 2));
console.log('\nResults saved to micro_scalp_feasibility.json.');
