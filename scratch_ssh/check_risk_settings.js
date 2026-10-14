const { Client } = require('ssh2');
const conn = new Client();
conn.on('ready', () => {
  conn.exec(`
    curl -s --unix-socket /home/u932536786/trading-bot/trading-bot.sock 'http://localhost/api/dashboard?account=SPOT' | grep -o '"riskSettings":{[^}]*}'
  `, (err, stream) => {
    if (err) throw err;
    stream.on('close', () => conn.end())
      .on('data', d => console.log(d.toString()));
  });
}).connect({
  host: '82.198.229.98',
  port: 65002,
  username: 'u932536786',
  password: 'NexusQuant@6767',
  readyTimeout: 30000
});
