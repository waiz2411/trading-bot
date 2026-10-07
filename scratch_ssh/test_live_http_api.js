const { Client } = require('ssh2');

const conn = new Client();
conn.on('error', err => console.log('SSH Notice:', err.message));
conn.on('ready', () => {
  const remoteCmd = `
    cd /home/u932536786/trading-bot
    node --input-type=module -e '
      import { authService } from "./backend/src/services/authService.js";
      (async () => {
        await authService.init();
        const u1 = await authService.getUserByEmail("waiztahseen@gmail.com");
        const t1 = authService.createSessionToken(u1);
        const u2 = await authService.getUserByEmail("waiztahseen2@gmail.com");
        const t2 = authService.createSessionToken(u2);
        console.log("TOKEN1:" + t1);
        console.log("TOKEN2:" + t2);
        process.exit(0);
      })();
    '
  `;

  conn.exec(remoteCmd, (err, stream) => {
    if (err) throw err;
    let tokens = '';
    stream.on('close', () => {
      const lines = tokens.split('\n');
      const t1 = lines.find(l => l.startsWith('TOKEN1:'))?.replace('TOKEN1:', '').trim();
      const t2 = lines.find(l => l.startsWith('TOKEN2:'))?.replace('TOKEN2:', '').trim();

      const curlCmd = `
        echo "=== LIVE USER DASHBOARD (via Socket) ==="
        curl -s --unix-socket /home/u932536786/trading-bot/trading-bot.sock http://localhost/api/dashboard -H "Authorization: Bearer ${t1}" | node -e '
          let s = "";
          process.stdin.on("data", d => s += d);
          process.stdin.on("end", () => {
            try {
              const d = JSON.parse(s);
              console.log("LIVE:", JSON.stringify({
                user: d.currentUser,
                mode: d.currentMode,
                binanceConnected: d.brokers?.binance?.connected,
                spotBalance: d.spot?.portfolio?.balance,
                spotFreeCash: d.spot?.portfolio?.freeCash,
                activePositions: d.spot?.portfolio?.activePositions?.length
              }, null, 2));
            } catch(e) { console.log("RAW:", s.slice(0, 200)); }
          });
        '
        
        echo "=== DEMO USER DASHBOARD (via Socket) ==="
        curl -s --unix-socket /home/u932536786/trading-bot/trading-bot.sock http://localhost/api/dashboard -H "Authorization: Bearer ${t2}" | node -e '
          let s = "";
          process.stdin.on("data", d => s += d);
          process.stdin.on("end", () => {
            try {
              const d = JSON.parse(s);
              console.log("DEMO:", JSON.stringify({
                user: d.currentUser,
                mode: d.currentMode,
                spotBalance: d.spot?.portfolio?.balance,
                spotFreeCash: d.spot?.portfolio?.freeCash,
                activePositions: d.spot?.portfolio?.activePositions?.length
              }, null, 2));
            } catch(e) { console.log("RAW:", s.slice(0, 200)); }
          });
        '
      `;

      conn.exec(curlCmd, (err2, stream2) => {
        if (err2) throw err2;
        stream2.on('close', () => conn.end())
          .on('data', d => console.log(d.toString()))
          .stderr.on('data', d => console.error(d.toString()));
      });
    })
    .on('data', data => { tokens += data.toString(); });
  });
}).connect({
  host: '217.196.54.11',
  port: 65002,
  username: 'u932536786',
  password: 'NexusQuant@6767',
  readyTimeout: 30000
});
