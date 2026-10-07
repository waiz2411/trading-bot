const { Client } = require('ssh2');

const conn = new Client();
conn.on('ready', () => {
  conn.exec('find /home/u932536786/trading-bot -name "persisted_*.json" -o -name "*spot_trades*.json"', (err, stream) => {
    if (err) throw err;
    stream.on('close', () => conn.end())
      .on('data', data => console.log('STDOUT: ' + data))
      .stderr.on('data', data => console.log('STDERR: ' + data));
  });
}).connect({
  host: '217.196.54.11',
  port: 65002,
  username: 'u932536786',
  password: 'NexusQuant@6767',
  readyTimeout: 20000
});
