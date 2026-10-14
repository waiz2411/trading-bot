import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

function calcEMA(candles, period) {
  const k = 2 / (period + 1);
  const ema = new Array(candles.length).fill(null);
  if (candles.length < period) return ema;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += candles[i].close;
  ema[period - 1] = sum / period;
  for (let i = period; i < candles.length; i++) {
    ema[i] = candles[i].close * k + ema[i - 1] * (1 - k);
  }
  return ema;
}

async function fetchBinanceKlines(symbol, interval = '5m', totalBars = 3000) {
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

async function runVariations() {
  const coins = ['RENDERUSDT', 'NEARUSDT', 'SOLUSDT', 'SUIUSDT', 'FETUSDT', 'AVAXUSDT'];
  const timeframes = ['1m', '5m', '15m'];

  console.log('Testing RSI Variations across Timeframes & Filters...');

  const summary = [];

  for (const tf of timeframes) {
    for (const sym of coins) {
      const candles = await fetchBinanceKlines(sym, tf, 2000);
      if (candles.length < 300) continue;

      const rsi14 = calculateWildersRSI(candles, 14);
      const ema200 = calcEMA(candles, 200);

      // Variations to test:
      // V1: Basic 1m (Dip < 30, Exit at 50, SL -1%)
      // V2: Deep Oversold (Dip < 25, Exit at 50, SL -1%)
      // V3: Trend Filtered (Dip < 30, Price > EMA 200, Exit at 50, SL -1%)
      // V4: Higher Target (Dip < 30, Exit at RSI 60, SL -1%)
      // V5: Fixed Target (Dip < 30, Exit at +1.0% TP, SL -0.65% or BE)
      const tests = [
        { name: 'V1: Pure Dip < 30 -> Exit 50 (SL -1.0%)', dip: 30, exitRsi: 50, fixedTp: null, useEma: false, sl: 1.0 },
        { name: 'V2: Deep Dip < 25 -> Exit 50 (SL -1.0%)', dip: 25, exitRsi: 50, fixedTp: null, useEma: false, sl: 1.0 },
        { name: 'V3: Dip < 30 + Price > EMA200 (SL -1.0%)', dip: 30, exitRsi: 50, fixedTp: null, useEma: true, sl: 1.0 },
        { name: 'V4: Dip < 30 -> Exit 60 (SL -1.0%)', dip: 30, exitRsi: 60, fixedTp: null, useEma: false, sl: 1.0 },
        { name: 'V5: Dip < 30 -> Fixed +1.0% TP, -0.65% SL', dip: 30, exitRsi: null, fixedTp: 1.0, useEma: false, sl: 0.65 }
      ];

      for (const t of tests) {
        let trades = [];
        let inTrade = false;
        let entryPrice = 0;
        let entryBar = 0;
        let wasOversold = false;

        for (let i = 205; i < candles.length; i++) {
          const c = candles[i];
          const rsiVal = rsi14[i];
          const prevRsi = rsi14[i - 1];
          if (rsiVal === null || prevRsi === null) continue;

          if (!inTrade) {
            if (rsiVal < t.dip) wasOversold = true;

            if (wasOversold && prevRsi < t.dip && rsiVal >= t.dip) {
              if (t.useEma && ema200[i] && c.close < ema200[i]) {
                // Reject: in downtrend
                wasOversold = false;
                continue;
              }

              inTrade = true;
              entryPrice = c.close;
              entryBar = i;
              wasOversold = false;
            }
          } else {
            const barsHeld = i - entryBar;
            let exitPrice = null;

            // Check SL
            const drop = (c.low - entryPrice) / entryPrice * 100;
            if (drop <= -t.sl) {
              exitPrice = entryPrice * (1 - t.sl / 100);
            }

            // Check TP
            if (!exitPrice) {
              if (t.fixedTp !== null) {
                const gain = (c.high - entryPrice) / entryPrice * 100;
                if (gain >= t.fixedTp) {
                  exitPrice = entryPrice * (1 + t.fixedTp / 100);
                }
              } else if (t.exitRsi !== null && rsiVal >= t.exitRsi) {
                exitPrice = c.close;
              }
            }

            // Max hold: 60 bars
            if (!exitPrice && barsHeld >= 60) {
              exitPrice = c.close;
            }

            if (exitPrice !== null) {
              const grossReturnPct = ((exitPrice - entryPrice) / entryPrice) * 100;
              const netReturnPct = grossReturnPct - 0.15 - 0.05; // 0.15% fee + 0.05% slippage
              trades.push({ netReturnPct, isWin: netReturnPct > 0 });
              inTrade = false;
            }
          }
        }

        const wins = trades.filter(tr => tr.isWin);
        summary.push({
          timeframe: tf,
          symbol: sym,
          variation: t.name,
          trades: trades.length,
          wins: wins.length,
          netPct: trades.reduce((a, b) => a + b.netReturnPct, 0)
        });
      }
    }
  }

  // Aggregate results by Timeframe + Variation
  const agg = {};
  for (const s of summary) {
    const key = `[${s.timeframe}] ${s.variation}`;
    if (!agg[key]) agg[key] = { key, trades: 0, wins: 0, netPct: 0 };
    agg[key].trades += s.trades;
    agg[key].wins += s.wins;
    agg[key].netPct += s.netPct;
  }

  console.log('\n===============================================================');
  console.log('📊 RSI STRATEGY VARIATIONS MATRIX (Across All Halal Coins)');
  console.log('===============================================================');
  const tableData = Object.values(agg).map(a => ({
    Strategy: a.key,
    TotalTrades: a.trades,
    WinRate: a.trades > 0 ? ((a.wins / a.trades) * 100).toFixed(1) + '%' : '0%',
    CombinedNetReturn: a.netPct.toFixed(2) + '%'
  }));
  console.table(tableData);

  fs.writeFileSync(path.join(__dirname, 'rsi_variations_summary.json'), JSON.stringify(tableData, null, 2));
}

runVariations().catch(console.error);
