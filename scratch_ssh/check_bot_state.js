const { Client } = require('ssh2');
const conn = new Client();
conn.on('ready', () => {
  conn.exec(`curl -s http://127.0.0.1:5000/api/dashboard`, (err, stream) => {
    if (err) throw err;
    let data = '';
    stream.on('close', () => {
      try {
        const json = JSON.parse(data);
        console.log("Dashboard response:", {
          isAutoTradingEnabled: json.isAutoTradingEnabled,
          activeAccount: json.activeAccount,
          currentMode: json.currentMode,
          spotBalance: json.spotBalance,
          liveSpotPositions: json.liveSpotPositions,
          activePositions: json.activePositions?.length
        });
      } catch (e) {
        console.log("Raw dashboard:", data.slice(0, 300));
      }
      conn.end();
    }).on('data', d => data += d.toString()).stderr.on('data', d => process.stderr.write(d.toString()));
  });
}).connect({
  host: '82.198.229.98',
  port: 65002,
  username: 'u932536786',
  password: 'NexusQuant@6767'
});
