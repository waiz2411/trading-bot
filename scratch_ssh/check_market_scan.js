const { Client } = require('ssh2');

const conn = new Client();
conn.on('ready', () => {
  conn.exec(`
    curl -s --unix-socket /home/u932536786/trading-bot/trading-bot.sock http://localhost/api/dashboard | node -e "
      let body = '';
      process.stdin.on('data', c => body += c);
      process.stdin.on('end', () => {
        try {
          const d = JSON.parse(body);
          console.log('Total marketScan items:', d.marketScan?.length);
          const buys = (d.marketScan || []).filter(m => m.action === 'STRONG_BUY' || m.signal?.action === 'STRONG_BUY');
          console.log('Strong buys count:', buys.length);
          for (const b of buys) {
            console.log(' -> BUY:', b.symbol, b.price, b.reason || b.signal?.reason);
          }
          if (buys.length === 0) {
            console.log('Sample rejections:');
            for (const m of (d.marketScan || []).slice(0, 10)) {
              console.log(' ->', m.symbol, 'Action:', m.action, 'Reason:', m.reason);
            }
          }
        } catch(e) { console.error('Parse error', e); }
      });
    "
  `, (err, stream) => {
    if (err) throw err;
    stream.on('data', d => process.stdout.write(d.toString()));
    stream.stderr.on('data', d => process.stderr.write(d.toString()));
    stream.on('close', () => {
      conn.end();
      process.exit(0);
    });
  });
}).connect({
  host: '82.198.229.98',
  port: 65002,
  username: 'u932536786',
  password: 'NexusQuant@6767'
});
