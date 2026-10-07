const { Client } = require('ssh2');

const conn = new Client();
conn.on('ready', () => {
  const remoteCmd = `
    cd /home/u932536786/trading-bot
    node --input-type=module -e '
      import { binanceConnector } from "./backend/src/services/binanceConnector.js";
      import { authService } from "./backend/src/services/authService.js";
      (async () => {
        try {
          await authService.init();
          const user = await authService.getUserByEmail("waiztahseen@gmail.com");
          if (!user || !user.brokerConnections?.binance) {
            console.log("No binance creds found for user");
            process.exit(1);
          }
          binanceConnector.configure({
            apiKey: user.brokerConnections.binance.apiKey,
            apiSecret: user.brokerConnections.binance.apiSecret,
            isTestnet: false,
            proxyUrl: user.brokerConnections.binance.proxyUrl || "https://trading-bot-test-z6bi.onrender.com/api/binance-proxy",
            connected: true
          });
          
          await binanceConnector.syncTime();
          console.log("Connected to Binance:", binanceConnector.connected, "baseUrl:", binanceConnector.baseUrl);
          
          const balances = await binanceConnector.getBalances();
          const usdtObj = balances.find(b => b.asset === "USDT");
          const usdtFree = usdtObj ? usdtObj.free : 0;
          console.log("USDT Free:", usdtFree);

          // Test with $1.95 (4 slots) -> EXPECT FAILURE
          console.log("\\n--- Testing order/test with $1.95 (old 4-slot notional) ---");
          const params1 = new URLSearchParams();
          params1.append("symbol", "BTCUSDT");
          params1.append("side", "BUY");
          params1.append("type", "MARKET");
          params1.append("quoteOrderQty", "1.95");
          const signed1 = binanceConnector.signQuery(params1.toString());
          const res1 = await fetch(binanceConnector.baseUrl + "/api/v3/order/test?" + signed1, {
            method: "POST",
            headers: { "X-MBX-APIKEY": binanceConnector.apiKey }
          });
          const d1 = await res1.json();
          console.log("Status:", res1.status, "Body:", d1);

          // Test with $7.82 (1 slot at 100%) -> EXPECT SUCCESS (HTTP 200 {})
          console.log("\\n--- Testing order/test with $7.82 (100% full allocation) ---");
          const params2 = new URLSearchParams();
          params2.append("symbol", "BTCUSDT");
          params2.append("side", "BUY");
          params2.append("type", "MARKET");
          params2.append("quoteOrderQty", "7.82");
          const signed2 = binanceConnector.signQuery(params2.toString());
          const res2 = await fetch(binanceConnector.baseUrl + "/api/v3/order/test?" + signed2, {
            method: "POST",
            headers: { "X-MBX-APIKEY": binanceConnector.apiKey }
          });
          const d2 = await res2.json();
          console.log("Status:", res2.status, "Body:", d2);

        } catch (e) {
          console.error("Test error:", e);
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
  readyTimeout: 20000
});
