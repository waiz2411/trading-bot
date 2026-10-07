const { Client } = require('ssh2');
const conn = new Client();
conn.on('ready', () => {
  conn.exec(`node -e '
    const fs = require("fs");
    const p1 = "/home/u932536786/trading-bot/backend/src/data/live_spot_trades.json";
    const p2 = "/home/u932536786/trading-bot/backend/backend/src/data/live_spot_trades.json";
    for (const p of [p1, p2]) {
      if (fs.existsSync(p)) {
        try {
          const d = JSON.parse(fs.readFileSync(p, "utf8"));
          console.log(p, "length:", d.length);
          console.log("Sample 3:", JSON.stringify(d.slice(0, 3), null, 2));
        } catch(e) {
          console.log(p, "read error:", e.message);
        }
      } else {
        console.log(p, "does not exist");
      }
    }
  '`, (err, stream) => {
    if (err) throw err;
    stream.on('close', () => conn.end())
      .on('data', data => console.log(data.toString()))
      .stderr.on('data', data => console.error(data.toString()));
  });
}).connect({ host: '217.196.54.11', port: 65002, username: 'u932536786', password: 'NexusQuant@6767', readyTimeout: 20000 });
