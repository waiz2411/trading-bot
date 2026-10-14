const { Client } = require('ssh2');

const conn = new Client();
conn.on('ready', () => {
  console.log('Connected to VPS...');
  const checkCmd = `
    curl -s http://127.0.0.1:5000/api/trading/dashboard | grep -o '"isAutonomous":[^,]*' | head -1
    curl -s http://127.0.0.1:5000/api/trading/dashboard | grep -o '"mode":[^,]*' | head -1
    curl -s http://127.0.0.1:5000/api/trading/dashboard | grep -o '"maxSlots":[^,]*' | head -2
  `;
  conn.exec(checkCmd, (err, stream) => {
    if (err) throw err;
    stream.on('close', () => {
      conn.end();
    }).on('data', d => process.stdout.write(d.toString()))
      .stderr.on('data', d => process.stderr.write(d.toString()));
  });
}).connect({
  host: '82.198.229.98',
  port: 65002,
  username: 'u932536786',
  password: 'NexusQuant@6767',
  readyTimeout: 40000
});
