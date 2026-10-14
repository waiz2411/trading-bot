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
      const q = binanceConnector.signQuery("");
      const res = await binanceConnector.request("/api/v3/account?" + q);
      const acc = await binanceConnector.parseJsonResponse(res);
      console.log("makerCommission:", acc.makerCommission);
      console.log("takerCommission:", acc.takerCommission);
      console.log("buyerCommission:", acc.buyerCommission);
      console.log("sellerCommission:", acc.sellerCommission);
      console.log("canTrade:", acc.canTrade);
      console.log("accountType:", acc.accountType);
      console.log("permissions:", acc.permissions);
      const bnb = acc.balances.find(b => b.asset === "BNB");
      console.log("BNB balance:", bnb);
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
