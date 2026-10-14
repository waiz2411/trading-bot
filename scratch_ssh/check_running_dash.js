const { Client } = require('ssh2');
const conn = new Client();
conn.on('ready', () => {
  conn.exec(`
    cd /home/u932536786/trading-bot
    cat << 'EOF' > ./test_dash.js
import { authService } from "./backend/src/services/authService.js";
import { execFileSync } from "child_process";

async function main() {
  const user = await authService.getUserByEmail("waiztahseen@gmail.com");
  const token = authService.createSessionToken(user);
  const out = execFileSync('curl', [
    '-s',
    '--unix-socket', '/home/u932536786/trading-bot/trading-bot.sock',
    'http://localhost/api/dashboard?mode=SIMULATED&account=SPOT',
    '-H', 'Authorization: Bearer ' + token
  ]).toString();

  const data = JSON.parse(out);
  console.log("activeAccount:", data.activeAccount);
  console.log("mode:", data.mode);
  console.log("marketScan count:", data.marketScan?.length);
  if (data.marketScan?.length > 0) {
    console.log("First 5 items:", data.marketScan.slice(0, 5).map(m => ({
      symbol: m.symbol,
      price: m.price,
      isHalal: m.isHalal,
      action: m.signal?.action,
      conf: m.signal?.confidence
    })));
  } else {
    console.log("marketScan is empty!");
  }
  process.exit(0);
}
main().catch(err => { console.error(err); process.exit(1); });
EOF
    node ./test_dash.js
  `, (err, stream) => {
    if (err) throw err;
    stream.on('close', () => conn.end())
      .on('data', d => process.stdout.write(d.toString()))
      .stderr.on('data', d => process.stderr.write(d.toString()));
  });
}).connect({
  host: '82.198.229.98',
  port: 65002,
  username: 'u932536786',
  password: 'NexusQuant@6767',
  readyTimeout: 40000
});
