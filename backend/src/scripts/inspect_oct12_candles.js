import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cacheDir = path.resolve(__dirname, '../data/binance_cache');

const raw = JSON.parse(fs.readFileSync(path.join(cacheDir, 'ZKUSDT_15m_60d.json'), 'utf8'));
const candles = raw.map(c => ({
  openTime: c.openTime || c[0],
  time: c.time || new Date(c.openTime || c[0]).toISOString(),
  open: Number(c.open || c[1]),
  high: Number(c.high || c[2]),
  low: Number(c.low || c[3]),
  close: Number(c.close || c[4]),
  volume: Number(c.volume || c[5])
})).filter(c => c.time.startsWith('2026-10-12') || c.time.startsWith('2026-10-14'));

console.log('Inspecting candles on Oct 12 and Oct 14 for ZKUSDT:');
console.table(candles.slice(0, 30).map(c => ({
  time: c.time.slice(11, 16),
  open: c.open.toFixed(5),
  high: c.high.toFixed(5),
  low: c.low.toFixed(5),
  close: c.close.toFixed(5),
  changePct: (((c.close - c.open) / c.open) * 100).toFixed(2) + '%'
})));
