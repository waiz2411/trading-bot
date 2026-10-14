const { Client } = require('ssh2');
const conn = new Client();
conn.on('ready', () => {
  conn.exec(`
    cd /home/u932536786/trading-bot
    node --input-type=module -e '
      import { authService } from "./backend/src/services/authService.js";
      import { agentLoop } from "./backend/src/services/agentLoop.js";
      (async () => {
        const user = await authService.getUserByEmail("waiztahseen@gmail.com");
        console.log("User:", user.email, "Mode:", user.mode, "AccountType:", user.account_type, "AutoTrading:", user.is_auto_trading);
        const data = agentLoop.getDashboardData("SIMULATED", "SPOT", user.email, user.brokerConnections);
        console.log("Dashboard activeAccount:", data.activeAccount);
        console.log("Dashboard mode:", data.mode);
        console.log("Dashboard marketScan count:", data.marketScan?.length);
        if (data.marketScan?.length > 0) {
          console.log("Sample marketScan items:", data.marketScan.slice(0, 3).map(m => ({ symbol: m.symbol, price: m.price, signal: m.signal?.action })));
        } else {
          console.log("latestScanResults length in agentLoop:", agentLoop.latestScanResults?.length);
        }
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
  password: 'NexusQuant@6767'
});
