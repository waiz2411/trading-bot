const { Client } = require('ssh2');

const conn = new Client();
conn.on('ready', () => {
  console.log('Connected to VPS...');
  const testScript = `
    node -e '
      const http = require("http");
      
      function postSettings() {
        const payload = JSON.stringify({
          account: "SPOT",
          maxSlots: 2,
          stopLossPct: 0.65,
          takeProfitPct: 1.20,
          allowHighVolatility: true
        });

        const req = http.request({
          hostname: "127.0.0.1",
          port: 5000,
          path: "/api/trading/settings",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload)
          }
        }, (res) => {
          let body = "";
          res.on("data", d => body += d);
          res.on("end", () => {
            console.log("Settings save response:", body);
            checkDashboard();
          });
        });
        req.write(payload);
        req.end();
      }

      function checkDashboard() {
        http.get("http://127.0.0.1:5000/api/dashboard", (res) => {
          let body = "";
          res.on("data", d => body += d);
          res.on("end", () => {
            try {
              const data = JSON.parse(body);
              console.log("Dashboard spot riskSettings maxSlots:", data.spot && data.spot.riskSettings ? data.spot.riskSettings.maxSlots : "N/A");
              console.log("Dashboard spot allocationPct:", data.spot && data.spot.riskSettings ? data.spot.riskSettings.allocationPct : "N/A");
              console.log("Dashboard mode:", data.mode);
              console.log("Dashboard isAutonomous:", data.isAutonomous);
            } catch (e) {
              console.log("Parse error:", e.message, body.substring(0, 100));
            }
          });
        });
      }

      postSettings();
    '
  `;
  conn.exec(testScript, (err, stream) => {
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
