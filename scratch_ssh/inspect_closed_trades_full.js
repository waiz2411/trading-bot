const { Client } = require('ssh2');
const conn = new Client();
conn.on('ready', () => {
  conn.exec(`
    cd /home/u932536786/trading-bot
    node --input-type=module -e '
      import { agentLoop } from "./backend/src/services/agentLoop.js";
      (async () => {
        const eng = agentLoop.getEngine("SPOT", "waiztahseen2@gmail.com");
        const trades = eng.closedTrades || [];
        for (const t of trades) {
          console.log("-----------------------------------------");
          console.log("Symbol:", t.symbol, "Reason:", t.exitReason);
          console.log("Entry:", t.entryPrice, "Exit:", t.exitPrice, "PnL:", t.finalPnL, "Pct:", t.finalPnLPercent);
          console.log("SL:", t.stopLoss, "TP:", t.takeProfit);
          console.log("Open:", t.openTime, "Close:", t.exitTime);
          console.log("Reason Text:", t.reason);
        }
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
