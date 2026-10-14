const { Client } = require('ssh2');
const conn = new Client();
conn.on('ready', () => {
  conn.exec(`cd /home/u932536786/trading-bot && node -e '
    const { binanceConnector } = require("./backend/src/services/binanceConnector.js");
    const { authService } = require("./backend/src/services/authService.js");
    (async () => {
      const user = await authService.getUserByEmail("waiztahseen@gmail.com");
      binanceConnector.configure(user.brokerConnections.binance);
      await binanceConnector.syncTime();

      const testQuantities = ["1.0989", "1.09", "1.0", "1.09890000"];
      for (const qty of testQuantities) {
        const q = binanceConnector.signQuery("symbol=NEARUSDT&side=SELL&type=MARKET&quantity=" + qty);
        const res = await binanceConnector.request("/api/v3/order/test?" + q, { method: "POST" });
        const txt = await res.text();
        console.log("Qty", qty, "HTTP", res.status, "Resp:", txt);
      }
    })();
  '`, (err, stream) => {
    if (err) throw err;
    stream.on('close', () => conn.end()).on('data', d => process.stdout.write(d.toString())).stderr.on('data', d => process.stderr.write(d.toString()));
  });
}).connect({
  host: '82.198.229.98',
  port: 65002,
  username: 'u932536786',
  password: 'NexusQuant@6767'
});
