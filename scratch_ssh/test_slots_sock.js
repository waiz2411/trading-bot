const { Client } = require('ssh2');

const conn = new Client();
conn.on('ready', () => {
  const cmd = `
    curl -s --unix-socket /home/u932536786/trading-bot/trading-bot.sock -X POST http://localhost/api/agent/settings \
      -H "Content-Type: application/json" \
      -d '{"account":"SPOT","maxSlots":2,"stopLossPct":0.65,"takeProfitPct":1.20}'
    
    echo ""
    echo "--- CHECKING DASHBOARD SPOT RISK SETTINGS ---"
    curl -s --unix-socket /home/u932536786/trading-bot/trading-bot.sock http://localhost/api/dashboard | \
      node -e '
        let d = "";
        process.stdin.on("data", c => d += c);
        process.stdin.on("end", () => {
          const j = JSON.parse(d);
          console.log("Spot maxSlots:", j.spot.riskSettings.maxSlots);
          console.log("Spot allocationPct:", j.spot.riskSettings.allocationPct);
          console.log("Spot stopLossPct:", j.spot.riskSettings.stopLossPct);
          console.log("Spot takeProfitPct:", j.spot.riskSettings.takeProfitPct);
        });
      '
  `;
  conn.exec(cmd, (err, stream) => {
    if (err) throw err;
    stream.on('close', () => {
      conn.end();
    }).on('data', d => process.stdout.write(d.toString()))
      .stderr.on('data', d => process.stderr.write(d.toString()));
  });
}).connect({
  host: '82.198.229.98',
  port: 65002,
  username: 'u932536786',
  password: 'NexusQuant@6767',
  readyTimeout: 40000
});
