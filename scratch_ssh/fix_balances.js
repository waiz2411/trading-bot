const { Client } = require('ssh2');

const conn = new Client();
conn.on('ready', () => {
  conn.exec(`node -e '
    const fs = require("fs");
    const path = require("path");
    
    function fixEngineFile(filePath) {
      if (!fs.existsSync(filePath)) return;
      const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
      console.log("Processing:", filePath);
      console.log("Current balance:", data.balance, "Initial:", data.initialBalance);
      
      const bttcTrades = data.closedTrades.filter(t => t.symbol === "BTTC-USD" || t.finalPnL <= -5);
      console.log("Found glitch trades:", bttcTrades.length);
      
      // Remove the glitch trades
      data.closedTrades = data.closedTrades.filter(t => t.symbol !== "BTTC-USD" && t.finalPnL > -5);
      
      // Recalculate stats
      let runningBal = data.initialBalance || 20;
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
          totalGrossProfit += (t.grossPnL || t.finalPnL);
        } else if (t.finalPnL < 0) {
          losses++;
          totalGrossLoss += Math.abs(t.grossPnL || t.finalPnL);
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
      
      console.log("RESTORED BALANCE:", data.balance, "WINS:", wins, "LOSSES:", losses);
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
    }
    
    fixEngineFile("/home/u932536786/trading-bot/backend/backend/src/data/persisted_engine_spot_waiztahseen2_gmail_com.json");
    fixEngineFile("/home/u932536786/trading-bot/backend/backend/src/data/persisted_engine_spot_waiztahseen_gmail_com.json");
  '`, (err, stream) => {
    if (err) throw err;
    stream.on('close', () => conn.end())
      .on('data', data => console.log('STDOUT: ' + data))
      .stderr.on('data', data => console.log('STDERR: ' + data));
  });
}).connect({
  host: '217.196.54.11',
  port: 65002,
  username: 'u932536786',
  password: 'NexusQuant@6767',
  readyTimeout: 20000
});
