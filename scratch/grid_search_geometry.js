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

/**
 * Grid Search for Optimal Win-Rate & Positive Expectancy Geometry
 */
function testGeometry(tp, sl, beTrigger, beLock, trailTrigger, trailDist, minGain, rvol) {
  const btcCandles = allData['BTCUSDT'] || allData[Object.keys(allData)[0]];
  const sortedTimes = btcCandles.slice(50).map(c => c.openTime);

  let balance = 100;
  let peakBalance = 100;
  let maxDD = 0;
  let wins = 0;
  let losses = 0;
  let totalTrades = 0;
  let totalWon = 0;
  let totalLost = 0;

  let currentPos = null;

  for (const t of sortedTimes) {
    if (currentPos) {
      const candle = allData[currentPos.symbol]?.find(c => c.openTime === t);
      if (!candle) continue;

      currentPos.high = Math.max(currentPos.high, candle.high);
      const peakGain = ((currentPos.high - currentPos.entry) / currentPos.entry) * 100;

      if (peakGain >= beTrigger) {
        const beP = currentPos.entry * (1 + beLock / 100);
        if (beP > currentPos.sl) currentPos.sl = beP;
      }
      if (peakGain >= trailTrigger) {
        const trP = currentPos.high * (1 - trailDist / 100);
        if (trP > currentPos.sl) currentPos.sl = trP;
      }

      let exit = null;
      if (candle.high >= currentPos.tp) exit = currentPos.tp;
      else if (candle.low <= currentPos.sl) exit = currentPos.sl;
      else if (++currentPos.bars >= 12) exit = candle.close;

      if (exit !== null) {
        const pnlPct = ((exit - currentPos.entry) / currentPos.entry) * 100 - 0.15; // Net of 0.15% Binance roundtrip fee
        const dollarPnL = balance * (pnlPct / 100);
        balance += dollarPnL;
        if (balance > peakBalance) peakBalance = balance;
        const dd = ((peakBalance - balance) / peakBalance) * 100;
        if (dd > maxDD) maxDD = dd;

        totalTrades++;
        if (dollarPnL > 0) {
          wins++;
          totalWon += dollarPnL;
        } else {
          losses++;
          totalLost += Math.abs(dollarPnL);
        }
        currentPos = null;
      }
    } else {
      // Look for candidate
      const candidates = [];
      for (const [sym, candles] of Object.entries(allData)) {
        if (sym === 'BTCUSDT') continue;
        const idx = candles.findIndex(c => c.openTime === t);
        if (idx < 25) continue;
        const cur = candles[idx];
        if (cur.close <= cur.open) continue;
        const gain = ((cur.close - cur.open) / cur.open) * 100;
        if (gain < minGain) continue;

        const vols = candles.slice(idx - 20, idx).map(c => c.volume);
        const avg = vols.reduce((a, b) => a + b, 0) / vols.length;
        const rv = avg > 0 ? cur.volume / avg : 1;
        if (rv < rvol) continue;

        candidates.push({ sym, entry: cur.close, score: rv * gain });
      }

      if (candidates.length > 0) {
        candidates.sort((a, b) => b.score - a.score);
        const pick = candidates[0];
        currentPos = {
          symbol: pick.sym,
          entry: pick.entry,
          tp: pick.entry * (1 + tp / 100),
          sl: pick.entry * (1 - sl / 100),
          high: pick.entry,
          bars: 0
        };
      }
    }
  }

  const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
  const pf = totalLost > 0 ? totalWon / totalLost : (totalWon > 0 ? 999 : 0);
  const ret = balance - 100;

  return {
    tp, sl, beTrigger, beLock, trailTrigger, trailDist, minGain, rvol,
    trades: totalTrades, winRate: Number(winRate.toFixed(1)),
    profitFactor: Number(pf.toFixed(2)),
    returnPct: Number(ret.toFixed(1)),
    maxDD: Number(maxDD.toFixed(1))
  };
}

console.log('Testing parameter combinations...');
const testConfigs = [
  // tp, sl, beTrig, beLock, trailTrig, trailDist, minGain, rvol
  [1.0, 0.5, 0.7, 0.25, 0.9, 0.25, 1.0, 2.0],
  [1.2, 0.6, 0.8, 0.30, 1.0, 0.30, 1.0, 2.0],
  [1.5, 0.7, 1.0, 0.35, 1.2, 0.35, 1.2, 2.2],
  [2.0, 0.8, 1.2, 0.40, 1.5, 0.40, 1.2, 2.2],
  [2.5, 0.9, 1.4, 0.45, 1.8, 0.45, 1.4, 2.4],
  [1.2, 0.8, 0.9, 0.35, 1.1, 0.30, 0.8, 1.8],
  [1.8, 0.6, 1.0, 0.35, 1.4, 0.35, 1.0, 2.0],
  [2.0, 0.6, 1.1, 0.40, 1.5, 0.35, 1.1, 2.0]
];

for (const c of testConfigs) {
  const r = testGeometry(...c);
  console.log(`TP: ${r.tp}% | SL: ${r.sl}% | BE: +${r.beTrigger}% -> Trades: ${r.trades} | Win: ${r.winRate}% | Net: ${r.returnPct >= 0 ? '+' : ''}${r.returnPct}% | PF: ${r.profitFactor} | MaxDD: ${r.maxDD}%`);
}
