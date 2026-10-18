import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cacheDir = path.resolve(__dirname, '../data/multi_year_cache');

if (!fs.existsSync(cacheDir)) {
  fs.mkdirSync(cacheDir, { recursive: true });
}

const SYMBOLS = [
  'BTCUSDT',
  'ETHUSDT',
  'BNBUSDT',
  'ADAUSDT',
  'LTCUSDT',
  'LINKUSDT',
  'SOLUSDT',
  'DOGEUSDT',
  'XRPUSDT',
  'ETCUSDT'
];

const START_TIME = new Date('2020-01-01T00:00:00Z').getTime();
const END_TIME = new Date('2026-10-16T12:00:00Z').getTime();

console.log('================================================================');
console.log('   NEXUS QUANT MULTI-YEAR HISTORICAL AUDIT (2020 - 2026)');
console.log('   Strategy: Option B (6.0% Macro Alpha Scalper)');
console.log('   Testing 7-Year Multi-Cycle Durability on Foundational Assets');
console.log('================================================================\n');

async function getOrFetchKlines(symbol) {
  const filePath = path.join(cacheDir, `${symbol}_15m_2020_2026.json`);
  if (fs.existsSync(filePath)) {
    console.log(`[CACHE HIT] Loaded ${symbol} from disk`);
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }

  console.log(`[FETCHING] Downloading 2020-2026 15m data for ${symbol}...`);
  let allKlines = [];
  let currentStart = START_TIME;

  while (currentStart < END_TIME) {
    const url = `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=15m&startTime=${currentStart}&limit=1000`;
    let attempts = 0;
    let klines = null;

    while (attempts < 5) {
      try {
        const res = await fetch(url);
        if (res.status === 429) {
          console.warn(`[RATE LIMIT] 429 on ${symbol}. Waiting 3s...`);
          await new Promise(r => setTimeout(r, 3000));
          attempts++;
          continue;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        klines = await res.json();
        break;
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

    const lastTime = klines[klines.length - 1][0];
    if (lastTime <= currentStart) break;
    currentStart = lastTime + 15 * 60 * 1000;
  }

  const map = new Map();
  for (const c of allKlines) map.set(c.openTime, c);
  const sorted = Array.from(map.values()).sort((a, b) => a.openTime - b.openTime);

  fs.writeFileSync(filePath, JSON.stringify(sorted));
  console.log(`[CACHED] Saved ${symbol}: ${sorted.length} candles to ${filePath}`);
  return sorted;
}

function calculateTech(candles) {
  const len = candles.length;
  const closes = candles.map(c => c.close);
  const ema21 = new Float64Array(len);
  const ema50 = new Float64Array(len);
  const rsi14 = new Float64Array(len);

  const k21 = 2 / 22, k50 = 2 / 51;
  let e21 = closes[0], e50 = closes[0];
  for (let i = 0; i < len; i++) {
    const cl = closes[i];
    e21 = i === 0 ? cl : cl * k21 + e21 * (1 - k21);
    e50 = i === 0 ? cl : cl * k50 + e50 * (1 - k50);
    ema21[i] = e21; ema50[i] = e50;
  }

  let avgG = 0, avgL = 0;
  for (let i = 1; i <= 14 && i < len; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) avgG += d; else avgL += Math.abs(d);
  }
  avgG /= 14; avgL /= 14;
  rsi14[14] = avgL === 0 ? 100 : 100 - (100 / (1 + avgG / avgL));
  for (let i = 15; i < len; i++) {
    const d = closes[i] - closes[i - 1];
    avgG = (avgG * 13 + (d > 0 ? d : 0)) / 14;
    avgL = (avgL * 13 + (d < 0 ? Math.abs(d) : 0)) / 14;
    rsi14[i] = avgL === 0 ? 100 : 100 - (100 / (1 + avgG / avgL));
  }
  return { ema21, ema50, rsi14 };
}

function resampleTo4H(c15m) {
  const buckets = new Map();
  for (const c of c15m) {
    const b = c.openTime - (c.openTime % (4 * 3600 * 1000));
    let group = buckets.get(b);
    if (!group) {
      group = [];
      buckets.set(b, group);
    }
    group.push(c);
  }
  const c4h = [];
  for (const [openTime, slice] of buckets.entries()) {
    c4h.push({
      openTime,
      time: new Date(openTime).toISOString(),
      open: slice[0].open,
      high: Math.max(...slice.map(c => c.high)),
      low: Math.min(...slice.map(c => c.low)),
      close: slice[slice.length - 1].close,
      volume: slice.reduce((acc, c) => acc + c.volume, 0)
    });
  }
  c4h.sort((a, b) => a.openTime - b.openTime);
  return c4h;
}

async function run() {
  const datasets15m = {};
  const datasets4h = {};

  for (const sym of SYMBOLS) {
    const c15 = await getOrFetchKlines(sym);
    if (c15.length < 5000) {
      console.warn(`Skipping ${sym}: insufficient data (${c15.length})`);
      continue;
    }
    const tech15 = calculateTech(c15);
    const map15 = new Map();
    c15.forEach((c, idx) => map15.set(c.openTime, idx));
    datasets15m[sym] = { candles: c15, tech: tech15, timeMap: map15 };

    const c4 = resampleTo4H(c15);
    const tech4 = calculateTech(c4);
    const map4 = new Map();
    c4.forEach((c, idx) => map4.set(c.openTime, idx));
    datasets4h[sym] = { candles: c4, tech: tech4, timeMap: map4 };
  }

  console.log('\nStarting multi-year continuous backtest across all assets...\n');

  // Unified timeline from BTC or ETH
  const timeline = datasets15m['BTCUSDT'].candles.map(c => c.openTime);
  const activeSymbols = Object.keys(datasets15m);

  let openTrades = [];
  const closedTrades = [];
  const MAX_CONCURRENT = 3;
  const TP_PCT = 0.06;
  const SL_PCT = 0.02;
  const BE_TRIGGER = 0.02;
  const BE_LOCK = 0.0025;
  const TRAIL_TRIGGER = 0.035;
  const TRAIL_DIST = 0.012;
  const MAX_HOLD_STEPS = 32; // 8 hours (32 * 15m)
  const ROUND_TRIP_FEE = 0.002;
  const SLIPPAGE = 0.0003;

  for (let tIdx = 100; tIdx < timeline.length; tIdx++) {
    const curTime = timeline[tIdx];

    // Manage open trades
    const surviving = [];
    for (const trade of openTrades) {
      const symData = datasets15m[trade.symbol];
      const candleIdx = symData.timeMap.get(curTime);

      if (candleIdx === undefined) {
        surviving.push(trade);
        continue;
      }

      const c = symData.candles[candleIdx];
      trade.barsHeld++;

      let exitPrice = null;
      let exitReason = null;

      // Update max high
      if (c.high > trade.maxPrice) {
        trade.maxPrice = c.high;
      }

      const maxGainPct = (trade.maxPrice - trade.entryPrice) / trade.entryPrice;

      // 1. Hard SL
      if (c.low <= trade.currentStopLoss) {
        exitPrice = trade.currentStopLoss;
        exitReason = trade.slAdjusted ? 'BE_STOP' : 'STOP_LOSS';
      }
      // 2. Trailing Stop
      else if (maxGainPct >= TRAIL_TRIGGER) {
        const trailStop = trade.maxPrice * (1 - TRAIL_DIST);
        if (trailStop > trade.currentStopLoss) {
          trade.currentStopLoss = trailStop;
          trade.slAdjusted = true;
        }
        if (c.low <= trade.currentStopLoss) {
          exitPrice = trade.currentStopLoss;
          exitReason = 'TRAILING_STOP';
        }
      }
      // 3. Break-Even Stop adjustment
      else if (maxGainPct >= BE_TRIGGER && !trade.slAdjusted) {
        const bePrice = trade.entryPrice * (1 + BE_LOCK);
        if (bePrice > trade.currentStopLoss) {
          trade.currentStopLoss = bePrice;
          trade.slAdjusted = true;
        }
      }

      // 4. TP
      if (!exitPrice && c.high >= trade.targetPrice) {
        exitPrice = trade.targetPrice;
        exitReason = 'TAKE_PROFIT';
      }

      // 5. Max Hold Timeout
      if (!exitPrice && trade.barsHeld >= MAX_HOLD_STEPS) {
        exitPrice = c.close;
        exitReason = 'TIME_EXIT';
      }

      if (exitPrice !== null) {
        const grossReturn = (exitPrice - trade.entryPrice) / trade.entryPrice;
        const netReturn = grossReturn - ROUND_TRIP_FEE - SLIPPAGE;

        closedTrades.push({
          ...trade,
          exitTime: c.time,
          exitTimestamp: c.openTime,
          exitPrice,
          exitReason,
          grossReturn,
          netReturn,
          durationMin: trade.barsHeld * 15,
          year: new Date(trade.entryTimestamp).getUTCFullYear(),
          monthKey: `${new Date(trade.entryTimestamp).getUTCFullYear()}-${String(new Date(trade.entryTimestamp).getUTCMonth() + 1).padStart(2, '0')}`
        });
      } else {
        surviving.push(trade);
      }
    }
    openTrades = surviving;

    // Check entry conditions if capacity available
    if (openTrades.length < MAX_CONCURRENT) {
      for (const sym of activeSymbols) {
        if (openTrades.length >= MAX_CONCURRENT) break;
        if (openTrades.some(t => t.symbol === sym)) continue;

        const symData = datasets15m[sym];
        const cIdx = symData.timeMap.get(curTime);
        if (cIdx === undefined || cIdx < 50) continue;

        const c15 = symData.candles[cIdx];
        const rsiVal = symData.tech.rsi14[cIdx];

        // 4H Macro Trend Check (using latest fully closed 4H candle)
        const c4hData = datasets4h[sym];
        const fourHourBucket = curTime - (curTime % (4 * 3600 * 1000));
        let c4Idx = c4hData.timeMap.get(fourHourBucket - (4 * 3600 * 1000));
        if (c4Idx === undefined) {
          // approximate previous 4H
          for (let step = 2; step <= 8; step++) {
            c4Idx = c4hData.timeMap.get(fourHourBucket - step * 4 * 3600 * 1000);
            if (c4Idx !== undefined) break;
          }
        }
        if (c4Idx === undefined || c4Idx < 50) continue;

        const ema21_4h = c4hData.tech.ema21[c4Idx];
        const ema50_4h = c4hData.tech.ema50[c4Idx];
        const close4h = c4hData.candles[c4Idx].close;

        // Macro Trend Filter: EMA21 > EMA50 AND Close > EMA50
        const isMacroBull = ema21_4h > ema50_4h && close4h > ema50_4h;
        if (!isMacroBull) continue;

        // 15m Panic Dip Rebound: RSI <= 30 AND Hammer Rejection Wick >= 35%
        const candleRange = c15.high - c15.low;
        if (candleRange <= 0) continue;
        const lowerWick = Math.min(c15.open, c15.close) - c15.low;
        const lowerWickRatio = lowerWick / candleRange;

        if (rsiVal <= 30 && lowerWickRatio >= 0.35) {
          const entryPrice = c15.close;
          const targetPrice = entryPrice * (1 + TP_PCT);
          const stopLossPrice = entryPrice * (1 - SL_PCT);

          openTrades.push({
            symbol: sym,
            entryTime: c15.time,
            entryTimestamp: c15.openTime,
            entryPrice,
            targetPrice,
            currentStopLoss: stopLossPrice,
            maxPrice: entryPrice,
            slAdjusted: false,
            barsHeld: 0
          });
        }
      }
    }
  }

  console.log(`================================================================`);
  console.log(`TOTAL TRADES ACROSS 2020-2026: ${closedTrades.length}`);
  console.log(`================================================================\n`);

  // Yearly Breakdown
  const years = [2020, 2021, 2022, 2023, 2024, 2025, 2026];
  const yearlyStats = {};

  for (const y of years) {
    const yTrades = closedTrades.filter(t => t.year === y);
    if (yTrades.length === 0) continue;

    const wins = yTrades.filter(t => t.netReturn > 0);
    const winRate = (wins.length / yTrades.length) * 100;
    const grossSum = yTrades.reduce((acc, t) => acc + t.grossReturn, 0);
    const netSum = yTrades.reduce((acc, t) => acc + t.netReturn, 0);

    yearlyStats[y] = {
      trades: yTrades.length,
      wins: wins.length,
      winRate: winRate.toFixed(1) + '%',
      netSumReturn: (netSum * 100).toFixed(1) + '%',
      avgNetPerTrade: ((netSum / yTrades.length) * 100).toFixed(2) + '%'
    };
  }

  console.table(yearlyStats);

  // Compounded Simulation Year-by-Year starting with $100
  let capital = 100.0;
  const compoundingCurve = [];

  for (const y of years) {
    const yTrades = closedTrades.filter(t => t.year === y);
    const startCap = capital;

    for (const t of yTrades) {
      // 1/3 position sizing (since MAX_CONCURRENT = 3)
      const posSize = capital / 3.0;
      const pnl = posSize * t.netReturn;
      capital += pnl;
    }

    const yearReturnPct = ((capital - startCap) / startCap) * 100;
    compoundingCurve.push({
      year: y,
      startCapital: '$' + startCap.toFixed(2),
      endCapital: '$' + capital.toFixed(2),
      yearGrowth: (yearReturnPct >= 0 ? '+' : '') + yearReturnPct.toFixed(1) + '%',
      trades: yTrades.length
    });
  }

  console.log('\n--- YEAR-BY-YEAR COMPOUNDING ($100 START) ---');
  console.table(compoundingCurve);

  // Export to Excel
  const wb = XLSX.utils.book_new();

  // Sheet 1: Summary & Yearly Performance
  const summaryData = [
    ['NEXUS QUANT MULTI-YEAR HISTORICAL AUDIT (2020 - 2026)'],
    ['Strategy', 'Option B (6.0% Macro Alpha Scalper)'],
    ['Timeframe', '15m Entry / 4H Macro Trend Filter'],
    ['Parameters', 'TP: 6.0% | SL: 2.0% | BE: 2.0% (Lock +0.25%) | Trailing: 3.5% (Dist 1.2%) | Max Hold: 8h'],
    ['Friction Modeled', '0.20% Round-trip Binance Spot Fee + 0.03% Slippage per trade'],
    ['Tested Universe', SYMBOLS.join(', ')],
    [],
    ['YEAR-BY-YEAR PERFORMANCE & COMPOUNDING FROM $100'],
    ['Year', 'Trades', 'Win Rate', 'Net Simple Return', 'Starting Capital', 'Ending Capital', 'Compounded Net Growth']
  ];

  for (const c of compoundingCurve) {
    const st = yearlyStats[c.year] || {};
    summaryData.push([
      c.year,
      c.trades,
      st.winRate || 'N/A',
      st.netSumReturn || 'N/A',
      c.startCapital,
      c.endCapital,
      c.yearGrowth
    ]);
  }

  summaryData.push([]);
  summaryData.push(['TOTAL 7-YEAR COMPOUNDED CAPITAL', '', '', '', '$100.00', '$' + capital.toFixed(2), '+' + (((capital - 100) / 100) * 100).toFixed(1) + '%']);

  const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Multi-Year Summary');

  // Sheet 2: All Closed Trades
  const tradesHeader = [
    'Trade #', 'Symbol', 'Entry Time', 'Exit Time', 'Duration (min)', 
    'Entry Price', 'Exit Price', 'Exit Reason', 'Gross Return (%)', 'Net Return (%)', 'Year'
  ];
  const tradesData = [tradesHeader];
  closedTrades.forEach((t, i) => {
    tradesData.push([
      i + 1,
      t.symbol,
      t.entryTime,
      t.exitTime,
      t.durationMin,
      t.entryPrice,
      t.exitPrice,
      t.exitReason,
      Number((t.grossReturn * 100).toFixed(2)),
      Number((t.netReturn * 100).toFixed(2)),
      t.year
    ]);
  });

  const wsTrades = XLSX.utils.aoa_to_sheet(tradesData);
  XLSX.utils.book_append_sheet(wb, wsTrades, 'All Historical Trades');

  const exportPath = path.resolve(__dirname, '../../nexus_quant_multi_year_7yr_backtest_report.xlsx');
  XLSX.writeFile(wb, exportPath);
  console.log(`\nExecutive Excel Report exported to: ${exportPath}`);

  // Copy to brain directory for user download
  const brainPath = 'C:\\Users\\waizt\\.gemini\\antigravity\\brain\\9240cc1b-f576-4996-a196-552f1f9e4603\\nexus_quant_multi_year_7yr_backtest_report.xlsx';
  try {
    fs.copyFileSync(exportPath, brainPath);
    console.log(`Copied to brain directory: ${brainPath}`);
  } catch (e) {
    console.error('Brain copy error:', e.message);
  }
}

run().catch(console.error);
