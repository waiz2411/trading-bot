const { Client } = require('ssh2');

function runRemote(cmd) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let out = '';
    let errOut = '';
    conn.on('ready', () => {
      conn.exec(cmd, (err, stream) => {
        if (err) { conn.end(); return reject(err); }
        stream.on('close', (code) => {
          conn.end();
          resolve({ code, out, errOut });
        });
        stream.on('data', d => { out += d.toString(); });
        stream.stderr.on('data', d => { errOut += d.toString(); });
      });
    }).on('error', err => reject(err))
    .connect({
      host: '217.196.54.11',
      port: 65002,
      username: 'u932536786',
      password: 'NexusQuant@6767',
      readyTimeout: 35000
    });
  });
}

(async () => {
  try {
    const res = await runRemote('date -u && pm2 status && curl -s http://127.0.0.1:5000/api/dashboard | head -c 300');
    console.log('OUTPUT:\n', res.out);
    if (res.errOut) console.error('STDERR:\n', res.errOut);
  } catch (e) {
    console.error('ERROR:', e.message);
  }
})();
