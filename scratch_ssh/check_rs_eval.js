const { Client } = require('ssh2');
const conn = new Client();
conn.on('ready', () => {
  conn.exec(`
    cd /home/u932536786/trading-bot
    cat << 'EOF' > ./check_rs_eval.js
import { marketDataService } from "./backend/src/services/marketData.js";
import { evaluateBtcHealth, scanRelativeStrengthLeaders, evaluateSpotConfluence } from "./backend/src/services/strategyEngine.js";
import { calculateTechnicalMetrics } from "./backend/src/services/technicalAnalysis.js";

async function main() {
  await marketDataService.updateAll();
  const markets = marketDataService.getAllMarkets();
  const btc = markets.find(m => m.symbol === 'BTC-USD');
  const btcHealth = evaluateBtcHealth(btc?.candles);
  const leaders = scanRelativeStrengthLeaders(markets, btc?.candles, 10);
  console.log("Found leaders:", leaders.length);
  for (const l of leaders) {
    const tech = calculateTechnicalMetrics(l.asset.candles);
    const sig = evaluateSpotConfluence(l.asset, tech, {}, { btcHealth, topLeaders: leaders });
    console.log("Leader:", l.symbol, "RS:", l.compositeRS, "Vol24h:", l.asset.quoteVolume, "Action:", sig.action, "Reason:", sig.reason);
  }
  process.exit(0);
}
main().catch(err => { console.error(err); process.exit(1); });
EOF
    node ./check_rs_eval.js
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
