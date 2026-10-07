const { Client } = require('ssh2');

const conn = new Client();
conn.on('ready', () => {
  conn.exec(`node -e '
    const http = require("http");
    const options = {
      socketPath: "/home/u932536786/trading-bot/trading-bot.sock",
      path: "/api/dashboard",
      method: "GET"
    };
    const req = http.request(options, res => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          const j = JSON.parse(data);
          console.log("MarketScan length on Hostinger:", (j.marketScan || []).length);
        } catch(e) {
          console.error(e.message);
        }
      });
    });
    req.on("error", err => console.error("Req err:", err.message));
    req.end();
  '`, (err, stream) => {
    if (err) throw err;
    stream.on('close', () => conn.end())
      .on('data', data => console.log(data.toString()))
      .stderr.on('data', data => console.error(data.toString()));
  });
}).connect({
  host: '217.196.54.11',
  port: 65002,
  username: 'u932536786',
  password: 'NexusQuant@6767',
  readyTimeout: 20000
});
