const { Client } = require('ssh2');

const conn = new Client();
conn.on('ready', () => {
  const remoteCmd = `
    cd /home/u932536786/trading-bot
    node --input-type=module -e '
      import { agentLoop } from "./backend/src/services/agentLoop.js";
      import { authService } from "./backend/src/services/authService.js";
      (async () => {
        await authService.init();
        const user = await authService.getUserByEmail("waiztahseen@gmail.com");
        console.log("User in DB -> mode:", user?.mode, "account_type:", user?.account_type, "accountType:", user?.accountType);
        
        // Fetch dashboard for user
        const d = agentLoop.getDashboardData(user?.mode || "LIVE", "SPOT", user?.email);
        console.log("=== SPOT DASHBOARD ===");
        console.log("activeAccount:", d.activeAccount);
        console.log("mode:", d.mode);
        console.log("spot.portfolio.isLive:", d.spot?.portfolio?.isLive);
        console.log("spot.portfolio.balance:", d.spot?.portfolio?.balance);
        console.log("spot.portfolio.closedTrades count:", d.spot?.portfolio?.closedTrades?.length);
        console.log("spot.portfolio.realizedPnL:", d.spot?.portfolio?.realizedPnL);
        console.log("spot.riskSettings.maxSlots:", d.spot?.riskSettings?.maxSlots);
        console.log("spot.riskSettings.allocationPct:", d.spot?.riskSettings?.allocationPct);
        console.log("spot.riskSettings.maxConcurrentTrades:", d.spot?.riskSettings?.maxConcurrentTrades);
        
        // Also check DEMO spot portfolio:
        const dDemo = agentLoop.getDashboardData("SIMULATED", "SPOT", user?.email);
        console.log("=== DEMO SPOT DASHBOARD ===");
        console.log("demo spot.portfolio.closedTrades count:", dDemo.spot?.portfolio?.closedTrades?.length);
        console.log("demo spot.portfolio.realizedPnL:", dDemo.spot?.portfolio?.realizedPnL);
        process.exit(0);
      })();
    '
  `;
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
  readyTimeout: 20000
});
