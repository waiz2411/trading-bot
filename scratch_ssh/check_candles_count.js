const { Client } = require('ssh2');
const conn = new Client();
conn.on('ready', () => {
  conn.exec(`
    cd /home/u932536786/trading-bot
    cat << 'EOF' > ./check_candles_count.js
import { marketDataService } from "./backend/src/services/marketData.js";
import { evaluateBtcHealth } from "./backend/src/services/strategyEngine.js";

async function main() {
  await marketDataService.updateAll();
  const markets = marketDataService.getAllMarkets();
  const btc = markets.find(m => m.symbol === 'BTC-USD');
  console.log("BTC candles:", btc?.candles?.length, "isRealCandles:", btc?.isRealCandles);
  if (btc?.candles) {
    console.log("BTC health:", evaluateBtcHealth(btc.candles));
  }
  const realCandleAssets = markets.filter(m => m.category === 'Crypto' && m.isRealCandles && m.candles?.length >= 48);
  console.log("Crypto assets with real candles >= 48:", realCandleAssets.length);
  if (realCandleAssets.length > 0) {
    console.log("Sample:", realCandleAssets.slice(0, 5).map(m => ({ symbol: m.symbol, candles: m.candles.length })));
  }
  process.exit(0);
}
main().catch(err => { console.error(err); process.exit(1); });
EOF
    node ./check_candles_count.js
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
