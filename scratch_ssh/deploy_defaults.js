const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const conn = new Client();
conn.on('ready', () => {
  console.log('Connected to Hostinger Frankfurt VPS (82.198.229.98)...');
  conn.sftp(async (err, sftp) => {
    if (err) throw err;

    const fastPutAsync = (local, remote) => new Promise((resolve, reject) => {
      sftp.fastPut(local, remote, (err) => err ? reject(err) : resolve());
    });

    try {
      console.log('Uploading server.js...');
      await fastPutAsync(
        path.join(__dirname, '..', 'backend', 'src', 'server.js'),
        '/home/u932536786/trading-bot/backend/src/server.js'
      );
      console.log('server.js uploaded.');

      console.log('Uploading agentLoop.js...');
      await fastPutAsync(
        path.join(__dirname, '..', 'backend', 'src', 'services', 'agentLoop.js'),
        '/home/u932536786/trading-bot/backend/src/services/agentLoop.js'
      );
      console.log('agentLoop.js uploaded.');

      console.log('Uploading technicalAnalysis.js...');
      await fastPutAsync(
        path.join(__dirname, '..', 'backend', 'src', 'services', 'technicalAnalysis.js'),
        '/home/u932536786/trading-bot/backend/src/services/technicalAnalysis.js'
      );
      console.log('technicalAnalysis.js uploaded.');

      console.log('Uploading strategyEngine.js...');
      await fastPutAsync(
        path.join(__dirname, '..', 'backend', 'src', 'services', 'strategyEngine.js'),
        '/home/u932536786/trading-bot/backend/src/services/strategyEngine.js'
      );
      console.log('strategyEngine.js uploaded.');

      console.log('Uploading paperTradingEngine.js...');
      await fastPutAsync(
        path.join(__dirname, '..', 'backend', 'src', 'services', 'paperTradingEngine.js'),
        '/home/u932536786/trading-bot/backend/src/services/paperTradingEngine.js'
      );
      console.log('paperTradingEngine.js uploaded.');

      console.log('Uploading marketData.js...');
      await fastPutAsync(
        path.join(__dirname, '..', 'backend', 'src', 'services', 'marketData.js'),
        '/home/u932536786/trading-bot/backend/src/services/marketData.js'
      );
      console.log('marketData.js uploaded.');

      console.log('Uploading halalFilter.js...');
      await fastPutAsync(
        path.join(__dirname, '..', 'backend', 'src', 'services', 'halalFilter.js'),
        '/home/u932536786/trading-bot/backend/src/services/halalFilter.js'
      );
      console.log('halalFilter.js uploaded.');

      // Upload dist files
      const distLocal = path.join(__dirname, '..', 'frontend', 'dist');
      const distRemote = '/home/u932536786/trading-bot/frontend/dist';

      async function uploadDir(localDir, remoteDir) {
        const entries = fs.readdirSync(localDir, { withFileTypes: true });
        for (const entry of entries) {
          const localPath = path.join(localDir, entry.name);
          const remotePath = `${remoteDir}/${entry.name}`;
          if (entry.isDirectory()) {
            await new Promise(res => sftp.mkdir(remotePath, () => res()));
            await uploadDir(localPath, remotePath);
          } else {
            await fastPutAsync(localPath, remotePath);
            console.log(`Uploaded ${entry.name}`);
          }
        }
      }

      console.log('Uploading dist assets...');
      await uploadDir(distLocal, distRemote);
      console.log('Dist assets uploaded.');

      // Restart PM2, save process list, and verify socket
      const remoteCmd = `
        cd /home/u932536786/trading-bot
        rm -f trading-bot.sock
        pm2 restart trading-bot || pm2 start ecosystem.config.cjs
        pm2 save
        echo "Waiting 4 seconds..."
        sleep 4
        pm2 status
        pm2 logs trading-bot --lines 20 --nostream
        echo "Testing Unix Socket directly..."
        curl -s --unix-socket /home/u932536786/trading-bot/trading-bot.sock http://localhost/api/dashboard | head -c 200
      `;

      conn.exec(remoteCmd, (err, stream) => {
        if (err) throw err;
        stream.on('close', () => {
          console.log('Deployment complete and verified.');
          conn.end();
        }).on('data', d => process.stdout.write(d.toString()))
          .stderr.on('data', d => process.stderr.write(d.toString()));
      });

    } catch (deployErr) {
      console.error('Deployment error:', deployErr);
      conn.end();
    }
  });
}).connect({
  host: '82.198.229.98',
  port: 65002,
  username: 'u932536786',
  password: 'NexusQuant@6767',
  readyTimeout: 40000
});
