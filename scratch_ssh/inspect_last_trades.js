const { Client } = require('ssh2');
const conn = new Client();
conn.on('ready', () => {
  conn.exec(`
    cd /home/u932536786/trading-bot
    node --input-type=module -e '
      import { agentLoop } from "./backend/src/services/agentLoop.js";
      (async () => {
        const eng = agentLoop.getEngine("SPOT", "waiztahseen2@gmail.com");
        console.log("Waiz2 Spot Closed Trades:", eng.closedTrades?.length, "PnL:", eng.realizedPnL, "Bal:", eng.balance);
        const trades = eng.closedTrades || [];
        console.table(trades.slice(-14).map(t => ({
          symbol: t.symbol,
          entry: t.entryPrice,
          exit: t.exitPrice,
          pnl: t.finalPnL,
          pnlPct: t.finalPnLPercent,
          fee: t.fee,
          reason: t.exitReason,
          dur: t.openTime && t.exitTime ? Math.round((new Date(t.exitTime) - new Date(t.openTime))/1000) + "s" : "-"
        })));
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
