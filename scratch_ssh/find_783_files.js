const { Client } = require('ssh2');
const conn = new Client();
conn.on('error', err => console.error('SSH Error:', err));
conn.on('ready', () => {
  conn.exec(`grep -rn "7.83" /home/u932536786/trading-bot/backend/`, (err, stream) => {
    if (err) throw err;
    stream.on('close', () => conn.end())
      .on('data', data => console.log('FOUND 7.83:\n', data.toString()))
      .stderr.on('data', data => console.error(data.toString()));
  });
}).connect({ host: '217.196.54.11', port: 65002, username: 'u932536786', password: 'NexusQuant@6767', readyTimeout: 20000 });
