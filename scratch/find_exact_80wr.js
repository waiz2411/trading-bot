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

function runGrid(tp, sl, beTrigger, beLock, trailTrigger, trailDist, minRS, minRvol, minGain) {
  let wins = 0, losses = 0, pnlSum = 0;
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
      if (candle.low <= currentPos.stopLoss) {
        exitPrice = currentPos.stopLoss;
      } else if (candle.high >= currentPos.takeProfit) {
        exitPrice = currentPos.takeProfit;
      } else if (currentPos.barsHeld >= 4) {
        exitPrice = candle.close;
      }

      if (exitPrice !== null) {
        const netPnl = ((exitPrice - currentPos.entryPrice) / currentPos.entryPrice) * 100 - 0.20;
        if (netPnl > 0) wins++; else losses++;
        pnlSum += netPnl;
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
  const wr = total ? parseFloat((wins / total * 100).toFixed(1)) : 0;
  return { total, wins, losses, wr, pnlSum: parseFloat(pnlSum.toFixed(1)) };
}

const hits = [];
for (const tp of [0.45, 0.50, 0.55, 0.60]) {
  for (const sl of [0.70, 0.85, 1.00]) {
    for (const beTrig of [0.25, 0.28, 0.30]) {
      for (const beLock of [0.22, 0.23, 0.24, 0.25]) {
        for (const minRvol of [1.6, 2.0, 2.4]) {
          for (const minRS of [1.0, 1.5, 2.0]) {
            const r = runGrid(tp, sl, beTrig, beLock, tp * 0.85, 0.10, minRS, minRvol, 0.8);
            if (r.wr >= 75 && r.total >= 100 && r.pnlSum > 50) {
              hits.push({ tp, sl, beTrig, beLock, minRvol, minRS, ...r });
            }
          }
        }
      }
    }
  }
}

hits.sort((a, b) => b.wr - a.wr);
console.log(`Found ${hits.length} configurations with Win Rate >= 75% and positive net return:`);
console.table(hits.slice(0, 10));
