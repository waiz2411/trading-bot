const { Client } = require('ssh2');
const conn = new Client();
conn.on('error', err => console.error('SSH Error:', err));
conn.on('ready', () => {
  conn.exec(`
    cd /home/u932536786/trading-bot
    node --input-type=module -e '
      import { db } from "./backend/src/services/db.js";
      import { binanceConnector } from "./backend/src/services/binanceConnector.js";
      import { authService } from "./backend/src/services/authService.js";
      (async () => {
        try {
          await authService.init();
          const user = await authService.getUserByEmail("waiztahseen@gmail.com");
          binanceConnector.configure({
            apiKey: user.brokerConnections.binance.apiKey,
            apiSecret: user.brokerConnections.binance.apiSecret,
            isTestnet: false,
            proxyUrl: "https://trading-bot-test-z6bi.onrender.com/api/binance-proxy",
            connected: true
          });
          binanceConnector.bannedUntil = 0;
          const freshBals = await binanceConnector.getBalances(true);
          console.log("Fetched fresh balances count:", freshBals.length);
          const usdtObj = freshBals.find(b => b.asset === "USDT");
          console.log("FRESH USDT BALANCE:", usdtObj?.free);

          // Update user_broker_configs in DB with real balances
          const [cfgRows] = await db.query("SELECT * FROM user_broker_configs WHERE user_id = ? AND broker = \\"binance\\"", [user.id]);
          if (cfgRows.length > 0) {
            const currentCfg = JSON.parse(cfgRows[0].config_json);
            currentCfg.balances = freshBals;
            currentCfg.lastChecked = new Date().toISOString();
            currentCfg.lastUpdated = new Date().toISOString();
            await db.query("UPDATE user_broker_configs SET config_json = ? WHERE user_id = ? AND broker = \\"binance\\"", [JSON.stringify(currentCfg), user.id]);
            console.log("✅ Successfully updated user_broker_configs in MySQL with fresh balance!");
          }
        } catch (e) {
          console.error("Update error:", e);
        }
        process.exit(0);
      })();
    '
  `, (err, stream) => {
    if (err) throw err;
    stream.on('close', () => conn.end())
      .on('data', data => console.log(data.toString()))
      .stderr.on('data', data => console.error(data.toString()));
  });
}).connect({ host: '217.196.54.11', port: 65002, username: 'u932536786', password: 'NexusQuant@6767', readyTimeout: 20000 });
