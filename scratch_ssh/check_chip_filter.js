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
          isTestnet: user.brokerConnections.binance.isTestnet,
          connected: true
        });
        await binanceConnector.syncTime();
        const filter = await binanceConnector.getSymbolLotSize("CHIPUSDT");
        console.log("CHIPUSDT filter:", JSON.stringify(filter));
        const price = await binanceConnector.getPrice("CHIPUSDT");
        console.log("CHIPUSDT price:", price);
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
