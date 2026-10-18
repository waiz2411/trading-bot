import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';

const cacheDir = './backend/src/data/binance_cache';
const outDir = 'C:/Users/waizt/.gemini/antigravity/brain/9240cc1b-f576-4996-a196-552f1f9e4603';
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

function generate50DollarExcelReport() {
  const initialBalance = 50.0;
  let curBalance = initialBalance;

  const allSignals = [];
  for (const sym of Object.keys(rawDatasets)) {
    const candles = rawDatasets[sym];
    const rsi = coinIndicators[sym].rsi14;

    for (let i = 50; i < candles.length; i++) {
      const c = candles[i];
      const btcIdx = btcMap.get(c.openTime);
      if (btcIdx !== undefined && (btcRSI[btcIdx] < 38 || btc15[btcIdx].close < btcEMA200[btcIdx])) continue;

      if (rsi[i - 1] < 30 && rsi[i] >= 30 && c.close >= c.open) {
        allSignals.push({
          symbol: sym,
          candleIdx: i,
          openTime: c.openTime,
          time: c.time,
          entryPrice: c.close * (1 + slipRate)
        });
      }
    }
  }

  allSignals.sort((a, b) => a.openTime - b.openTime);

  const completedTrades = [];
  let nextFreeTime = 0;

  for (const sig of allSignals) {
    if (sig.openTime < nextFreeTime) continue;

    const sym = sig.symbol;
    const candles = rawDatasets[sym];
    const startIdx = sig.candleIdx;

    // Sizing: 30% Base, 70% SO1
    const baseUSD = curBalance * 0.30;
    const so1USD = curBalance * 0.70;

    let totalInvestedUSD = baseUSD;
    let totalCoins = baseUSD / sig.entryPrice;
    let avgPrice = sig.entryPrice;
    let soFilled = 0;

    const so1Price = sig.entryPrice * (1 - 3.5 / 100);

    let exitPrice = null;
    let exitTime = '';
    let exitReason = '';
    let exitOpenTime = 0;

    for (let j = startIdx + 1; j < candles.length && j <= startIdx + 300; j++) {
      const bar = candles[j];
      const rsiVal = coinIndicators[sym].rsi14[j];

      // Fill SO1
      if (soFilled === 0 && bar.low <= so1Price) {
        const fillP = so1Price;
        totalInvestedUSD += so1USD;
        totalCoins += so1USD / fillP;
        avgPrice = totalInvestedUSD / totalCoins;
        soFilled = 1;
      }

      const tpTarget = avgPrice * (1 + 1.5 / 100);
      const curGainPct = ((bar.close - avgPrice) / avgPrice) * 100;

      if (bar.high >= tpTarget) {
        exitPrice = tpTarget * (1 - slipRate);
        exitTime = bar.time;
        exitOpenTime = bar.openTime;
        exitReason = 'Take Profit Target Hit (+1.5%)';
        break;
      } else if (rsiVal >= 50 && curGainPct >= 1.0) {
        exitPrice = bar.close * (1 - slipRate);
        exitTime = bar.time;
        exitOpenTime = bar.openTime;
        exitReason = `Middle Line (RSI 50) Reached (+${curGainPct.toFixed(2)}%)`;
        break;
      } else if (bar.low <= avgPrice * (1 - 10.0 / 100)) {
        exitPrice = avgPrice * (1 - 10.0 / 100) * (1 - slipRate);
        exitTime = bar.time;
        exitOpenTime = bar.openTime;
        exitReason = 'Emergency Stop Loss Hit (-10.0%)';
        break;
      }
    }

    if (!exitPrice) {
      const lastBar = candles[Math.min(candles.length - 1, startIdx + 300)];
      exitPrice = lastBar.close * (1 - slipRate);
      exitTime = lastBar.time;
      exitOpenTime = lastBar.openTime;
      exitReason = 'Time Horizon Exit (3.1 Days)';
    }

    const grossProceedsUSD = totalCoins * exitPrice;
    const buyFees = totalInvestedUSD * feeRate;
    const sellFees = grossProceedsUSD * feeRate;
    const totalFees = buyFees + sellFees;
    const netPnLUSD = grossProceedsUSD - totalInvestedUSD - totalFees;
    const netReturnPct = (netPnLUSD / totalInvestedUSD) * 100;

    const startBalanceBeforeTrade = curBalance;
    curBalance += netPnLUSD;
    nextFreeTime = exitOpenTime;

    const durationHours = ((exitOpenTime - sig.openTime) / (3600 * 1000)).toFixed(1);

    completedTrades.push({
      'Trade #': completedTrades.length + 1,
      'Symbol': sym,
      'Entry Time (UTC)': sig.time,
      'Exit Time (UTC)': exitTime,
      'Duration (Hours)': Number(durationHours),
      'Safety Orders Filled': soFilled,
      'Initial Base ($)': Number(baseUSD.toFixed(2)),
      'Total Invested ($)': Number(totalInvestedUSD.toFixed(2)),
      'Avg Entry Price ($)': Number(avgPrice.toFixed(4)),
      'Exit Price ($)': Number(exitPrice.toFixed(4)),
      'Binance Fees ($)': Number(totalFees.toFixed(3)),
      'Net Profit/Loss ($)': Number(netPnLUSD.toFixed(2)),
      'Net Return (%)': Number(netReturnPct.toFixed(2)),
      'Starting Capital ($)': Number(startBalanceBeforeTrade.toFixed(2)),
      'Compounded Balance ($)': Number(curBalance.toFixed(2)),
      'Cumulative Gain (%)': Number((((curBalance - initialBalance) / initialBalance) * 100).toFixed(2)),
      'Outcome': netPnLUSD > 0 ? 'WIN' : 'LOSS',
      'Exit Mechanism': exitReason
    });
  }

  const wins = completedTrades.filter(t => t.Outcome === 'WIN').length;
  const losses = completedTrades.filter(t => t.Outcome === 'LOSS').length;
  const winRate = ((wins / completedTrades.length) * 100).toFixed(1) + '%';
  const totalNetUSD = (curBalance - initialBalance).toFixed(2);
  const totalNetPct = (((curBalance - initialBalance) / initialBalance) * 100).toFixed(2) + '%';

  // Excel generation
  const wb = XLSX.utils.book_new();

  const summarySheetData = [
    { 'NEXUS QUANT $50 MICRO-CAPITAL AUDIT': 'Starting Capital', 'SPECIFICATION / RESULT': '$50.00' },
    { 'NEXUS QUANT $50 MICRO-CAPITAL AUDIT': 'Position Management Mode', 'SPECIFICATION / RESULT': '1 Active Deal at a Time (100% Capital Sequentially Compounded)' },
    { 'NEXUS QUANT $50 MICRO-CAPITAL AUDIT': 'Base Order Allocation', 'SPECIFICATION / RESULT': '30% of Balance ($15.00 on $50 - meets Binance $10 min)' },
    { 'NEXUS QUANT $50 MICRO-CAPITAL AUDIT': 'Safety Order Allocation', 'SPECIFICATION / RESULT': '70% of Balance ($35.00 on $50 - meets Binance $10 min)' },
    { 'NEXUS QUANT $50 MICRO-CAPITAL AUDIT': 'Safety Order Step Deviation', 'SPECIFICATION / RESULT': '-3.5% from Entry Price' },
    { 'NEXUS QUANT $50 MICRO-CAPITAL AUDIT': 'Entry Signal', 'SPECIFICATION / RESULT': 'RSI(14) was < 30 and crosses back >= 30 (Re-enter purple zone) + Green Candle' },
    { 'NEXUS QUANT $50 MICRO-CAPITAL AUDIT': 'Exit Condition 1 (Target TP)', 'SPECIFICATION / RESULT': '+1.5% from Average Price' },
    { 'NEXUS QUANT $50 MICRO-CAPITAL AUDIT': 'Exit Condition 2 (Middle Line)', 'SPECIFICATION / RESULT': 'RSI touches/crosses 50 (Middle Line) with minimum +1.0% profit buffer' },
    { 'NEXUS QUANT $50 MICRO-CAPITAL AUDIT': 'Emergency Stop Loss', 'SPECIFICATION / RESULT': '-10.0% from Average Price' },
    { 'NEXUS QUANT $50 MICRO-CAPITAL AUDIT': 'Binance Spot Fees Deducted', 'SPECIFICATION / RESULT': '0.10% Buy + 0.10% Sell + 0.03% Slippage on EVERY Trade' },
    {},
    { 'NEXUS QUANT $50 MICRO-CAPITAL AUDIT': 'PERFORMANCE METRICS' },
    { 'NEXUS QUANT $50 MICRO-CAPITAL AUDIT': 'Total Trades Completed', 'SPECIFICATION / RESULT': completedTrades.length },
    { 'NEXUS QUANT $50 MICRO-CAPITAL AUDIT': 'Winning Trades', 'SPECIFICATION / RESULT': wins },
    { 'NEXUS QUANT $50 MICRO-CAPITAL AUDIT': 'Losing Trades', 'SPECIFICATION / RESULT': losses },
    { 'NEXUS QUANT $50 MICRO-CAPITAL AUDIT': 'Win Rate (%)', 'SPECIFICATION / RESULT': winRate },
    { 'NEXUS QUANT $50 MICRO-CAPITAL AUDIT': 'Initial Balance', 'SPECIFICATION / RESULT': '$50.00' },
    { 'NEXUS QUANT $50 MICRO-CAPITAL AUDIT': 'Final Compounded Balance', 'SPECIFICATION / RESULT': '$' + curBalance.toFixed(2) },
    { 'NEXUS QUANT $50 MICRO-CAPITAL AUDIT': 'Net Profit ($)', 'SPECIFICATION / RESULT': '+$' + totalNetUSD },
    { 'NEXUS QUANT $50 MICRO-CAPITAL AUDIT': 'Net Return (%)', 'SPECIFICATION / RESULT': '+' + totalNetPct }
  ];

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summarySheetData), 'Executive Summary');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(completedTrades), '$50 Compounding Trade Log');

  const finalPath = path.join(outDir, 'nexus_quant_50_dollar_rsi_middleline_compounding.xlsx');
  XLSX.writeFile(wb, finalPath);
  console.log('Successfully generated $50 compounding report at:', finalPath);
  console.log({
    trades: completedTrades.length,
    wins,
    losses,
    winRate,
    start: '$50.00',
    end: '$' + curBalance.toFixed(2),
    profit: '+$' + totalNetUSD,
    gainPct: '+' + totalNetPct
  });
}

generate50DollarExcelReport();
