const { Client } = require('ssh2');
const conn = new Client();
conn.on('ready', () => {
  conn.exec(`
    cd /home/u932536786/trading-bot
    node --input-type=module -e '
      import { authService } from "./backend/src/services/authService.js";
      (async () => {
        const u = await authService.getUserByEmail("waiztahseen@gmail.com");
        console.log("DB User:", {
          email: u.email,
          is_auto_trading: u.is_auto_trading,
          mode: u.mode,
          account_type: u.account_type
        });
        process.exit(0);
      })();
    '
  `, (err, stream) => {
    if (err) throw err;
    stream.on('close', () => conn.end())
      .on('data', d => process.stdout.write(d.toString()))
      .stderr.on('data', d => process.stderr.write(d.toString()));
  });
}).connect({
  host: '82.198.229.98',
  port: 65002,
  username: 'u932536786',
  password: 'NexusQuant@6767',
  readyTimeout: 40000
});
