const { Client } = require('ssh2');

const conn = new Client();
conn.on('ready', () => {
  conn.exec(`cd /home/u932536786/trading-bot && node --input-type=module -e '
    import fs from "fs";
    import path from "path";
    import { authService } from "./backend/src/services/authService.js";
    import { agentLoop } from "./backend/src/services/agentLoop.js";
    import { binanceConnector } from "./backend/src/services/binanceConnector.js";
    (async () => {
      await authService.init();
      const u1 = await authService.getUserByEmail("waiztahseen@gmail.com");
      const u2 = await authService.getUserByEmail("waiztahseen2@gmail.com");
      console.log("=== USER 1 (LIVE) ===");
      console.log("Email:", u1?.email, "Mode:", u1?.mode, "AccountType:", u1?.accountType);
      console.log("Binance connected:", u1?.brokerConnections?.binance?.connected);
      console.log("=== USER 2 (DEMO) ===");
      console.log("Email:", u2?.email, "Mode:", u2?.mode, "AccountType:", u2?.accountType);
      
      const demoData = JSON.parse(fs.readFileSync("./backend/src/data/persisted_engine_spot_waiztahseen2_gmail_com.json", "utf8"));
      console.log("=== DEMO LAST 5 TRADES ===");
      console.log(demoData.closedTrades.slice(-5).map(t => ({ symbol: t.symbol, notional: t.notional, open: t.openTime, close: t.closeTime, pnl: t.finalPnL, exit: t.exitReason })));
      console.log("=== DEMO ACTIVE POSITIONS ===");
      console.log(demoData.activePositions);

      // Check agentLoop uConfig for both
      console.log("Loop users:", Array.from(agentLoop.userConfigs.keys()));
      for (const [k, cfg] of agentLoop.userConfigs.entries()) {
        console.log("Config for " + k + ": mode=" + cfg.mode + ", lastSpotOpen=" + new Date(cfg.lastSpotTradeOpenedAt || 0).toISOString());
      }

      const liveTrades = JSON.parse(fs.readFileSync("./backend/src/data/live_spot_trades.json", "utf8"));
      console.log("=== LIVE SPOT TRADES FILE ===");
      console.log(JSON.stringify(liveTrades, null, 2));

      process.exit(0);
    })();
  '`, (err, stream) => {
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
