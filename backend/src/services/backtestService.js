import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const POSSIBLE_CACHE_DIRS = [
  path.resolve(__dirname, '../data/binance_cache'),
  path.resolve(__dirname, '../../scratch/binance_cache'),
  '/home/u932536786/trading-bot/backend/src/data/binance_cache'
];

let ACTIVE_CACHE_DIR = POSSIBLE_CACHE_DIRS.find(d => fs.existsSync(d) && fs.readdirSync(d).some(f => f.endsWith('.json'))) || POSSIBLE_CACHE_DIRS[0];

class BacktestService {
  constructor() {
    this.memoryCache = null;
    this.metadata = null;
  }

  // Load all candles into memory once for lightning-fast repeated backtests
  loadDatasets() {
    if (this.memoryCache) return this.memoryCache;

    if (!fs.existsSync(ACTIVE_CACHE_DIR)) {
      ACTIVE_CACHE_DIR = POSSIBLE_CACHE_DIRS.find(d => fs.existsSync(d) && fs.readdirSync(d).some(f => f.endsWith('.json'))) || ACTIVE_CACHE_DIR;
    }

    if (!fs.existsSync(ACTIVE_CACHE_DIR)) {
      try { fs.mkdirSync(ACTIVE_CACHE_DIR, { recursive: true }); } catch (_) {}
    }

    const files = fs.existsSync(ACTIVE_CACHE_DIR) ? fs.readdirSync(ACTIVE_CACHE_DIR).filter(f => f.endsWith('.json')) : [];
    const loaded = {};

    let globalMinTime = Infinity;
    let globalMaxTime = -Infinity;

    for (const file of files) {
      const sym = file.split('_')[0];
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(ACTIVE_CACHE_DIR, file), 'utf8'));
        if (Array.isArray(raw) && raw.length > 50) {
          const parsed = raw.map(c => ({
            openTime: c.openTime || c[0] || (c.time ? new Date(c.time).getTime() : 0),
            time: c.time || new Date(c.openTime || c[0]).toISOString(),
            open: Number(c.open || c[1]),
            high: Number(c.high || c[2]),
            low: Number(c.low || c[3]),
            close: Number(c.close || c[4]),
            volume: Number(c.volume || c[5])
          })).filter(c => c.openTime > 0 && !isNaN(c.close));

          parsed.sort((a, b) => a.openTime - b.openTime);

          if (parsed.length > 0) {
            loaded[sym] = parsed;
            globalMinTime = Math.min(globalMinTime, parsed[0].openTime);
            globalMaxTime = Math.max(globalMaxTime, parsed[parsed.length - 1].openTime);
          }
        }
      } catch (_) {}
    }

    this.memoryCache = loaded;
    this.metadata = {
      symbols: Object.keys(loaded).filter(s => s !== 'BTCUSDT' && s !== 'PAXGUSDT'),
      hasBtc: Boolean(loaded['BTCUSDT']),
      minDate: globalMinTime < Infinity ? new Date(globalMinTime).toISOString().split('T')[0] : '2026-08-01',
      maxDate: globalMaxTime > -Infinity ? new Date(globalMaxTime).toISOString().split('T')[0] : '2026-10-15',
      totalCoins: Object.keys(loaded).length
    };

    return this.memoryCache;
  }

  getMetadata() {
    if (!this.metadata) {
      this.loadDatasets();
    }
    return this.metadata;
  }

  // Pre-calculate technicals for a given symbol slice
  calculateTechnicals(candles) {
    const closes = candles.map(c => c.close);
    const volumes = candles.map(c => c.volume);
    const len = candles.length;

    // EMA 9, EMA 21, EMA 50 (15m) & Effective 4H EMAs (16x resolution)
    const ema9 = new Array(len);
    const ema21 = new Array(len);
    const ema50 = new Array(len);
    const ema21_4h = new Array(len);
    const ema50_4h = new Array(len);

    const k9 = 2 / 10;
    const k21 = 2 / 22;
    const k50 = 2 / 51;
    const k21_4h = 2 / (21 * 16 + 1);
    const k50_4h = 2 / (50 * 16 + 1);

    let e9 = closes[0];
    let e21 = closes[0];
    let e50 = closes[0];
    let e21_4 = closes[0];
    let e50_4 = closes[0];

    for (let i = 0; i < len; i++) {
      e9 = closes[i] * k9 + e9 * (1 - k9);
      e21 = closes[i] * k21 + e21 * (1 - k21);
      e50 = closes[i] * k50 + e50 * (1 - k50);
      e21_4 = closes[i] * k21_4h + e21_4 * (1 - k21_4h);
      e50_4 = closes[i] * k50_4h + e50_4 * (1 - k50_4h);

      ema9[i] = e9;
      ema21[i] = e21;
      ema50[i] = e50;
      ema21_4h[i] = e21_4;
      ema50_4h[i] = e50_4;
    }

    // SMA 20 of Volume
    const volSma20 = new Array(len);
    let volSum = 0;
    for (let i = 0; i < len; i++) {
      volSum += volumes[i];
      if (i >= 20) {
        volSum -= volumes[i - 20];
        volSma20[i] = volSum / 20;
      } else {
        volSma20[i] = volSum / (i + 1);
      }
    }

    // RSI 14
    const rsi14 = new Array(len).fill(50);
    if (len > 15) {
      let g = 0, l = 0;
      for (let i = 1; i <= 14; i++) {
        const d = closes[i] - closes[i - 1];
        if (d >= 0) g += d; else l -= d;
      }
      let avgG = g / 14;
      let avgL = l / 14;
      rsi14[14] = avgL === 0 ? 100 : 100 - (100 / (1 + avgG / avgL));

      for (let i = 15; i < len; i++) {
        const d = closes[i] - closes[i - 1];
        const gain = d > 0 ? d : 0;
        const loss = d < 0 ? -d : 0;
        avgG = (avgG * 13 + gain) / 14;
        avgL = (avgL * 13 + loss) / 14;
        rsi14[i] = avgL === 0 ? 100 : 100 - (100 / (1 + avgG / avgL));
      }
    }

    return { ema9, ema21, ema50, ema21_4h, ema50_4h, volSma20, rsi14 };
  }

  resampleTo4H(c15m) {
    const c4h = [];
    for (let i = 0; i < c15m.length; i += 16) {
      const slice = c15m.slice(i, i + 16);
      if (slice.length === 16) {
        c4h.push({
          openTime: slice[0].openTime,
          time: slice[0].time,
          open: slice[0].open,
          high: Math.max(...slice.map(c => c.high)),
          low: Math.min(...slice.map(c => c.low)),
          close: slice[15].close,
          volume: slice.reduce((acc, c) => acc + c.volume, 0)
        });
      }
    }
    return c4h;
  }

  calculate4HEMAs(candles) {
    const len = candles.length;
    const closes = candles.map(c => c.close);
    const ema21 = new Float64Array(len);
    const ema50 = new Float64Array(len);
    const k21 = 2 / 22;
    const k50 = 2 / 51;
    let e21 = closes[0], e50 = closes[0];

    for (let i = 0; i < len; i++) {
      const cl = closes[i];
      e21 = i === 0 ? cl : (cl * k21) + (e21 * (1 - k21));
      e50 = i === 0 ? cl : (cl * k50) + (e50 * (1 - k50));
      ema21[i] = e21;
      ema50[i] = e50;
    }
    return { ema21, ema50 };
  }

  /**
   * Run high-speed comprehensive backtest
   */
  run(params = {}) {
    const startTime = Date.now();
    const datasets = this.loadDatasets();

    const {
      startDate = '2026-08-15',
      endDate = '2026-10-15',
      initialBalance = 10.0,
      symbols: requestedSymbols,
      takeProfitPct = 10.0,
      stopLossPct = 2.0,
      breakEvenTriggerPct = 2.5,
      breakEvenLockPct = 0.35,
      trailingTriggerPct = 4.0,
      trailingDistancePct = 1.5,
      min24hGain = 6.0,
      max24hGain = 45.0,
      minRvol = 2.0,
      rsiMin = 44,
      rsiMax = 72,
      maxHoldMinutes = 240,
      maxSlots = 1,
      feeRatePct = 0.10, // 0.10% each way
      slippagePct = 0.05,
      surgeVelocityPct = 2.40,
      volumeSurgeRatio = 2.0,
      upperWickMaxRatio = 0.30,
      useBtcFilter = true,
      btcFilterMode = 'STANDARD', // 'STANDARD' (BTC > EMA21) | 'CRASH_ONLY' (BTC not dumping >2% below EMA50) | 'OFF'
      entryStrategy = 'HDMS_15M' // 'HDMS_15M' | 'PULLBACK' | 'BREAKOUT' | 'CROSSOVER' | 'ANY_VALID' | 'VALUE_PULLBACK' | 'PANIC_DIP'
    } = params;

    const startMs = new Date(startDate).getTime();
    const endMs = new Date(endDate + 'T23:59:59.999Z').getTime();

    // Select target symbols
    const availableSymbols = Object.keys(datasets).filter(s => s !== 'BTCUSDT' && s !== 'PAXGUSDT');
    let targetSymbols = availableSymbols;
    if (Array.isArray(requestedSymbols) && requestedSymbols.length > 0 && !requestedSymbols.includes('ALL')) {
      targetSymbols = requestedSymbols.filter(s => datasets[s]);
    }
    if (targetSymbols.length === 0) targetSymbols = availableSymbols;

    // Precalculate technicals and time maps
    const techData = {};
    const candleMap = {};
    const timeSet = new Set();

    for (const sym of [...targetSymbols, 'BTCUSDT']) {
      if (!datasets[sym]) continue;
      const filtered = datasets[sym].filter(c => c.openTime >= startMs - (96 * 15 * 60 * 1000) && c.openTime <= endMs);
      if (filtered.length < 30) continue;

      const c4 = this.resampleTo4H(datasets[sym]);
      const tech4 = this.calculate4HEMAs(c4);
      const timeMap4 = new Map();
      c4.forEach((c, idx) => timeMap4.set(c.openTime, idx));

      techData[sym] = {
        candles: filtered,
        tech: this.calculateTechnicals(filtered),
        timeMap: new Map(),
        c4,
        tech4,
        timeMap4
      };

      filtered.forEach((c, idx) => {
        techData[sym].timeMap.set(c.openTime, idx);
        if (c.openTime >= startMs && c.openTime <= endMs) {
          timeSet.add(c.openTime);
        }
      });
    }

    const sortedTimes = Array.from(timeSet).sort((a, b) => a - b);
    if (sortedTimes.length === 0) {
      return {
        success: false,
        error: 'No candle data available within the selected date range.'
      };
    }

    const btcEntry = techData['BTCUSDT'];

    let balance = Number(initialBalance) || 10.0;
    let peakBalance = balance;
    let maxDrawdownPct = 0;
    let maxDrawdownDollar = 0;

    const activeTrades = [];
    const closedTrades = [];
    const dailyPnL = {};
    const equityCurve = [
      {
        time: new Date(sortedTimes[0]).toISOString(),
        date: new Date(sortedTimes[0]).toISOString().split('T')[0],
        balance: Number(balance.toFixed(2)),
        drawdownPct: 0
      }
    ];

    const feeRate = (feeRatePct / 100);
    const slipRate = (slippagePct / 100);
    const maxHoldBars = Math.max(1, Math.round(maxHoldMinutes / 15));

    // Iterate chronologically bar-by-bar
    for (let tIdx = 0; tIdx < sortedTimes.length; tIdx++) {
      const openTime = sortedTimes[tIdx];
      const currentDateStr = new Date(openTime).toISOString().split('T')[0];

      // 1. Manage Active Positions
      for (let pIdx = activeTrades.length - 1; pIdx >= 0; pIdx--) {
        const pos = activeTrades[pIdx];
        const symEntry = techData[pos.symbol];
        if (!symEntry) continue;

        const candleIdx = symEntry.timeMap.get(openTime);
        if (candleIdx === undefined) continue;

        const candle = symEntry.candles[candleIdx];
        pos.barsHeld++;

        let exitPrice = null;
        let exitReason = null;

        // Realistic intrabar check: Did low hit stop loss?
        if (candle.low <= pos.currentStop) {
          exitPrice = pos.currentStop * (1 - slipRate); // slippage on stop execution
          exitReason = pos.isTrailing ? 'TRAILING_STOP' : (pos.isBE ? 'BREAKEVEN' : 'STOP_LOSS');
        } else {
          // Check peak price reached in this candle
          if (candle.high > pos.peakPrice) {
            pos.peakPrice = candle.high;
          }

          const peakGainPct = ((pos.peakPrice - pos.entryPrice) / pos.entryPrice) * 100;

          // Break-Even Lock Check
          if (peakGainPct >= breakEvenTriggerPct && !pos.isBE) {
            const bePrice = pos.entryPrice * (1 + breakEvenLockPct / 100);
            if (bePrice > pos.currentStop) {
              pos.currentStop = bePrice;
              pos.isBE = true;
            }
          }

          // Trailing Stop Check
          if (peakGainPct >= trailingTriggerPct) {
            const trPrice = pos.peakPrice * (1 - trailingDistancePct / 100);
            if (trPrice > pos.currentStop) {
              pos.currentStop = trPrice;
              pos.isTrailing = true;
            }
          }

          // Take Profit Cap Check
          if (takeProfitPct > 0 && candle.high >= pos.entryPrice * (1 + takeProfitPct / 100)) {
            exitPrice = pos.entryPrice * (1 + takeProfitPct / 100);
            exitReason = 'TAKE_PROFIT';
          }
          // Max Hold Duration Expiry
          else if (pos.barsHeld >= maxHoldBars) {
            exitPrice = candle.close;
            exitReason = 'TIME_LIMIT';
          }
        }

        if (exitPrice !== null) {
          const notional = pos.notional;
          const grossReturnPct = ((exitPrice - pos.entryPrice) / pos.entryPrice) * 100;
          const grossGain = notional * (grossReturnPct / 100);
          const totalFees = notional * feeRate * 2;
          const netPnL = grossGain - totalFees;
          const netReturnPct = (netPnL / notional) * 100;

          balance = Number((balance + netPnL).toFixed(2));
          if (balance > peakBalance) peakBalance = balance;
          const ddDollar = peakBalance - balance;
          const ddPct = peakBalance > 0 ? (ddDollar / peakBalance) * 100 : 0;
          if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;
          if (ddDollar > maxDrawdownDollar) maxDrawdownDollar = ddDollar;

          dailyPnL[currentDateStr] = (dailyPnL[currentDateStr] || 0) + netPnL;

          const tradeRecord = {
            id: closedTrades.length + 1,
            symbol: pos.symbol,
            entryTime: pos.entryTime,
            exitTime: candle.time,
            entryPrice: Number(pos.entryPrice.toFixed(4)),
            exitPrice: Number(exitPrice.toFixed(4)),
            notional: Number(notional.toFixed(2)),
            grossPnL: Number(grossGain.toFixed(3)),
            fee: Number(totalFees.toFixed(3)),
            netPnL: Number(netPnL.toFixed(3)),
            returnPct: Number(netReturnPct.toFixed(2)),
            exitReason,
            durationMins: pos.barsHeld * 15,
            balanceAfter: balance
          };

          closedTrades.push(tradeRecord);
          activeTrades.splice(pIdx, 1);

          equityCurve.push({
            time: candle.time,
            date: currentDateStr,
            balance,
            drawdownPct: Number(ddPct.toFixed(2)),
            tradeId: tradeRecord.id
          });
        }
      }

      // 2. Scan for Entry Signals if slots open (Never stop due to balance cutoff)
      if (activeTrades.length < maxSlots) {
        // BTC Health Gate check
        if (useBtcFilter && btcFilterMode !== 'OFF' && btcEntry) {
          if (entryStrategy === 'HDMS_15M') {
            const btcIdx = btcEntry.timeMap.get(openTime);
            if (btcIdx !== undefined) {
              const btcC = btcEntry.candles[btcIdx];
              const btcBarChange = ((btcC.close - btcC.open) / btcC.open) * 100;
              if (btcBarChange <= -1.50) {
                continue; // Circuit breaker: halt buying if BTC dumps >= 1.5% on current bar
              }
            }
          } else if (entryStrategy === 'PANIC_DIP') {
            const nearest4hTime = openTime - (openTime % (4 * 3600 * 1000));
            const btcIdx4 = btcEntry.timeMap4.get(nearest4hTime);
            if (btcIdx4 !== undefined && btcIdx4 >= 50 && btcEntry.c4[btcIdx4].close < btcEntry.tech4.ema50[btcIdx4]) {
              continue;
            }
          } else {
            const btcIdx = btcEntry.timeMap.get(openTime);
            if (btcIdx !== undefined && btcIdx >= 50) {
              const btcC = btcEntry.candles[btcIdx];
              if (btcFilterMode === 'CRASH_ONLY') {
                const btcEma50 = btcEntry.tech.ema50[btcIdx];
                if (btcC.close < btcEma50 * 0.98 || btcEntry.tech.rsi14[btcIdx] < 28) {
                  continue;
                }
              } else {
                const btcEma = btcEntry.tech.ema21[btcIdx];
                if (btcC.close < btcEma) {
                  continue;
                }
              }
            }
          }
        }

        let bestCandidate = null;
        let highestScore = -Infinity;

        for (const sym of targetSymbols) {
          // Check if already holding this coin
          if (activeTrades.some(t => t.symbol === sym)) continue;

          const symData = techData[sym];
          if (!symData) continue;

          const idx = symData.timeMap.get(openTime);
          if (idx === undefined || idx < 96) continue; // Need 24h of history (96 15m bars)

          const c = symData.candles[idx];
          const tech = symData.tech;
          const rsi = tech.rsi14[idx];

          let isSetupMatch = false;
          let score = 0;

          if (entryStrategy === 'HDMS_15M') {
            if (idx < 2) continue;
            // 1. Volume Surge: V_t >= 2.0 * SMA20(V)
            const smaVol = tech.volSma20[idx];
            if (!smaVol || smaVol <= 0) continue;
            const volRatio = c.volume / smaVol;
            if (volRatio < volumeSurgeRatio) continue;

            // 2. 2-Bar Price Velocity: (C_t - C_t-2) / C_t-2 >= 2.40%
            const prev2Close = symData.candles[idx - 2].close;
            const velocityPct = ((c.close - prev2Close) / prev2Close) * 100;
            if (velocityPct < surgeVelocityPct) continue;

            // 3. Candle Geometry: Green candle & Upper Wick <= 30% of total range
            if (c.close <= c.open) continue;
            const candleRange = c.high - c.low;
            if (candleRange > 0) {
              const upperWick = c.high - c.close;
              if ((upperWick / candleRange) > upperWickMaxRatio) continue;
            }

            isSetupMatch = true;
            score = velocityPct * 10 + volRatio * 5;
          } else if (entryStrategy === 'PANIC_DIP') {
            const nearest4hTime = openTime - (openTime % (4 * 3600 * 1000));
            const idx4 = symData.timeMap4.get(nearest4hTime);
            if (idx4 === undefined || idx4 < 50) continue;

            const is4hBull = symData.tech4.ema21[idx4] > symData.tech4.ema50[idx4] && symData.c4[idx4].close > symData.tech4.ema50[idx4];
            if (!is4hBull) continue;

            if (rsi > 30) continue;

            const candleRange = c.high - c.low;
            if (candleRange <= 0) continue;
            const lowerWick = Math.min(c.open, c.close) - c.low;
            const isRejection = (lowerWick / candleRange) >= 0.35;
            if (!isRejection) continue;

            isSetupMatch = true;
            score = (50 - rsi) * 2 + (symData.tech4.ema21[idx4] / symData.tech4.ema50[idx4]) * 10;
          } else {
            // Standard/Legacy momentum screening filters
            const past24hClose = symData.candles[idx - 96].close;
            const gain24h = ((c.close - past24hClose) / past24hClose) * 100;
            if (gain24h < min24hGain || gain24h > max24hGain) continue;

            // RVOL
            const rvol = tech.volSma20[idx] > 0 ? c.volume / tech.volSma20[idx] : 1;
            if (rvol < minRvol) continue;

            // RSI filter
            if (rsi < rsiMin || rsi > rsiMax) continue;

            // Trend requirement
            const isUptrend = tech.ema9[idx] > tech.ema21[idx] && c.close >= tech.ema21[idx];
            if (!isUptrend) continue;

            // Pullback setup
            const isPullback = c.low <= tech.ema9[idx] * 1.004 && c.close >= tech.ema9[idx] && c.close > c.open;
            // Breakout setup
            const high20 = Math.max(...symData.candles.slice(idx - 20, idx).map(x => x.high));
            const isBreakout = c.close > high20 && c.close > c.open;
            // Crossover setup
            const isCross = (tech.ema9[idx - 1] <= tech.ema21[idx - 1]) && (tech.ema9[idx] > tech.ema21[idx]);
            // Value Pullback
            const isValuePullback = c.low <= tech.ema21[idx] * 1.008 && c.close >= tech.ema21[idx] * 0.995 && rsi >= 38 && rsi <= 55 && c.close > c.open;

            if (entryStrategy === 'PULLBACK' && isPullback) isSetupMatch = true;
            else if (entryStrategy === 'BREAKOUT' && isBreakout) isSetupMatch = true;
            else if (entryStrategy === 'CROSSOVER' && isCross) isSetupMatch = true;
            else if (entryStrategy === 'VALUE_PULLBACK' && isValuePullback) isSetupMatch = true;
            else if (entryStrategy === 'ANY_VALID' && (isPullback || isBreakout || isCross || isValuePullback)) isSetupMatch = true;

            score = entryStrategy === 'VALUE_PULLBACK'
              ? ((60 - rsi) * 2 + Math.min(rvol, 3.0) * 10)
              : (rvol * 2 + gain24h);
          }

          if (isSetupMatch && score > highestScore) {
            highestScore = score;
            bestCandidate = {
              symbol: sym,
              entryPrice: c.close * (1 + slipRate),
              entryTime: c.time
            };
          }
        }

        if (bestCandidate) {
          const posSize = maxSlots === 1 ? balance : Math.max(1.0, (balance / maxSlots));

          activeTrades.push({
            symbol: bestCandidate.symbol,
            entryPrice: bestCandidate.entryPrice,
            entryTime: bestCandidate.entryTime,
            notional: posSize,
            peakPrice: bestCandidate.entryPrice,
            currentStop: bestCandidate.entryPrice * (1 - stopLossPct / 100),
            barsHeld: 0,
            isBE: false,
            isTrailing: false
          });
        }
      }
    }

    // Performance Calculations
    const wins = closedTrades.filter(t => t.netPnL > 0.01);
    const losses = closedTrades.filter(t => t.netPnL < -0.01);
    const breakEvens = closedTrades.filter(t => Math.abs(t.netPnL) <= 0.01);
    const decisiveTrades = wins.length + losses.length;

    const totalTrades = closedTrades.length;
    const winRatePct = totalTrades > 0 ? Number(((wins.length / totalTrades) * 100).toFixed(1)) : 0;
    const decisiveWinRatePct = decisiveTrades > 0 ? Number(((wins.length / decisiveTrades) * 100).toFixed(1)) : 0;

    const totalGrossWin = wins.reduce((acc, t) => acc + t.netPnL, 0);
    const totalGrossLoss = Math.abs(losses.reduce((acc, t) => acc + t.netPnL, 0));
    const profitFactor = totalGrossLoss > 0 ? Number((totalGrossWin / totalGrossLoss).toFixed(2)) : (totalGrossWin > 0 ? 99.9 : 0);

    const avgWinDollar = wins.length > 0 ? Number((totalGrossWin / wins.length).toFixed(3)) : 0;
    const avgLossDollar = losses.length > 0 ? Number((totalGrossLoss / losses.length).toFixed(3)) : 0;
    const riskRewardRatio = avgLossDollar > 0 ? Number((avgWinDollar / avgLossDollar).toFixed(2)) : 0;

    const netProfitDollar = Number((balance - initialBalance).toFixed(2));
    const roiPct = Number(((netProfitDollar / initialBalance) * 100).toFixed(2));

    const totalDays = Object.keys(dailyPnL).length || 1;
    const profitableDays = Object.values(dailyPnL).filter(p => p > 0.05).length;
    const avgDailyProfit = Number((netProfitDollar / totalDays).toFixed(3));

    const avgHoldDurationMins = totalTrades > 0
      ? Math.round(closedTrades.reduce((acc, t) => acc + t.durationMins, 0) / totalTrades)
      : 0;

    const elapsedMs = Date.now() - startTime;

    return {
      success: true,
      executionTimeMs: elapsedMs,
      config: {
        startDate,
        endDate,
        initialBalance,
        takeProfitPct,
        stopLossPct,
        breakEvenTriggerPct,
        breakEvenLockPct,
        trailingTriggerPct,
        trailingDistancePct,
        min24hGain,
        max24hGain,
        minRvol,
        maxHoldMinutes,
        maxSlots,
        feeRatePct,
        symbolsTested: targetSymbols.length
      },
      summary: {
        initialBalance: Number(initialBalance),
        finalBalance: balance,
        netProfitDollar,
        roiPct,
        totalTrades,
        wins: wins.length,
        losses: losses.length,
        breakEvens: breakEvens.length,
        winRatePct,
        decisiveWinRatePct,
        profitFactor,
        maxDrawdownPct: Number(maxDrawdownPct.toFixed(1)),
        maxDrawdownDollar: Number(maxDrawdownDollar.toFixed(2)),
        avgWinDollar,
        avgLossDollar,
        riskRewardRatio,
        avgDailyProfit,
        profitableDays: `${profitableDays}/${totalDays} (${((profitableDays / totalDays) * 100).toFixed(1)}%)`,
        avgHoldDurationMins,
        exitsBreakdown: {
          takeProfit: closedTrades.filter(t => t.exitReason === 'TAKE_PROFIT').length,
          trailingStop: closedTrades.filter(t => t.exitReason === 'TRAILING_STOP').length,
          breakEven: closedTrades.filter(t => t.exitReason === 'BREAKEVEN').length,
          stopLoss: closedTrades.filter(t => t.exitReason === 'STOP_LOSS').length,
          timeLimit: closedTrades.filter(t => t.exitReason === 'TIME_LIMIT').length
        }
      },
      equityCurve,
      trades: closedTrades.reverse() // Most recent first
    };
  }
}

export const backtestService = new BacktestService();
