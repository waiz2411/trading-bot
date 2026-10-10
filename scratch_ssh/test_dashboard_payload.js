const { Client } = require('ssh2');
const conn = new Client();
conn.on('ready', () => {
  conn.exec(`cd /home/u932536786/trading-bot && node -e '
    const { agentLoop } = require("./backend/src/services/agentLoop.js");
    const data = agentLoop.getDashboardData("LIVE", "SPOT", "waiztahseen@gmail.com");
    console.log(JSON.stringify({
      isConnected: data.portfolio.isConnected,
      balance: data.portfolio.balance,
      equity: data.portfolio.equity,
      positions: data.portfolio.activePositions,
      statusMessage: data.portfolio.statusMessage,
      logsCount: data.logs.length,
      firstLog: data.logs[0]
    }, null, 2));
  '`, (err, stream) => {
    if (err) throw err;
    stream.on('close', () => conn.end()).on('data', d => process.stdout.write(d.toString())).stderr.on('data', d => process.stderr.write(d.toString()));
  });
}).connect({
  host: '82.198.229.98',
  port: 65002,
  username: 'u932536786',
  password: 'NexusQuant@6767'
});
