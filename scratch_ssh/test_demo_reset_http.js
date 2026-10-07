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
        const u2 = await authService.getUserByEmail("waiztahseen2@gmail.com");
        const t2 = authService.createSessionToken(u2);
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
      const t2 = lines.find(l => l.startsWith('TOKEN2:'))?.replace('TOKEN2:', '').trim();

      const curlCmd = `
        echo "=== RESETTING DEMO SPOT BALANCE TO $50 VIA HTTP ==="
        curl -s -X POST --unix-socket /home/u932536786/trading-bot/trading-bot.sock http://localhost/api/portfolio/reset \\
          -H "Authorization: Bearer ${t2}" \\
          -H "Content-Type: application/json" \\
          -d '{"initialBalance": 50, "account": "SPOT"}' | node -e '
            let s = "";
            process.stdin.on("data", d => s += d);
            process.stdin.on("end", () => {
              try {
                const d = JSON.parse(s);
                console.log("RAW_RESET_OUTPUT:", s);
              } catch(e) { console.log("RAW:", s); }
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
