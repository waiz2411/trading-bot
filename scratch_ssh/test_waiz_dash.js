const { Client } = require('ssh2');

const conn = new Client();
conn.on('ready', () => {
  const remoteCmd = `
    cd /home/u932536786/trading-bot
    node --input-type=module -e '
      import { agentLoop } from "./backend/src/services/agentLoop.js";
      import { authService } from "./backend/src/services/authService.js";
      import { binanceConnector } from "./backend/src/services/binanceConnector.js";
      (async () => {
        try {
          await authService.init();
          await agentLoop.setUserMode("waiztahseen@gmail.com", "LIVE");
          await binanceConnector.syncTime();
          await binanceConnector.getBalances(true);
          const d = agentLoop.getDashboardData("LIVE", "SPOT", "waiztahseen@gmail.com");
          console.log("=== TELEMETRY FOR WAIZ LIVE SPOT ===");
          console.log("User:", d.currentUser);
          console.log("Binance Connected:", d.brokers.binance.connected);
          console.log("Spot Balance:", d.spot.portfolio.balance, "Free Cash:", d.spot.portfolio.freeCash);
          console.log("Spot Active Positions:", d.spot.portfolio.activePositions.length);
          console.log("Spot Closed Trades in Live Ledger:", d.spot.portfolio.closedTrades.length);
          console.log("Spot Realized PnL in Live Ledger:", d.spot.portfolio.realizedPnL);
          console.log("Trades:", JSON.stringify(d.spot.portfolio.closedTrades, null, 2));
        } catch (e) {
          console.error("Telemetry error:", e);
        }
        process.exit(0);
      })();
    '
  `;

  conn.on('error', err => console.error('SSH Error:', err.message));
  conn.exec(remoteCmd, (err, stream) => {
    if (err) throw err;
    stream.on('close', () => conn.end())
      .on('data', data => console.log(data.toString()))
      .stderr.on('data', data => console.error(data.toString()));
  });
}).connect({
  host: '217.196.54.11',
  port: 65002,
  username: 'u932536786',
  password: 'NexusQuant@6767',
  readyTimeout: 35000
});
