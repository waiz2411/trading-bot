import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Top liquid Halal spot coins on Binance
const HALAL_SYMBOLS = [
  'NEARUSDT', 'SUIUSDT', 'APTUSDT', 'SOLUSDT', 'AVAXUSDT',
  'FETUSDT', 'SEIUSDT', 'CKBUSDT', 'STRKUSDT', 'DYMUSDT',
  'ARBUSDT', 'OPUSDT', 'TIAUSDT', 'INJUSDT', 'RENDERUSDT',
  'ICPUSDT', 'ADAUSDT', 'LINKUSDT', 'ALGOUSDT', 'DOTUSDT',
  'FTMUSDT', 'ATOMUSDT', 'SANDUSDT', 'MANAUSDT', 'GALAUSDT'
];

const DATA_CACHE_DIR = path.join(__dirname, 'binance_cache');
if (!fs.existsSync(DATA_CACHE_DIR)) {
  fs.mkdirSync(DATA_CACHE_DIR, { recursive: true });
}

/**
 * Fetch 60 days of historical 15m klines from Binance API with disk caching.
 */
async function fetchBinanceKlines(symbol, interval = '15m', days = 60) {
  const cacheFile = path.join(DATA_CACHE_DIR, `${symbol}_${interval}_${days}d.json`);
  if (fs.existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (Array.isArray(cached) && cached.length > 500) {
        return cached;
      }
    } catch (_) {}
  }

  const endTime = Date.now();
  const startTime = endTime - (days * 24 * 60 * 60 * 1000);
  let currentStart = startTime;
  const allCandles = [];

  console.log(`📡 Fetching ${days}d of ${interval} data from Binance for ${symbol}...`);

  while (currentStart < endTime) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${currentStart}&limit=1000`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`Failed to fetch ${symbol}: ${res.status} ${res.statusText}`);
        break;
      }
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) break;

      for (const k of data) {
        allCandles.push({
          openTime: k[0],
          time: new Date(k[0]).toISOString(),
          open: parseFloat(k[1]),
          high: parseFloat(k[2]),
          low: parseFloat(k[3]),
          close: parseFloat(k[4]),
          volume: parseFloat(k[5]),
          closeTime: k[6],
          quoteVolume: parseFloat(k[7]),
          trades: k[8]
        });
      }

      const lastCandleTime = data[data.length - 1][0];
      if (lastCandleTime <= currentStart) break;
      currentStart = lastCandleTime + 1;

      // Gentle rate-limit pause
      await new Promise(r => setTimeout(r, 120));
    } catch (err) {
      console.warn(`Error fetching ${symbol}: ${err.message}`);
      break;
    }
  }

  // Deduplicate by openTime
  const uniqueMap = new Map();
  for (const c of allCandles) {
    uniqueMap.set(c.openTime, c);
  }
  const cleanCandles = Array.from(uniqueMap.values()).sort((a, b) => a.openTime - b.openTime);

  if (cleanCandles.length > 0) {
    fs.writeFileSync(cacheFile, JSON.stringify(cleanCandles), 'utf8');
  }
  return cleanCandles;
}

/**
 * Pump Momentum Scalper Strategy Simulation
 */
function runBacktest(allCoinData, params = {}) {
  const {
    takeProfitPct = 2.0,       // Target +2.0%
    stopLossPct = 0.9,         // Tight -0.9% SL
    breakEvenTriggerPct = 1.0, // Ratchet at +1.0%
    breakEvenLockPct = 0.35,   // Lock +0.35% (guarantees profit above fees)
    trailingTriggerPct = 1.5,  // Trailing stop activates at +1.5%
    trailingDistancePct = 0.5, // Trails 0.5% behind high
    volumeMultiplier = 2.2,    // Volume must be >= 2.2x 20 SMA
    minCandleGainPct = 1.2,    // Candle must have gained >= +1.2%
    maxCandleGainPct = 4.5,    // Avoid candles that already pumped > 4.5% (climax risk)
    feeRate = 0.00075,         // Binance 0.075% fee per side (0.15% roundtrip)
    startingBalance = 100,     // Normalized starting balance
    maxPositions = 1           // 1 position at a time (pure spot allocation)
  } = params;

  // Align timestamps across all coins
  const allTimestamps = new Set();
  for (const [sym, candles] of Object.entries(allCoinData)) {
    for (let i = 25; i < candles.length; i++) {
      allTimestamps.add(candles[i].openTime);
    }
  }
  const sortedTimes = Array.from(allTimestamps).sort((a, b) => a - b);

  let balance = startingBalance;
  let peakBalance = startingBalance;
  let maxDrawdownPct = 0;
  const closedTrades = [];
  const openPositions = [];

  for (const t of sortedTimes) {
    // 1. Manage existing open positions on current bar
    for (let i = openPositions.length - 1; i >= 0; i--) {
      const pos = openPositions[i];
      const candle = allCoinData[pos.symbol]?.find(c => c.openTime === t);
      if (!candle) continue;

      pos.highestPrice = Math.max(pos.highestPrice, candle.high);
      pos.barsHeld++;

      const peakGainPct = ((pos.highestPrice - pos.entryPrice) / pos.entryPrice) * 100;

      // Break-even lock
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

      // Take profit hit
      if (candle.high >= pos.takeProfit) {
        exitPrice = pos.takeProfit;
        exitReason = 'TAKE_PROFIT';
      }
      // Stop loss hit
      else if (candle.low <= pos.stopLoss) {
        exitPrice = pos.stopLoss;
        exitReason = pos.isTrailing ? 'TRAILING_STOP' : (pos.isBreakEven ? 'BREAKEVEN_STOP' : 'STOP_LOSS');
      }
      // Time cap (4 hours = 16 15m bars)
      else if (pos.barsHeld >= 16) {
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

    // 2. Scan for new pump signals if position slot is available
    if (openPositions.length < maxPositions && balance >= 5.0) {
      const candidates = [];

      for (const [sym, candles] of Object.entries(allCoinData)) {
        // Find current candle index
        const idx = candles.findIndex(c => c.openTime === t);
        if (idx < 25) continue;

        const current = candles[idx];
        const prev = candles[idx - 1];

        // Must be green candle
        if (current.close <= current.open) continue;

        // Current candle percentage gain
        const candleGainPct = ((current.close - current.open) / current.open) * 100;
        if (candleGainPct < minCandleGainPct || candleGainPct > maxCandleGainPct) continue;

        // Volume explosion check (vs 20-period average volume)
        const recentVols = candles.slice(idx - 20, idx).map(c => c.volume);
        const avgVol = recentVols.reduce((a, b) => a + b, 0) / recentVols.length;
        const rvol = avgVol > 0 ? current.volume / avgVol : 1;
        if (rvol < volumeMultiplier) continue;

        // Strong close near the high (bullish conviction, minimal upper wick)
        const range = current.high - current.low;
        const closeOffLow = current.close - current.low;
        const closeRatio = range > 0 ? closeOffLow / range : 0;
        if (closeRatio < 0.65) continue;

        // Breakout of recent 15-period high
        const recentHighs = candles.slice(idx - 15, idx).map(c => c.high);
        const maxPrevHigh = Math.max(...recentHighs);
        if (current.close < maxPrevHigh * 0.998) continue;

        candidates.push({
          symbol: sym,
          candle: current,
          rvol,
          candleGainPct,
          score: rvol * candleGainPct
        });
      }

      if (candidates.length > 0) {
        // Pick the single strongest pump ignition
        candidates.sort((a, b) => b.score - a.score);
        const pick = candidates[0];

        const notional = Math.floor(balance * 100) / 100;
        const entryPrice = pick.candle.close;
        const units = notional / entryPrice;
        const takeProfit = entryPrice * (1 + takeProfitPct / 100);
        const stopLoss = entryPrice * (1 - stopLossPct / 100);

        balance -= notional; // Allocate 100% of cash

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

  // Calculate detailed statistics
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
  const avgTradePct = totalTrades > 0 ? closedTrades.reduce((a, t) => a + t.pnlPct, 0) / totalTrades : 0;

  return {
    params,
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
    avgTradePct: Number(avgTradePct.toFixed(2)),
    tpCount: closedTrades.filter(t => t.exitReason === 'TAKE_PROFIT').length,
    trailCount: closedTrades.filter(t => t.exitReason === 'TRAILING_STOP').length,
    beCount: closedTrades.filter(t => t.exitReason === 'BREAKEVEN_STOP').length,
    slCount: closedTrades.filter(t => t.exitReason === 'STOP_LOSS').length,
    timeCapCount: closedTrades.filter(t => t.exitReason === 'TIME_CAP').length,
    sampleTrades: closedTrades.slice(-10)
  };
}

async function main() {
  console.log('========================================================================');
  console.log('🚀 BINANCE 60-DAY HISTORICAL BACKTEST: REAL-TIME PUMP MOMENTUM SCALPER');
  console.log('========================================================================\n');

  const allCoinData = {};
  for (const sym of HALAL_SYMBOLS) {
    const candles = await fetchBinanceKlines(sym, '15m', 60);
    if (candles.length > 500) {
      allCoinData[sym] = candles;
      console.log(`✅ Loaded ${candles.length} 15m candles for ${sym} (from ${candles[0].time.slice(0, 10)} to ${candles[candles.length - 1].time.slice(0, 10)})`);
    }
  }

  const coinCount = Object.keys(allCoinData).length;
  console.log(`\n📊 Total Halal coins ready for backtesting: ${coinCount}\n`);

  // Run backtests across different parameter combinations to find the highest-edge geometry
  const configs = [
    { name: 'Aggressive Scalp', tp: 1.8, sl: 0.8, be: 1.0, beLock: 0.35, trail: 1.4, trailDist: 0.4, rvol: 2.2, minGain: 1.2 },
    { name: 'Standard Momentum', tp: 2.2, sl: 0.9, be: 1.2, beLock: 0.40, trail: 1.7, trailDist: 0.5, rvol: 2.5, minGain: 1.4 },
    { name: 'High-Volume Breakout', tp: 2.5, sl: 1.0, be: 1.3, beLock: 0.45, trail: 2.0, trailDist: 0.5, rvol: 2.8, minGain: 1.5 },
    { name: 'Ultra-Tight Scalp', tp: 1.5, sl: 0.7, be: 0.9, beLock: 0.30, trail: 1.2, trailDist: 0.35, rvol: 2.0, minGain: 1.0 }
  ];

  const results = [];

  for (const cfg of configs) {
    const res = runBacktest(allCoinData, {
      takeProfitPct: cfg.tp,
      stopLossPct: cfg.sl,
      breakEvenTriggerPct: cfg.be,
      breakEvenLockPct: cfg.beLock,
      trailingTriggerPct: cfg.trail,
      trailingDistancePct: cfg.trailDist,
      volumeMultiplier: cfg.rvol,
      minCandleGainPct: cfg.minGain,
      feeRate: 0.00075,
      startingBalance: 100
    });
    res.configName = cfg.name;
    results.push(res);
  }

  console.log('\n========================================================================');
  console.log('📈 BACKTEST RESULTS ACROSS 60 DAYS (REAL BINANCE DATA):');
  console.log('========================================================================\n');

  for (const r of results) {
    console.log(`--- [${r.configName}] ---`);
    console.log(`Target: +${r.params.takeProfitPct}% | Stop: -${r.params.stopLossPct}% | RVOL: >=${r.params.volumeMultiplier}x`);
    console.log(`Total Trades: ${r.totalTrades} | Win Rate: ${r.winRate}% (Wins: ${r.wins}, Losses: ${r.losses})`);
    console.log(`Net Return: +${r.netReturnPct}% ($${r.startingBalance} -> $${r.finalBalance})`);
    console.log(`Profit Factor: ${r.profitFactor} | Max Drawdown: ${r.maxDrawdownPct}%`);
    console.log(`Avg Win: +${r.avgWinPct}% | Avg Loss: ${r.avgLossPct}% | Avg Trade: +${r.avgTradePct}%`);
    console.log(`Exits -> TP: ${r.tpCount}, Trailing: ${r.trailCount}, BE Lock: ${r.beCount}, SL: ${r.slCount}, Time: ${r.timeCapCount}\n`);
  }

  // Save results to file
  fs.writeFileSync(
    path.join(__dirname, 'pump_backtest_60d_results.json'),
    JSON.stringify(results, null, 2),
    'utf8'
  );
  console.log('💾 Results saved to scratch/pump_backtest_60d_results.json');
}

main().catch(console.error);
