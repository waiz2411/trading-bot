const { Client } = require('ssh2');
const conn = new Client();
conn.on('ready', () => {
  conn.exec(`
    cd /home/u932536786/trading-bot
    node --input-type=module -e '
      import { agentLoop } from "./backend/src/services/agentLoop.js";
      import { marketDataService } from "./backend/src/services/marketData.js";
      setTimeout(async () => {
        const markets = marketDataService.getAllMarkets();
        console.log("Markets count:", markets.length);
        const data = agentLoop.getDashboardData("SIMULATED", "SPOT", "waiztahseen@gmail.com");
        console.log("ScanResults count:", data.scanResults?.length);
        if (data.scanResults?.length > 0) {
          console.log("First 3 scan results:", data.scanResults.slice(0, 3).map(s => ({ symbol: s.symbol, price: s.price, signal: s.signal?.action })));
        }
        process.exit(0);
      }, 3000);
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
  password: 'NexusQuant@6767'
});
