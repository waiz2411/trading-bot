const { Client } = require('ssh2');
const conn = new Client();
conn.on('ready', () => {
  conn.exec(`cd /home/u932536786/trading-bot && node -e '
    const { agentLoop } = require("./backend/src/services/agentLoop.js");
    const data = agentLoop.getDashboardData("LIVE", "SPOT", "waiztahseen@gmail.com");
    console.log(JSON.stringify({
      isLive: data.mode === "LIVE",
      isAuto: data.isAutoTradingEnabled,
      balance: data.portfolio.balance,
      positionsCount: data.portfolio.activePositions ? data.portfolio.activePositions.length : 0,
      positions: data.portfolio.activePositions
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
