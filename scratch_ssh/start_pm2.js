const { Client } = require('ssh2');

const conn = new Client();
conn.on('ready', () => {
  const startCmd = `
    cd /home/u932536786/trading-bot
    rm -f trading-bot.sock
    pm2 start ecosystem.config.cjs
    pm2 save
    echo "Waiting 5 seconds..."
    sleep 5
    pm2 status
    echo "Checking socket..."
    ls -l trading-bot.sock
    curl -s --unix-socket /home/u932536786/trading-bot/trading-bot.sock http://localhost/api/dashboard | head -c 200
  `;
  conn.exec(startCmd, (err, stream) => {
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
