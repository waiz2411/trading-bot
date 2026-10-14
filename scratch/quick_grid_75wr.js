import fs from 'fs';
import path from 'path';

const DATA_CACHE_DIR = './scratch/binance_cache';
const files = fs.readdirSync(DATA_CACHE_DIR).filter(f => f.endsWith('_15m_60d.json'));
const allData = {};
const mapData = {};

for (const f of files) {
  const sym = f.split('_')[0];
  const candles = JSON.parse(fs.readFileSync(path.join(DATA_CACHE_DIR, f), 'utf8'));
  allData[sym] = candles;
  mapData[sym] = new Map();
  candles.forEach((c, i) => {
    mapData[sym].set(c.openTime, { candle: c, index: i });
  });
}

const btcCandles = allData['BTCUSDT'] || allData[Object.keys(allData)[0]];

function runSim(tp, sl, beTrigger, beLock, trailTrigger, trailDist, minRS, minRvol, minGain) {
  let wins = 0, losses = 0, totalDuration = 0, pnlSum = 0;
  let currentPos = null;

  for (let tIdx = 30; tIdx < btcCandles.length; tIdx++) {
    const t = btcCandles[tIdx].openTime;
    if (currentPos) {
      const entry = mapData[currentPos.symbol]?.get(t);
      if (!entry) continue;
      const candle = entry.candle;
      currentPos.barsHeld++;
      currentPos.highestPrice = Math.max(currentPos.highestPrice, candle.high);
      const peakGain = ((currentPos.highestPrice - currentPos.entryPrice) / currentPos.entryPrice) * 100;

      if (peakGain >= beTrigger) {
        const beP = currentPos.entryPrice * (1 + beLock / 100);
        if (beP > currentPos.stopLoss) currentPos.stopLoss = beP;
      }
      if (peakGain >= trailTrigger) {
        const trP = currentPos.highestPrice * (1 - trailDist / 100);
        if (trP > currentPos.stopLoss) currentPos.stopLoss = trP;
      }

      let exitPrice = null;
      if (candle.low <= currentPos.stopLoss) exitPrice = currentPos.stopLoss;
      else if (candle.high >= currentPos.takeProfit) exitPrice = currentPos.takeProfit;
      else if (currentPos.barsHeld >= 4) exitPrice = candle.close; // 1 hour max hold

      if (exitPrice !== null) {
        const rawPnl = ((exitPrice - currentPos.entryPrice) / currentPos.entryPrice) * 100;
        const netPnl = rawPnl - 0.15; // 0.15% fee roundtrip
        if (netPnl > 0) wins++; else losses++;
        pnlSum += netPnl;
        totalDuration += currentPos.barsHeld * 15;
        currentPos = null;
      }
    } else {
      let bestSym = null;
      let bestScore = -999;
      for (const sym of Object.keys(allData)) {
        if (sym === 'BTCUSDT') continue;
        const entry = mapData[sym]?.get(t);
        if (!entry) continue;
        const idx = entry.index;
        if (idx < 20) continue;
        const c = entry.candle;

        const avgVol = allData[sym].slice(idx - 20, idx).reduce((s, x) => s + x.volume, 0) / 20;
        const rvol = c.volume / avgVol;
        const gainPct = ((c.close - c.open) / c.open) * 100;
        const cPast = allData[sym][idx - 8]?.close;
        const bPast = btcCandles[tIdx - 8]?.close;
        const rs = cPast && bPast ? (((c.close - cPast) / cPast) * 100) - (((btcCandles[tIdx].close - bPast) / bPast) * 100) : 0;

        if (rvol >= minRvol && gainPct >= minGain && rs >= minRS && c.close > c.open) {
          const score = rvol * 2 + gainPct + rs;
          if (score > bestScore) {
            bestScore = score;
            bestSym = sym;
          }
        }
      }
      if (bestSym) {
        const entry = mapData[bestSym].get(t);
        const c = entry.candle;
        currentPos = {
          symbol: bestSym,
          entryPrice: c.close,
          stopLoss: c.close * (1 - sl / 100),
          takeProfit: c.close * (1 + tp / 100),
          highestPrice: c.close,
          barsHeld: 0
        };
      }
    }
  }
  const total = wins + losses;
  const wr = total ? (wins / total * 100).toFixed(1) : '0';
  const avgDur = total ? (totalDuration / total).toFixed(1) : '0';
  return { total, wins, losses, wr, avgDur, pnlSum: pnlSum.toFixed(1) };
}

console.log('Testing parameter grid for 70-80% Win Rate...');
const configs = [
  { name: 'Ultra-Fast Quick Scalp (TP +0.65%, SL -0.65%, BE at +0.35%)', tp: 0.65, sl: 0.65, beT: 0.35, beL: 0.18, trT: 0.55, trD: 0.15, rs: 0.5, rvol: 1.5, gain: 0.6 },
  { name: 'Micro-Scalp Quick TP (TP +0.55%, SL -0.70%, BE at +0.30%)', tp: 0.55, sl: 0.70, beT: 0.30, beL: 0.15, trT: 0.45, trD: 0.12, rs: 0.8, rvol: 1.5, gain: 0.6 },
  { name: 'Pure Momentum Snag (TP +0.50%, SL -0.80%, BE at +0.28%)', tp: 0.50, sl: 0.80, beT: 0.28, beL: 0.15, trT: 0.40, trD: 0.10, rs: 1.0, rvol: 1.6, gain: 0.7 },
  { name: '75% Target Model (TP +0.60%, SL -0.75%, BE at +0.32%)', tp: 0.60, sl: 0.75, beT: 0.32, beL: 0.18, trT: 0.50, trD: 0.15, rs: 1.2, rvol: 1.8, gain: 0.8 },
  { name: 'High-Volume Surge Snatch (TP +0.60%, SL -0.80%, BE at +0.30%)', tp: 0.60, sl: 0.80, beT: 0.30, beL: 0.16, trT: 0.48, trD: 0.12, rs: 1.5, rvol: 2.0, gain: 1.0 },
  { name: '80% Win-Rate Target (TP +0.50%, SL -0.90%, BE at +0.25%)', tp: 0.50, sl: 0.90, beT: 0.25, beL: 0.15, trT: 0.38, trD: 0.10, rs: 1.5, rvol: 2.0, gain: 1.0 }
];

for (const c of configs) {
  const res = runSim(c.tp, c.sl, c.beT, c.beL, c.trT, c.trD, c.rs, c.rvol, c.gain);
  console.log(c.name + ':');
  console.log('  Trades: ' + res.total + ' | Wins: ' + res.wins + ' | Losses: ' + res.losses + ' | Win Rate: ' + res.wr + '% | Avg Duration: ' + res.avgDur + ' min | Cumulative PnL: ' + res.pnlSum + '%');
}
