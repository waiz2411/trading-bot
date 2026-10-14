const { Client } = require('ssh2');

const conn = new Client();
conn.on('ready', () => {
  const cmd = `
    cat /proc/net/tcp | grep -i "1388" || true
  `;
  // 5000 in hex is 1388
  conn.exec(cmd, (err, stream) => {
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
