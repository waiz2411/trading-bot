import fs from 'fs';
import path from 'path';
import { WATCHLIST } from '../backend/src/config/assets.js';
import { calculateTechnicalMetrics } from '../backend/src/services/technicalAnalysis.js';
import { evaluateSpotConfluence } from '../backend/src/services/strategyEngine.js';

const CACHE_DIR = path.resolve('scratch/kline_cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

const START_TIME = new Date('2026-08-01T00:00:00Z').getTime();
const END_TIME = new Date('2026-10-01T00:00:00Z').getTime();

const TP_PCT = 0.6; // 0.6%
const SL_PCT = 0.7; // 0.7%
const FEE_PCT = 0.20; // 0.20% round-trip Binance Spot fee
const HOLD_CANDLES = 3; // 15 minutes = 3 x 5m candles

async function fetchKlinesForSymbol(binanceSymbol) {
  const cacheFile = path.join(CACHE_DIR, `${binanceSymbol}_5m_aug_oct_2026.json`);
  if (fs.existsSync(cacheFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (Array.isArray(data) && data.length > 5000) {
        return data;
      }
    } catch (_) {}
  }

  let allKlines = [];
  let currentStart = START_TIME;

  console.log(`Downloading ${binanceSymbol} from Binance API...`);
  while (currentStart < END_TIME) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${binanceSymbol}&interval=5m&startTime=${currentStart}&endTime=${END_TIME}&limit=1000`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) {
        if (res.status === 400) {
          console.warn(`Symbol ${binanceSymbol} not supported or 400 error.`);
          return null;
        }
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) break;

      allKlines = allKlines.concat(data);
      const lastCloseTime = data[data.length - 1][0];
      if (lastCloseTime <= currentStart) break;
      currentStart = lastCloseTime + 1;

      // Small throttle to be courteous to Binance API
      await new Promise(r => setTimeout(r, 80));
    } catch (err) {
      console.warn(`Retry ${binanceSymbol} due to:`, err.message);
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  if (allKlines.length > 0) {
    fs.writeFileSync(cacheFile, JSON.stringify(allKlines), 'utf8');
    console.log(`Saved ${binanceSymbol}: ${allKlines.length} candles.`);
  }
  return allKlines;
}

async function runBacktest() {
  const cryptos = WATCHLIST.filter(a => a.category === 'Crypto');
  console.log(`Found ${cryptos.length} crypto assets to backtest from Aug 1 to Oct 1 2026.`);
  console.log(`Settings: TP = ${TP_PCT}%, SL = ${SL_PCT}%, Max Hold = 15m (3 candles), Fee = ${FEE_PCT}%\n`);

  const symbolData = [];
  for (const asset of cryptos) {
    const baseAsset = asset.baseAsset || asset.symbol.replace(/[-_/]/g, '').replace(/USD$/, '');
    const binanceSymbol = `${baseAsset}USDT`;
    const rawKlines = await fetchKlinesForSymbol(binanceSymbol);
    if (rawKlines && rawKlines.length >= 200) {
      // Map to standard candles format
      const candles = rawKlines.map(k => ({
        time: new Date(k[0]).toISOString(),
        timestamp: k[0],
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
        quoteVolume: parseFloat(k[7])
      }));
      symbolData.push({ asset, binanceSymbol, candles });
    }
  }

  console.log(`\nSuccessfully loaded kline data for ${symbolData.length} symbols.\nStarting simulation...`);

  const allTrades = [];
  const riskSettings = {
    stopLossPct: SL_PCT,
    takeProfitPct: TP_PCT,
    allowHighVolatility: true, // We will evaluate with engine
    minConfidenceThreshold: 85
  };

  // For each symbol, run strategy
  for (const item of symbolData) {
    const { asset, binanceSymbol, candles } = item;
    let inTradeUntilIdx = -1;

    for (let i = 50; i < candles.length - HOLD_CANDLES; i++) {
      if (i <= inTradeUntilIdx) continue; // In an active position

      const windowCandles = candles.slice(i - 49, i + 1); // 50 candles window
      const currentCandle = candles[i];
      const technicals = calculateTechnicalMetrics(windowCandles);
      if (!technicals) continue;

      const mockAsset = {
        ...asset,
        price: currentCandle.close,
        quoteVolume: currentCandle.quoteVolume,
        candles: windowCandles
      };

      // Test with allowHighVolatility: null / both high and normal to get full picture
      const signal = evaluateSpotConfluence(mockAsset, technicals, {
        ...riskSettings,
        allowHighVolatility: asset.isHighVolatility ?? true
      });

      if (signal && signal.action === 'STRONG_BUY') {
        const entryPrice = currentCandle.close;
        const entryTime = currentCandle.time;
        const targetPrice = entryPrice * (1 + TP_PCT / 100);
        const stopPrice = entryPrice * (1 - SL_PCT / 100);

        let exitPrice = null;
        let exitReason = null;
        let exitCandleIdx = null;

        // Check forward 3 candles (15 mins)
        for (let step = 1; step <= HOLD_CANDLES; step++) {
          const nextCandle = candles[i + step];
          const hitTP = nextCandle.high >= targetPrice;
          const hitSL = nextCandle.low <= stopPrice;

          if (hitTP && hitSL) {
            // Both hit in the same 5m candle: check candle open direction
            if (nextCandle.open >= entryPrice) {
              exitPrice = targetPrice;
              exitReason = 'TAKE_PROFIT_TRIGGER';
            } else {
              exitPrice = stopPrice;
              exitReason = 'STOP_LOSS_TRIGGER';
            }
            exitCandleIdx = i + step;
            break;
          } else if (hitTP) {
            exitPrice = targetPrice;
            exitReason = 'TAKE_PROFIT_TRIGGER';
            exitCandleIdx = i + step;
            break;
          } else if (hitSL) {
            exitPrice = stopPrice;
            exitReason = 'STOP_LOSS_TRIGGER';
            exitCandleIdx = i + step;
            break;
          }
        }

        // If not hit within 3 candles (15 mins), close at 15m candle close
        if (!exitPrice) {
          const finalCandle = candles[i + HOLD_CANDLES];
          exitPrice = finalCandle.close;
          exitReason = '15M_TIME_EXPIRY';
          exitCandleIdx = i + HOLD_CANDLES;
        }

        inTradeUntilIdx = exitCandleIdx;

        const grossPnLPct = ((exitPrice - entryPrice) / entryPrice) * 100;
        const netPnLPct = grossPnLPct - FEE_PCT;
        const exitTime = candles[exitCandleIdx].time;
        const dayKey = entryTime.slice(0, 10); // YYYY-MM-DD

        allTrades.push({
          symbol: asset.symbol,
          binanceSymbol,
          dayKey,
          entryTime,
          exitTime,
          entryPrice,
          exitPrice,
          exitReason,
          grossPnLPct: Number(grossPnLPct.toFixed(3)),
          netPnLPct: Number(netPnLPct.toFixed(3)),
          isWin: netPnLPct > 0.001,
          isLoss: netPnLPct < -0.001,
          isBreakEven: Math.abs(netPnLPct) <= 0.001
        });
      }
    }
  }

  // Sort trades chronologically
  allTrades.sort((a, b) => new Date(a.entryTime).getTime() - new Date(b.entryTime).getTime());

  // Aggregate results
  const totalTrades = allTrades.length;
  const wins = allTrades.filter(t => t.isWin).length;
  const losses = allTrades.filter(t => t.isLoss).length;
  const breakEvens = allTrades.filter(t => t.isBreakEven).length;
  const winRate = totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(2) : 0;

  const totalGrossPnL = allTrades.reduce((acc, t) => acc + t.grossPnLPct, 0);
  const totalNetPnL = allTrades.reduce((acc, t) => acc + t.netPnLPct, 0);
  const totalFeesPaid = totalTrades * FEE_PCT;

  const grossProfit = allTrades.filter(t => t.netPnLPct > 0).reduce((acc, t) => acc + t.netPnLPct, 0);
  const grossLoss = Math.abs(allTrades.filter(t => t.netPnLPct < 0).reduce((acc, t) => acc + t.netPnLPct, 0));
  const profitFactor = grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : 'N/A';

  const tpExits = allTrades.filter(t => t.exitReason === 'TAKE_PROFIT_TRIGGER').length;
  const slExits = allTrades.filter(t => t.exitReason === 'STOP_LOSS_TRIGGER').length;
  const timeExits = allTrades.filter(t => t.exitReason === '15M_TIME_EXPIRY').length;

  // Daily statistics
  const dayMap = {};
  for (const trade of allTrades) {
    if (!dayMap[trade.dayKey]) {
      dayMap[trade.dayKey] = {
        date: trade.dayKey,
        trades: 0,
        wins: 0,
        losses: 0,
        breakEvens: 0,
        netPnL: 0
      };
    }
    const d = dayMap[trade.dayKey];
    d.trades++;
    if (trade.isWin) d.wins++;
    else if (trade.isLoss) d.losses++;
    else d.breakEvens++;
    d.netPnL += trade.netPnLPct;
  }

  const daysCount = 61; // Aug 1 to Sep 30 inclusive (full 2 months)
  const activeTradingDays = Object.keys(dayMap).length;
  const avgDailyTrades = (totalTrades / daysCount).toFixed(1);
  const avgDailyNetPnL = (totalNetPnL / daysCount).toFixed(2);

  const report = {
    overview: {
      period: '2026-08-01 to 2026-10-01 (61 days)',
      totalCoinsTested: symbolData.length,
      takeProfitPct: `${TP_PCT}%`,
      stopLossPct: `${SL_PCT}%`,
      roundTripFeePct: `${FEE_PCT}%`,
      maxHoldMinutes: 15,
      totalTrades,
      wins,
      losses,
      breakEvens,
      winRate: `${winRate}%`,
      totalNetReturnPct: `${totalNetPnL.toFixed(2)}%`,
      totalGrossReturnPct: `${totalGrossPnL.toFixed(2)}%`,
      totalFeesDeductedPct: `${totalFeesPaid.toFixed(2)}%`,
      profitFactor,
      avgTradeNetPnL: totalTrades > 0 ? `${(totalNetPnL / totalTrades).toFixed(3)}%` : '0%',
      avgDailyTrades,
      avgDailyNetPnL: `${avgDailyNetPnL}%`,
      exitReasons: {
        takeProfitHit: `${tpExits} (${((tpExits / totalTrades) * 100 || 0).toFixed(1)}%)`,
        stopLossHit: `${slExits} (${((slExits / totalTrades) * 100 || 0).toFixed(1)}%)`,
        fifteenMinTimeExpiry: `${timeExits} (${((timeExits / totalTrades) * 100 || 0).toFixed(1)}%)`
      }
    },
    dailyBreakdown: Object.values(dayMap)
  };

  fs.writeFileSync('scratch/backtest_results.json', JSON.stringify(report, null, 2), 'utf8');
  console.log('\n========================================');
  console.log('         BACKTEST SUMMARY REPORT        ');
  console.log('========================================');
  console.log(`Period: 2026-08-01 to 2026-10-01 (61 Days)`);
  console.log(`Coins Tested: ${symbolData.length} Binance Spot Halal pairs`);
  console.log(`Settings: TP = ${TP_PCT}%, SL = ${SL_PCT}%, Max Hold = 15 mins`);
  console.log(`Total Trades: ${totalTrades}`);
  console.log(`Wins: ${wins} | Losses: ${losses} | Break-Even: ${breakEvens}`);
  console.log(`Win Rate: ${winRate}%`);
  console.log(`Total Net Return: ${totalNetPnL.toFixed(2)}% (after ${FEE_PCT}% fees)`);
  console.log(`Profit Factor: ${profitFactor}`);
  console.log(`Avg Daily Trades: ${avgDailyTrades} trades/day`);
  console.log(`Avg Daily Net Return: ${avgDailyNetPnL}% / day`);
  console.log(`Exit Reasons:`);
  console.log(`  - Take Profit: ${tpExits} (${((tpExits / totalTrades) * 100 || 0).toFixed(1)}%)`);
  console.log(`  - Stop Loss: ${slExits} (${((slExits / totalTrades) * 100 || 0).toFixed(1)}%)`);
  console.log(`  - 15m Expiry: ${timeExits} (${((timeExits / totalTrades) * 100 || 0).toFixed(1)}%)`);
  console.log('========================================\n');
}

runBacktest().catch(err => {
  console.error('Backtest error:', err);
});
