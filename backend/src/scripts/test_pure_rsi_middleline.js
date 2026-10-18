import fs from 'fs';
import path from 'path';

const cacheDir = './backend/src/data/binance_cache';

// Load all 15m cached files
const files = fs.readdirSync(cacheDir).filter(f => f.endsWith('_15m_60d.json') && !f.startsWith('BTCUSDT'));

console.log(`Found ${files.length} altcoin data files.`);

const rawDatasets = {};
for (const file of files) {
  const sym = file.replace('_15m_60d.json', '');
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(cacheDir, file), 'utf8'));
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
    if (parsed.length > 500) rawDatasets[sym] = parsed;
  } catch (_) {}
}

const loadedSymbols = Object.keys(rawDatasets);
console.log(`Loaded ${loadedSymbols.length} valid altcoin pairs.`);

function calculateRSI14(candles) {
  const len = candles.length;
  const closes = candles.map(c => c.close);
  const rsi14 = new Float64Array(len);
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
  return rsi14;
}

const coinRSI = {};
for (const sym of loadedSymbols) {
  coinRSI[sym] = calculateRSI14(rawDatasets[sym]);
}

// 1. Gather ALL raw signals without any BTC or restrictive filters:
// Buy: RSI was < 30 and crosses >= 30 (re-enters purple zone)
let totalRawSignals = 0;
const allSignals = [];
for (const sym of loadedSymbols) {
  const candles = rawDatasets[sym];
  const rsi = coinRSI[sym];
  for (let i = 50; i < candles.length; i++) {
    if (rsi[i - 1] < 30 && rsi[i] >= 30) {
      totalRawSignals++;
      allSignals.push({
        symbol: sym,
        candleIdx: i,
        openTime: candles[i].openTime,
        time: candles[i].time,
        entryPrice: candles[i].close
      });
    }
  }
}

console.log(`Total raw RSI purple-zone re-entry signals across all pairs: ${totalRawSignals}`);

// Let's test the PURE RSI strategy per deal:
// Buy when RSI crosses >= 30
// TP when RSI touches middle line (RSI >= 50)
// What is the price outcome of each trade?
const feeRate = 0.0010;
const slipRate = 0.00015;

function auditPureRSIExit(soDev = 3.5, maxBars = 192) {
  let wins = 0;
  let losses = 0;
  let totalNetReturnPct = 0;
  const tradeOutcomes = [];

  for (const sig of allSignals) {
    const candles = rawDatasets[sig.symbol];
    const rsi = coinRSI[sig.symbol];
    const start = sig.candleIdx;
    const entryPrice = sig.entryPrice * (1 + slipRate);

    let exitPrice = null;
    let exitReason = '';
    let soFilled = false;
    let avgPrice = entryPrice;
    let soPrice = entryPrice * (1 - soDev / 100);

    for (let j = start + 1; j < candles.length && j <= start + maxBars; j++) {
      const bar = candles[j];
      const rsiVal = rsi[j];

      // Check SO fill at -soDev%
      if (!soFilled && bar.low <= soPrice) {
        // Assume Base = 30%, SO = 70%
        // avgPrice = (0.3 * entryPrice + 0.7 * soPrice)
        avgPrice = (0.3 * entryPrice) + (0.7 * soPrice);
        soFilled = true;
      }

      // TP condition: RSI touches middle line (RSI >= 50)
      if (rsiVal >= 50) {
        exitPrice = bar.close * (1 - slipRate);
        exitReason = 'RSI 50 Middle Line';
        break;
      }
    }

    if (!exitPrice) {
      const lastBar = candles[Math.min(candles.length - 1, start + maxBars)];
      exitPrice = lastBar.close * (1 - slipRate);
      exitReason = 'Timeout Exit';
    }

    const grossPct = ((exitPrice - avgPrice) / avgPrice) * 100;
    const netPct = grossPct - 0.23; // fees

    if (netPct > 0) wins++; else losses++;
    totalNetReturnPct += netPct;
    tradeOutcomes.push({ netPct, exitReason, soFilled });
  }

  console.log(`Pure RSI Signals: ${allSignals.length} | Wins: ${wins} | Losses: ${losses} | Win Rate: ${((wins / allSignals.length) * 100).toFixed(1)}% | Avg Net Return: ${(totalNetReturnPct / allSignals.length).toFixed(3)}%`);
}

auditPureRSIExit(3.5);
