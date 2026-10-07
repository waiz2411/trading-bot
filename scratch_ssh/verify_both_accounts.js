const { Client } = require('ssh2');

const conn = new Client();
conn.on('error', err => console.log('SSH Notice:', err.message));
conn.on('ready', () => {
  const remoteCmd = `
    cd /home/u932536786/trading-bot
    node --input-type=module -e '
      import { authService } from "./backend/src/services/authService.js";
      import { agentLoop } from "./backend/src/services/agentLoop.js";
      (async () => {
        try {
          await authService.init();

          // 1. Live User Check
          const liveDash = agentLoop.getDashboardData("LIVE", "SPOT", "waiztahseen@gmail.com");
          console.log("LIVE_USER_BALANCE:" + liveDash.spot.portfolio.balance);
          console.log("LIVE_USER_FREE_CASH:" + liveDash.spot.portfolio.freeCash);
          console.log("LIVE_USER_POSITIONS:" + liveDash.spot.portfolio.activePositions.length);
          console.log("LIVE_BINANCE_CONNECTED:" + liveDash.brokers.binance.connected);

          // 2. Demo User Check & Balance Update
          const demoDashBefore = agentLoop.getDashboardData("SIMULATED", "SPOT", "waiztahseen2@gmail.com");
          console.log("DEMO_BALANCE_BEFORE:" + demoDashBefore.spot.portfolio.balance);

          // Reset demo to 50
          const resetRes = agentLoop.getEngine("SPOT", "waiztahseen2@gmail.com").reset(50);
          console.log("DEMO_RESET_RESULT:" + resetRes.balance);

          // Set demo to 100
          const setRes = agentLoop.setBalance(100, false, "SPOT", "waiztahseen2@gmail.com");
          console.log("DEMO_SET_BALANCE_RESULT:" + setRes.balance);

          const demoDashAfter = agentLoop.getDashboardData("SIMULATED", "SPOT", "waiztahseen2@gmail.com");
          console.log("DEMO_BALANCE_AFTER:" + demoDashAfter.spot.portfolio.balance);

          // 3. Confirm Live is completely independent and untouched
          const liveDashAfter = agentLoop.getDashboardData("LIVE", "SPOT", "waiztahseen@gmail.com");
          console.log("LIVE_USER_BALANCE_FINAL:" + liveDashAfter.spot.portfolio.balance);

        } catch (e) {
          console.error("Test execution error:", e);
        }
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
  readyTimeout: 30000
});
