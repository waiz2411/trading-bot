import fs from 'fs';
import path from 'path';

const cacheDir = './backend/src/data/binance_cache';

// Test BTC + ETH only with $100 starting capital
function testBtcEthDCA() {
  const btcRaw = JSON.parse(fs.readFileSync(path.join(cacheDir, 'BTCUSDT_15m_60d.json'), 'utf8'));
  const ethRaw = JSON.parse(fs.readFileSync(path.join(cacheDir, 'ETHUSDT_15m_60d.json'), 'utf8'));

  const parse = raw => raw.map(c => ({
    openTime: c.openTime || c[0],
    time: c.time || new Date(c.openTime || c[0]).toISOString(),
    open: Number(c.open || c[1]),
    high: Number(c.high || c[2]),
    low: Number(c.low || c[3]),
    close: Number(c.close || c[4]),
    volume: Number(c.volume || c[5])
  })).filter(c => c.openTime >= 1767225600000 && !isNaN(c.close)).sort((a,b) => a.openTime - b.openTime);

  const btc = parse(btcRaw);
  const eth = parse(ethRaw);

  function calcRSI(candles) {
    const rsi = new Float64Array(candles.length);
    let avgG = 0, avgL = 0;
    for (let i = 1; i <= 14; i++) {
      const d = candles[i].close - candles[i-1].close;
      if (d > 0) avgG += d; else avgL += Math.abs(d);
    }
    avgG /= 14; avgL /= 14;
    rsi[14] = avgL === 0 ? 100 : 100 - (100 / (1 + avgG / avgL));
    for (let i = 15; i < candles.length; i++) {
      const d = candles[i].close - candles[i-1].close;
      avgG = (avgG * 13 + (d > 0 ? d : 0)) / 14;
      avgL = (avgL * 13 + (d < 0 ? Math.abs(d) : 0)) / 14;
      rsi[i] = avgL === 0 ? 100 : 100 - (100 / (1 + avgG / avgL));
    }
    return rsi;
  }

  const ethRSI = calcRSI(eth);
  const btcRSI = calcRSI(btc);

  // Let's test trading ETH only when RSI dips and bounces
  let balance = 100.0;
  let trades = [];
  let nextFree = 0;

  for (let i = 50; i < eth.length; i++) {
    if (eth[i].openTime < nextFree) continue;

    // Signal: ETH oversold bounce
    if (ethRSI[i-1] < 30 && ethRSI[i] >= 30 && eth[i].close > eth[i].open) {
      const entryPrice = eth[i].close * 1.00015;
      const baseUSD = balance * 0.30;
      const so1USD = balance * 0.70;
      let totalUSD = baseUSD;
      let coins = baseUSD / entryPrice;
      let avgP = entryPrice;
      let soFilled = false;

      let exitP = null;
      let exitTime = '';
      let exitOpenTime = 0;

      for (let j = i + 1; j < eth.length && j <= i + 300; j++) {
        const bar = eth[j];
        if (!soFilled && bar.low <= entryPrice * 0.975) { // SO at -2.5%
          const fillP = entryPrice * 0.975;
          totalUSD += so1USD;
          coins += so1USD / fillP;
          avgP = totalUSD / coins;
          soFilled = true;
        }

        const tpP = avgP * 1.012; // +1.2% TP
        const slP = avgP * 0.93;  // -7% SL

        if (bar.high >= tpP) {
          exitP = tpP * 0.99985;
          exitTime = bar.time;
          exitOpenTime = bar.openTime;
          break;
        }
        if (bar.low <= slP) {
          exitP = slP * 0.99985;
          exitTime = bar.time;
          exitOpenTime = bar.openTime;
          break;
        }
      }

      if (!exitP) {
        exitP = eth[Math.min(eth.length - 1, i + 300)].close * 0.99985;
        exitTime = eth[Math.min(eth.length - 1, i + 300)].time;
        exitOpenTime = eth[Math.min(eth.length - 1, i + 300)].openTime;
      }

      const gross = coins * exitP;
      const fees = (totalUSD * 0.001) + (gross * 0.001);
      const net = gross - totalUSD - fees;
      balance += net;
      nextFree = exitOpenTime;

      trades.push({
        time: eth[i].time,
        exitTime,
        net,
        balance,
        soFilled,
        win: net > 0
      });
    }
  }

  const wins = trades.filter(t => t.win).length;
  console.log('ETH ONLY DCA ($100 Compounded):', {
    totalTrades: trades.length,
    wins,
    losses: trades.length - wins,
    winRate: ((wins / trades.length) * 100).toFixed(1) + '%',
    finalBalance: '$' + balance.toFixed(2),
    netGain: (((balance - 100) / 100) * 100).toFixed(2) + '%'
  });
}

testBtcEthDCA();
