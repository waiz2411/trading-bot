const { Client } = require('ssh2');
const conn = new Client();
conn.on('ready', () => {
  conn.exec(`cd /home/u932536786/trading-bot && node -e '
    const { binanceConnector } = require("./backend/src/services/binanceConnector.js");
    const { authService } = require("./backend/src/services/authService.js");
    
    (async () => {
      const user = await authService.getUserByEmail("waiztahseen@gmail.com");
      const bCfg = user?.brokerConnections?.binance;
      if (bCfg) {
        binanceConnector.configure(bCfg);
        // Test GET /sapi/v1/asset/dust-btc to see eligible assets
        const signedQuery = binanceConnector.signQuery("");
        const res = await binanceConnector.request("/sapi/v1/asset/dust-btc?" + signedQuery);
        const data = await binanceConnector.parseJsonResponse(res);
        console.log("Eligible dust assets count:", data.details?.length);
        if (data.details) {
          console.log("Eligible assets:", data.details.map(d => d.asset));
          const eligibleNames = data.details.map(d => d.asset);
          // Try converting the eligible ones
          const params = new URLSearchParams();
          for (const a of eligibleNames) {
            params.append("asset", a);
          }
          const postQuery = binanceConnector.signQuery(params.toString());
          const postRes = await binanceConnector.request("/sapi/v1/asset/dust?" + postQuery, { method: "POST" });
          const postData = await binanceConnector.parseJsonResponse(postRes);
          console.log("Dust conversion result for eligible assets:", postData);
        }
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
