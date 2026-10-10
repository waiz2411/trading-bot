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
        const bals = await binanceConnector.getBalances(true);
        console.log("Current balances:", bals.filter(b => b.free > 0));
        
        const dustAssets = bals.filter(b => b.asset !== "USDT" && b.asset !== "BNB" && b.free > 0).map(b => b.asset);
        console.log("Attempting dust conversion for:", dustAssets);
        const res = await binanceConnector.convertDustToBnb(dustAssets);
        console.log("Dust conversion result:", res);
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
