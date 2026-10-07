const { Client } = require('ssh2');

const conn = new Client();
conn.on('ready', () => {
  conn.exec('grep -i "MEGA" /home/u932536786/.pm2/logs/*.log | tail -n 25', (err, stream) => {
    if (err) throw err;
    let out = '';
    stream.on('close', () => {
      console.log('MEGA LOGS:\n', out);
      conn.end();
    })
    .on('data', d => out += d.toString())
    .stderr.on('data', d => process.stderr.write(d.toString()));
  });
}).connect({
  host: '217.196.54.11',
  port: 65002,
  username: 'u932536786',
  password: 'NexusQuant@6767',
  readyTimeout: 60000
});
