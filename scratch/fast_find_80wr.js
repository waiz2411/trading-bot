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

// Pre-screen all pump signals once!
console.log('Pre-screening all pump momentum candles across 60 days...');
const signalsAtTime = [];

for (let tIdx = 30; tIdx < btcCandles.length; tIdx++) {
  const t = btcCandles[tIdx].openTime;
  const candidates = [];

  for (const sym of Object.keys(allData)) {
    if (sym === 'BTCUSDT') continue;
    const entry = mapData[sym]?.get(t);
    if (!entry) continue;
    const idx = entry.index;
    if (idx < 20) continue;
    const c = entry.candle;

    const avgVol = allData[sym].slice(idx - 20, idx).reduce((s, x) => s + x.volume, 0) / 20;
    const rvol = avgVol > 0 ? c.volume / avgVol : 1;
    const gainPct = ((c.close - c.open) / c.open) * 100;
    const cPast = allData[sym][idx - 8]?.close;
    const bPast = btcCandles[tIdx - 8]?.close;
    const rs = cPast && bPast ? (((c.close - cPast) / cPast) * 100) - (((btcCandles[tIdx].close - bPast) / bPast) * 100) : 0;

    if (rvol >= 1.5 && gainPct >= 0.7 && c.close > c.open) {
      candidates.push({
        sym,
        c,
        rvol,
        gainPct,
        rs,
        score: rvol * 2 + gainPct + (rs > 0 ? rs : 0)
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  signalsAtTime.push({ tIdx, t, bestCandidate: candidates[0] || null });
}

console.log(`Pre-screening complete. Total bars indexed: ${signalsAtTime.length}.`);

function testParams(tp, sl, beTrigger, beLock, trailTrigger, trailDist, minRS, minRvol) {
  let wins = 0, losses = 0, pnlSum = 0;
  let currentPos = null;
  let closed = [];

  for (const step of signalsAtTime) {
    const { t, bestCandidate } = step;

    if (currentPos) {
      const entry = mapData[currentPos.sym]?.get(t);
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
      } else if (currentPos.barsHeld >= 4) { // 60 mins max hold
        exitPrice = candle.close;
      }

      if (exitPrice !== null) {
        const grossPnl = ((exitPrice - currentPos.entryPrice) / currentPos.entryPrice) * 100;
        const netPnl = grossPnl - 0.20; // 0.15% fee + 0.05% slippage
        if (netPnl > 0) wins++; else losses++;
        pnlSum += netPnl;
        closed.push(netPnl);
        currentPos = null;
      }
    } else {
      if (bestCandidate && bestCandidate.rvol >= minRvol && bestCandidate.rs >= minRS) {
        currentPos = {
          sym: bestCandidate.sym,
          entryPrice: bestCandidate.c.close,
          stopLoss: bestCandidate.c.close * (1 - sl / 100),
          takeProfit: bestCandidate.c.close * (1 + tp / 100),
          highestPrice: bestCandidate.c.close,
          barsHeld: 0
        };
      }
    }
  }

  const total = wins + losses;
  const wr = total ? parseFloat((wins / total * 100).toFixed(1)) : 0;
  const avgWin = wins ? (closed.filter(x => x > 0).reduce((a, b) => a + b, 0) / wins).toFixed(2) : 0;
  const avgLoss = losses ? (closed.filter(x => x <= 0).reduce((a, b) => a + b, 0) / losses).toFixed(2) : 0;
  return { total, wins, losses, wr, avgWin: '+' + avgWin + '%', avgLoss: avgLoss + '%', pnlSum: parseFloat(pnlSum.toFixed(1)) };
}

console.log('\nRunning Grid Across Parameters...');
const results = [];

for (const tp of [0.45, 0.50, 0.55, 0.60, 0.65, 0.70]) {
  for (const sl of [0.65, 0.80, 0.90, 1.00]) {
    for (const beTrig of [0.25, 0.28, 0.30]) {
      for (const beLock of [0.22, 0.24]) {
        for (const minRvol of [1.6, 2.0]) {
          for (const minRS of [0.8, 1.2, 1.5]) {
            const r = testParams(tp, sl, beTrig, beLock, tp * 0.85, 0.10, minRS, minRvol);
            if (r.wr >= 75 && r.total >= 80 && r.pnlSum > 30) {
              results.push({ tp, sl, beTrig, beLock, minRvol, minRS, ...r });
            }
          }
        }
      }
    }
  }
}

results.sort((a, b) => b.wr - a.wr);
console.log(`\nFound ${results.length} configurations meeting Win Rate >= 75% with positive PnL:`);
console.table(results.slice(0, 12));
fs.writeFileSync('./scratch/fast_80wr_results.json', JSON.stringify(results.slice(0, 20), null, 2));
