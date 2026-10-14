const { Client } = require('ssh2');
const conn = new Client();
conn.on('ready', () => {
  conn.exec(`
    cd /home/u932536786/trading-bot
    cat << 'EOF' > ./check_waiz2_state.js
import { authService } from "./backend/src/services/authService.js";
import { execFileSync } from "child_process";

async function main() {
  const user = await authService.getUserByEmail("waiztahseen2@gmail.com");
  const token = authService.createSessionToken(user);
  const out = execFileSync('curl', [
    '-s',
    '--unix-socket', '/home/u932536786/trading-bot/trading-bot.sock',
    'http://localhost/api/dashboard?mode=SIMULATED&account=SPOT',
    '-H', 'Authorization: Bearer ' + token
  ]).toString();

  const data = JSON.parse(out);
  console.log("=== WAIZ 2 DASHBOARD TELEMETRY ===");
  console.log("Account:", data.activeAccount);
  console.log("Mode:", data.mode);
  console.log("IsAutoTrading:", data.isAutoTradingEnabled);
  console.log("Balance:", data.spot?.portfolio?.balance);
  console.log("AvailableCash:", data.spot?.portfolio?.freeCash);
  console.log("ActivePositions count:", data.spot?.portfolio?.activePositions?.length);
  console.log("ClosedTrades count:", data.spot?.portfolio?.closedTrades?.length);
  console.log("MarketScan count:", data.marketScan?.length);
  const strongBuys = (data.marketScan || []).filter(m => m.signal?.action === 'STRONG_BUY');
  console.log("Current STRONG_BUY signals count:", strongBuys.length);
  if (strongBuys.length > 0) {
    console.log("Strong buys:", strongBuys.map(s => ({ symbol: s.symbol, conf: s.signal.confidence, reason: s.signal.reason })));
  } else {
    // Check top candidate rejection reasons
    const topCandidates = (data.marketScan || []).slice(0, 5);
    console.log("Top 5 candidates reasons:", topCandidates.map(s => ({ symbol: s.symbol, action: s.signal?.action, reason: s.signal?.reason })));
  }
  process.exit(0);
}
main().catch(err => { console.error(err); process.exit(1); });
EOF
    node ./check_waiz2_state.js
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
