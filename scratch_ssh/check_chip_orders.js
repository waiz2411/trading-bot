const { Client } = require('ssh2');

const conn = new Client();
conn.on('ready', () => {
  const remoteCmd = `
    cd /home/u932536786/trading-bot
    node --input-type=module -e '
      import { binanceConnector } from "./backend/src/services/binanceConnector.js";
      import { authService } from "./backend/src/services/authService.js";
      (async () => {
        await authService.init();
        const user = await authService.getUserByEmail("waiztahseen@gmail.com");
        binanceConnector.configure({
          apiKey: user.brokerConnections.binance.apiKey,
          apiSecret: user.brokerConnections.binance.apiSecret,
          proxyUrl: user.brokerConnections.binance.proxyUrl,
          isTestnet: false,
          connected: true
        });
        await binanceConnector.syncTime();
        const signedQuery = binanceConnector.signQuery("symbol=CHIPUSDT&limit=10");
        const res = await fetch(binanceConnector.baseUrl + "/api/v3/allOrders?" + signedQuery, {
          headers: { "X-MBX-APIKEY": binanceConnector.apiKey }
        });
        const data = await res.json();
        console.log("CHIPUSDT ORDERS ON BINANCE:", JSON.stringify(data, null, 2));
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
