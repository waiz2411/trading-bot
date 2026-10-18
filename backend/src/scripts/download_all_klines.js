import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cacheDir = path.resolve(__dirname, '../data/binance_cache');

const START_TIME = 1767225600000; // 2026-01-01T00:00:00.000Z
const END_TIME = 1792152000000;   // 2026-10-16T12:00:00.000Z
const INTERVAL = '15m';

const files = fs.readdirSync(cacheDir).filter(f => f.endsWith('.json'));

async function fetchKlinesForSymbol(symbol) {
  let allKlines = [];
  let currentStart = START_TIME;

  while (currentStart < END_TIME) {
    const url = `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=${INTERVAL}&startTime=${currentStart}&endTime=${END_TIME}&limit=1000`;
    let attempts = 0;
    let success = false;
    let klines = [];

    while (attempts < 5 && !success) {
      try {
        const res = await fetch(url);
        if (res.status === 429) {
          console.warn(`[RATE LIMIT] 429 on ${symbol}. Waiting 3s...`);
          await new Promise(r => setTimeout(r, 3000));
          attempts++;
          continue;
        }
        if (!res.ok) {
          // If coin was listed later than Jan 1, 2026, Binance returns empty array, but check status
          if (res.status === 400) {
            // Might be bad request or not listed yet
            const errJson = await res.json().catch(() => ({}));
            if (errJson.code === -1121) {
              // Invalid symbol
              console.log(`[INVALID SYMBOL] ${symbol}`);
              return null;
            }
          }
          throw new Error(`HTTP ${res.status}`);
        }
        klines = await res.json();
        success = true;
      } catch (err) {
        attempts++;
        if (attempts >= 5) {
          console.error(`Failed ${symbol} at ${new Date(currentStart).toISOString()}: ${err.message}`);
          break;
        }
        await new Promise(r => setTimeout(r, 1000 * attempts));
      }
    }

    if (!klines || klines.length === 0) {
      // If we got nothing at the very beginning, coin might have been listed later in 2026.
      // Advance by 30 days to see if it starts later, or break if we're near the end.
      if (allKlines.length === 0 && currentStart < END_TIME - (30 * 86400 * 1000)) {
        currentStart += 30 * 86400 * 1000;
        continue;
      }
      break;
    }

    for (const k of klines) {
      allKlines.push({
        openTime: k[0],
        time: new Date(k[0]).toISOString(),
        open: Number(k[1]),
        high: Number(k[2]),
        low: Number(k[3]),
        close: Number(k[4]),
        volume: Number(k[5])
      });
    }

    const lastCandleTime = klines[klines.length - 1][0];
    if (lastCandleTime <= currentStart) {
      break;
    }
    // Next start is last candle close time + 1ms (or next 15m)
    currentStart = lastCandleTime + (15 * 60 * 1000);
    
    // Tiny delay between chunks
    await new Promise(r => setTimeout(r, 30));
  }

  // Deduplicate and sort
  const map = new Map();
  for (const c of allKlines) {
    map.set(c.openTime, c);
  }
  const sorted = Array.from(map.values()).sort((a, b) => a.openTime - b.openTime);
  return sorted;
}

async function run() {
  const queue = [];

  for (const file of files) {
    const sym = file.split('_')[0];
    const filePath = path.join(cacheDir, file);
    let needUpdate = true;
    try {
      const existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const firstTime = existing.length > 0 ? (existing[0].openTime || existing[0][0]) : 0;
      if (existing.length > 20000 && firstTime <= START_TIME + 3600000) {
        needUpdate = false;
      }
    } catch (_) {}

    if (needUpdate) {
      queue.push({ sym, file, filePath });
    }
  }

  console.log(`Starting download for ${queue.length} coins (Jan 1, 2026 -> Oct 16, 2026)...`);

  const CONCURRENCY = 6;
  let completed = 0;

  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;
      const t0 = Date.now();
      try {
        const klines = await fetchKlinesForSymbol(item.sym);
        if (klines && klines.length > 0) {
          fs.writeFileSync(item.filePath, JSON.stringify(klines));
          completed++;
          const duration = ((Date.now() - t0) / 1000).toFixed(1);
          console.log(`[${completed}/${completed + queue.length}] Saved ${item.sym}: ${klines.length} candles (${klines[0].time.slice(0, 10)} -> ${klines[klines.length - 1].time.slice(0, 10)}) in ${duration}s`);
        } else {
          console.log(`[WARN] No klines returned for ${item.sym}`);
        }
      } catch (err) {
        console.error(`[ERROR] ${item.sym}:`, err.message);
      }
    }
  }

  const workers = [];
  for (let i = 0; i < CONCURRENCY; i++) {
    workers.push(worker());
  }

  await Promise.all(workers);
  console.log('All downloads completed successfully!');
}

run().catch(console.error);
