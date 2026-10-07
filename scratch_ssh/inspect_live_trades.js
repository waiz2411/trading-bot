const { Client } = require('ssh2');

const conn = new Client();
conn.on('error', err => console.log('SSH Notice:', err.message));
conn.on('ready', () => {
  const remoteCmd = `
    cd /home/u932536786/trading-bot
    node --input-type=module -e '
      import fs from "fs";
      try {
        const d = JSON.parse(fs.readFileSync("./backend/src/data/live_spot_trades.json", "utf8"));
        console.log("LIVE TRADES COUNT:", d?.length);
        for (const t of (d || []).slice(-15)) {
          console.log(t.openTime, t.symbol, "entry:", t.entryPrice, "exit:", t.exitPrice, "pnl:", t.finalPnL, "reason:", t.exitReason, "note:", t.exitNote);
        }
      } catch (e) {
        console.error(e.message);
      }
      process.exit(0);
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
  readyTimeout: 30000
});
