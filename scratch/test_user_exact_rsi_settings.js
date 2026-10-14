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
    rsi[i] = avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));
  }
  return rsi;
}

// TradingView RSI-based MA: 14-period Simple Moving Average of the RSI line
function calculateSMA(values, period = 14) {
  const sma = new Array(values.length).fill(null);
  let sum = 0;
  let count = 0;

  for (let i = 0; i < values.length; i++) {
    if (values[i] === null) continue;
    sum += values[i];
    count++;
    if (count >= period) {
      if (count > period) {
        sum -= values[i - period];
      }
      sma[i] = sum / period;
    }
  }
  return sma;
}

// Fetch historical klines from Binance API with pagination
async function fetchBinanceKlines(symbol, interval = '1m', totalBars = 4000) {
  let allCandles = [];
  let endTime = Date.now();
  const limit = 1000;

  while (allCandles.length < totalBars) {
    const fetchLimit = Math.min(limit, totalBars - allCandles.length);
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${fetchLimit}&endTime=${endTime}`;
    try {
      const res = await fetch(url);
      if (!res.ok) break;
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
      allCandles = [...chunk, ...allCandles];
      endTime = chunk[0].openTime - 1;
      if (raw.length < fetchLimit) break;
    } catch (e) {
      break;
    }
  }

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
  console.log('Testing User Exact TradingView Settings:');
  console.log('RSI Length: 14, Smoothing: SMA 14');
  console.log('Bands: Lower 35, Middle 50, Upper 75\n');

  // Variations to test:
  // 1. User Exact Rule: Buy when RSI dips < 35 and crosses >= 35 back into purple. Sell when RSI >= 50.
  // 2. User Rule with SL = -0.50%
  // 3. User Rule with SL = -0.80%
  // 4. User Rule with SL = -1.20%
  // 5. User Rule + Exit at RSI-based MA (Yellow line)
  // 6. User Rule + Exit at RSI Upper Band (75)
  const strategyConfigs = [
    { name: '1. Exact User Rule (Dip < 35 -> Exit RSI 50, No SL)', dip: 35, exitType: 'RSI_50', slPct: null, maxHoldBars: 1440 },
    { name: '2. User Rule + Tight SL -0.50% (Exit RSI 50)', dip: 35, exitType: 'RSI_50', slPct: 0.50, maxHoldBars: 180 },
    { name: '3. User Rule + Balanced SL -0.80% (Exit RSI 50)', dip: 35, exitType: 'RSI_50', slPct: 0.80, maxHoldBars: 180 },
    { name: '4. User Rule + Wide SL -1.20% (Exit RSI 50)', dip: 35, exitType: 'RSI_50', slPct: 1.20, maxHoldBars: 180 },
    { name: '5. Dip < 35 -> Exit at Upper Band (RSI 75, SL -0.8%)', dip: 35, exitType: 'RSI_75', slPct: 0.80, maxHoldBars: 180 },
    { name: '6. RSI Crosses Yellow MA from < 35 -> Exit RSI 50 (SL -0.8%)', dip: 35, exitType: 'RSI_50', useMaCross: true, slPct: 0.80, maxHoldBars: 180 }
  ];

  const allCoinReports = {};

  for (const sym of coins) {
    process.stdout.write(`Fetching ${sym} 1m candles... `);
    const candles = await fetchBinanceKlines(sym, '1m', 4000);
    console.log(`Loaded ${candles.length} bars.`);

    const rsi = calculateWildersRSI(candles, 14);
    const rsiMA = calculateSMA(rsi, 14);

    const reports = [];

    for (const cfg of strategyConfigs) {
      let trades = [];
      let inTrade = false;
      let entryPrice = 0;
      let entryBar = 0;
      let wasBelowDip = false;

      for (let i = 35; i < candles.length; i++) {
        const c = candles[i];
        const rsiVal = rsi[i];
        const prevRsi = rsi[i - 1];
        const maVal = rsiMA[i];
        const prevMa = rsiMA[i - 1];

        if (rsiVal === null || prevRsi === null) continue;

        if (!inTrade) {
          if (rsiVal < cfg.dip) {
            wasBelowDip = true;
          }

          let buySignal = false;
          if (cfg.useMaCross) {
            // Signal: RSI crosses above RSI-based MA while having dipped below 35
            if (wasBelowDip && prevRsi < prevMa && rsiVal >= maVal) {
              buySignal = true;
            }
          } else {
            // Signal: RSI enters purple channel (crosses >= 35 from below 35)
            if (wasBelowDip && prevRsi < cfg.dip && rsiVal >= cfg.dip) {
              buySignal = true;
            }
          }

          if (buySignal) {
            inTrade = true;
            entryPrice = c.close;
            entryBar = i;
            wasBelowDip = false;
          }
        } else {
          const barsHeld = i - entryBar;
          let exitPrice = null;
          let exitReason = null;

          // 1. SL Check
          if (cfg.slPct !== null) {
            const drop = (c.low - entryPrice) / entryPrice * 100;
            if (drop <= -cfg.slPct) {
              exitPrice = entryPrice * (1 - cfg.slPct / 100);
              exitReason = `SL -${cfg.slPct}%`;
            }
          }

          // 2. TP / Target Check
          if (!exitPrice) {
            if (cfg.exitType === 'RSI_50' && rsiVal >= 50) {
              exitPrice = c.close;
              exitReason = 'RSI >= 50';
            } else if (cfg.exitType === 'RSI_75' && rsiVal >= 75) {
              exitPrice = c.close;
              exitReason = 'RSI >= 75 (Upper Band)';
            }
          }

          // 3. Timeout Check
          if (!exitPrice && barsHeld >= cfg.maxHoldBars) {
            exitPrice = c.close;
            exitReason = `Timeout ${cfg.maxHoldBars}m`;
          }

          if (exitPrice !== null) {
            const grossReturnPct = ((exitPrice - entryPrice) / entryPrice) * 100;
            const feePct = 0.15; // 0.075% each way with BNB discount
            const slippagePct = 0.05;
            const netReturnPct = grossReturnPct - feePct - slippagePct;

            trades.push({
              entryPrice,
              exitPrice,
              grossReturnPct,
              netReturnPct,
              exitReason,
              barsHeld,
              isWin: netReturnPct > 0
            });

            inTrade = false;
          }
        }
      }

      const wins = trades.filter(t => t.isWin);
      const losses = trades.filter(t => !t.isWin);
      const winRate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;
      const totalNetPct = trades.reduce((acc, t) => acc + t.netReturnPct, 0);
      const avgWin = wins.length > 0 ? wins.reduce((acc, t) => acc + t.netReturnPct, 0) / wins.length : 0;
      const avgLoss = losses.length > 0 ? losses.reduce((acc, t) => acc + t.netReturnPct, 0) / losses.length : 0;
      const avgDuration = trades.length > 0 ? trades.reduce((acc, t) => acc + t.barsHeld, 0) / trades.length : 0;

      reports.push({
        config: cfg.name,
        trades: trades.length,
        winRate: winRate.toFixed(1) + '%',
        totalNetPct: totalNetPct.toFixed(2) + '%',
        avgWin: '+' + avgWin.toFixed(2) + '%',
        avgLoss: avgLoss.toFixed(2) + '%',
        avgDuration: avgDuration.toFixed(1) + 'm'
      });
    }

    allCoinReports[sym] = reports;
  }

  console.log('\n===============================================================');
  console.log('📊 RESULTS FOR RENDERUSDT (From Your Screenshot)');
  console.log('===============================================================');
  console.table(allCoinReports['RENDERUSDT']);

  // Aggregate across all coins
  const agg = {};
  for (const [sym, repList] of Object.entries(allCoinReports)) {
    for (const r of repList) {
      if (!agg[r.config]) {
        agg[r.config] = { config: r.config, trades: 0, wins: 0, netPct: 0, durationSum: 0 };
      }
      const trNum = r.trades;
      const wr = parseFloat(r.winRate);
      agg[r.config].trades += trNum;
      agg[r.config].wins += Math.round(trNum * (wr / 100));
      agg[r.config].netPct += parseFloat(r.totalNetPct);
      agg[r.config].durationSum += parseFloat(r.avgDuration) * trNum;
    }
  }

  console.log('\n===============================================================');
  console.log('🏆 AGGREGATE SUMMARY ACROSS ALL 8 HALAL COINS (Binance 1m)');
  console.log('===============================================================');
  const summaryTable = Object.values(agg).map(a => ({
    Configuration: a.config,
    TotalTrades: a.trades,
    WinRate: a.trades > 0 ? ((a.wins / a.trades) * 100).toFixed(1) + '%' : '0%',
    CombinedNetReturn: a.netPct.toFixed(2) + '%',
    AvgTradeDuration: a.trades > 0 ? (a.durationSum / a.trades).toFixed(1) + ' mins' : '0m'
  }));
  console.table(summaryTable);

  fs.writeFileSync(path.join(__dirname, 'user_exact_rsi_results.json'), JSON.stringify({ allCoinReports, summaryTable }, null, 2));
}

run().catch(console.error);
