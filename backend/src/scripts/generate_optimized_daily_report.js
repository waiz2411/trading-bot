import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';
import { backtestService } from '../services/backtestService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log('--- GENERATING UNRESTRICTED FULL-YEAR STRATEGY BENCHMARK (JAN 1 - OCT 16, 2026) ---');

  const profiles = [
    {
      id: 'SCREENSHOT_BASELINE',
      setupName: 'Original User Screenshot (Baseline)',
      entryStrategy: 'CROSSOVER',
      takeProfitPct: 10.0,
      stopLossPct: 2.0,
      breakEvenTriggerPct: 2.5,
      breakEvenLockPct: 0.2,
      trailingTriggerPct: 5.0,
      trailingDistancePct: 1.5,
      maxHoldMinutes: 240,
      min24hGain: 7.0,
      max24hGain: 45.0,
      minRvol: 2.0,
      maxSlots: 1,
      btcFilterMode: 'STANDARD',
      description: 'Original setup: 10% TP, 2% SL, 7% 24h pump requirement, 1 slot'
    },
    {
      id: 'VALUE_PULLBACK_2SLOTS',
      setupName: 'Smart Value Pullback (3-5% Target, 2 Slots)',
      entryStrategy: 'VALUE_PULLBACK',
      takeProfitPct: 3.8,
      stopLossPct: 2.5,
      breakEvenTriggerPct: 2.0,
      breakEvenLockPct: 0.25,
      trailingTriggerPct: 2.8,
      trailingDistancePct: 1.0,
      maxHoldMinutes: 360,
      min24hGain: 1.5,
      max24hGain: 25.0,
      minRvol: 1.2,
      maxSlots: 2,
      btcFilterMode: 'CRASH_ONLY',
      description: 'Dips into 21 EMA support with non-overbought RSI, 2 active slots, crash-only BTC gate'
    },
    {
      id: 'VALUE_PULLBACK_1SLOT',
      setupName: 'Smart Value Pullback (3-5% Target, 1 Slot)',
      entryStrategy: 'VALUE_PULLBACK',
      takeProfitPct: 4.2,
      stopLossPct: 2.5,
      breakEvenTriggerPct: 2.2,
      breakEvenLockPct: 0.25,
      trailingTriggerPct: 3.0,
      trailingDistancePct: 1.0,
      maxHoldMinutes: 360,
      min24hGain: 1.5,
      max24hGain: 25.0,
      minRvol: 1.2,
      maxSlots: 1,
      btcFilterMode: 'CRASH_ONLY',
      description: 'Dips into 21 EMA support, 100% position allocation, 4.2% TP target'
    },
    {
      id: 'DYNAMIC_SCALPER_2SLOTS',
      setupName: 'Dynamic Multi-Trigger Scalper (Relaxed Momentum, 2 Slots)',
      entryStrategy: 'ANY_VALID',
      takeProfitPct: 3.5,
      stopLossPct: 2.2,
      breakEvenTriggerPct: 1.8,
      breakEvenLockPct: 0.20,
      trailingTriggerPct: 2.5,
      trailingDistancePct: 0.8,
      maxHoldMinutes: 240,
      min24hGain: 1.5,
      max24hGain: 30.0,
      minRvol: 1.2,
      maxSlots: 2,
      btcFilterMode: 'CRASH_ONLY',
      description: 'Dynamic multi-trigger scalping across all valid setups with fast 2-4h turnaround'
    },
    {
      id: 'PURE_PULLBACK_1SLOT',
      setupName: 'Trend Pullback (9 EMA Re-test, 1 Slot)',
      entryStrategy: 'PULLBACK',
      takeProfitPct: 4.0,
      stopLossPct: 2.5,
      breakEvenTriggerPct: 2.0,
      breakEvenLockPct: 0.25,
      trailingTriggerPct: 2.8,
      trailingDistancePct: 1.0,
      maxHoldMinutes: 360,
      min24hGain: 2.0,
      max24hGain: 35.0,
      minRvol: 1.3,
      maxSlots: 1,
      btcFilterMode: 'CRASH_ONLY',
      description: 'Pullback re-test of 9 EMA in uptrend targeting 4.0% bounce'
    },
    {
      id: 'BREAKOUT_1SLOT',
      setupName: 'Breakout Momentum (20-Bar High Break, 1 Slot)',
      entryStrategy: 'BREAKOUT',
      takeProfitPct: 4.5,
      stopLossPct: 2.5,
      breakEvenTriggerPct: 2.2,
      breakEvenLockPct: 0.25,
      trailingTriggerPct: 3.2,
      trailingDistancePct: 1.0,
      maxHoldMinutes: 360,
      min24hGain: 3.0,
      max24hGain: 35.0,
      minRvol: 1.5,
      maxSlots: 1,
      btcFilterMode: 'CRASH_ONLY',
      description: 'Fresh 20-candle high breakout with volume expansion'
    }
  ];

  // Calendar dates
  const start = new Date('2026-01-01T00:00:00Z');
  const end = new Date('2026-10-16T00:00:00Z');
  const allDates = [];
  let curr = new Date(start);
  while (curr <= end) {
    allDates.push(curr.toISOString().split('T')[0]);
    curr.setUTCDate(curr.getUTCDate() + 1);
  }

  const masterDailyRows = [];
  const masterTradesRows = [];
  const profileSummaries = [];
  const profileDailySheets = {};

  for (const prof of profiles) {
    console.log(`\nTesting: ${prof.setupName}...`);
    const t0 = Date.now();

    const res = backtestService.run({
      startDate: '2026-01-01',
      endDate: '2026-10-16',
      initialBalance: 10.0,
      symbols: 'ALL',
      entryStrategy: prof.entryStrategy,
      takeProfitPct: prof.takeProfitPct,
      stopLossPct: prof.stopLossPct,
      breakEvenTriggerPct: prof.breakEvenTriggerPct,
      breakEvenLockPct: prof.breakEvenLockPct,
      trailingTriggerPct: prof.trailingTriggerPct,
      trailingDistancePct: prof.trailingDistancePct,
      min24hGain: prof.min24hGain,
      max24hGain: prof.max24hGain,
      minRvol: prof.minRvol,
      maxHoldMinutes: prof.maxHoldMinutes,
      useBtcFilter: true,
      btcFilterMode: prof.btcFilterMode,
      maxSlots: prof.maxSlots,
      feeRatePct: 0.10,
      slippagePct: 0.05
    });

    const duration = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`Finished in ${duration}s.`);

    if (!res || !res.success) {
      console.error(`Failed: ${res?.error}`);
      continue;
    }

    const { summary, trades: rawTrades } = res;
    const trades = [...rawTrades].sort((a, b) => new Date(a.entryTime).getTime() - new Date(b.entryTime).getTime());

    const tradesByDate = {};
    trades.forEach(t => {
      const date = t.exitTime ? t.exitTime.split('T')[0] : t.entryTime.split('T')[0];
      if (!tradesByDate[date]) tradesByDate[date] = [];
      tradesByDate[date].push(t);
    });

    let runningBalance = 10.0;
    let winDays = 0;
    let lossDays = 0;
    let flatDays = 0;

    const setupDailyRows = [];

    for (const dateStr of allDates) {
      const dayStartBalance = runningBalance;
      const dayTrades = tradesByDate[dateStr] || [];

      let dayNetPnL = 0;
      let dayWins = 0;
      let dayLosses = 0;
      const coinsTraded = [];

      dayTrades.forEach(t => {
        dayNetPnL += t.netPnL;
        if (t.netPnL > 0) dayWins++;
        else if (t.netPnL < 0) dayLosses++;
        coinsTraded.push(`${t.symbol} (${t.returnPct >= 0 ? '+' : ''}${t.returnPct.toFixed(2)}% [${t.exitReason}])`);
      });

      const dayEndBalance = Number((dayStartBalance + dayNetPnL).toFixed(2));
      runningBalance = dayEndBalance;

      // Base daily return % on the sum of trade return percentages or normalized to $10 base
      const dayReturnPct = (dayNetPnL / 10.0) * 100;
      const cumulativeRoiPct = ((dayEndBalance - 10.0) / 10.0) * 100;

      let status = 'CAPITAL PROTECTED (0.00%)';
      if (dayReturnPct > 0) {
        status = 'PROFIT (+)';
        winDays++;
      } else if (dayReturnPct < 0) {
        status = 'LOSS (-)';
        lossDays++;
      } else {
        flatDays++;
      }

      const rowObj = {
        'Trigger Setup': prof.setupName,
        'Date': dateStr,
        'Daily Return (%)': `${dayReturnPct >= 0 ? '+' : ''}${dayReturnPct.toFixed(2)}%`,
        'Daily Return (Numeric)': Number(dayReturnPct.toFixed(2)),
        'Cumulative ROI (%)': `${cumulativeRoiPct >= 0 ? '+' : ''}${cumulativeRoiPct.toFixed(2)}%`,
        'Day Status': status,
        'Trades Count': dayTrades.length,
        'Wins': dayWins,
        'Losses': dayLosses,
        'Balance ($)': `$${dayEndBalance.toFixed(2)}`,
        'Coins Traded & Outcome': coinsTraded.join('; ') || 'No trade taken (Capital Protected)'
      };

      masterDailyRows.push(rowObj);
      setupDailyRows.push(rowObj);
    }

    profileDailySheets[prof.id] = setupDailyRows;

    trades.forEach(t => {
      masterTradesRows.push({
        'Trigger Setup': prof.setupName,
        'Trade #': t.id,
        'Symbol': t.symbol,
        'Entry Time (UTC)': t.entryTime,
        'Exit Time (UTC)': t.exitTime,
        'Hold Time (mins)': t.durationMins,
        'Entry Price ($)': t.entryPrice,
        'Exit Price ($)': t.exitPrice,
        'Return (%)': `${t.returnPct >= 0 ? '+' : ''}${t.returnPct.toFixed(2)}%`,
        'Return (Numeric)': t.returnPct,
        'Exit Reason': t.exitReason,
        'Balance After ($)': `$${t.balanceAfter.toFixed(2)}`
      });
    });

    profileSummaries.push({
      'Strategy Profile': prof.setupName,
      'Active Trading Days': `${winDays + lossDays}/289 (${(((winDays + lossDays) / 289) * 100).toFixed(1)}%)`,
      'Capital Protected Days': `${flatDays}/289 (${((flatDays / 289) * 100).toFixed(1)}%)`,
      'Win Days': winDays,
      'Loss Days': lossDays,
      'Daily Win Rate (%)': (winDays + lossDays > 0) ? `${((winDays / (winDays + lossDays)) * 100).toFixed(1)}%` : '0.0%',
      'Total Trades': summary.totalTrades,
      'Trade Win Rate (%)': `${summary.winRatePct.toFixed(2)}%`,
      'Win Trades': summary.wins,
      'Loss Trades': summary.losses,
      'Breakeven Trades': summary.breakEvens,
      'Cumulative Return (%)': `${summary.roiPct >= 0 ? '+' : ''}${summary.roiPct.toFixed(2)}%`,
      'Max Drawdown (%)': `-${summary.maxDrawdownPct.toFixed(2)}%`,
      'Profit Factor': summary.profitFactor,
      'Slots': prof.maxSlots,
      'Target TP (%)': `${prof.takeProfitPct}%`,
      'Stop Loss (%)': `${prof.stopLossPct}%`,
      'BTC Gate': prof.btcFilterMode
    });
  }

  console.log('\n=== UNRESTRICTED FULL-YEAR COMPARISON TABLE ===');
  console.table(profileSummaries);

  const wb = XLSX.utils.book_new();

  // Tab 1: Strategy Comparison Summary
  const wsSummary = XLSX.utils.json_to_sheet(profileSummaries);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Comparison Summary');

  // Tab 2: Master Filterable Daily Log
  const wsMasterDaily = XLSX.utils.json_to_sheet(masterDailyRows);
  XLSX.utils.book_append_sheet(wb, wsMasterDaily, 'Master Daily Log (Filterable)');

  // Tab 3: Master Filterable Trades Log
  const wsMasterTrades = XLSX.utils.json_to_sheet(masterTradesRows);
  XLSX.utils.book_append_sheet(wb, wsMasterTrades, 'Master Trades Log (Filterable)');

  // Individual sheets for each setup
  for (const prof of profiles) {
    const sheetData = profileDailySheets[prof.id];
    if (sheetData) {
      const wsSetup = XLSX.utils.json_to_sheet(sheetData);
      XLSX.utils.book_append_sheet(wb, wsSetup, prof.id.slice(0, 31));
    }
  }

  const excelFileName = 'nexus_quant_unrestricted_full_year_report.xlsx';
  const localExcelPath = path.resolve(__dirname, '../../../', excelFileName);
  const artifactExcelPath = path.resolve('C:/Users/waizt/.gemini/antigravity/brain/9240cc1b-f576-4996-a196-552f1f9e4603', excelFileName);

  XLSX.writeFile(wb, localExcelPath);
  console.log(`\nMaster Excel generated successfully at:\n${localExcelPath}`);

  try {
    XLSX.writeFile(wb, artifactExcelPath);
    console.log(`Copied to artifact directory: ${artifactExcelPath}`);
  } catch (err) {
    console.warn('Artifact copy note:', err.message);
  }

  fs.writeFileSync(path.resolve(__dirname, 'unrestricted_report_results.json'), JSON.stringify(profileSummaries, null, 2));
}

main().catch(console.error);
