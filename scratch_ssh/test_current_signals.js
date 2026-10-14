const { Client } = require('ssh2');
const conn = new Client();
conn.on('ready', () => {
  conn.exec(`
    cd /home/u932536786/trading-bot
    node --input-type=module -e '
      import { marketDataService } from "./backend/src/services/marketData.js";
      import { evaluateSpotConfluence, scanPumpingHalalCoins, scanRelativeStrengthLeaders } from "./backend/src/services/strategyEngine.js";
      import { calculateTechnicalMetrics } from "./backend/src/services/technicalAnalysis.js";

      (async () => {
        const markets = marketDataService.getAllMarkets();
        console.log("Total markets:", markets.length);
        const pumping = scanPumpingHalalCoins(markets, 6);
        console.log("Pumping coins detected:", pumping.map(p => ({ sym: p.symbol, rvol: p.rvol, gain: p.currentGain })));

        const btc = markets.find(m => m.symbol === "BTC-USD" || m.symbol === "BTCUSDT");
        const leaders = scanRelativeStrengthLeaders(markets, btc?.candles, 5);
        console.log("RS leaders detected:", leaders.map(l => ({ sym: l.symbol, rs: l.compositeRS })));

        const context = { pumpingLeaders: pumping, topLeaders: leaders };
        const buys = [];
        for (const m of markets) {
          if (m.category !== "Crypto") continue;
          const tech = calculateTechnicalMetrics(m.candles);
          const sig = evaluateSpotConfluence(m, tech, {}, context);
          if (sig.action === "STRONG_BUY") buys.push({ sym: m.symbol, reason: sig.reason, conf: sig.confidence });
        }
        console.log("STRONG_BUY signals count:", buys.length);
        if (buys.length > 0) console.log("STRONG_BUY list:", buys.slice(0, 5));
        process.exit(0);
      })();
    '
  `, (err, stream) => {
    if (err) throw err;
    stream.on('close', () => conn.end())
      .on('data', d => process.stdout.write(d.toString()))
      .stderr.on('data', d => process.stderr.write(d.toString()));
  });
}).connect({
  host: '82.198.229.98',
  port: 65002,
  username: 'u932536786',
  password: 'NexusQuant@6767',
  readyTimeout: 40000
});
