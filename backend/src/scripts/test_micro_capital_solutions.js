import fs from 'fs';
import path from 'path';

const cacheDir = './backend/src/data/binance_cache';

const top10Symbols = ['ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'AVAXUSDT', 'LINKUSDT', 'NEARUSDT', 'SUIUSDT', 'LTCUSDT'];
const rawDatasets = {};

for (const sym of top10Symbols) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(cacheDir, `${sym}_15m_60d.json`), 'utf8'));
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
    rawDatasets[sym] = parsed;
  } catch (_) {}
}

const rawBTC = JSON.parse(fs.readFileSync(path.join(cacheDir, 'BTCUSDT_15m_60d.json'), 'utf8'));
const btc15 = rawBTC.map(c => ({
  openTime: c.openTime || c[0],
  close: Number(c.close || c[4])
})).filter(c => c.openTime >= 1767225600000 && !isNaN(c.close));
btc15.sort((a, b) => a.openTime - b.openTime);

function calculateEMA(closes, p) {
  const ema = new Float64Array(closes.length);
  const k = 2 / (p + 1);
  let e = closes[0];
  for (let i = 0; i < closes.length; i++) {
    e = i === 0 ? closes[i] : closes[i] * k + e * (1 - k);
    ema[i] = e;
  }
  return ema;
}

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

const btcEMA200 = calculateEMA(btc15.map(c => c.close), 200);
const btcRSI = calculateRSI14(btc15);
const btcMap = new Map();
btc15.forEach((c, idx) => btcMap.set(c.openTime, idx));

const coinIndicators = {};
for (const sym of Object.keys(rawDatasets)) {
  coinIndicators[sym] = {
    rsi14: calculateRSI14(rawDatasets[sym])
  };
}

const feeRate = 0.0010;
const slipRate = 0.00015;

// Let's test $100 DCA simulation with compounding:
// Only 1 deal active at a time!
// Base = 25% of current balance ($25 when balance is $100)
// SO1 = 35% of current balance ($35 when balance is $100) at -2.5%
// SO2 = 40% of current balance ($40 when balance is $100) at -5.0%
// TP = +1.2% from average price
// Stop Loss = -10.0% from average price
function simulate100DollarDCACompounding(soSteps = 2, soDev = 2.5, tpPct = 1.2, emergencySL = 10.0) {
  let balance = 100.0;
  const allSignals = [];

  for (const sym of Object.keys(rawDatasets)) {
    const candles = rawDatasets[sym];
    const rsi = coinIndicators[sym].rsi14;
    for (let i = 50; i < candles.length; i++) {
      const c = candles[i];
      const btcIdx = btcMap.get(c.openTime);
      if (btcIdx !== undefined && (btcRSI[btcIdx] < 35 || btc15[btcIdx].close < btcEMA200[btcIdx])) continue;
      if (rsi[i - 1] < 32 && rsi[i] >= 30 && c.close >= c.open) {
        allSignals.push({ symbol: sym, candleIdx: i, openTime: c.openTime, time: c.time, price: c.close * (1 + slipRate) });
      }
    }
  }

  allSignals.sort((a, b) => a.openTime - b.openTime);

  let nextFreeTime = 0;
  const trades = [];

  for (const sig of allSignals) {
    if (sig.openTime < nextFreeTime) continue;

    const sym = sig.symbol;
    const candles = rawDatasets[sym];
    const startIdx = sig.candleIdx;

    // Allocate current balance for this deal
    const dealCapital = balance;
    let baseUSD, so1USD, so2USD;
    if (soSteps === 2) {
      baseUSD = dealCapital * 0.25;
      so1USD = dealCapital * 0.35;
      so2USD = dealCapital * 0.40;
    } else if (soSteps === 1) {
      baseUSD = dealCapital * 0.40;
      so1USD = dealCapital * 0.60;
      so2USD = 0;
    }

    let totalInvestedUSD = baseUSD;
    let totalCoins = baseUSD / sig.price;
    let avgPrice = sig.price;
    let soFilled = 0;

    let so1TriggerPrice = sig.price * (1 - soDev / 100);
    let so2TriggerPrice = sig.price * (1 - (soDev * 2) / 100);

    let exitPrice = null;
    let exitTime = '';
    let exitReason = '';
    let exitOpenTime = 0;

    for (let j = startIdx + 1; j < candles.length && j <= startIdx + 480; j++) {
      const bar = candles[j];

      // Check SO1 fill
      if (soFilled === 0 && bar.low <= so1TriggerPrice) {
        const fillPrice = so1TriggerPrice;
        const boughtCoins = so1USD / fillPrice;
        totalInvestedUSD += so1USD;
        totalCoins += boughtCoins;
        avgPrice = totalInvestedUSD / totalCoins;
        soFilled = 1;
      }

      // Check SO2 fill
      if (soSteps === 2 && soFilled === 1 && bar.low <= so2TriggerPrice) {
        const fillPrice = so2TriggerPrice;
        const boughtCoins = so2USD / fillPrice;
        totalInvestedUSD += so2USD;
        totalCoins += boughtCoins;
        avgPrice = totalInvestedUSD / totalCoins;
        soFilled = 2;
      }

      const tpTarget = avgPrice * (1 + tpPct / 100);
      const slTarget = avgPrice * (1 - emergencySL / 100);

      if (bar.high >= tpTarget) {
        exitPrice = tpTarget * (1 - slipRate);
        exitTime = bar.time;
        exitOpenTime = bar.openTime;
        exitReason = 'Take Profit Hit';
        break;
      }

      if (bar.low <= slTarget) {
        exitPrice = slTarget * (1 - slipRate);
        exitTime = bar.time;
        exitOpenTime = bar.openTime;
        exitReason = 'Stop Loss Hit';
        break;
      }
    }

    if (!exitPrice) {
      const lastBar = candles[Math.min(candles.length - 1, startIdx + 480)];
      exitPrice = lastBar.close * (1 - slipRate);
      exitTime = lastBar.time;
      exitOpenTime = lastBar.openTime;
      exitReason = 'Timeout Exit';
    }

    // Gross proceeds
    const grossProceedsUSD = totalCoins * exitPrice;
    const buyFees = totalInvestedUSD * feeRate;
    const sellFees = grossProceedsUSD * feeRate;
    const totalFees = buyFees + sellFees;
    const netPnLUSD = grossProceedsUSD - totalInvestedUSD - totalFees;

    balance = balance + netPnLUSD;
    nextFreeTime = exitOpenTime;

    trades.push({
      symbol: sym,
      entryTime: sig.time,
      exitTime,
      soFilled,
      invested: totalInvestedUSD,
      netPnL: netPnLUSD,
      balance,
      outcome: netPnLUSD > 0 ? 'WIN' : 'LOSS',
      exitReason
    });
  }

  const wins = trades.filter(t => t.outcome === 'WIN').length;
  const losses = trades.filter(t => t.outcome === 'LOSS').length;
  return {
    soSteps,
    soDev,
    tpPct,
    totalTrades: trades.length,
    wins,
    losses,
    winRate: ((wins / trades.length) * 100).toFixed(1) + '%',
    startBalance: '$100.00',
    endBalance: '$' + balance.toFixed(2),
    netProfitUSD: (balance - 100).toFixed(2),
    netReturnPct: (((balance - 100) / 100) * 100).toFixed(2) + '%'
  };
}

console.log('--- $100 MICRO-CAPITAL DCA COMPOUNDING TESTS ---');
console.log('Test 1 (2 SOs, 2.5% dev, 1.2% TP):', simulate100DollarDCACompounding(2, 2.5, 1.2, 10.0));
console.log('Test 2 (2 SOs, 2.0% dev, 1.0% TP):', simulate100DollarDCACompounding(2, 2.0, 1.0, 10.0));
console.log('Test 3 (1 SO only, 3.0% dev, 1.2% TP):', simulate100DollarDCACompounding(1, 3.0, 1.2, 10.0));
console.log('Test 4 (2 SOs, 3.0% dev, 1.5% TP):', simulate100DollarDCACompounding(2, 3.0, 1.5, 10.0));
console.log('Test 5 (2 SOs, 2.0% dev, 0.8% TP):', simulate100DollarDCACompounding(2, 2.0, 0.8, 8.0));
