const { Client } = require('ssh2');

const conn = new Client();
conn.on('ready', () => {
  console.log('Client connected to Hostinger VPS.');

  const bashScript = `
    echo "=== STEP 1: Stopping PM2 ==="
    pm2 stop all

    echo "=== STEP 2: Sanitizing Glitch Trades & Restoring Balances ==="
    node -e '
      const fs = require("fs");
      const path = require("path");
      const glob = require("child_process").execSync("find /home/u932536786/trading-bot -name \\"persisted_engine_spot*.json\\"").toString().trim().split("\\n");
      
      glob.forEach(filePath => {
        if (!filePath || !fs.existsSync(filePath)) return;
        try {
          const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
          console.log("\\n--- Processing:", filePath);
          console.log("Initial Balance:", data.initialBalance, "Current Balance before fix:", data.balance);
          
          const glitchTrades = (data.closedTrades || []).filter(t => t.symbol === "BTTC-USD" || t.finalPnL <= -5);
          console.log("Found glitch trades count:", glitchTrades.length);
          if (glitchTrades.length > 0) {
            glitchTrades.forEach(gt => console.log("Glitch trade:", gt.symbol, "PnL:", gt.finalPnL, "Exit:", gt.exitReason));
          }
          
          // Filter out glitch trades
          data.closedTrades = (data.closedTrades || []).filter(t => t.symbol !== "BTTC-USD" && t.finalPnL > -5);
          
          // Also check activePositions just in case
          if (Array.isArray(data.activePositions)) {
            data.activePositions = data.activePositions.filter(p => p.symbol !== "BTTC-USD");
          }
          
          let runningBal = Number(data.initialBalance) || 20;
          let wins = 0;
          let losses = 0;
          let be = 0;
          let totalGrossProfit = 0;
          let totalGrossLoss = 0;
          let totalFees = 0;
          
          for (const t of data.closedTrades) {
            runningBal += (t.finalPnL || 0);
            totalFees += (t.fee || t.totalFees || 0);
            if (t.finalPnL > 0) {
              wins++;
              totalGrossProfit += (t.grossPnL || t.finalPnL || 0);
            } else if (t.finalPnL < 0) {
              losses++;
              totalGrossLoss += Math.abs(t.grossPnL || t.finalPnL || 0);
            } else {
              be++;
            }
          }
          
          data.balance = Number(runningBal.toFixed(2));
          data.winCount = wins;
          data.lossCount = losses;
          data.breakEvenCount = be;
          data.totalGrossProfit = Number(totalGrossProfit.toFixed(2));
          data.totalGrossLoss = Number(totalGrossLoss.toFixed(2));
          data.totalFeesPaid = Number(totalFees.toFixed(2));
          
          console.log("RESTORED BALANCE ->", data.balance, "Wins:", wins, "Losses:", losses, "Total Trades:", data.closedTrades.length);
          fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
        } catch (err) {
          console.error("Error processing " + filePath + ":", err.message);
        }
      });
    '

    echo "=== STEP 3: Pulling Git Updates & Building Frontend ==="
    cd /home/u932536786/trading-bot
    git pull origin main
    npm run build:frontend
    cp -r frontend/dist/* ~/domains/slategrey-reindeer-680249.hostingersite.com/public_html/

    echo "=== STEP 4: Restarting PM2 ==="
    pm2 restart all
    pm2 status
  `;

  conn.exec(bashScript, (err, stream) => {
    if (err) throw err;
    stream.on('close', (code, signal) => {
      console.log('Stream closed with code:', code);
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
