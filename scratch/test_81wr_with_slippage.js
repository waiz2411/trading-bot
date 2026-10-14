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

function runExactSim(tp, sl, beTrigger, beLock, trailTrigger, trailDist, minRS, minRvol, minGain, feePct, slipPct) {
  let wins = 0, losses = 0, totalDuration = 0, pnlSum = 0;
  let currentPos = null;
  const closed = [];

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
      let exitReason = null;
      if (candle.low <= currentPos.stopLoss) {
        exitPrice = currentPos.stopLoss;
        exitReason = 'SL_OR_BE';
      } else if (candle.high >= currentPos.takeProfit) {
        exitPrice = currentPos.takeProfit;
        exitReason = 'TAKE_PROFIT';
      } else if (currentPos.barsHeld >= 4) {
        exitPrice = candle.close;
        exitReason = 'TIME_CAP';
      }

      if (exitPrice !== null) {
        const rawPnl = ((exitPrice - currentPos.entryPrice) / currentPos.entryPrice) * 100;
        const totalFriction = feePct + slipPct; // Fee + slippage
        const netPnl = rawPnl - totalFriction;
        if (netPnl > 0) wins++; else losses++;
        pnlSum += netPnl;
        totalDuration += currentPos.barsHeld * 15;
        closed.push({ netPnl, exitReason, duration: currentPos.barsHeld * 15 });
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
  const avgWin = wins ? (closed.filter(t => t.netPnl > 0).reduce((s, t) => s + t.netPnl, 0) / wins).toFixed(2) : '0';
  const avgLoss = losses ? (closed.filter(t => t.netPnl <= 0).reduce((s, t) => s + t.netPnl, 0) / losses).toFixed(2) : '0';
  return { total, wins, losses, wr, avgWin: '+' + avgWin + '%', avgLoss: avgLoss + '%', avgDur: avgDur + 'm', pnlSum: pnlSum.toFixed(1) + '%' };
}

console.log('Testing with 0.15% Binance Fee + 0.05% Slippage (0.20% Total Friction):');
const res80 = runExactSim(0.55, 0.85, 0.28, 0.18, 0.42, 0.10, 1.5, 2.0, 0.9, 0.15, 0.05);
console.log('80% Win Rate Setup:', res80);

const res75 = runExactSim(0.65, 0.75, 0.32, 0.20, 0.50, 0.12, 1.2, 1.8, 0.8, 0.15, 0.05);
console.log('75% Win Rate Setup (Higher Profit):', res75);
