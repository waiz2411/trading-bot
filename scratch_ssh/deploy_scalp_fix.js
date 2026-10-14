const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const conn = new Client();
conn.on('ready', () => {
  console.log('Connected to Hostinger Frankfurt VPS (82.198.229.98)...');
  conn.sftp((err, sftp) => {
    if (err) throw err;

    const localAgentLoop = path.join(__dirname, '..', 'backend', 'src', 'services', 'agentLoop.js');
    const remoteAgentLoop = '/home/u932536786/trading-bot/backend/src/services/agentLoop.js';

    const localStrategyEngine = path.join(__dirname, '..', 'backend', 'src', 'services', 'strategyEngine.js');
    const remoteStrategyEngine = '/home/u932536786/trading-bot/backend/src/services/strategyEngine.js';

    console.log('Uploading agentLoop.js...');
    sftp.fastPut(localAgentLoop, remoteAgentLoop, (err) => {
      if (err) throw err;
      console.log('agentLoop.js uploaded successfully.');

      console.log('Uploading strategyEngine.js...');
      sftp.fastPut(localStrategyEngine, remoteStrategyEngine, (err) => {
        if (err) throw err;
        console.log('strategyEngine.js uploaded successfully.');

        // Restart PM2 and monitor logs
        const remoteCmd = `
          cd /home/u932536786/trading-bot
          pm2 restart trading-bot
          echo "Waiting 6 seconds for agent loop cycle..."
          sleep 6
          pm2 logs trading-bot --lines 30 --nostream
        `;

        conn.exec(remoteCmd, (err, stream) => {
          if (err) throw err;
          stream.on('close', () => {
            console.log('Deployment verified.');
            conn.end();
          }).on('data', d => process.stdout.write(d.toString()))
            .stderr.on('data', d => process.stderr.write(d.toString()));
        });
      });
    });
  });
}).connect({
  host: '82.198.229.98',
  port: 65002,
  username: 'u932536786',
  password: 'NexusQuant@6767',
  readyTimeout: 40000
});
