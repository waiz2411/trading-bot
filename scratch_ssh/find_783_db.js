const { Client } = require('ssh2');
const conn = new Client();
conn.on('ready', () => {
  conn.exec(`
    cd /home/u932536786/trading-bot
    node --input-type=module -e '
    import { db } from "./backend/src/services/db.js";
    (async () => {
      const [uRows] = await db.query("SELECT * FROM users WHERE email LIKE \\"%waiz%\\"");
      for (const u of uRows) {
        console.log("User:", u.email, "mode:", u.mode, "broker_config:", u.broker_config, "balances:", u.balances);
      }
      const [pRows] = await db.query("SELECT user_email, account_type, state_json FROM user_portfolios WHERE user_email LIKE \\"%waiz%\\"");
      for (const p of pRows) {
        console.log("Portfolio:", p.user_email, p.account_type, p.state_json);
      }
      process.exit(0);
    })();
  '`, (err, stream) => {
    if (err) throw err;
    stream.on('close', () => conn.end())
      .on('data', data => console.log(data.toString()))
      .stderr.on('data', data => console.error(data.toString()));
  });
}).connect({ host: '217.196.54.11', port: 65002, username: 'u932536786', password: 'NexusQuant@6767', readyTimeout: 20000 });
