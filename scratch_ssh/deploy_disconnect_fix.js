const { Client } = require('ssh2');

const conn = new Client();
conn.on('ready', () => {
  console.log('Client connected to Hostinger Frankfurt VPS (82.198.229.98).');

  const bashScript = `
    cd /home/u932536786/trading-bot
    echo "=== STEP 1: Git Fetch & Reset to Origin Main ==="
    git fetch origin main
    git reset --hard origin/main

    echo "=== STEP 2: Clear any stale live trade records ==="
    echo "[]" > backend/src/data/live_spot_trades.json
    echo "[]" > backend/src/data/live_trades.json

    echo "=== STEP 3: Ensure binary permissions & Build Frontend ==="
    chmod 755 frontend/node_modules/vite/bin/vite.js frontend/node_modules/@esbuild/linux-x64/bin/esbuild || true
    npm run build:frontend

    echo "=== STEP 4: Sync to Hostinger Web Root ==="
    cp -r frontend/dist/* /home/u932536786/domains/slategrey-reindeer-680249.hostingersite.com/public_html/

    echo "=== STEP 5: Restart PM2 Backend ==="
    ~/.local/bin/pm2 restart ecosystem.config.cjs
    ~/.local/bin/pm2 status
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
  host: '82.198.229.98',
  port: 65002,
  username: 'u932536786',
  password: 'NexusQuant@6767',
  readyTimeout: 30000
});
