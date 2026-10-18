import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cacheDir = path.resolve(__dirname, '../data/binance_cache');
const outDir = 'C:/Users/waizt/.gemini/antigravity/brain/9240cc1b-f576-4996-a196-552f1f9e4603';

console.log('=== GENERATING INSTITUTIONAL DEDICATED STRATEGY EXCEL WORKBOOKS ===');

const files = fs.readdirSync(cacheDir).filter(f => f.endsWith('.json'));
const rawDatasets = {};

for (const file of files) {
  const sym = file.split('_')[0];
  if (['PAXGUSDT', 'FDUSDUSDT', 'USDCUSDT'].includes(sym)) continue;
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
      if (parsed.length > 2000) rawDatasets[sym] = parsed;
    }
  } catch (_) {}
}

const allSymbols = Object.keys(rawDatasets).filter(s => s !== 'BTCUSDT');
console.log(`Loaded ${allSymbols.length} altcoins + BTCUSDT from Binance cache.`);

function resampleCandles(c15m, targetMinutes) {
  const stepMs = targetMinutes * 60 * 1000;
  const buckets = new Map();
  for (const c of c15m) {
    const bucket = c.openTime - (c.openTime % stepMs);
    let arr = buckets.get(bucket);
    if (!arr) { arr = []; buckets.set(bucket, arr); }
    arr.push(c);
  }
  const resampled = [];
  for (const [openTime, slice] of buckets.entries()) {
    let open = slice[0].open;
    let high = -Infinity;
    let low = Infinity;
    let close = slice[slice.length - 1].close;
    let volume = 0;
    for (const c of slice) {
      if (c.high > high) high = c.high;
      if (c.low < low) low = c.low;
      volume += c.volume;
    }
    resampled.push({ openTime, time: new Date(openTime).toISOString(), open, high, low, close, volume });
  }
  resampled.sort((a, b) => a.openTime - b.openTime);
  return resampled;
}

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

// Precompute BTC 1H
const btc15 = rawDatasets['BTCUSDT'];
const btc1h = resampleCandles(btc15, 60);
const btcEMA50_1h = calculateEMA(btc1h.map(c => c.close), 50);
const btc1hMap = new Map();
btc1h.forEach((c, idx) => btc1hMap.set(c.openTime, idx));

// Multi-TF Datasets (15m, 30m, 1h)
const multiTF = { '15m': {}, '30m': {}, '1h': {} };

for (const sym of allSymbols) {
  const c15 = rawDatasets[sym];
  multiTF['15m'][sym] = {
    candles: c15,
    rsi: calculateRSI14(c15),
    ema100: calculateEMA(c15.map(c => c.close), 100)
  };

  const c30 = resampleCandles(c15, 30);
  multiTF['30m'][sym] = {
    candles: c30,
    rsi: calculateRSI14(c30),
    ema100: calculateEMA(c30.map(c => c.close), 100)
  };

  const c1h = resampleCandles(c15, 60);
  multiTF['1h'][sym] = {
    candles: c1h,
    rsi: calculateRSI14(c1h),
    ema100: calculateEMA(c1h.map(c => c.close), 100)
  };
}

const feeRoundTrip = 0.20; // 0.10% buy + 0.10% sell
const slipRate = 0.00015; // 0.015% each side

function runBacktest(strategyMode, tf) {
  const isBtcSafe = strategyMode === 'BTC_SAFE';
  const slPct = tf === '1h' ? 2.5 : (tf === '30m' ? 2.0 : 1.5);
  const cooldownBars = tf === '1h' ? 2 : (tf === '30m' ? 4 : 8); // 2 hours cooldown
  const maxBarsHeld = tf === '1h' ? 24 : (tf === '30m' ? 36 : 48);

  const trades = [];
  const dailyPnL = new Map();
  const coinStats = new Map();

  for (const sym of allSymbols) {
    const data = multiTF[tf][sym];
    const candles = data.candles;
    const rsi = data.rsi;
    const ema100 = data.ema100;
    const len = candles.length;

    let inTrade = false;
    let entryPrice = 0;
    let entryTime = 0;
    let entryTimeString = '';
    let entryRSI = 0;
    let currentSL = 0;
    let cooldownUntil = 0;
    let entryIdx = 0;
    let inOversold = false;

    // Two-stage state
    let stage1Done = false;
    let stage1Net = 0;
    let stage1Time = '';
    let stage1Price = 0;

    // Start after 120 bars warmup so indicators are completely stabilized
    for (let i = 120; i < len; i++) {
      const c = candles[i];
      const curRSI = rsi[i];
      const prevRSI = rsi[i - 1];

      if (i < cooldownUntil) continue;

      if (!inTrade) {
        if (curRSI > 0 && curRSI < 30) {
          inOversold = true;
        } else if (inOversold && prevRSI < 30 && curRSI >= 30) {
          // Trend Filter: Close must be > EMA 100
          if (c.close > ema100[i]) {
            // If BTC Safe mode, check BTC 1H Close > EMA 50
            let canEnter = true;
            if (isBtcSafe) {
              const btcBucket = c.openTime - (c.openTime % (3600 * 1000));
              const btcIdx = btc1hMap.get(btcBucket);
              if (btcIdx !== undefined && btc1h[btcIdx].close <= btcEMA50_1h[btcIdx]) {
                canEnter = false;
              }
            }

            if (canEnter) {
              inTrade = true;
              entryPrice = c.close * (1 + slipRate);
              entryTime = c.openTime;
              entryTimeString = c.time;
              entryRSI = curRSI;
              entryIdx = i;
              currentSL = entryPrice * (1 - slPct / 100);
              stage1Done = false;
              stage1Net = 0;
              stage1Time = '';
              stage1Price = 0;
            }
          }
          inOversold = false;
        }
      } else {
        // In trade
        // 1. Check if Stage 1 (RSI 50) is reached
        if (!stage1Done && curRSI >= 50) {
          stage1Done = true;
          stage1Price = c.close * (1 - slipRate);
          stage1Time = c.time;
          const gross1 = ((stage1Price - entryPrice) / entryPrice) * 100;
          stage1Net = gross1 - feeRoundTrip - (slipRate * 2 * 100);
          // Ratchet SL of remaining 50% to Break-Even + fee cover (+0.25% buffer)!
          currentSL = entryPrice * 1.0025;
        }

        let exitPrice = null;
        let exitReason = '';

        // 2. Check Stop Loss or Break-Even Stop
        if (c.low <= currentSL) {
          exitPrice = currentSL * (1 - slipRate);
          if (stage1Done) {
            exitReason = 'Stage 2: Break-Even Shield Hit (+0.05% Net)';
          } else {
            exitReason = `Stop Loss Hit (-${slPct.toFixed(1)}%)`;
            cooldownUntil = i + cooldownBars; // 2-hour cooldown
          }
        }
        // 3. Check Runner Exit at RSI 65 (if stage 1 completed)
        else if (stage1Done && curRSI >= 65) {
          exitPrice = c.close * (1 - slipRate);
          exitReason = 'Stage 2: RSI 65 Runner Target Hit';
        }
        // 4. Max Duration Limit
        else if (i - entryIdx >= maxBarsHeld) {
          exitPrice = c.close * (1 - slipRate);
          exitReason = stage1Done ? 'Stage 2: Max Time Limit Exit' : 'Max Time Limit Exit';
        }

        if (exitPrice !== null) {
          const gross2 = ((exitPrice - entryPrice) / entryPrice) * 100;
          const net2 = gross2 - feeRoundTrip - (slipRate * 2 * 100);

          let finalNet = 0;
          let finalGross = 0;
          let exitDescription = '';

          if (stage1Done) {
            finalNet = (stage1Net * 0.50) + (net2 * 0.50);
            finalGross = (((stage1Price - entryPrice) / entryPrice * 100) * 0.50) + (gross2 * 0.50);
            exitDescription = `Stage 1: RSI 50 (${stage1Net > 0 ? '+' : ''}${stage1Net.toFixed(2)}%) | ${exitReason} (${net2 > 0 ? '+' : ''}${net2.toFixed(2)}%)`;
          } else {
            finalNet = net2;
            finalGross = gross2;
            exitDescription = exitReason;
          }

          const durationHours = ((c.openTime - entryTime) / (3600 * 1000)).toFixed(1);
          const dayKey = c.time.split('T')[0];

          const tradeRecord = {
            tradeId: trades.length + 1,
            symbol: sym,
            timeframe: tf,
            entryTime: entryTimeString,
            entryPrice: Number(entryPrice.toFixed(4)),
            entryRSI: Number(entryRSI.toFixed(1)),
            exitTime: c.time,
            exitPrice: Number(exitPrice.toFixed(4)),
            exitRSI: Number(curRSI.toFixed(1)),
            durationHours: Number(durationHours),
            exitReason: exitDescription,
            grossReturnPct: Number(finalGross.toFixed(2)),
            feeAndSlippagePct: Number((feeRoundTrip + (slipRate * 2 * 100)).toFixed(2)),
            netReturnPct: Number(finalNet.toFixed(2)),
            isWin: finalNet > 0.05 ? 'WIN' : (finalNet >= -0.05 ? 'BREAK-EVEN' : 'LOSS')
          };

          trades.push(tradeRecord);

          // Daily stats
          if (!dailyPnL.has(dayKey)) dailyPnL.set(dayKey, { trades: 0, wins: 0, netPnL: 0 });
          const dStat = dailyPnL.get(dayKey);
          dStat.trades++;
          if (finalNet > 0.05) dStat.wins++;
          dStat.netPnL += finalNet;

          // Coin stats
          if (!coinStats.has(sym)) coinStats.set(sym, { trades: 0, wins: 0, losses: 0, be: 0, totalNet: 0, winSum: 0, lossSum: 0 });
          const cStat = coinStats.get(sym);
          cStat.trades++;
          if (finalNet > 0.05) { cStat.wins++; cStat.winSum += finalNet; }
          else if (finalNet >= -0.05) { cStat.be++; }
          else { cStat.losses++; cStat.lossSum += finalNet; }
          cStat.totalNet += finalNet;

          inTrade = false;
        }
      }
    }
  }

  // Sort trades chronologically
  trades.sort((a, b) => new Date(a.entryTime).getTime() - new Date(b.entryTime).getTime());
  let runningCum = 0;
  for (let t of trades) {
    runningCum += t.netReturnPct;
    t.cumNetReturnPct = Number(runningCum.toFixed(2));
  }

  // Summary Metrics
  const totalTrades = trades.length;
  const wins = trades.filter(t => t.isWin === 'WIN').length;
  const be = trades.filter(t => t.isWin === 'BREAK-EVEN').length;
  const losses = trades.filter(t => t.isWin === 'LOSS').length;
  const winRate = totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(1) : '0.0';
  const totalNet = trades.reduce((acc, t) => acc + t.netReturnPct, 0);

  const winSum = trades.filter(t => t.netReturnPct > 0.05).reduce((acc, t) => acc + t.netReturnPct, 0);
  const lossSum = Math.abs(trades.filter(t => t.netReturnPct < -0.05).reduce((acc, t) => acc + t.netReturnPct, 0));
  const profitFactor = lossSum > 0 ? (winSum / lossSum).toFixed(2) : (winSum > 0 ? '999.00' : '0.00');

  const avgWin = wins > 0 ? (winSum / wins).toFixed(2) : '0.00';
  const avgLoss = losses > 0 ? (-lossSum / losses).toFixed(2) : '0.00';

  // Calculate Max Drawdown
  let peak = 0;
  let maxDD = 0;
  let curEquity = 0;
  for (let t of trades) {
    curEquity += t.netReturnPct;
    if (curEquity > peak) peak = curEquity;
    const dd = peak - curEquity;
    if (dd > maxDD) maxDD = dd;
  }

  // Profitable days
  let profitableDays = 0;
  const dayKeys = Array.from(dailyPnL.keys()).sort();
  for (const dk of dayKeys) {
    if (dailyPnL.get(dk).netPnL > 0) profitableDays++;
  }
  const dayWinRate = dayKeys.length > 0 ? ((profitableDays / dayKeys.length) * 100).toFixed(1) : '0.0';

  return {
    tf,
    totalTrades,
    tradesPerDay: dayKeys.length > 0 ? (totalTrades / dayKeys.length).toFixed(1) : '0.0',
    wins,
    be,
    losses,
    winRate: winRate + '%',
    avgWin: '+' + avgWin + '%',
    avgLoss: avgLoss + '%',
    profitFactor,
    maxDrawdown: '-' + maxDD.toFixed(2) + '%',
    totalNetGain: (totalNet > 0 ? '+' : '') + totalNet.toFixed(2) + '%',
    activeDays: dayKeys.length,
    profitableDays: `${profitableDays}/${dayKeys.length} (${dayWinRate}%)`,
    trades,
    dailyPnL,
    coinStats
  };
}

function exportExcelReport(strategyName, fileName, res1h, res30m, res15m) {
  const wb = XLSX.utils.book_new();

  // Sheet 1: Executive Summary & Metrics
  const summaryRows = [
    { 'STRATEGY SPECIFICATION': 'Strategy Name', 'VALUE': strategyName },
    { 'STRATEGY SPECIFICATION': 'Entry Signal', 'VALUE': 'RSI(14) crosses from < 30 back >= 30 (Purple Band Re-entry)' },
    { 'STRATEGY SPECIFICATION': 'Trend Condition', 'VALUE': strategyName.includes('BTC') ? 'Coin Close > EMA(100) AND BTCUSDT 1H Close > EMA(50)' : 'Coin Close > EMA(100)' },
    { 'STRATEGY SPECIFICATION': 'De-Risking Mechanism', 'VALUE': 'Two-Stage: Sell 50% at RSI 50 -> Ratchet remaining 50% SL to Break-Even (+0.25% fee cover) -> Runner target RSI 65' },
    { 'STRATEGY SPECIFICATION': 'Stop-Loss & Risk', 'VALUE': '1H: 2.5% SL (2-bar cooldown) | 30m: 2.0% SL (4-bar cooldown) | 15m: 1.5% SL (8-bar cooldown)' },
    { 'STRATEGY SPECIFICATION': 'Exchange Friction', 'VALUE': '0.20% Round-trip Binance Spot Fee + 0.03% Slippage deducted from EVERY trade' },
    {},
    { 'STRATEGY SPECIFICATION': 'COMPREHENSIVE PERFORMANCE COMPARISON BY TIMEFRAME' },
    {
      'STRATEGY SPECIFICATION': 'Metric',
      'VALUE': '1-Hour (1H)',
      '__EMPTY': '30-Minute (30m)',
      '__EMPTY_1': '15-Minute (15m)'
    },
    { 'STRATEGY SPECIFICATION': 'Total Completed Trades', 'VALUE': res1h.totalTrades, '__EMPTY': res30m.totalTrades, '__EMPTY_1': res15m.totalTrades },
    { 'STRATEGY SPECIFICATION': 'Active Trading Days', 'VALUE': res1h.activeDays, '__EMPTY': res30m.activeDays, '__EMPTY_1': res15m.activeDays },
    { 'STRATEGY SPECIFICATION': 'Trading Frequency (Trades/Day)', 'VALUE': res1h.tradesPerDay, '__EMPTY': res30m.tradesPerDay, '__EMPTY_1': res15m.tradesPerDay },
    { 'STRATEGY SPECIFICATION': 'Winning Trades (Wins)', 'VALUE': res1h.wins, '__EMPTY': res30m.wins, '__EMPTY_1': res15m.wins },
    { 'STRATEGY SPECIFICATION': 'Break-Even Guard Exits', 'VALUE': res1h.be, '__EMPTY': res30m.be, '__EMPTY_1': res15m.be },
    { 'STRATEGY SPECIFICATION': 'Full Stop-Losses Hit', 'VALUE': res1h.losses, '__EMPTY': res30m.losses, '__EMPTY_1': res15m.losses },
    { 'STRATEGY SPECIFICATION': 'Win Rate (%)', 'VALUE': res1h.winRate, '__EMPTY': res30m.winRate, '__EMPTY_1': res15m.winRate },
    { 'STRATEGY SPECIFICATION': 'Average Net Win (%)', 'VALUE': res1h.avgWin, '__EMPTY': res30m.avgWin, '__EMPTY_1': res15m.avgWin },
    { 'STRATEGY SPECIFICATION': 'Average Net Loss (%)', 'VALUE': res1h.avgLoss, '__EMPTY': res30m.avgLoss, '__EMPTY_1': res15m.avgLoss },
    { 'STRATEGY SPECIFICATION': 'Profit Factor', 'VALUE': res1h.profitFactor, '__EMPTY': res30m.profitFactor, '__EMPTY_1': res15m.profitFactor },
    { 'STRATEGY SPECIFICATION': 'Max Drawdown (%)', 'VALUE': res1h.maxDrawdown, '__EMPTY': res30m.maxDrawdown, '__EMPTY_1': res15m.maxDrawdown },
    { 'STRATEGY SPECIFICATION': 'Profitable Days (%)', 'VALUE': res1h.profitableDays, '__EMPTY': res30m.profitableDays, '__EMPTY_1': res15m.profitableDays },
    { 'STRATEGY SPECIFICATION': 'Cumulative Total Net Gain (%)', 'VALUE': res1h.totalNetGain, '__EMPTY': res30m.totalNetGain, '__EMPTY_1': res15m.totalNetGain }
  ];

  const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Executive Summary');

  // Sheet 2: 1-Hour Complete Trade Log
  const logRows1h = res1h.trades.map(t => ({
    'Trade #': t.tradeId,
    'Symbol': t.symbol,
    'Timeframe': t.timeframe,
    'Entry Time (UTC)': t.entryTime,
    'Entry Price ($)': t.entryPrice,
    'Entry RSI': t.entryRSI,
    'Exit Time (UTC)': t.exitTime,
    'Exit Price ($)': t.exitPrice,
    'Exit RSI': t.exitRSI,
    'Duration (Hours)': t.durationHours,
    'Exit Mechanics & Breakdown': t.exitReason,
    'Gross Return (%)': t.grossReturnPct,
    'Fees + Slip (%)': t.feeAndSlippagePct,
    'Net Return (%)': t.netReturnPct,
    'Cumulative Net Return (%)': t.cumNetReturnPct,
    'Outcome': t.isWin
  }));
  const wsLog1h = XLSX.utils.json_to_sheet(logRows1h);
  XLSX.utils.book_append_sheet(wb, wsLog1h, '1H Trade Log (All Trades)');

  // Sheet 3: 30-Minute Complete Trade Log
  const logRows30m = res30m.trades.map(t => ({
    'Trade #': t.tradeId,
    'Symbol': t.symbol,
    'Timeframe': t.timeframe,
    'Entry Time (UTC)': t.entryTime,
    'Entry Price ($)': t.entryPrice,
    'Entry RSI': t.entryRSI,
    'Exit Time (UTC)': t.exitTime,
    'Exit Price ($)': t.exitPrice,
    'Exit RSI': t.exitRSI,
    'Duration (Hours)': t.durationHours,
    'Exit Mechanics & Breakdown': t.exitReason,
    'Gross Return (%)': t.grossReturnPct,
    'Fees + Slip (%)': t.feeAndSlippagePct,
    'Net Return (%)': t.netReturnPct,
    'Cumulative Net Return (%)': t.cumNetReturnPct,
    'Outcome': t.isWin
  }));
  const wsLog30m = XLSX.utils.json_to_sheet(logRows30m);
  XLSX.utils.book_append_sheet(wb, wsLog30m, '30m Trade Log (All Trades)');

  // Sheet 4: 15-Minute Complete Trade Log
  const logRows15m = res15m.trades.map(t => ({
    'Trade #': t.tradeId,
    'Symbol': t.symbol,
    'Timeframe': t.timeframe,
    'Entry Time (UTC)': t.entryTime,
    'Entry Price ($)': t.entryPrice,
    'Entry RSI': t.entryRSI,
    'Exit Time (UTC)': t.exitTime,
    'Exit Price ($)': t.exitPrice,
    'Exit RSI': t.exitRSI,
    'Duration (Hours)': t.durationHours,
    'Exit Mechanics & Breakdown': t.exitReason,
    'Gross Return (%)': t.grossReturnPct,
    'Fees + Slip (%)': t.feeAndSlippagePct,
    'Net Return (%)': t.netReturnPct,
    'Cumulative Net Return (%)': t.cumNetReturnPct,
    'Outcome': t.isWin
  }));
  const wsLog15m = XLSX.utils.json_to_sheet(logRows15m);
  XLSX.utils.book_append_sheet(wb, wsLog15m, '15m Trade Log (All Trades)');

  // Sheet 5: Coin-by-Coin Performance (1H)
  const coinRows = [];
  res1h.coinStats.forEach((st, sym) => {
    const pf = st.lossSum > 0 ? (st.winSum / Math.abs(st.lossSum)).toFixed(2) : (st.winSum > 0 ? '999.00' : '0.00');
    coinRows.push({
      'Symbol': sym,
      'Total Trades': st.trades,
      'Wins': st.wins,
      'Break-Evens': st.be,
      'Losses': st.losses,
      'Win Rate (%)': ((st.wins / st.trades) * 100).toFixed(1) + '%',
      'Net Profit (%)': (st.totalNet > 0 ? '+' : '') + st.totalNet.toFixed(2) + '%',
      'Profit Factor': pf
    });
  });
  coinRows.sort((a, b) => parseFloat(b['Net Profit (%)']) - parseFloat(a['Net Profit (%)']));
  const wsCoins = XLSX.utils.json_to_sheet(coinRows);
  XLSX.utils.book_append_sheet(wb, wsCoins, 'Coin Performance (1H)');

  // Sheet 6: Daily PnL Distribution (1H)
  const dailyRows = [];
  const sortedDays = Array.from(res1h.dailyPnL.keys()).sort();
  for (const day of sortedDays) {
    const st = res1h.dailyPnL.get(day);
    dailyRows.push({
      'Date': day,
      'Completed Trades': st.trades,
      'Winning Trades': st.wins,
      'Daily Net Return (%)': (st.netPnL > 0 ? '+' : '') + st.netPnL.toFixed(2) + '%',
      'Status': st.netPnL > 0 ? 'PROFITABLE DAY' : (st.netPnL === 0 ? 'BREAK-EVEN DAY' : 'LOSS DAY')
    });
  }
  const wsDaily = XLSX.utils.json_to_sheet(dailyRows);
  XLSX.utils.book_append_sheet(wb, wsDaily, 'Daily PnL Distribution (1H)');

  const outPath = path.join(outDir, fileName);
  XLSX.writeFile(wb, outPath);
  console.log(`Saved workbook: ${outPath}`);
}

// 1. Run Strategy 7: Trend Filter (Close > EMA 100) + Two-Stage Exit
console.log('\n--- BACKTESTING STRATEGY 7: Trend Filter (Close > EMA 100) + Two-Stage Exit ---');
const strat7_1h = runBacktest('TREND_ONLY', '1h');
const strat7_30m = runBacktest('TREND_ONLY', '30m');
const strat7_15m = runBacktest('TREND_ONLY', '15m');
console.log('Strat 7 (1H): Trades:', strat7_1h.totalTrades, 'WinRate:', strat7_1h.winRate, 'PF:', strat7_1h.profitFactor, 'Net:', strat7_1h.totalNetGain);
console.log('Strat 7 (30m): Trades:', strat7_30m.totalTrades, 'WinRate:', strat7_30m.winRate, 'PF:', strat7_30m.profitFactor, 'Net:', strat7_30m.totalNetGain);
console.log('Strat 7 (15m): Trades:', strat7_15m.totalTrades, 'WinRate:', strat7_15m.winRate, 'PF:', strat7_15m.profitFactor, 'Net:', strat7_15m.totalNetGain);
exportExcelReport('Strategy 7: Trend Filter (Close > EMA 100) + Two-Stage Exit', 'nexus_quant_strategy_7_trend_filter_two_stage.xlsx', strat7_1h, strat7_30m, strat7_15m);

// 2. Run Strategy 8: BTC Safe Regime + Trend Filter + Two-Stage Exit
console.log('\n--- BACKTESTING STRATEGY 8: BTC Safe Regime + Trend Filter + Two-Stage Exit ---');
const strat8_1h = runBacktest('BTC_SAFE', '1h');
const strat8_30m = runBacktest('BTC_SAFE', '30m');
const strat8_15m = runBacktest('BTC_SAFE', '15m');
console.log('Strat 8 (1H): Trades:', strat8_1h.totalTrades, 'WinRate:', strat8_1h.winRate, 'PF:', strat8_1h.profitFactor, 'Net:', strat8_1h.totalNetGain);
console.log('Strat 8 (30m): Trades:', strat8_30m.totalTrades, 'WinRate:', strat8_30m.winRate, 'PF:', strat8_30m.profitFactor, 'Net:', strat8_30m.totalNetGain);
console.log('Strat 8 (15m): Trades:', strat8_15m.totalTrades, 'WinRate:', strat8_15m.winRate, 'PF:', strat8_15m.profitFactor, 'Net:', strat8_15m.totalNetGain);
exportExcelReport('Strategy 8: BTC Safe Regime + Trend Filter + Two-Stage Exit', 'nexus_quant_strategy_8_btc_safe_trend_two_stage.xlsx', strat8_1h, strat8_30m, strat8_15m);

console.log('=== ALL COMPREHENSIVE EXCEL FILES SUCCESSFULLY GENERATED ===');
