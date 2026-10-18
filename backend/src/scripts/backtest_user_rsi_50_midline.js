import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cacheDir = path.resolve(__dirname, '../data/binance_cache');

console.log('Loading Binance 15m dataset for 2026 across all altcoins...');
const files = fs.readdirSync(cacheDir).filter(f => f.endsWith('.json'));

const datasets = {};
for (const file of files) {
  const sym = file.split('_')[0];
  if (sym === 'BTCUSDT' || sym === 'PAXGUSDT') continue;
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
      if (parsed.length > 2000) datasets[sym] = parsed;
    }
  } catch (_) {}
}

const symbols = Object.keys(datasets);
console.log(`Loaded ${symbols.length} altcoin datasets.`);

function calculateRSI14(closes) {
  const len = closes.length;
  const rsi = new Float64Array(len);
  let avgG = 0, avgL = 0;
  for (let i = 1; i <= 14 && i < len; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) avgG += d; else avgL += Math.abs(d);
  }
  avgG /= 14; avgL /= 14;
  rsi[14] = avgL === 0 ? 100 : 100 - (100 / (1 + avgG / avgL));
  for (let i = 15; i < len; i++) {
    const d = closes[i] - closes[i - 1];
    avgG = (avgG * 13 + (d > 0 ? d : 0)) / 14;
    avgL = (avgL * 13 + (d < 0 ? Math.abs(d) : 0)) / 14;
    rsi[i] = avgL === 0 ? 100 : 100 - (100 / (1 + avgG / avgL));
  }
  return rsi;
}

const feeRate = 0.0010; // 0.10% each way = 0.20% round trip
const slipRate = 0.0003;

// Test different SL values with dynamic RSI 50 Take Profit
const slOptions = [1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0];
const results = [];

for (const slPct of slOptions) {
  let totalTrades = 0;
  let totalWins = 0;
  let totalLosses = 0;
  let grossProfitSum = 0;
  let netProfitSum = 0;
  let allGainPercentages = [];
  let winGains = [];
  let lossGains = [];
  let holdMinutesSum = 0;

  for (const sym of symbols) {
    const candles = datasets[sym];
    const closes = candles.map(c => c.close);
    const rsi = calculateRSI14(closes);

    let inTrade = false;
    let entryPrice = 0;
    let entryIdx = 0;
    let stopLossPrice = 0;

    for (let i = 20; i < candles.length; i++) {
      const c = candles[i];
      const curRSI = rsi[i];
      const prevRSI = rsi[i - 1];

      if (!inTrade) {
        // Buy condition: Purple line came down below 35, now re-enters (>= 35)
        if (prevRSI < 35 && curRSI >= 35) {
          inTrade = true;
          entryPrice = c.close * (1 + slipRate);
          entryIdx = i;
          stopLossPrice = entryPrice * (1 - slPct / 100);
        }
      } else {
        // We are in trade
        // Check SL first on candle low
        if (c.low <= stopLossPrice) {
          const exitPrice = stopLossPrice * (1 - slipRate);
          const grossPct = ((exitPrice - entryPrice) / entryPrice) * 100;
          const netPct = grossPct - (feeRate * 2 * 100) - (slipRate * 100);

          totalTrades++;
          totalLosses++;
          lossGains.push(netPct);
          grossProfitSum += grossPct;
          netProfitSum += netPct;
          allGainPercentages.push(netPct);
          holdMinutesSum += (i - entryIdx) * 15;
          inTrade = false;
        }
        // Take profit when RSI reaches midline 50
        else if (curRSI >= 50) {
          const exitPrice = c.close * (1 - slipRate);
          const grossPct = ((exitPrice - entryPrice) / entryPrice) * 100;
          const netPct = grossPct - (feeRate * 2 * 100) - (slipRate * 100);

          totalTrades++;
          if (netPct > 0) {
            totalWins++;
            winGains.push(netPct);
          } else {
            totalLosses++;
            lossGains.push(netPct);
          }
          grossProfitSum += grossPct;
          netProfitSum += netPct;
          allGainPercentages.push(netPct);
          holdMinutesSum += (i - entryIdx) * 15;
          inTrade = false;
        }
        // Safety timeout if held too long (e.g. 48 bars = 12 hours)
        else if (i - entryIdx >= 48) {
          const exitPrice = c.close * (1 - slipRate);
          const grossPct = ((exitPrice - entryPrice) / entryPrice) * 100;
          const netPct = grossPct - (feeRate * 2 * 100) - (slipRate * 100);

          totalTrades++;
          if (netPct > 0) {
            totalWins++;
            winGains.push(netPct);
          } else {
            totalLosses++;
            lossGains.push(netPct);
          }
          grossProfitSum += grossPct;
          netProfitSum += netPct;
          allGainPercentages.push(netPct);
          holdMinutesSum += (i - entryIdx) * 15;
          inTrade = false;
        }
      }
    }
  }

  const winRate = (totalWins / totalTrades) * 100;
  const avgWin = winGains.length ? (winGains.reduce((a, b) => a + b, 0) / winGains.length) : 0;
  const avgLoss = lossGains.length ? (lossGains.reduce((a, b) => a + b, 0) / lossGains.length) : 0;
  const avgTrade = netProfitSum / totalTrades;
  const avgHoldMin = holdMinutesSum / totalTrades;

  results.push({
    slPct: slPct.toFixed(1) + '%',
    trades: totalTrades,
    wins: totalWins,
    losses: totalLosses,
    winRate: winRate.toFixed(1) + '%',
    avgWin: '+' + avgWin.toFixed(2) + '%',
    avgLoss: avgLoss.toFixed(2) + '%',
    avgTrade: (avgTrade >= 0 ? '+' : '') + avgTrade.toFixed(2) + '%',
    totalNetROI: (netProfitSum >= 0 ? '+' : '') + netProfitSum.toFixed(1) + '%',
    avgHoldMin: Math.round(avgHoldMin) + ' min'
  });
}

console.log('\n========================================================================');
console.log('  EXACT USER TRADINGVIEW RSI (14) RE-ENTRY (35) -> MIDLINE (50) EXIT');
console.log('  Testing across 94 Altcoins with 0.20% Round-trip Fee + Slippage');
console.log('========================================================================\n');
console.table(results);
