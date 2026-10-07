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
        console.log("BINANCE CONFIG:", JSON.stringify({
          apiKey: user.brokerConnections.binance.apiKey ? user.brokerConnections.binance.apiKey.slice(0, 8) + "..." : "NONE",
          proxyUrl: user.brokerConnections.binance.proxyUrl,
          connected: user.brokerConnections.binance.connected,
          isTestnet: user.brokerConnections.binance.isTestnet
        }));
        binanceConnector.configure({
          apiKey: user.brokerConnections.binance.apiKey,
          apiSecret: user.brokerConnections.binance.apiSecret,
          proxyUrl: user.brokerConnections.binance.proxyUrl,
          isTestnet: user.brokerConnections.binance.isTestnet,
          connected: true
        });
        const testRes = await binanceConnector.testConnection();
        console.log("TEST CONNECTION RES:", JSON.stringify(testRes, null, 2));
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
