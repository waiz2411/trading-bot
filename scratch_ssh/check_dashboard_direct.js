const { Client } = require('ssh2');
const conn = new Client();
conn.on('ready', () => {
  conn.exec(`cd /home/u932536786/trading-bot && node -e '
    const { agentLoop } = require("./backend/src/services/agentLoop.js");
    const { authService } = require("./backend/src/services/authService.js");
    const { binanceConnector } = require("./backend/src/services/binanceConnector.js");
    (async () => {
      const user = await authService.getUserByEmail("waiztahseen@gmail.com");
      binanceConnector.configure(user.brokerConnections.binance);
      await binanceConnector.getBalances(true);
      const data = agentLoop.getDashboardData("LIVE", "SPOT", "waiztahseen@gmail.com", user.brokerConnections);
      console.log("Spot Balance:", data.balance);
      console.log("Positions:", data.activePositions);
      console.log("AutoTrading Enabled:", data.isAutoTradingEnabled);
      console.log("Risk Settings:", data.riskSettings);
      process.exit(0);
    })();
  '`, (err, stream) => {
    if (err) throw err;
    stream.on('close', () => conn.end()).on('data', d => process.stdout.write(d.toString())).stderr.on('data', d => process.stderr.write(d.toString()));
  });
}).connect({
  host: '82.198.229.98',
  port: 65002,
  username: 'u932536786',
  password: 'NexusQuant@6767'
});
