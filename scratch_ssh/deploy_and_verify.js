const { Client } = require('ssh2');

const conn = new Client();
conn.on('ready', () => {
  const remoteCmd = `
    cd /home/u932536786/trading-bot
    git fetch origin main
    git reset --hard origin/main
    
    # Purge the phantom CHIP trades from live_spot_trades.json so ledger matches true Binance state
    echo "[]" > backend/src/data/live_spot_trades.json

    pm2 restart trading-bot
    sleep 3
    pm2 status
  `;

  conn.on('error', err => console.error('SSH Error:', err.message));
  conn.exec(remoteCmd, (err, stream) => {
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
  readyTimeout: 40000
});
