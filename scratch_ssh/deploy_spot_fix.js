const { Client } = require('ssh2');

const conn = new Client();
conn.on('ready', () => {
  console.log('Client connected to Hostinger VPS.');

  const bashScript = `
    cd /home/u932536786/trading-bot
    echo "=== STEP 1: Git Pull Origin Main ==="
    git fetch origin main
    git reset --hard origin/main

    echo "=== STEP 2: Clear legacy test trades from live_spot_trades.json ==="
    echo "[]" > backend/src/data/live_spot_trades.json

    echo "=== STEP 3: Build Frontend & Sync to Web Root ==="
    npm run build:frontend
    cp -r frontend/dist/* /home/u932536786/domains/slategrey-reindeer-680249.hostingersite.com/public_html/

    echo "=== STEP 4: PM2 Restart ==="
    pm2 restart all --update-env
    pm2 status
  `;

  conn.exec(bashScript, (err, stream) => {
    if (err) throw err;
    stream.on('close', (code, signal) => {
      console.log('Deployment stream closed with exit code:', code);
      conn.end();
    }).on('data', data => {
      process.stdout.write(data.toString());
    }).stderr.on('data', data => {
      process.stderr.write(data.toString());
    });
  });
}).on('error', err => {
  console.error('SSH Connection error:', err);
}).connect({
  host: '217.196.54.11',
  port: 65002,
  username: 'u932536786',
  password: 'NexusQuant@6767',
  readyTimeout: 30000
});
