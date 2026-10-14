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
      console.log("Calling convertDustToBnb with all dust...");
      const res = await binanceConnector.convertDustToBnb(["NEAR", "BAT", "BEL", "AERO", "MINA", "VIC", "BTTC"]);
      console.log("Dust Conversion Result:", res);
      const bals = await binanceConnector.getBalances(true);
      console.log("Remaining Non-Zero Balances:", bals);
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
