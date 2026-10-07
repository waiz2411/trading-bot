const { Client } = require('ssh2');
const conn = new Client();
conn.on('error', err => console.error('SSH Error:', err));
conn.on('ready', () => {
  conn.exec(`
    cd /home/u932536786/trading-bot
    node --input-type=module -e '
      import { db } from "./backend/src/services/db.js";
      (async () => {
        const [rows] = await db.query("SELECT user_email, account_type, state_json FROM user_portfolios");
        for (const r of rows) {
          const parsed = typeof r.state_json === "string" ? JSON.parse(r.state_json) : r.state_json;
          console.log("PORTFOLIO:", r.user_email, r.account_type, "balance:", parsed?.balance, "freeCash:", parsed?.freeCash);
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
