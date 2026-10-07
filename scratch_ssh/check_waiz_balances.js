const { Client } = require('ssh2');
const conn = new Client();
conn.on('error', err => console.error('SSH Error:', err));
conn.on('ready', () => {
  conn.exec(`
    cd /home/u932536786/trading-bot
    node --input-type=module -e '
      import { db } from "./backend/src/services/db.js";
      (async () => {
        const [rows] = await db.query("SELECT email, balance, balances FROM users WHERE email LIKE \\"%waiz%\\"");
        console.log("USERS_TABLE:", JSON.stringify(rows, null, 2));
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
