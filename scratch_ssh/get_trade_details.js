const { Client } = require('ssh2');
const conn = new Client();
conn.on('ready', () => {
  conn.exec(`
    grep -E 'SCALP OPEN|Stop Loss Hit|TARGET HIT|STOP HIT|W-USD|STRK|S-USD|NEAR|RSR|FTM' /home/u932536786/.pm2/logs/trading-bot-out-0.log | tail -n 40
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
