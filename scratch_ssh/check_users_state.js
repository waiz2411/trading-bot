const { Client } = require('ssh2');

const conn = new Client();
conn.on('ready', () => {
  const remoteCmd = `
    cd /home/u932536786/trading-bot
    node --input-type=module -e '
      import { authService } from "./backend/src/services/authService.js";
      (async () => {
        try {
          await authService.init();
          const u1 = await authService.getUserByEmail("waiztahseen@gmail.com");
          const u2 = await authService.getUserByEmail("waiztahseen2@gmail.com");
          console.log("USER 1 (Live Binance):", u1?.email, "autoTrading:", u1?.is_auto_trading, "mode:", u1?.trading_mode);
          console.log("USER 2 (Demo):", u2?.email, "autoTrading:", u2?.is_auto_trading, "mode:", u2?.trading_mode);
        } catch (e) {
          console.error("Error:", e);
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
  readyTimeout: 35000
});
