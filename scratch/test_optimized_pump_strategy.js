import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_CACHE_DIR = path.join(__dirname, 'binance_cache');

// Load cached data
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

// Calculate EMA
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

function runAdvancedPumpBacktest(allCoinData, options = {}) {
  const {
    takeProfitPct = 2.5,
    stopLossPct = 1.0,
    breakEvenTriggerPct = 1.2,
    breakEvenLockPct = 0.4,
    trailingTriggerPct = 1.8,
    trailingDistancePct = 0.6,
    rvolThreshold = 2.0,
    minGain = 1.0,
    maxGain = 4.0,
    useTrendFilter = true,     // Price > EMA50
    useConsolidationFilter = true, // Low volatility before pump
    maxPositions = 1,
    feeRate = 0.00075,
    startingBalance = 100
  } = options;

  // Precalculate EMAs for all coins
  const indicators = {};
  for (const [sym, candles] of Object.entries(allCoinData)) {
    const closes = candles.map(c => c.close);
    const ema20 = calcEMA(closes, 20);
    const ema50 = calcEMA(closes, 50);
    indicators[sym] = { ema20, ema50 };
  }

  // BTC reference
  const btcCandles = allCoinData['BTCUSDT'] || allCoinData[Object.keys(allCoinData)[0]];

  // Timestamps
  const sortedTimes = btcCandles.slice(55).map(c => c.openTime);

  let balance = startingBalance;
  let peakBalance = startingBalance;
  let maxDrawdownPct = 0;
  const closedTrades = [];
  const openPositions = [];

  for (const t of sortedTimes) {
    // 1. Manage open positions
    for (let i = openPositions.length - 1; i >= 0; i--) {
      const pos = openPositions[i];
      const candle = allCoinData[pos.symbol]?.find(c => c.openTime === t);
      if (!candle) continue;

      pos.highestPrice = Math.max(pos.highestPrice, candle.high);
      pos.barsHeld++;

      const peakGainPct = ((pos.highestPrice - pos.entryPrice) / pos.entryPrice) * 100;

      // Break-even ratchet
      if (peakGainPct >= breakEvenTriggerPct) {
        const bePrice = pos.entryPrice * (1 + breakEvenLockPct / 100);
        if (bePrice > pos.stopLoss) {
          pos.stopLoss = bePrice;
          pos.isBreakEven = true;
        }
      }

      // Trailing stop
      if (peakGainPct >= trailingTriggerPct) {
        const trailPrice = pos.highestPrice * (1 - trailingDistancePct / 100);
        if (trailPrice > pos.stopLoss) {
          pos.stopLoss = trailPrice;
          pos.isTrailing = true;
        }
      }

      let exitPrice = null;
      let exitReason = null;

      if (candle.high >= pos.takeProfit) {
        exitPrice = pos.takeProfit;
        exitReason = 'TAKE_PROFIT';
      } else if (candle.low <= pos.stopLoss) {
        exitPrice = pos.stopLoss;
        exitReason = pos.isTrailing ? 'TRAILING_STOP' : (pos.isBreakEven ? 'BREAKEVEN_STOP' : 'STOP_LOSS');
      } else if (pos.barsHeld >= 16) {
        exitPrice = candle.close;
        exitReason = 'TIME_CAP';
      }

      if (exitPrice !== null) {
        const grossPnL = (exitPrice - pos.entryPrice) * pos.units;
        const entryFee = pos.notional * feeRate;
        const exitFee = (pos.units * exitPrice) * feeRate;
        const netPnL = grossPnL - entryFee - exitFee;
        const netPnLPct = (netPnL / pos.notional) * 100;

        balance += pos.notional + netPnL;
        if (balance > peakBalance) peakBalance = balance;
        const dd = ((peakBalance - balance) / peakBalance) * 100;
        if (dd > maxDrawdownPct) maxDrawdownPct = dd;

        closedTrades.push({
          symbol: pos.symbol,
          entryTime: pos.entryTime,
          exitTime: candle.time,
          entryPrice: pos.entryPrice,
          exitPrice,
          pnl: netPnL,
          pnlPct: netPnLPct,
          exitReason,
          barsHeld: pos.barsHeld,
          balanceAfter: balance
        });

        openPositions.splice(i, 1);
      }
    }

    // 2. Scan for pump setups
    if (openPositions.length < maxPositions && balance >= 5.0) {
      const candidates = [];

      for (const [sym, candles] of Object.entries(allCoinData)) {
        if (sym === 'BTCUSDT') continue;

        const idx = candles.findIndex(c => c.openTime === t);
        if (idx < 50) continue;

        const current = candles[idx];
        if (current.close <= current.open) continue;

        const candleGainPct = ((current.close - current.open) / current.open) * 100;
        if (candleGainPct < minGain || candleGainPct > maxGain) continue;

        // Trend filter: Must be above EMA 50 (no trading dead-cat dumps)
        const { ema20, ema50 } = indicators[sym];
        if (useTrendFilter) {
          if (current.close < ema50[idx] || ema20[idx] < ema50[idx]) continue;
        }

        // RVOL volume explosion
        const recentVols = candles.slice(idx - 20, idx).map(c => c.volume);
        const avgVol = recentVols.reduce((a, b) => a + b, 0) / recentVols.length;
        const rvol = avgVol > 0 ? current.volume / avgVol : 1;
        if (rvol < rvolThreshold) continue;

        // Strong close near candle high
        const range = current.high - current.low;
        const closeRatio = range > 0 ? (current.close - current.low) / range : 0;
        if (closeRatio < 0.70) continue;

        // Consolidation breakout: past 10 bars were tight (< 3.5% range)
        if (useConsolidationFilter) {
          const past10Highs = candles.slice(idx - 10, idx).map(c => c.high);
          const past10Lows = candles.slice(idx - 10, idx).map(c => c.low);
          const maxH = Math.max(...past10Highs);
          const minL = Math.min(...past10Lows);
          const tightRange = ((maxH - minL) / minL) * 100;
          if (tightRange > 4.5) continue; // Must be breaking out from tight base!
        }

        candidates.push({
          symbol: sym,
          candle: current,
          rvol,
          candleGainPct,
          score: rvol * candleGainPct
        });
      }

      if (candidates.length > 0) {
        candidates.sort((a, b) => b.score - a.score);
        const pick = candidates[0];

        const notional = Math.floor(balance * 100) / 100;
        const entryPrice = pick.candle.close;
        const units = notional / entryPrice;
        const takeProfit = entryPrice * (1 + takeProfitPct / 100);
        const stopLoss = entryPrice * (1 - stopLossPct / 100);

        balance -= notional;

        openPositions.push({
          symbol: pick.symbol,
          entryTime: pick.candle.time,
          entryPrice,
          units,
          notional,
          takeProfit,
          stopLoss,
          highestPrice: entryPrice,
          barsHeld: 0,
          isBreakEven: false,
          isTrailing: false
        });
      }
    }
  }

  const totalTrades = closedTrades.length;
  const wins = closedTrades.filter(t => t.pnl > 0);
  const losses = closedTrades.filter(t => t.pnl <= 0);
  const winRate = totalTrades > 0 ? (wins.length / totalTrades) * 100 : 0;

  const totalWon = wins.reduce((acc, t) => acc + t.pnl, 0);
  const totalLost = Math.abs(losses.reduce((acc, t) => acc + t.pnl, 0));
  const profitFactor = totalLost > 0 ? totalWon / totalLost : (totalWon > 0 ? 999 : 0);
  const netProfit = balance - startingBalance;
  const netReturnPct = (netProfit / startingBalance) * 100;

  const avgWinPct = wins.length > 0 ? wins.reduce((a, t) => a + t.pnlPct, 0) / wins.length : 0;
  const avgLossPct = losses.length > 0 ? losses.reduce((a, t) => a + t.pnlPct, 0) / losses.length : 0;

  return {
    options,
    startingBalance,
    finalBalance: Number(balance.toFixed(2)),
    netProfit: Number(netProfit.toFixed(2)),
    netReturnPct: Number(netReturnPct.toFixed(2)),
    totalTrades,
    wins: wins.length,
    losses: losses.length,
    winRate: Number(winRate.toFixed(1)),
    profitFactor: Number(profitFactor.toFixed(2)),
    maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
    avgWinPct: Number(avgWinPct.toFixed(2)),
    avgLossPct: Number(avgLossPct.toFixed(2)),
    tpCount: closedTrades.filter(t => t.exitReason === 'TAKE_PROFIT').length,
    trailCount: closedTrades.filter(t => t.exitReason === 'TRAILING_STOP').length,
    beCount: closedTrades.filter(t => t.exitReason === 'BREAKEVEN_STOP').length,
    slCount: closedTrades.filter(t => t.exitReason === 'STOP_LOSS').length,
    timeCapCount: closedTrades.filter(t => t.exitReason === 'TIME_CAP').length,
    sampleTrades: closedTrades.slice(-10)
  };
}

const allData = loadAllCachedData();
console.log(`Loaded ${Object.keys(allData).length} cached Halal coins.`);

const variations = [
  { name: 'Trend Base Breakout (TP 2.2%, SL 0.9%)', tp: 2.2, sl: 0.9, be: 1.1, beLock: 0.35, trail: 1.6, trailDist: 0.45, rvol: 2.2, minGain: 1.2, trend: true, base: true },
  { name: 'Trend Base Breakout (TP 2.5%, SL 1.0%)', tp: 2.5, sl: 1.0, be: 1.2, beLock: 0.40, trail: 1.8, trailDist: 0.50, rvol: 2.4, minGain: 1.3, trend: true, base: true },
  { name: 'Trend Base Breakout (TP 3.0%, SL 1.1%)', tp: 3.0, sl: 1.1, be: 1.3, beLock: 0.45, trail: 2.0, trailDist: 0.60, rvol: 2.5, minGain: 1.4, trend: true, base: true },
  { name: 'Pure Momentum without Base (TP 2.2%, SL 0.9%)', tp: 2.2, sl: 0.9, be: 1.1, beLock: 0.35, trail: 1.6, trailDist: 0.45, rvol: 2.2, minGain: 1.2, trend: true, base: false }
];

console.log('\n========================================================================');
console.log('🔬 ADVANCED PUMP MOMENTUM BACKTEST RESULTS (60 DAYS - REAL BINANCE DATA)');
console.log('========================================================================\n');

for (const v of variations) {
  const res = runAdvancedPumpBacktest(allData, {
    takeProfitPct: v.tp,
    stopLossPct: v.sl,
    breakEvenTriggerPct: v.be,
    breakEvenLockPct: v.beLock,
    trailingTriggerPct: v.trail,
    trailingDistancePct: v.trailDist,
    rvolThreshold: v.rvol,
    minGain: v.minGain,
    useTrendFilter: v.trend,
    useConsolidationFilter: v.base,
    feeRate: 0.00075,
    startingBalance: 100
  });

  console.log(`--- [${v.name}] ---`);
  console.log(`Trades: ${res.totalTrades} | Win Rate: ${res.winRate}% (Wins: ${res.wins}, Losses: ${res.losses})`);
  console.log(`Net Return: ${res.netReturnPct >= 0 ? '+' : ''}${res.netReturnPct}% ($${res.startingBalance} -> $${res.finalBalance})`);
  console.log(`Profit Factor: ${res.profitFactor} | Max Drawdown: ${res.maxDrawdownPct}%`);
  console.log(`Avg Win: +${res.avgWinPct}% | Avg Loss: ${res.avgLossPct}%`);
  console.log(`Exits -> TP: ${res.tpCount}, Trailing: ${res.trailCount}, BE Lock: ${res.beCount}, SL: ${res.slCount}, Time: ${res.timeCapCount}\n`);
}
