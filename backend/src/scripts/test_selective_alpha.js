import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { backtestService } from '../services/backtestService.js';

async function testSelectiveEngine() {
  console.log('Testing High-Precision Selective Alpha Engine...');

  const datasets = backtestService.loadDatasets();
  const availableSymbols = Object.keys(datasets).filter(s => s !== 'BTCUSDT' && s !== 'PAXGUSDT');
  const startMs = new Date('2026-01-01T00:00:00Z').getTime();
  const endMs = new Date('2026-10-16T23:59:59.999Z').getTime();

  // Pre-calculate indicators
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

  // Test various alpha models
  function runAlphaModel(config) {
    const {
      name,
      tp,
      sl,
      beTrigger,
      beLock,
      trTrigger,
      trDist,
      maxHoldHours = 8,
      minGain24,
      maxGain24,
      minRsi,
      maxRsi,
      minRvol,
      trendStrength
    } = config;

    let balance = 100.0; // Use $100 base to see pure percentage growth without micro-slot cutoff
    let peakBalance = balance;
    let maxDrawdownPct = 0;
    const activeTrades = [];
    const closedTrades = [];
    const feeRate = 0.0010;
    const slipRate = 0.0005;
    const maxHoldBars = maxHoldHours * 4;

    for (let tIdx = 0; tIdx < sortedTimes.length; tIdx++) {
      const openTime = sortedTimes[tIdx];

      // Manage trades
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
          const peakGain = ((pos.peakPrice - pos.entryPrice) / pos.entryPrice) * 100;

          if (peakGain >= beTrigger && !pos.isBE) {
            const bePrice = pos.entryPrice * (1 + beLock / 100);
            if (bePrice > pos.currentStop) {
              pos.currentStop = bePrice;
              pos.isBE = true;
            }
          }

          if (peakGain >= trTrigger) {
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
          const grossReturn = ((exitPrice - pos.entryPrice) / pos.entryPrice) * 100;
          const grossGain = notional * (grossReturn / 100);
          const totalFees = notional * feeRate * 2;
          const netPnL = grossGain - totalFees;
          const netReturnPct = (netPnL / notional) * 100;

          balance = Number((balance + netPnL).toFixed(2));
          if (balance > peakBalance) peakBalance = balance;
          const ddDollar = peakBalance - balance;
          const ddPct = peakBalance > 0 ? (ddDollar / peakBalance) * 100 : 0;
          if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;

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

      // Check Entry
      if (activeTrades.length === 0 && balance >= 10.0) {
        // BTC Macro Trend Gate: BTC close > EMA 50
        if (btcEntry) {
          const btcIdx = btcEntry.timeMap.get(openTime);
          if (btcIdx !== undefined && btcIdx >= 50) {
            if (btcEntry.candles[btcIdx].close < btcEntry.tech.ema50[btcIdx]) {
              continue; // BTC in macro downtrend
            }
          }
        }

        let bestCandidate = null;
        let highestScore = -1;

        for (const sym of availableSymbols) {
          const symData = techData[sym];
          if (!symData) continue;

          const idx = symData.timeMap.get(openTime);
          if (idx === undefined || idx < 96) continue;

          const c = symData.candles[idx];
          const tech = symData.tech;

          // 24h momentum
          const past24hClose = symData.candles[idx - 96].close;
          const gain24h = ((c.close - past24hClose) / past24hClose) * 100;
          if (gain24h < minGain24 || gain24h > maxGain24) continue;

          // RVOL
          const rvol = tech.volSma20[idx] > 0 ? c.volume / tech.volSma20[idx] : 1;
          if (rvol < minRvol) continue;

          // RSI range
          const rsi = tech.rsi14[idx];
          if (rsi < minRsi || rsi > maxRsi) continue;

          // Trend criteria: EMA 9 > EMA 21 > EMA 50 (Strong 3-Tier Bull Alignment)
          const isTier3Trend = tech.ema9[idx] > tech.ema21[idx] && tech.ema21[idx] > tech.ema50[idx];
          if (trendStrength === 'TIER3' && !isTier3Trend) continue;
          if (trendStrength === 'TIER2' && !(tech.ema9[idx] > tech.ema21[idx] && c.close > tech.ema50[idx])) continue;

          // Entry Trigger: Candle pulls back into value zone between EMA9 and EMA21
          const isDipZone = c.low <= tech.ema9[idx] && c.close >= tech.ema21[idx] * 0.998;
          const isBullishCandle = c.close > c.open;

          if (isDipZone && isBullishCandle) {
            // Quality score: lower RSI (cheaper price) + steady volume
            const score = (70 - rsi) * 2 + Math.min(rvol, 3.0) * 10;
            if (score > highestScore) {
              highestScore = score;
              bestCandidate = {
                symbol: sym,
                entryPrice: c.close * (1 + slipRate),
                entryTime: c.time
              };
            }
          }
        }

        if (bestCandidate) {
          activeTrades.push({
            symbol: bestCandidate.symbol,
            entryPrice: bestCandidate.entryPrice,
            entryTime: bestCandidate.entryTime,
            notional: balance, // 100% position
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
    const grossWins = wins.reduce((acc, t) => acc + t.netPnL, 0);
    const grossLoss = Math.abs(losses.reduce((acc, t) => acc + t.netPnL, 0));
    const profitFactor = grossLoss > 0 ? Number((grossWins / grossLoss).toFixed(2)) : 999;
    const activeDays = new Set(closedTrades.map(t => t.exitTime.slice(0, 10))).size;

    return {
      name,
      roi: Number((((balance - 100.0) / 100.0) * 100).toFixed(1)),
      trades: closedTrades.length,
      wins: wins.length,
      losses: losses.length,
      winRate: Number(((wins.length / (closedTrades.length || 1)) * 100).toFixed(1)),
      profitFactor,
      maxDrawdownPct: Number(maxDrawdownPct.toFixed(1)),
      activeDays,
      finalBalance: balance
    };
  }

  const models = [
    { name: 'Tier-3 Trend Dip (TP 4.5%, SL 2.0%, Tr 3.0%)', tp: 4.5, sl: 2.0, beTrigger: 2.2, beLock: 0.3, trTrigger: 3.0, trDist: 1.0, maxHoldHours: 8, minGain24: 1.5, maxGain24: 25.0, minRsi: 40, maxRsi: 55, minRvol: 1.2, trendStrength: 'TIER3' },
    { name: 'Tier-3 Trend Dip (TP 5.5%, SL 2.2%, Tr 3.5%)', tp: 5.5, sl: 2.2, beTrigger: 2.5, beLock: 0.3, trTrigger: 3.5, trDist: 1.2, maxHoldHours: 12, minGain24: 2.0, maxGain24: 30.0, minRsi: 40, maxRsi: 58, minRvol: 1.3, trendStrength: 'TIER3' },
    { name: 'Tier-2 Trend Dip (TP 4.0%, SL 2.0%, Tr 2.8%)', tp: 4.0, sl: 2.0, beTrigger: 2.0, beLock: 0.25, trTrigger: 2.8, trDist: 1.0, maxHoldHours: 6, minGain24: 1.5, maxGain24: 25.0, minRsi: 40, maxRsi: 56, minRvol: 1.2, trendStrength: 'TIER2' },
    { name: 'Tier-3 Trend Dip (TP 6.0%, SL 2.0%, Tr 3.5%)', tp: 6.0, sl: 2.0, beTrigger: 2.5, beLock: 0.3, trTrigger: 3.5, trDist: 1.2, maxHoldHours: 12, minGain24: 2.0, maxGain24: 30.0, minRsi: 40, maxRsi: 56, minRvol: 1.3, trendStrength: 'TIER3' },
    { name: 'Tier-3 Quick Scalp (TP 3.5%, SL 1.8%, Tr 2.5%)', tp: 3.5, sl: 1.8, beTrigger: 1.8, beLock: 0.2, trTrigger: 2.5, trDist: 0.8, maxHoldHours: 4, minGain24: 1.5, maxGain24: 20.0, minRsi: 40, maxRsi: 54, minRvol: 1.2, trendStrength: 'TIER3' }
  ];

  console.log('\nRunning Alpha Model Simulations...');
  for (const m of models) {
    const res = runAlphaModel(m);
    console.log(`\n[${res.name}]:`);
    console.log(`  ROI: ${res.roi >= 0 ? '+' : ''}${res.roi}%, Final Balance: $${res.finalBalance}, Trades: ${res.trades}, WinRate: ${res.winRate}%, PF: ${res.profitFactor}, MaxDD: ${res.maxDrawdownPct}%, ActiveDays: ${res.activeDays}/289`);
  }
}

testSelectiveEngine().catch(console.error);
