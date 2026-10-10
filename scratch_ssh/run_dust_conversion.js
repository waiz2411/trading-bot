const { Client } = require('ssh2');
const conn = new Client();
conn.on('ready', () => {
  conn.exec(`cd /home/u932536786/trading-bot && node -e '
    const { binanceConnector } = require("./backend/src/services/binanceConnector.js");
    const { authService } = require("./backend/src/services/authService.js");
    (async () => {
      const user = await authService.getUserByEmail("waiztahseen@gmail.com");
      binanceConnector.configure(user.brokerConnections.binance);
      const q = binanceConnector.signQuery("");
      const res = await binanceConnector.request("/sapi/v1/asset/dust-btc?" + q, { method: "POST" });
      const data = await binanceConnector.parseJsonResponse(res);
      if (data && data.details) {
        // True dust: exclude USDT, USDC, and any large holding like MINA (value > 0.0001 BTC)
        const dustOnly = data.details
          .filter(d => d.asset !== "USDT" && d.asset !== "USDC" && parseFloat(d.toBTC) < 0.00001)
          .map(d => d.asset);
        console.log("True dust to convert to BNB:", dustOnly);
        
        const params = new URLSearchParams();
        for (const a of dustOnly) {
          params.append("asset", a);
        }
        const postQ = binanceConnector.signQuery(params.toString());
        const postRes = await binanceConnector.request("/sapi/v1/asset/dust?" + postQ, { method: "POST" });
        const postData = await binanceConnector.parseJsonResponse(postRes);
        console.log("Conversion Result:", JSON.stringify(postData, null, 2));
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
