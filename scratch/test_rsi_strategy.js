import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Standard Wilder's RSI calculation (identical to TradingView)
function calculateWildersRSI(candles, period = 14) {
  const rsi = new Array(candles.length).fill(null);
  if (candles.length <= period) return rsi;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    if (diff >= 0) gains += diff;
    else losses += -diff;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  rsi[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));

  for (let i = period + 1; i < candles.length; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    if (avgLoss === 0) {
      rsi[i] = 100;
    } else {
      const rs = avgGain / avgLoss;
      rsi[i] = 100 - (100 / (1 + rs));
    }
  }

  return rsi;
}

// Fetch historical klines from Binance API with pagination
async function fetchBinanceKlines(symbol, interval = '1m', limit = 1000, totalBars = 5000) {
  let allCandles = [];
  let endTime = Date.now();

  while (allCandles.length < totalBars) {
    const fetchLimit = Math.min(limit, totalBars - allCandles.length);
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${fetchLimit}&endTime=${endTime}`;
    
    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`Failed to fetch ${symbol}: ${res.statusText}`);
        break;
      }
      const raw = await res.json();
      if (!raw || raw.length === 0) break;

      const chunk = raw.map(k => ({
        openTime: k[0],
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
        closeTime: k[6]
      }));

      // Chunk is sorted asc, prepend to allCandles
      allCandles = [...chunk, ...allCandles];
      endTime = chunk[0].openTime - 1;

      if (raw.length < fetchLimit) break;
    } catch (e) {
      console.warn(`Fetch error for ${symbol}:`, e.message);
      break;
    }
  }

  // Deduplicate and sort asc
  const seen = new Set();
  const deduped = [];
  for (const c of allCandles) {
    if (!seen.has(c.openTime)) {
      seen.add(c.openTime);
      deduped.push(c);
    }
  }
  deduped.sort((a, b) => a.openTime - b.openTime);
  return deduped;
}

async function run() {
  const coins = ['RENDERUSDT', 'NEARUSDT', 'SOLUSDT', 'SUIUSDT', 'FETUSDT', 'AVAXUSDT', 'APTUSDT', 'SEIUSDT'];
  console.log(`Starting RSI 30-to-50 Backtest on Binance 1m data for ${coins.length} coins...`);

  const resultsByCoin = {};

  for (const sym of coins) {
    process.stdout.write(`Fetching 1m candles for ${sym}... `);
    const candles = await fetchBinanceKlines(sym, '1m', 1000, 5000);
    console.log(`Fetched ${candles.length} bars (~${(candles.length / 1440).toFixed(1)} days).`);

    const rsi14 = calculateWildersRSI(candles, 14);

    // Test different SL configurations:
    // 1. Pure Strategy (no SL, sell ONLY when RSI >= 50, max hold 24h)
    // 2. SL = -0.5%
    // 3. SL = -0.8%
    // 4. SL = -1.2%
    // 5. SL = Swing Low of the dip
    const configs = [
      { name: 'Pure TV (No SL, Exit at RSI 50 only)', slPct: null, maxHoldBars: 1440 },
      { name: 'Tight SL -0.50% (Exit at RSI 50)', slPct: 0.50, maxHoldBars: 180 },
      { name: 'Balanced SL -0.80% (Exit at RSI 50)', slPct: 0.80, maxHoldBars: 180 },
      { name: 'Wide SL -1.20% (Exit at RSI 50)', slPct: 1.20, maxHoldBars: 180 },
      { name: 'Ultra-Wide SL -2.00% (Exit at RSI 50)', slPct: 2.00, maxHoldBars: 360 }
    ];

    const coinReports = [];

    for (const cfg of configs) {
      let trades = [];
      let inTrade = false;
      let entryPrice = 0;
      let entryTime = 0;
      let entryBar = 0;
      let wasBelow30 = false;
      let lowestDipPrice = Infinity;

      for (let i = 20; i < candles.length; i++) {
        const c = candles[i];
        const rsiVal = rsi14[i];
        const prevRsi = rsi14[i - 1];

        if (rsiVal === null || prevRsi === null) continue;

        if (!inTrade) {
          // Track if RSI dipped below 30
          if (rsiVal < 30) {
            wasBelow30 = true;
            if (c.low < lowestDipPrice) lowestDipPrice = c.low;
          }

          // Entry Condition: RSI was below 30, and now enters the purple channel (crosses >= 30)
          if (wasBelow30 && prevRsi < 30 && rsiVal >= 30) {
            inTrade = true;
            entryPrice = c.close; // enter at close of the trigger bar
            entryTime = c.closeTime;
            entryBar = i;
            wasBelow30 = false;
          }
        } else {
          // Inside trade: check exit conditions
          const barsHeld = i - entryBar;
          let exitPrice = null;
          let exitReason = null;

          // 1. Stop Loss check
          if (cfg.slPct !== null) {
            const currentDrop = (c.low - entryPrice) / entryPrice * 100;
            if (currentDrop <= -cfg.slPct) {
              exitPrice = entryPrice * (1 - cfg.slPct / 100);
              exitReason = `SL (-${cfg.slPct}%)`;
            }
          }

          // 2. Middle dotted line reached: RSI >= 50
          if (!exitPrice && rsiVal >= 50) {
            exitPrice = c.close;
            exitReason = 'TP (RSI >= 50 Middle Line)';
          }

          // 3. Max hold timeout
          if (!exitPrice && barsHeld >= cfg.maxHoldBars) {
            exitPrice = c.close;
            exitReason = `TIMEOUT (${cfg.maxHoldBars}m)`;
          }

          if (exitPrice !== null) {
            const grossReturnPct = ((exitPrice - entryPrice) / entryPrice) * 100;
            // Binance Fee: 0.075% entry + 0.075% exit = 0.15% round-trip (with BNB discount)
            const feePct = 0.15;
            const slippagePct = 0.05; // 0.05% realistic market order execution slippage
            const netReturnPct = grossReturnPct - feePct - slippagePct;

            trades.push({
              sym,
              entryPrice,
              exitPrice,
              grossReturnPct,
              netReturnPct,
              exitReason,
              barsHeld,
              durationMins: barsHeld,
              isWin: netReturnPct > 0
            });

            inTrade = false;
            lowestDipPrice = Infinity;
          }
        }
      }

      // Calculate stats
      const wins = trades.filter(t => t.isWin);
      const losses = trades.filter(t => !t.isWin);
      const winRate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;
      const totalNetPct = trades.reduce((acc, t) => acc + t.netReturnPct, 0);
      const avgWin = wins.length > 0 ? wins.reduce((acc, t) => acc + t.netReturnPct, 0) / wins.length : 0;
      const avgLoss = losses.length > 0 ? losses.reduce((acc, t) => acc + t.netReturnPct, 0) / losses.length : 0;
      const avgDuration = trades.length > 0 ? trades.reduce((acc, t) => acc + t.durationMins, 0) / trades.length : 0;
      
      const totalGrossWon = wins.reduce((acc, t) => acc + t.netReturnPct, 0);
      const totalGrossLost = Math.abs(losses.reduce((acc, t) => acc + t.netReturnPct, 0));
      const profitFactor = totalGrossLost > 0 ? totalGrossWon / totalGrossLost : (totalGrossWon > 0 ? 99 : 0);

      coinReports.push({
        config: cfg.name,
        totalTrades: trades.length,
        winRate: winRate.toFixed(1) + '%',
        totalNetPct: totalNetPct.toFixed(2) + '%',
        avgWin: '+' + avgWin.toFixed(2) + '%',
        avgLoss: avgLoss.toFixed(2) + '%',
        avgDurationMins: avgDuration.toFixed(1) + 'm',
        profitFactor: profitFactor.toFixed(2)
      });
    }

    resultsByCoin[sym] = coinReports;
  }

  // Summary aggregation across all coins
  console.log('\n===============================================================');
  console.log('📊 RSI 30-TO-50 STRATEGY BACKTEST RESULTS (Binance 1m Real Klines)');
  console.log('===============================================================');

  for (const [sym, reports] of Object.entries(resultsByCoin)) {
    console.log(`\n--- Symbol: ${sym} ---`);
    console.table(reports);
  }

  // Output overall combined results per configuration
  const overallConfigMap = {};
  for (const [sym, reports] of Object.entries(resultsByCoin)) {
    for (const r of reports) {
      if (!overallConfigMap[r.config]) {
        overallConfigMap[r.config] = {
          config: r.config,
          totalTrades: 0,
          wins: 0,
          totalNetPct: 0,
          totalDuration: 0,
          count: 0
        };
      }
      const entry = overallConfigMap[r.config];
      const tradesNum = r.totalTrades;
      const winRateNum = parseFloat(r.winRate);
      const winsNum = Math.round(tradesNum * (winRateNum / 100));
      entry.totalTrades += tradesNum;
      entry.wins += winsNum;
      entry.totalNetPct += parseFloat(r.totalNetPct);
      entry.totalDuration += parseFloat(r.avgDurationMins) * tradesNum;
      entry.count++;
    }
  }

  console.log('\n===============================================================');
  console.log('🏆 AGGREGATE PERFORMANCE ACROSS ALL HALAL COINS (Binance 1m)');
  console.log('===============================================================');
  const summaryTable = Object.values(overallConfigMap).map(c => ({
    Configuration: c.config,
    TotalTrades: c.totalTrades,
    AvgWinRate: c.totalTrades > 0 ? ((c.wins / c.totalTrades) * 100).toFixed(1) + '%' : '0%',
    CombinedNetReturn: c.totalNetPct.toFixed(2) + '%',
    AvgTradeDuration: c.totalTrades > 0 ? (c.totalDuration / c.totalTrades).toFixed(1) + ' mins' : '0m'
  }));
  console.table(summaryTable);

  fs.writeFileSync(path.join(__dirname, 'rsi_strategy_results.json'), JSON.stringify({ resultsByCoin, summaryTable }, null, 2));
  console.log('\nResults saved to scratch/rsi_strategy_results.json');
}

run().catch(console.error);
