const { Client } = require('ssh2');

const conn = new Client();
conn.on('ready', () => {
  conn.on('error', err => console.error('SSH Error:', err.message));
  conn.exec('pm2 logs trading-bot --lines 300 --nostream | grep -i -E "manual|chip|close|error|warn"', (err, stream) => {
    if (err) throw err;
    stream.on('close', () => conn.end())
      .on('data', data => console.log(data.toString()))
      .stderr.on('data', data => console.error(data.toString()));
  });
}).connect({
  host: '217.196.54.11',
  port: 65002,
  username: 'u932536786',
  password: 'NexusQuant@6767',
  readyTimeout: 35000
});
