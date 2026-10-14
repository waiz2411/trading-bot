const { Client } = require('ssh2');
const conn = new Client();
conn.on('ready', () => {
  conn.exec(`
    cd /home/u932536786/trading-bot
    node --input-type=module -e '
      import { db } from "./backend/src/services/db.js";
      (async () => {
        await db.init();
        const users = await db.query("SELECT id, name, email, role, is_auto_trading FROM users");
        console.log("All users in DB:", users);
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
