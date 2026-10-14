import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function calculateWildersRSI(candles, period = 14) {
  const rsi = new Array(candles.length).fill(null);
  if (candles.length <= period) return rsi;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    if (diff >= 0) gains += diff; else losses += -diff;
  }
  let avgGain = gains / period, avgLoss = losses / period;
  rsi[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));
  for (let i = period + 1; i < candles.length; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
    rsi[i] = avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));
  }
  return rsi;
}

async function fetchBinanceKlines(symbol, interval = '15m', totalBars = 3000) {
  let allCandles = [];
  let endTime = Date.now();
  while (allCandles.length < totalBars) {
    const fetchLimit = Math.min(1000, totalBars - allCandles.length);
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${fetchLimit}&endTime=${endTime}`;
    try {
      const res = await fetch(url);
      if (!res.ok) break;
      const raw = await res.json();
      if (!raw || raw.length === 0) break;
      const chunk = raw.map(k => ({
        openTime: k[0],
        close: parseFloat(k[4]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3])
      }));
      allCandles = [...chunk, ...allCandles];
      endTime = chunk[0].openTime - 1;
      if (raw.length < fetchLimit) break;
    } catch (e) { break; }
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

async function runTFs() {
  const coins = ['RENDERUSDT', 'NEARUSDT', 'SOLUSDT', 'SUIUSDT', 'FETUSDT', 'AVAXUSDT'];
  const tfs = ['5m', '15m'];

  for (const tf of tfs) {
    let allTrades = [];
    for (const sym of coins) {
      const candles = await fetchBinanceKlines(sym, tf, 2000);
      const rsi = calculateWildersRSI(candles, 14);

      let inTrade = false;
      let entryPrice = 0;
      let entryBar = 0;
      let wasBelow35 = false;

      for (let i = 20; i < candles.length; i++) {
        const c = candles[i];
        const rsiVal = rsi[i];
        const prevRsi = rsi[i - 1];
        if (rsiVal === null || prevRsi === null) continue;

        if (!inTrade) {
          if (rsiVal < 35) wasBelow35 = true;
          if (wasBelow35 && prevRsi < 35 && rsiVal >= 35) {
            inTrade = true;
            entryPrice = c.close;
            entryBar = i;
            wasBelow35 = false;
          }
        } else {
          let exitPrice = null;
          const drop = (c.low - entryPrice) / entryPrice * 100;
          if (drop <= -1.0) exitPrice = entryPrice * 0.99;
          else if (rsiVal >= 50) exitPrice = c.close;
          else if (i - entryBar >= 48) exitPrice = c.close;

          if (exitPrice !== null) {
            const net = ((exitPrice - entryPrice) / entryPrice * 100) - 0.15 - 0.05;
            allTrades.push({ net, isWin: net > 0 });
            inTrade = false;
          }
        }
      }
    }
    const wins = allTrades.filter(t => t.isWin);
    const wr = allTrades.length > 0 ? (wins.length / allTrades.length * 100).toFixed(1) : 0;
    const totNet = allTrades.reduce((a, b) => a + b.net, 0).toFixed(2);
    console.log(`[${tf}] Trades: ${allTrades.length}, Win Rate: ${wr}%, Net Return: ${totNet}%`);
  }
}

runTFs().catch(console.error);
