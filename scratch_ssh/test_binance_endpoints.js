const { Client } = require('ssh2');

const conn = new Client();
conn.on('ready', () => {
  const cmd = `
    for h in testnet.binance.vision api.binance.us data-api.binance.vision; do
      code=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 4 https://$h/api/v3/ping)
      echo "$h -> HTTP $code"
    done
  `;
  conn.exec(cmd, (err, stream) => {
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
