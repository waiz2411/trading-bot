const { Client } = require('ssh2');

const conn = new Client();
conn.on('ready', () => {
  conn.exec(`node -e '
    const fs = require("fs");
    const data = JSON.parse(fs.readFileSync("/home/u932536786/trading-bot/backend/backend/src/data/persisted_engine_spot_waiztahseen2_gmail_com.json"));
    const losses = data.closedTrades.filter(t => t.finalPnL < 0);
    console.log("LOSSES COUNT:", losses.length);
    console.log(JSON.stringify(losses.map(l => ({
      symbol: l.symbol,
      notional: l.notional,
      entryPrice: l.entryPrice,
      exitPrice: l.exitPrice,
      stopLoss: l.stopLoss,
      exitReason: l.exitReason,
      exitNote: l.exitNote,
      finalPnL: l.finalPnL,
      pnlPercent: l.finalPnLPercent,
      openTime: l.openTime,
      closeTime: l.closeTime
    })), null, 2));
  '`, (err, stream) => {
    if (err) throw err;
    stream.on('close', () => conn.end())
      .on('data', data => console.log('STDOUT: ' + data))
      .stderr.on('data', data => console.log('STDERR: ' + data));
  });
}).connect({
  host: '217.196.54.11',
  port: 65002,
  username: 'u932536786',
  password: 'NexusQuant@6767',
  readyTimeout: 20000
});
