const { Client } = require('ssh2');

const realBinanceTrades = JSON.stringify([
  {
    id: "BINANCE-PLUME-335301876",
    symbol: "PLUME-USD",
    name: "PLUME",
    side: "LONG",
    entryPrice: 0.01971,
    exitPrice: 0.01948,
    units: 391,
    notional: 7.62,
    finalPnL: -0.09,
    finalPnLPercent: -1.17,
    fee: 0.0115,
    exitReason: "STOP_LOSS_TRIGGER",
    openTime: "2026-10-05T05:00:40.000Z",
    exitTime: "2026-10-05T05:09:45.000Z",
    isLiveBrokerOrder: true
  },
  {
    id: "BINANCE-PLUME-335291182",
    symbol: "PLUME-USD",
    name: "PLUME",
    side: "LONG",
    entryPrice: 0.01992,
    exitPrice: 0.01969,
    units: 391,
    notional: 7.72,
    finalPnL: -0.10,
    finalPnLPercent: -1.30,
    fee: 0.0117,
    exitReason: "STOP_LOSS_TRIGGER",
    openTime: "2026-10-05T04:57:09.000Z",
    exitTime: "2026-10-05T05:00:32.000Z",
    isLiveBrokerOrder: true
  }
], null, 2);

const conn = new Client();
conn.on('ready', () => {
  console.log('Client connected to Hostinger VPS.');

  const bashScript = `
    cd /home/u932536786/trading-bot
    echo "=== STEP 1: Git Pull Origin Main ==="
    git fetch origin main
    git reset --hard origin/main

    echo "=== STEP 2: Clean duplicate directory and sync real Binance trades ==="
    rm -rf /home/u932536786/trading-bot/backend/backend
    mkdir -p /home/u932536786/trading-bot/backend/src/data
    cat << 'EOF' > /home/u932536786/trading-bot/backend/src/data/live_spot_trades.json
${realBinanceTrades}
EOF

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
