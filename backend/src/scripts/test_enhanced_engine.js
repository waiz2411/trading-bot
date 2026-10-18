import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { backtestService } from '../services/backtestService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testEngine() {
  console.log('Testing Enhanced Value Pullback Engine...');

  const datasets = backtestService.loadDatasets();
  const availableSymbols = Object.keys(datasets).filter(s => s !== 'BTCUSDT' && s !== 'PAXGUSDT');

  // Let's test a standalone simulation with the new logic to see exact performance
  const startMs = new Date('2026-01-01T00:00:00Z').getTime();
  const endMs = new Date('2026-10-16T23:59:59.999Z').getTime();

  // Pre-calculate
  const techData = {};
  const timeSet = new Set();
  for (const sym of [...availableSymbols, 'BTCUSDT']) {
    if (!datasets[sym]) continue;
    const filtered = datasets[sym].filter(c => c.openTime >= startMs - (96 * 15 * 60 * 1000) && c.openTime <= endMs);
    if (filtered.length < 50) continue;
    techData[sym] = {
      candles: filtered,
      tech: backtestService.calculateTechnicals(filtered),
      timeMap: new Map()
    };
    filtered.forEach((c, idx) => {
      techData[sym].timeMap.set(c.openTime, idx);
      if (c.openTime >= startMs && c.openTime <= endMs) timeSet.add(c.openTime);
    });
  }

  const sortedTimes = Array.from(timeSet).sort((a, b) => a - b);
  const btcEntry = techData['BTCUSDT'];

  function runSim(options) {
    const {
      tp = 3.5,
      sl = 2.5,
      be = 2.0,
      beLock = 0.25,
      tr = 2.8,
      trDist = 1.0,
      maxHoldMins = 360,
      maxSlots = 2,
      min24 = 1.0,
      max24 = 25.0,
      minRvol = 1.2,
      maxRvol = 4.0,
      btcCrashOnly = true,
      setupType = 'VALUE_PULLBACK'
    } = options;

    let balance = 10.0;
    let peakBalance = balance;
    let maxDrawdownPct = 0;
    const activeTrades = [];
    const closedTrades = [];
    const dailyPnL = {};

    const maxHoldBars = Math.round(maxHoldMins / 15);
    const feeRate = 0.0010;
    const slipRate = 0.0005;

    for (let tIdx = 0; tIdx < sortedTimes.length; tIdx++) {
      const openTime = sortedTimes[tIdx];
      const currentDateStr = new Date(openTime).toISOString().split('T')[0];

      // 1. Manage Active Trades
      for (let pIdx = activeTrades.length - 1; pIdx >= 0; pIdx--) {
        const pos = activeTrades[pIdx];
        const symEntry = techData[pos.symbol];
        if (!symEntry) continue;

        const candleIdx = symEntry.timeMap.get(openTime);
        if (candleIdx === undefined) continue;

        const candle = symEntry.candles[candleIdx];
        pos.barsHeld++;

        let exitPrice = null;
        let exitReason = null;

        if (candle.low <= pos.currentStop) {
          exitPrice = pos.currentStop * (1 - slipRate);
          exitReason = pos.isTrailing ? 'TRAILING_STOP' : (pos.isBE ? 'BREAKEVEN' : 'STOP_LOSS');
        } else {
          if (candle.high > pos.peakPrice) pos.peakPrice = candle.high;
          const peakGainPct = ((pos.peakPrice - pos.entryPrice) / pos.entryPrice) * 100;

          if (peakGainPct >= be && !pos.isBE) {
            const bePrice = pos.entryPrice * (1 + beLock / 100);
            if (bePrice > pos.currentStop) {
              pos.currentStop = bePrice;
              pos.isBE = true;
            }
          }

          if (peakGainPct >= tr) {
            const trPrice = pos.peakPrice * (1 - trDist / 100);
            if (trPrice > pos.currentStop) {
              pos.currentStop = trPrice;
              pos.isTrailing = true;
            }
          }

          if (tp > 0 && candle.high >= pos.entryPrice * (1 + tp / 100)) {
            exitPrice = pos.entryPrice * (1 + tp / 100);
            exitReason = 'TAKE_PROFIT';
          } else if (pos.barsHeld >= maxHoldBars) {
            exitPrice = candle.close;
            exitReason = 'TIME_LIMIT';
          }
        }

        if (exitPrice !== null) {
          const notional = pos.notional;
          const grossReturnPct = ((exitPrice - pos.entryPrice) / pos.entryPrice) * 100;
          const grossGain = notional * (grossReturnPct / 100);
          const totalFees = notional * feeRate * 2;
          const netPnL = grossGain - totalFees;
          const netReturnPct = (netPnL / notional) * 100;

          balance = Number((balance + netPnL).toFixed(2));
          if (balance > peakBalance) peakBalance = balance;
          const ddDollar = peakBalance - balance;
          const ddPct = peakBalance > 0 ? (ddDollar / peakBalance) * 100 : 0;
          if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;

          dailyPnL[currentDateStr] = (dailyPnL[currentDateStr] || 0) + netPnL;

          closedTrades.push({
            id: closedTrades.length + 1,
            symbol: pos.symbol,
            entryTime: pos.entryTime,
            exitTime: candle.time,
            entryPrice: Number(pos.entryPrice.toFixed(4)),
            exitPrice: Number(exitPrice.toFixed(4)),
            returnPct: Number(netReturnPct.toFixed(2)),
            netPnL: Number(netPnL.toFixed(3)),
            exitReason,
            durationMins: pos.barsHeld * 15,
            balanceAfter: balance
          });

          activeTrades.splice(pIdx, 1);
        }
      }

      // 2. Scan for Entry Signals
      if (activeTrades.length < maxSlots && balance >= 5.0) {
        if (btcCrashOnly && btcEntry) {
          const btcIdx = btcEntry.timeMap.get(openTime);
          if (btcIdx !== undefined && btcIdx >= 20) {
            const btcC = btcEntry.candles[btcIdx];
            const btcEma50 = btcEntry.tech.ema50[btcIdx];
            // Only pause if BTC is crashing deeply (>2% below EMA50 or RSI < 28)
            if (btcC.close < btcEma50 * 0.98 || btcEntry.tech.rsi14[btcIdx] < 28) {
              continue;
            }
          }
        }

        let bestCandidate = null;
        let highestScore = -1;

        for (const sym of availableSymbols) {
          if (activeTrades.some(t => t.symbol === sym)) continue;
          const symData = techData[sym];
          if (!symData) continue;

          const idx = symData.timeMap.get(openTime);
          if (idx === undefined || idx < 96) continue;

          const c = symData.candles[idx];
          const tech = symData.tech;

          const past24hClose = symData.candles[idx - 96].close;
          const gain24h = ((c.close - past24hClose) / past24hClose) * 100;
          if (gain24h < min24 || gain24h > max24) continue;

          const rvol = tech.volSma20[idx] > 0 ? c.volume / tech.volSma20[idx] : 1;
          if (rvol < minRvol || rvol > maxRvol) continue; // Exclude climax blow-offs

          const rsi = tech.rsi14[idx];
          const isUptrend = tech.ema9[idx] > tech.ema21[idx] && c.close >= tech.ema21[idx] * 0.995;
          if (!isUptrend) continue;

          let isMatch = false;
          let entryScore = 0;

          if (setupType === 'VALUE_PULLBACK') {
            // Dip near 21 EMA with healthy RSI 38-54
            const isDip = c.low <= tech.ema21[idx] * 1.008 && c.close >= tech.ema21[idx] * 0.995;
            const isHealthyRsi = rsi >= 38 && rsi <= 55;
            const hasRejectionWick = (c.close - c.low) >= (c.high - c.low) * 0.35 || c.close > c.open;

            if (isDip && isHealthyRsi && hasRejectionWick) {
              isMatch = true;
              // Score favors best support bounce + lowest RSI (most discounted entry)
              entryScore = (60 - rsi) * 2 + (rvol > 1.3 ? 20 : 10);
            }
          } else if (setupType === 'TREND_RETEST') {
            // Dip to 9 EMA
            const isDip9 = c.low <= tech.ema9[idx] * 1.003 && c.close >= tech.ema9[idx] * 0.998;
            if (isDip9 && rsi >= 42 && rsi <= 60 && c.close > c.open) {
              isMatch = true;
              entryScore = (60 - rsi) * 2 + rvol * 10;
            }
          }

          if (isMatch && entryScore > highestScore) {
            highestScore = entryScore;
            bestCandidate = {
              symbol: sym,
              entryPrice: c.close * (1 + slipRate),
              entryTime: c.time
            };
          }
        }

        if (bestCandidate) {
          const availableSlots = maxSlots - activeTrades.length;
          const slotCash = Math.floor((balance / (availableSlots || 1)) * 100) / 100;
          const posSize = Math.max(5.0, Math.min(balance, slotCash));

          activeTrades.push({
            symbol: bestCandidate.symbol,
            entryPrice: bestCandidate.entryPrice,
            entryTime: bestCandidate.entryTime,
            notional: posSize,
            peakPrice: bestCandidate.entryPrice,
            currentStop: bestCandidate.entryPrice * (1 - sl / 100),
            barsHeld: 0,
            isBE: false,
            isTrailing: false
          });
        }
      }
    }

    const wins = closedTrades.filter(t => t.netPnL > 0);
    const losses = closedTrades.filter(t => t.netPnL < 0);
    const beCount = closedTrades.filter(t => t.netPnL === 0);
    const grossWins = wins.reduce((acc, t) => acc + t.netPnL, 0);
    const grossLoss = Math.abs(losses.reduce((acc, t) => acc + t.netPnL, 0));
    const profitFactor = grossLoss > 0 ? Number((grossWins / grossLoss).toFixed(2)) : 999;
    const activeDays = new Set(closedTrades.map(t => t.exitTime.slice(0, 10))).size;

    return {
      balance,
      roi: Number((((balance - 10.0) / 10.0) * 100).toFixed(1)),
      trades: closedTrades.length,
      wins: wins.length,
      losses: losses.length,
      winRate: Number(((wins.length / (closedTrades.length || 1)) * 100).toFixed(1)),
      profitFactor,
      maxDrawdownPct: Number(maxDrawdownPct.toFixed(1)),
      activeDays,
      tradesList: closedTrades
    };
  }

  // Test variations of Value Pullback & Trend Retest
  const testCases = [
    { name: 'Value Pullback TP 3.5%, SL 2.5%, BE 2.0%, Tr 2.8%, 2 Slots', setupType: 'VALUE_PULLBACK', tp: 3.5, sl: 2.5, be: 2.0, tr: 2.8, maxSlots: 2 },
    { name: 'Value Pullback TP 4.0%, SL 2.5%, BE 2.2%, Tr 3.0%, 2 Slots', setupType: 'VALUE_PULLBACK', tp: 4.0, sl: 2.5, be: 2.2, tr: 3.0, maxSlots: 2 },
    { name: 'Value Pullback TP 4.5%, SL 2.2%, BE 2.0%, Tr 3.2%, 1 Slot',  setupType: 'VALUE_PULLBACK', tp: 4.5, sl: 2.2, be: 2.0, tr: 3.2, maxSlots: 1 },
    { name: 'Trend Retest TP 3.5%, SL 2.2%, BE 1.8%, Tr 2.6%, 2 Slots',   setupType: 'TREND_RETEST',   tp: 3.5, sl: 2.2, be: 1.8, tr: 2.6, maxSlots: 2 },
    { name: 'Trend Retest TP 4.0%, SL 2.5%, BE 2.0%, Tr 3.0%, 2 Slots',   setupType: 'TREND_RETEST',   tp: 4.0, sl: 2.5, be: 2.0, tr: 3.0, maxSlots: 2 },
    { name: 'Value Pullback TP 5.0%, SL 2.5%, BE 2.5%, Tr 3.5%, 2 Slots', setupType: 'VALUE_PULLBACK', tp: 5.0, sl: 2.5, be: 2.5, tr: 3.5, maxSlots: 2 }
  ];

  console.log('\nResults Comparison across 289 Days (Jan 1 - Oct 16, 2026):');
  for (const tc of testCases) {
    const res = runSim(tc);
    console.log(`[${tc.name}]:`);
    console.log(`  ROI: ${res.roi >= 0 ? '+' : ''}${res.roi}%, Balance: $${res.balance}, Trades: ${res.trades}, WinRate: ${res.winRate}%, ActiveDays: ${res.activeDays}/289, PF: ${res.profitFactor}, MaxDD: ${res.maxDrawdownPct}%`);
  }
}

testEngine().catch(console.error);
