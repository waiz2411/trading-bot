import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_CACHE_DIR = path.join(__dirname, 'binance_cache');

function loadAllCachedData() {
  const files = fs.readdirSync(DATA_CACHE_DIR).filter(f => f.endsWith('_15m_60d.json'));
  const allData = {};
  for (const f of files) {
    const sym = f.split('_')[0];
    const data = JSON.parse(fs.readFileSync(path.join(DATA_CACHE_DIR, f), 'utf8'));
    allData[sym] = data;
  }
  return allData;
}

const allData = loadAllCachedData();
const btcCandles = allData['BTCUSDT'] || allData[Object.keys(allData)[0]];

function calcEMA(values, period) {
  const k = 2 / (period + 1);
  const ema = new Array(values.length);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  ema[period - 1] = sum / period;
  for (let i = period; i < values.length; i++) {
    ema[i] = values[i] * k + ema[i - 1] * (1 - k);
  }
  return ema;
}

const btcCloses = btcCandles.map(c => c.close);
const btcEma20 = calcEMA(btcCloses, 20);

// Relative strength vs BTC
function calcRS(coinCandles, btcCandles, idx) {
  if (idx < 16) return 0;
  const cCur = coinCandles[idx].close;
  const cPast = coinCandles[idx - 8].close; // 2h return
  const bCur = btcCandles[idx].close;
  const bPast = btcCandles[idx - 8].close;

  const cRet = ((cCur - cPast) / cPast) * 100;
  const bRet = ((bCur - bPast) / bPast) * 100;
  return cRet - bRet;
}

function testHighProbabilityConfluence(options) {
  const {
    tp = 0.90,          // +0.90% Take Profit
    sl = 0.60,          // -0.60% Stop Loss
    beTrigger = 0.50,   // Ratchet at +0.50%
    beLock = 0.20,      // Lock +0.20% (clears 0.15% fees)
    trailTrigger = 0.75,// Trail at +0.75%
    trailDist = 0.20,   // Trail by 0.20%
    minRS = 1.0,        // Must outperform BTC by at least +1.0% in last 2h
    minRvol = 1.6,
    maxHoldBars = 6     // 90 mins max hold
  } = options;

  let balance = 100;
  let peakBalance = 100;
  let maxDD = 0;
  const closedTrades = [];
  let currentPos = null;

  for (let tIdx = 30; tIdx < btcCandles.length; tIdx++) {
    const t = btcCandles[tIdx].openTime;
    const isBtcHealthy = btcCandles[tIdx].close >= btcEma20[tIdx];

    if (currentPos) {
      const candle = allData[currentPos.symbol]?.find(c => c.openTime === t);
      if (!candle) continue;

      currentPos.barsHeld++;
      currentPos.highestPrice = Math.max(currentPos.highestPrice, candle.high);

      const peakGainPct = ((currentPos.highestPrice - currentPos.entryPrice) / currentPos.entryPrice) * 100;

      if (peakGainPct >= beTrigger) {
        const beP = currentPos.entryPrice * (1 + beLock / 100);
        if (beP > currentPos.stopLoss) {
          currentPos.stopLoss = beP;
          currentPos.isBE = true;
        }
      }
      if (peakGainPct >= trailTrigger) {
        const trP = currentPos.highestPrice * (1 - trailDist / 100);
        if (trP > currentPos.stopLoss) {
          currentPos.stopLoss = trP;
          currentPos.isTrail = true;
        }
      }

      let exitPrice = null;
      let exitReason = null;

      if (candle.high >= currentPos.takeProfit) {
        exitPrice = currentPos.takeProfit;
        exitReason = 'TAKE_PROFIT';
      } else if (candle.low <= currentPos.stopLoss) {
        exitPrice = currentPos.stopLoss;
        exitReason = currentPos.isTrail ? 'TRAILING_STOP' : (currentPos.isBE ? 'BREAKEVEN' : 'STOP_LOSS');
      } else if (currentPos.barsHeld >= maxHoldBars) {
        exitPrice = candle.close;
        exitReason = 'TIME_CAP';
      }

      if (exitPrice !== null) {
        const grossPct = ((exitPrice - currentPos.entryPrice) / currentPos.entryPrice) * 100;
        const netPct = grossPct - 0.15; // 0.15% roundtrip Binance fees
        const dollarPnL = balance * (netPct / 100);

        balance += dollarPnL;
        if (balance > peakBalance) peakBalance = balance;
        const dd = ((peakBalance - balance) / peakBalance) * 100;
        if (dd > maxDD) maxDD = dd;

        closedTrades.push({
          symbol: currentPos.symbol,
          entryPrice: currentPos.entryPrice,
          exitPrice,
          netPct,
          dollarPnL,
          exitReason,
          durationMinutes: currentPos.barsHeld * 15
        });

        currentPos = null;
      }
    } else {
      if (!isBtcHealthy) continue; // BTC Health Gate

      const candidates = [];
      for (const [sym, candles] of Object.entries(allData)) {
        if (sym === 'BTCUSDT') continue;
        const idx = candles.findIndex(c => c.openTime === t);
        if (idx < 25) continue;
        const cur = candles[idx];
        const prev = candles[idx - 1];

        // Green candle
        if (cur.close <= cur.open) continue;

        // Relative strength vs BTC
        const rs = calcRS(candles, btcCandles, idx);
        if (rs < minRS) continue;

        // Volume explosion
        const vols = candles.slice(idx - 20, idx).map(c => c.volume);
        const avgVol = vols.reduce((a, b) => a + b, 0) / vols.length;
        const rvol = avgVol > 0 ? cur.volume / avgVol : 1;
        if (rvol < minRvol) continue;

        candidates.push({
          symbol: sym,
          entryPrice: cur.close,
          score: rs * rvol
        });
      }

      if (candidates.length > 0) {
        candidates.sort((a, b) => b.score - a.score);
        const best = candidates[0];

        currentPos = {
          symbol: best.symbol,
          entryPrice: best.entryPrice,
          takeProfit: best.entryPrice * (1 + tp / 100),
          stopLoss: best.entryPrice * (1 - sl / 100),
          highestPrice: best.entryPrice,
          barsHeld: 0,
          isBE: false,
          isTrail: false
        };
      }
    }
  }

  const totalTrades = closedTrades.length;
  const wins = closedTrades.filter(t => t.netPct > 0);
  const losses = closedTrades.filter(t => t.netPct <= 0);
  const winRate = totalTrades > 0 ? (wins.length / totalTrades) * 100 : 0;

  const totalWon = wins.reduce((acc, t) => acc + t.dollarPnL, 0);
  const totalLost = Math.abs(losses.reduce((acc, t) => acc + t.dollarPnL, 0));
  const pf = totalLost > 0 ? totalWon / totalLost : (totalWon > 0 ? 999 : 0);
  const netRet = balance - 100;

  const avgDur = totalTrades > 0
    ? closedTrades.reduce((acc, t) => acc + t.durationMinutes, 0) / totalTrades
    : 0;

  return {
    tp, sl, beTrigger, beLock,
    trades: totalTrades,
    wins: wins.length,
    losses: losses.length,
    winRate: Number(winRate.toFixed(1)),
    profitFactor: Number(pf.toFixed(2)),
    netReturnPct: Number(netRet.toFixed(1)),
    maxDrawdownPct: Number(maxDD.toFixed(1)),
    avgDurationMinutes: Number(avgDur.toFixed(1)),
    tpCount: closedTrades.filter(t => t.exitReason === 'TAKE_PROFIT').length,
    trailCount: closedTrades.filter(t => t.exitReason === 'TRAILING_STOP').length,
    beCount: closedTrades.filter(t => t.exitReason === 'BREAKEVEN').length,
    slCount: closedTrades.filter(t => t.exitReason === 'STOP_LOSS').length,
    timeCapCount: closedTrades.filter(t => t.exitReason === 'TIME_CAP').length
  };
}

console.log('Testing Confluence RS + Pump Models across 60 days...');
const models = [
  { name: 'Ultra-High Win Rate (TP +0.75%, SL -0.50%)', tp: 0.75, sl: 0.50, beTrigger: 0.45, beLock: 0.18, trailTrigger: 0.65, trailDist: 0.18, minRS: 1.0, minRvol: 1.5 },
  { name: 'High-Probability Scalper (TP +0.85%, SL -0.55%)', tp: 0.85, sl: 0.55, beTrigger: 0.50, beLock: 0.20, trailTrigger: 0.70, trailDist: 0.20, minRS: 1.2, minRvol: 1.6 },
  { name: 'Balanced Momentum Scalper (TP +0.95%, SL -0.55%)', tp: 0.95, sl: 0.55, beTrigger: 0.55, beLock: 0.22, trailTrigger: 0.80, trailDist: 0.20, minRS: 1.5, minRvol: 1.8 }
];

for (const m of models) {
  const r = testHighProbabilityConfluence(m);
  console.log(`\n======================================================`);
  console.log(`🎯 ${m.name}`);
  console.log(`======================================================`);
  console.log(`Total Trades: ${r.trades} (in 60 days)`);
  console.log(`Wins: ${r.wins} | Losses: ${r.losses} | WIN RATE: ${r.winRate}%`);
  console.log(`Net Return: +${r.netReturnPct}% | Profit Factor: ${r.profitFactor} | Max Drawdown: ${r.maxDrawdownPct}%`);
  console.log(`Average Holding Duration: ${r.avgDurationMinutes} mins (~${(r.avgDurationMinutes/60).toFixed(1)} hrs)`);
  console.log(`Exit Breakdown -> TP: ${r.tpCount} | Trailing: ${r.trailCount} | BE: ${r.beCount} | SL: ${r.slCount} | Time: ${r.timeCapCount}`);
}
