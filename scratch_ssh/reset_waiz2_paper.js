const { Client } = require('ssh2');

const conn = new Client();
conn.on('ready', () => {
  const remoteScript = `
cd /home/u932536786/trading-bot && node --input-type=module -e '
import { db } from "./backend/src/services/db.js";
(async () => {
  const cleanState = {
    accountType: "SPOT",
    balance: 12.0,
    initialBalance: 12.0,
    activePositions: [],
    closedTrades: [],
    winCount: 0,
    lossCount: 0,
    breakEvenCount: 0,
    totalGrossProfit: 0,
    totalGrossLoss: 0,
    totalFeesPaid: 0,
    updatedAt: new Date().toISOString()
  };
  await db.query(
    \`UPDATE user_portfolios SET state_json = ? WHERE user_email = "waiztahseen2_gmail_com" AND account_type = "SPOT"\`,
    [JSON.stringify(cleanState)]
  );
  console.log("Successfully reset waiztahseen2_gmail_com SPOT portfolio to $12.00 clean state!");
  process.exit(0);
})();
'
`;
  conn.exec(remoteScript, (err, stream) => {
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
