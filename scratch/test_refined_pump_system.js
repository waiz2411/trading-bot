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

const btcCloses = btcCandles.map(c => c.close);
const btcEma20 = calcEMA(btcCloses, 20);

function testPumpSystem(options) {
  const {
    tp = 1.1,
    sl = 0.55,
    beTrigger = 0.75,
    beLock = 0.25,
    trailTrigger = 0.95,
    trailDist = 0.25,
    minGain = 1.0,
    rvol = 2.2,
    requireBtcBull = true,
    requireConsecutiveGreen = true,
    feeRate = 0.00075
  } = options;

  const sortedTimes = btcCandles.slice(30).map(c => c.openTime);

  let balance = 100;
  let peakBalance = 100;
  let maxDD = 0;
  let wins = 0;
  let losses = 0;
  let totalTrades = 0;
  let totalWon = 0;
  let totalLost = 0;

  const closedTrades = [];
  let currentPos = null;

  for (let tIdx = 30; tIdx < btcCandles.length; tIdx++) {
    const t = btcCandles[tIdx].openTime;
    const isBtcBull = btcCandles[tIdx].close >= btcEma20[tIdx];

    if (currentPos) {
      const candle = allData[currentPos.symbol]?.find(c => c.openTime === t);
      if (!candle) continue;

      currentPos.high = Math.max(currentPos.high, candle.high);
      const peakGain = ((currentPos.high - currentPos.entry) / currentPos.entry) * 100;

      if (peakGain >= beTrigger) {
        const beP = currentPos.entry * (1 + beLock / 100);
        if (beP > currentPos.sl) {
          currentPos.sl = beP;
          currentPos.isBE = true;
        }
      }
      if (peakGain >= trailTrigger) {
        const trP = currentPos.high * (1 - trailDist / 100);
        if (trP > currentPos.sl) {
          currentPos.sl = trP;
          currentPos.isTrail = true;
        }
      }

      let exit = null;
      let exitReason = null;
      if (candle.high >= currentPos.tp) {
        exit = currentPos.tp;
        exitReason = 'TAKE_PROFIT';
      } else if (candle.low <= currentPos.sl) {
        exit = currentPos.sl;
        exitReason = currentPos.isTrail ? 'TRAILING_STOP' : (currentPos.isBE ? 'BREAKEVEN' : 'STOP_LOSS');
      } else if (++currentPos.bars >= 8) {
        exit = candle.close;
        exitReason = 'TIME_CAP';
      }

      if (exit !== null) {
        const pnlPct = ((exit - currentPos.entry) / currentPos.entry) * 100 - (feeRate * 2 * 100);
        const dollarPnL = balance * (pnlPct / 100);
        balance += dollarPnL;
        if (balance > peakBalance) peakBalance = balance;
        const dd = ((peakBalance - balance) / peakBalance) * 100;
        if (dd > maxDD) maxDD = dd;

        totalTrades++;
        if (dollarPnL > 0) {
          wins++;
          totalWon += dollarPnL;
        } else {
          losses++;
          totalLost += Math.abs(dollarPnL);
        }

        closedTrades.push({
          symbol: currentPos.symbol,
          entryTime: currentPos.entryTime,
          exitTime: candle.time,
          entryPrice: currentPos.entry,
          exitPrice: exit,
          pnlPct,
          exitReason,
          balanceAfter: Number(balance.toFixed(2))
        });

        currentPos = null;
      }
    } else {
      if (requireBtcBull && !isBtcBull) continue; // BTC filter

      const candidates = [];
      for (const [sym, candles] of Object.entries(allData)) {
        if (sym === 'BTCUSDT') continue;
        const idx = candles.findIndex(c => c.openTime === t);
        if (idx < 25) continue;
        const cur = candles[idx];
        const prev = candles[idx - 1];

        // Must be green candle
        if (cur.close <= cur.open) continue;
        if (requireConsecutiveGreen && prev.close <= prev.open) continue;

        const gain = ((cur.close - cur.open) / cur.open) * 100;
        if (gain < minGain) continue;

        const vols = candles.slice(idx - 20, idx).map(c => c.volume);
        const avg = vols.reduce((a, b) => a + b, 0) / vols.length;
        const rv = avg > 0 ? cur.volume / avg : 1;
        if (rv < rvol) continue;

        candidates.push({
          sym,
          entry: cur.close,
          time: cur.time,
          score: rv * gain
        });
      }

      if (candidates.length > 0) {
        candidates.sort((a, b) => b.score - a.score);
        const pick = candidates[0];
        currentPos = {
          symbol: pick.sym,
          entry: pick.entry,
          entryTime: pick.time,
          tp: pick.entry * (1 + tp / 100),
          sl: pick.entry * (1 - sl / 100),
          high: pick.entry,
          bars: 0,
          isBE: false,
          isTrail: false
        };
      }
    }
  }

  const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
  const pf = totalLost > 0 ? totalWon / totalLost : (totalWon > 0 ? 999 : 0);
  const netRet = balance - 100;

  return {
    options,
    trades: totalTrades,
    wins,
    losses,
    winRate: Number(winRate.toFixed(1)),
    profitFactor: Number(pf.toFixed(2)),
    netReturnPct: Number(netRet.toFixed(1)),
    maxDrawdownPct: Number(maxDD.toFixed(1)),
    tpCount: closedTrades.filter(t => t.exitReason === 'TAKE_PROFIT').length,
    trailCount: closedTrades.filter(t => t.exitReason === 'TRAILING_STOP').length,
    beCount: closedTrades.filter(t => t.exitReason === 'BREAKEVEN').length,
    slCount: closedTrades.filter(t => t.exitReason === 'STOP_LOSS').length,
    timeCount: closedTrades.filter(t => t.exitReason === 'TIME_CAP').length,
    tradesList: closedTrades
  };
}

console.log('Running refined backtests across 60 days on Binance data...');
const res1 = testPumpSystem({ tp: 1.1, sl: 0.50, beTrigger: 0.70, beLock: 0.25, trailTrigger: 0.90, trailDist: 0.25, minGain: 1.0, rvol: 2.2, requireBtcBull: true, requireConsecutiveGreen: true });
const res2 = testPumpSystem({ tp: 1.2, sl: 0.55, beTrigger: 0.75, beLock: 0.30, trailTrigger: 1.00, trailDist: 0.30, minGain: 1.1, rvol: 2.4, requireBtcBull: true, requireConsecutiveGreen: true });
const res3 = testPumpSystem({ tp: 1.3, sl: 0.60, beTrigger: 0.80, beLock: 0.30, trailTrigger: 1.05, trailDist: 0.30, minGain: 1.2, rvol: 2.5, requireBtcBull: true, requireConsecutiveGreen: true });
const res4 = testPumpSystem({ tp: 1.0, sl: 0.45, beTrigger: 0.65, beLock: 0.20, trailTrigger: 0.85, trailDist: 0.20, minGain: 0.9, rvol: 2.0, requireBtcBull: false, requireConsecutiveGreen: true });

console.log('\n--- Model 1: Fast Scalp (TP 1.1%, SL 0.50%) ---');
console.log(`Trades: ${res1.trades} | Win Rate: ${res1.winRate}% (Wins: ${res1.wins}, Losses: ${res1.losses})`);
console.log(`Net Return: +${res1.netReturnPct}% | Profit Factor: ${res1.profitFactor} | Max Drawdown: ${res1.maxDrawdownPct}%`);
console.log(`Exits -> TP: ${res1.tpCount}, Trailing: ${res1.trailCount}, BE Lock: ${res1.beCount}, SL: ${res1.slCount}, Time: ${res1.timeCount}`);

console.log('\n--- Model 2: Momentum Surge (TP 1.2%, SL 0.55%) ---');
console.log(`Trades: ${res2.trades} | Win Rate: ${res2.winRate}% (Wins: ${res2.wins}, Losses: ${res2.losses})`);
console.log(`Net Return: +${res2.netReturnPct}% | Profit Factor: ${res2.profitFactor} | Max Drawdown: ${res2.maxDrawdownPct}%`);
console.log(`Exits -> TP: ${res2.tpCount}, Trailing: ${res2.trailCount}, BE Lock: ${res2.beCount}, SL: ${res2.slCount}, Time: ${res2.timeCount}`);

console.log('\n--- Model 3: Strong Breakout (TP 1.3%, SL 0.60%) ---');
console.log(`Trades: ${res3.trades} | Win Rate: ${res3.winRate}% (Wins: ${res3.wins}, Losses: ${res3.losses})`);
console.log(`Net Return: +${res3.netReturnPct}% | Profit Factor: ${res3.profitFactor} | Max Drawdown: ${res3.maxDrawdownPct}%`);
console.log(`Exits -> TP: ${res3.tpCount}, Trailing: ${res3.trailCount}, BE Lock: ${res3.beCount}, SL: ${res3.slCount}, Time: ${res3.timeCount}`);

console.log('\n--- Model 4: All-Market Scalp (No BTC Filter, TP 1.0%, SL 0.45%) ---');
console.log(`Trades: ${res4.trades} | Win Rate: ${res4.winRate}% (Wins: ${res4.wins}, Losses: ${res4.losses})`);
console.log(`Net Return: +${res4.netReturnPct}% | Profit Factor: ${res4.profitFactor} | Max Drawdown: ${res4.maxDrawdownPct}%`);
console.log(`Exits -> TP: ${res4.tpCount}, Trailing: ${res4.trailCount}, BE Lock: ${res4.beCount}, SL: ${res4.slCount}, Time: ${res4.timeCount}`);

fs.writeFileSync(path.join(__dirname, 'refined_pump_backtest_60d.json'), JSON.stringify({ res1, res2, res3, res4 }, null, 2));
