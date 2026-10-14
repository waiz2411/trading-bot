const { Client } = require('ssh2');

const conn = new Client();
conn.on('ready', () => {
  const remoteScript = `
cd /home/u932536786/trading-bot && node --input-type=module -e '
import { db } from "./backend/src/services/db.js";
(async () => {
  const [rows] = await db.query("SELECT user_email, account_type, state_json FROM user_portfolios WHERE account_type = \\"SPOT\\"");
  for (const r of rows) {
    const state = JSON.parse(r.state_json);
    const winRate = (state.winCount + state.lossCount) > 0 ? ((state.winCount / (state.winCount + state.lossCount)) * 100).toFixed(1) : 0;
    console.log(\`User: \${r.user_email} | Balance: \${state.balance} | Win: \${state.winCount} | Loss: \${state.lossCount} | BreakEven: \${state.breakEvenCount} | WinRate: \${winRate}% | ClosedTrades: \${state.closedTrades?.length}\`);
  }
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
