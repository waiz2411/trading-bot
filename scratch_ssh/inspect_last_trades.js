const { Client } = require('ssh2');

const conn = new Client();
conn.on('ready', () => {
  conn.exec(`
    cd /home/u932536786/trading-bot
    DB_HOST=127.0.0.1 DB_USER=u932536786_waiztahseen DB_PASSWORD=NexusQuant@6767 DB_NAME=u932536786_nexus_quant DB_PORT=3306 node -e "
      import('./backend/src/services/db.js').then(async m => {
        const db = m.db;
        const [row] = await db.query('SELECT state_json FROM user_portfolios WHERE id = 7');
        const state = JSON.parse(row[0].state_json);
        const lastTrades = state.closedTrades.slice(-3);
        console.log(JSON.stringify(lastTrades, null, 2));
        process.exit(0);
      });
    "
  `, (err, stream) => {
    if (err) throw err;
    stream.on('data', d => process.stdout.write(d.toString()));
    stream.stderr.on('data', d => process.stderr.write(d.toString()));
    stream.on('close', () => conn.end());
  });
}).connect({
  host: '82.198.229.98',
  port: 65002,
  username: 'u932536786',
  password: process.env.SSH_PASSWORD || 'NexusQuant@6767'
});
