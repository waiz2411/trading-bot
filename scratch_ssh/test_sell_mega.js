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
        const u = await authService.getUserByEmail("waiztahseen@gmail.com");
        console.log("User waiz: is_auto_trading=", u?.is_auto_trading, "isAutoTradingEnabled=", u?.isAutoTradingEnabled, "mode=", u?.mode);
        await authService.setUserAutoTrading("waiztahseen@gmail.com", true);
        console.log("Updated auto trading to true for waiztahseen@gmail.com");
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
  readyTimeout: 60000
});
