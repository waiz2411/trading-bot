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
const btcCandles = allData['BTCUSDT'] || allData[Object.keys(allData)[0]];

function calcEMA(values, period) {
  const k = 2 / (period + 1);
  const ema = new Array(values.length);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  ema[period - 1] = sum / period;
  for (let i = period; i < values.length; i++) {
    ema[i] = values[i] * k + ema[i - 1] * (1 - k);
  }
  return ema;
}

// Pre-calculate EMAs
const indicators = {};
for (const [sym, candles] of Object.entries(allData)) {
  const closes = candles.map(c => c.close);
  indicators[sym] = {
    ema20: calcEMA(closes, 20),
    ema50: calcEMA(closes, 50)
  };
}

const btcCloses = btcCandles.map(c => c.close);
const btcEma20 = calcEMA(btcCloses, 20);

/**
 * High-Precision Bar-by-Bar Backtest of the Updated Real-Time Pump Scalper
 */
function runPreciseBacktest(params) {
  const {
    name = 'Updated System',
    takeProfitPct = 1.10,        // +1.10% Target
    stopLossPct = 0.55,          // -0.55% Stop Loss
    breakEvenTriggerPct = 0.70,  // +0.70% BE Trigger
    breakEvenLockPct = 0.25,    // +0.25% BE Net Lock
    trailingTriggerPct = 0.95,   // +0.95% Trailing Trigger
    trailingDistancePct = 0.25,  // Trails 0.25%
    minGain = 0.8,              // Min candle expansion %
    maxGain = 4.0,              // Max candle expansion %
    rvolThreshold = 1.8,        // Relative volume >= 1.8x
    requireStrongBody = true,   // Close in top 30% of candle
    requireTrend = true,        // Above EMA 50
    requireBtcHealthy = false,  // BTC check
    maxHoldBars = 6,            // 6 x 15m = 90 mins max hold
    feeRate = 0.00075,          // Binance 0.075% fee per side
    startingBalance = 100
  } = params;

  let balance = startingBalance;
  let peakBalance = startingBalance;
  let maxDD = 0;
  const closedTrades = [];
  let currentPos = null;

  for (let tIdx = 35; tIdx < btcCandles.length; tIdx++) {
    const t = btcCandles[tIdx].openTime;
    const isBtcHealthy = btcCandles[tIdx].close >= btcEma20[tIdx] * 0.998;

    // 1. Position Management
    if (currentPos) {
      const candle = allData[currentPos.symbol]?.find(c => c.openTime === t);
      if (!candle) continue;

      currentPos.barsHeld++;
      currentPos.highestPrice = Math.max(currentPos.highestPrice, candle.high);
      currentPos.lowestPrice = Math.min(currentPos.lowestPrice, candle.low);

      const peakGainPct = ((currentPos.highestPrice - currentPos.entryPrice) / currentPos.entryPrice) * 100;

      // Break-even lock
      if (peakGainPct >= breakEvenTriggerPct) {
        const bePrice = currentPos.entryPrice * (1 + breakEvenLockPct / 100);
        if (bePrice > currentPos.stopLoss) {
          currentPos.stopLoss = bePrice;
          currentPos.isBreakEven = true;
        }
      }

      // Trailing stop
      if (peakGainPct >= trailingTriggerPct) {
        const trailPrice = currentPos.highestPrice * (1 - trailingDistancePct / 100);
        if (trailPrice > currentPos.stopLoss) {
          currentPos.stopLoss = trailPrice;
          currentPos.isTrailing = true;
        }
      }

      let exitPrice = null;
      let exitReason = null;

      // TP Trigger
      if (candle.high >= currentPos.takeProfit) {
        exitPrice = currentPos.takeProfit;
        exitReason = 'TAKE_PROFIT';
      }
      // SL / BE / Trailing Trigger
      else if (candle.low <= currentPos.stopLoss) {
        exitPrice = currentPos.stopLoss;
        exitReason = currentPos.isTrailing
          ? 'TRAILING_STOP'
          : (currentPos.isBreakEven ? 'BREAKEVEN_LOCK' : 'STOP_LOSS');
      }
      // Max Hold Time Expiry
      else if (currentPos.barsHeld >= maxHoldBars) {
        exitPrice = candle.close;
        exitReason = 'TIME_CAP';
      }

      if (exitPrice !== null) {
        const grossPct = ((exitPrice - currentPos.entryPrice) / currentPos.entryPrice) * 100;
        const totalFeesPct = feeRate * 2 * 100; // 0.15% roundtrip
        const netPct = grossPct - totalFeesPct;
        const dollarPnL = balance * (netPct / 100);

        balance += dollarPnL;
        if (balance > peakBalance) peakBalance = balance;
        const dd = ((peakBalance - balance) / peakBalance) * 100;
        if (dd > maxDD) maxDD = dd;

        const durationMinutes = currentPos.barsHeld * 15;

        closedTrades.push({
          symbol: currentPos.symbol,
          entryTime: currentPos.entryTime,
          exitTime: candle.time,
          entryPrice: currentPos.entryPrice,
          exitPrice,
          pnlPct: Number(netPct.toFixed(2)),
          pnlDollar: Number(dollarPnL.toFixed(3)),
          exitReason,
          durationMinutes,
          balanceAfter: Number(balance.toFixed(2))
        });

        currentPos = null;
      }
    } else {
      // 2. Scan for Real-Time Pumping Coins
      if (requireBtcHealthy && !isBtcHealthy) continue;

      const candidates = [];

      for (const [sym, candles] of Object.entries(allData)) {
        if (sym === 'BTCUSDT') continue;

        const idx = candles.findIndex(c => c.openTime === t);
        if (idx < 25) continue;

        const cur = candles[idx];
        const prev = candles[idx - 1];

        // Must be green candle
        if (cur.close <= cur.open) continue;

        const gain = ((cur.close - cur.open) / cur.open) * 100;
        if (gain < minGain || gain > maxGain) continue;

        // Relative volume
        const vols = candles.slice(idx - 20, idx).map(c => c.volume);
        const avgVol = vols.reduce((a, b) => a + b, 0) / vols.length;
        const rvol = avgVol > 0 ? cur.volume / avgVol : 1;
        if (rvol < rvolThreshold) continue;

        // Strong close near the high
        const range = cur.high - cur.low;
        const closeRatio = range > 0 ? (cur.close - cur.low) / range : 1;
        if (requireStrongBody && closeRatio < 0.65) continue;

        // Trend filter
        if (requireTrend) {
          const { ema50 } = indicators[sym];
          if (cur.close < ema50[idx]) continue;
        }

        const score = rvol * gain;
        candidates.push({
          symbol: sym,
          candle: cur,
          entryPrice: cur.close,
          score
        });
      }

      if (candidates.length > 0) {
        candidates.sort((a, b) => b.score - a.score);
        const best = candidates[0];

        currentPos = {
          symbol: best.symbol,
          entryPrice: best.entryPrice,
          entryTime: best.candle.time,
          takeProfit: best.entryPrice * (1 + takeProfitPct / 100),
          stopLoss: best.entryPrice * (1 - stopLossPct / 100),
          highestPrice: best.entryPrice,
          lowestPrice: best.entryPrice,
          barsHeld: 0,
          isBreakEven: false,
          isTrailing: false
        };
      }
    }
  }

  // Calculate final stats
  const totalTrades = closedTrades.length;
  const wins = closedTrades.filter(t => t.pnlPct > 0);
  const losses = closedTrades.filter(t => t.pnlPct <= 0);
  const winRate = totalTrades > 0 ? (wins.length / totalTrades) * 100 : 0;

  const totalWon = wins.reduce((acc, t) => acc + t.pnlDollar, 0);
  const totalLost = Math.abs(losses.reduce((acc, t) => acc + t.pnlDollar, 0));
  const profitFactor = totalLost > 0 ? totalWon / totalLost : (totalWon > 0 ? 999 : 0);
  const netReturnPct = ((balance - startingBalance) / startingBalance) * 100;

  const avgWinPct = wins.length > 0 ? wins.reduce((acc, t) => acc + t.pnlPct, 0) / wins.length : 0;
  const avgLossPct = losses.length > 0 ? losses.reduce((acc, t) => acc + t.pnlPct, 0) / losses.length : 0;

  // Average trade duration in minutes
  const avgDurationMinutes = totalTrades > 0
    ? closedTrades.reduce((acc, t) => acc + t.durationMinutes, 0) / totalTrades
    : 0;

  return {
    name,
    params,
    totalTrades,
    wins: wins.length,
    losses: losses.length,
    winRate: Number(winRate.toFixed(1)),
    profitFactor: Number(profitFactor.toFixed(2)),
    netReturnPct: Number(netReturnPct.toFixed(2)),
    maxDrawdownPct: Number(maxDD.toFixed(1)),
    avgDurationMinutes: Number(avgDurationMinutes.toFixed(1)),
    avgWinPct: Number(avgWinPct.toFixed(2)),
    avgLossPct: Number(avgLossPct.toFixed(2)),
    tpCount: closedTrades.filter(t => t.exitReason === 'TAKE_PROFIT').length,
    trailCount: closedTrades.filter(t => t.exitReason === 'TRAILING_STOP').length,
    beCount: closedTrades.filter(t => t.exitReason === 'BREAKEVEN_LOCK').length,
    slCount: closedTrades.filter(t => t.exitReason === 'STOP_LOSS').length,
    timeCapCount: closedTrades.filter(t => t.exitReason === 'TIME_CAP').length,
    recentTrades: closedTrades.slice(-15)
  };
}

console.log('========================================================================');
console.log('🔬 REAL-TIME PUMP MOMENTUM SCALPER: 60-DAY BINANCE HISTORICAL BACKTEST');
console.log('========================================================================\n');

// 1. Current Deployed Version (+1.10% TP / -0.55% SL)
const testCurrent = runPreciseBacktest({
  name: 'Updated Deployed Version (+1.10% TP / -0.55% SL)',
  takeProfitPct: 1.10,
  stopLossPct: 0.55,
  breakEvenTriggerPct: 0.70,
  breakEvenLockPct: 0.25,
  trailingTriggerPct: 0.95,
  trailingDistancePct: 0.25,
  rvolThreshold: 1.6,
  minGain: 0.8,
  requireTrend: true,
  maxHoldBars: 4 // 1 hour max hold
});

// 2. High-Probability 75%+ Win-Rate Target Model (+0.85% TP / -0.50% SL)
const testHighWinRate = runPreciseBacktest({
  name: 'Ultra-High Win Rate Scalper (+0.85% TP / -0.50% SL)',
  takeProfitPct: 0.85,
  stopLossPct: 0.50,
  breakEvenTriggerPct: 0.55,
  breakEvenLockPct: 0.20,
  trailingTriggerPct: 0.75,
  trailingDistancePct: 0.20,
  rvolThreshold: 1.8,
  minGain: 0.8,
  requireTrend: true,
  maxHoldBars: 4 // 1 hour max hold
});

// 3. Sniper Momentum Model (+0.95% TP / -0.55% SL, RVOL >= 2.0x)
const testSniper = runPreciseBacktest({
  name: 'Sniper Momentum Scalper (+0.95% TP / -0.55% SL)',
  takeProfitPct: 0.95,
  stopLossPct: 0.55,
  breakEvenTriggerPct: 0.60,
  breakEvenLockPct: 0.22,
  trailingTriggerPct: 0.80,
  trailingDistancePct: 0.20,
  rvolThreshold: 2.0,
  minGain: 1.0,
  requireTrend: true,
  maxHoldBars: 4
});

const suite = [testCurrent, testHighWinRate, testSniper];

for (const t of suite) {
  console.log(`------------------------------------------------------------------------`);
  console.log(`📊 ${t.name}`);
  console.log(`------------------------------------------------------------------------`);
  console.log(`Target: +${t.params.takeProfitPct}% | Stop: -${t.params.stopLossPct}% | RVOL: >=${t.params.rvolThreshold}x`);
  console.log(`Total Trades (60 Days): ${t.totalTrades}`);
  console.log(`Wins: ${t.wins} | Losses: ${t.losses} | WIN RATE: ${t.winRate}%`);
  console.log(`Net Return (60 Days): ${t.netReturnPct >= 0 ? '+' : ''}${t.netReturnPct}% | Profit Factor: ${t.profitFactor}`);
  console.log(`Average Holding Duration: ${t.avgDurationMinutes} minutes (${(t.avgDurationMinutes / 60).toFixed(1)} hours)`);
  console.log(`Average Win: +${t.avgWinPct}% | Average Loss: ${t.avgLossPct}%`);
  console.log(`Max Drawdown: ${t.maxDrawdownPct}%`);
  console.log(`Exit Breakdown -> TP Hit: ${t.tpCount} | Trailing Profit: ${t.trailCount} | Break-Even Lock: ${t.beCount} | Stop Loss: ${t.slCount} | Time Cap: ${t.timeCapCount}\n`);
}

fs.writeFileSync(path.join(__dirname, 'precise_backtest_results.json'), JSON.stringify(suite, null, 2));
console.log('✅ Backtest completed and saved to scratch/precise_backtest_results.json');
