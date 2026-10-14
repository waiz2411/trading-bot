const { Client } = require('ssh2');
const conn = new Client();
conn.on('ready', () => {
  conn.exec(`
    cd /home/u932536786/trading-bot
    cat << 'EOF' > ./check_rs_leaders.js
import { marketDataService } from "./backend/src/services/marketData.js";
import { evaluateBtcHealth, scanRelativeStrengthLeaders, evaluateSpotConfluence } from "./backend/src/services/strategyEngine.js";
import { calculateTechnicalMetrics } from "./backend/src/services/technicalAnalysis.js";

async function main() {
  const markets = marketDataService.getAllMarkets();
  console.log("Total markets:", markets.length);
  const btcAsset = markets.find(m => m.symbol === 'BTC-USD' || m.symbol === 'BTCUSDT' || m.symbol === 'BTC/USDT');
  const btcHealth = evaluateBtcHealth(btcAsset?.candles);
  console.log("BTC Health:", btcHealth);

  const topLeaders = scanRelativeStrengthLeaders(markets, btcAsset?.candles, 10);
  console.log("Top RS Leaders count:", topLeaders.length);
  console.log("Top RS Leaders:", topLeaders.map(l => ({ symbol: l.symbol, compositeRS: l.compositeRS })));

  const spotContext = { btcHealth, topLeaders };
  for (const leader of topLeaders) {
    const technicals = calculateTechnicalMetrics(leader.asset.candles);
    const signal = evaluateSpotConfluence(leader.asset, technicals, {}, spotContext);
    console.log("Leader [" + leader.symbol + "]:", {
      action: signal.action,
      conf: signal.confidence,
      reason: signal.reason
    });
  }
  process.exit(0);
}
main().catch(err => { console.error(err); process.exit(1); });
EOF
    node ./check_rs_leaders.js
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
