const { Client } = require('ssh2');

const conn = new Client();
conn.on('ready', () => {
  conn.exec('curl -s --unix-socket /home/u932536786/trading-bot/trading-bot.sock http://localhost/api/dashboard', (err, stream) => {
    if (err) throw err;
    let out = '';
    stream.on('close', () => {
      try {
        const d = JSON.parse(out);
        console.log('Logs count:', d.logs?.length);
        console.log('Last 25 logs:');
        for (const l of (d.logs || []).slice(0, 25)) {
          console.log(`[${l.time || l.timestamp}] [${l.type}] ${l.message}`);
        }
      } catch(e) {
        console.log('Error parsing:', e.message);
      }
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
  readyTimeout: 35000
});
