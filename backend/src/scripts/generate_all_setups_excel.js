import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';
import { backtestService } from '../services/backtestService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log('--- STARTING MULTI-SETUP BACKTEST (JAN 1 - OCT 16, 2026) ---');

  // Define strategy profiles targeting realistic 3% to 5% daily profit
  const profiles = [
    {
      id: 'ORIGINAL_SCREENSHOT',
      setupName: 'CROSSOVER (User Screenshot Baseline)',
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
      description: 'Original screenshot: 10% TP, 2% SL, 7% 24h pump requirement'
    },
    {
      id: 'CROSSOVER_3_5',
      setupName: 'CROSSOVER (Target 3-5% Daily Momentum)',
      entryStrategy: 'CROSSOVER',
      takeProfitPct: 4.0,
      stopLossPct: 2.2,
      breakEvenTriggerPct: 2.0,
      breakEvenLockPct: 0.25,
      trailingTriggerPct: 3.0,
      trailingDistancePct: 1.0,
      maxHoldMinutes: 360,
      min24hGain: 3.5,
      max24hGain: 35.0,
      minRvol: 1.8,
      description: 'EMA 9/21 cross tuned for 4% TP target with 3.5% min 24h momentum'
    },
    {
      id: 'PULLBACK_3_5',
      setupName: 'PULLBACK (Buy The Dip in Trend)',
      entryStrategy: 'PULLBACK',
      takeProfitPct: 4.0,
      stopLossPct: 2.2,
      breakEvenTriggerPct: 2.0,
      breakEvenLockPct: 0.25,
      trailingTriggerPct: 3.0,
      trailingDistancePct: 1.0,
      maxHoldMinutes: 360,
      min24hGain: 3.0,
      max24hGain: 35.0,
      minRvol: 1.8,
      description: 'Dips to 9 EMA during uptrend, targeting 4% bounce recovery'
    },
    {
      id: 'BREAKOUT_3_5',
      setupName: 'BREAKOUT (20-Bar High Surge)',
      entryStrategy: 'BREAKOUT',
      takeProfitPct: 4.5,
      stopLossPct: 2.5,
      breakEvenTriggerPct: 2.2,
      breakEvenLockPct: 0.25,
      trailingTriggerPct: 3.2,
      trailingDistancePct: 1.0,
      maxHoldMinutes: 360,
      min24hGain: 4.0,
      max24hGain: 40.0,
      minRvol: 2.0,
      description: 'Fresh 20-bar high breakout with 2x RVOL volume burst targeting 4.5% surge'
    },
    {
      id: 'ANY_VALID_3_5',
      setupName: 'ANY_VALID (Dynamic Multi-Trigger Scanner)',
      entryStrategy: 'ANY_VALID',
      takeProfitPct: 4.0,
      stopLossPct: 2.2,
      breakEvenTriggerPct: 2.0,
      breakEvenLockPct: 0.25,
      trailingTriggerPct: 3.0,
      trailingDistancePct: 1.0,
      maxHoldMinutes: 360,
      min24hGain: 3.5,
      max24hGain: 35.0,
      minRvol: 1.8,
      description: 'Scans Pullbacks, Breakouts & Crossovers; selects highest RVOL score'
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
    console.log(`\nExecuting Profile: ${prof.setupName}...`);
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
      maxSlots: 1,
      feeRatePct: 0.10,
      slippagePct: 0.05
    });

    const duration = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`Completed in ${duration}s.`);

    if (!res || !res.success) {
      console.error(`Failed: ${res?.error}`);
      continue;
    }

    const { summary, trades: rawTrades } = res;
    const trades = [...rawTrades].sort((a, b) => new Date(a.entryTime).getTime() - new Date(b.entryTime).getTime());

    // Trades by date
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

      const dayReturnPct = dayStartBalance > 0 ? (dayNetPnL / dayStartBalance) * 100 : 0;
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
        'Setup Code': prof.entryStrategy,
        'Date': dateStr,
        'Daily Return (%)': `${dayReturnPct >= 0 ? '+' : ''}${dayReturnPct.toFixed(2)}%`,
        'Daily Return (Numeric)': Number(dayReturnPct.toFixed(2)),
        'Cumulative ROI (%)': `${cumulativeRoiPct >= 0 ? '+' : ''}${cumulativeRoiPct.toFixed(2)}%`,
        'Day Status': status,
        'Trades Count': dayTrades.length,
        'Wins': dayWins,
        'Losses': dayLosses,
        'Balance ($)': `$${dayEndBalance.toFixed(2)}`,
        'Coins Traded & Outcome': coinsTraded.join('; ') || 'No qualifying trade signals (Capital Protected)'
      };

      masterDailyRows.push(rowObj);
      setupDailyRows.push(rowObj);
    }

    profileDailySheets[prof.id] = setupDailyRows;

    // Add trades to master trades
    trades.forEach(t => {
      masterTradesRows.push({
        'Trigger Setup': prof.setupName,
        'Setup Code': prof.entryStrategy,
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
      'Trigger Setup': prof.setupName,
      'Setup Strategy': prof.entryStrategy,
      'Cumulative Return (%)': `${summary.roiPct >= 0 ? '+' : ''}${summary.roiPct.toFixed(2)}%`,
      'Max Drawdown (%)': `-${summary.maxDrawdownPct.toFixed(2)}%`,
      'Profit Factor': summary.profitFactor,
      'Total Trades': summary.totalTrades,
      'Trade Win Rate (%)': `${summary.winRatePct.toFixed(2)}%`,
      'Win Trades': summary.wins,
      'Loss Trades': summary.losses,
      'Breakeven Trades': summary.breakEvens,
      'Active Trading Days': winDays + lossDays,
      'Win Days': winDays,
      'Loss Days': lossDays,
      'Daily Win Rate (%)': (winDays + lossDays > 0) ? `${((winDays / (winDays + lossDays)) * 100).toFixed(1)}%` : '0.0%',
      'Capital Protected Days': flatDays,
      'Take Profit Target': `${prof.takeProfitPct}%`,
      'Stop Loss Limit': `${prof.stopLossPct}%`,
      'Trailing Trigger': `${prof.trailingTriggerPct}%`,
      'Description': prof.description
    });
  }

  console.log('\n--- COMPARATIVE SUMMARY ACROSS ALL SETUPS ---');
  console.table(profileSummaries);

  // Build Comprehensive Excel File
  const wb = XLSX.utils.book_new();

  // Tab 1: Comparative Setup Summary
  const wsSummary = XLSX.utils.json_to_sheet(profileSummaries);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Comparative Setup Summary');

  // Tab 2: Master Daily Log (Filterable by Trigger Setup)
  const wsMasterDaily = XLSX.utils.json_to_sheet(masterDailyRows);
  XLSX.utils.book_append_sheet(wb, wsMasterDaily, 'All Setups - Daily Log');

  // Tab 3: All Executed Trades (Filterable by Trigger Setup)
  const wsMasterTrades = XLSX.utils.json_to_sheet(masterTradesRows);
  XLSX.utils.book_append_sheet(wb, wsMasterTrades, 'All Executed Trades Log');

  // Tabs for each setup individually
  for (const prof of profiles) {
    const sheetData = profileDailySheets[prof.id];
    if (sheetData) {
      const sheetName = prof.id.slice(0, 31); // Max 31 chars in Excel sheet name
      const wsSetup = XLSX.utils.json_to_sheet(sheetData);
      XLSX.utils.book_append_sheet(wb, wsSetup, sheetName);
    }
  }

  const excelFileName = 'nexus_quant_all_trigger_setups_master.xlsx';
  const localExcelPath = path.resolve(__dirname, '../../../', excelFileName);
  const artifactExcelPath = path.resolve('C:/Users/waizt/.gemini/antigravity/brain/9240cc1b-f576-4996-a196-552f1f9e4603', excelFileName);

  XLSX.writeFile(wb, localExcelPath);
  console.log(`\nMaster Excel generated successfully at:\n${localExcelPath}`);

  try {
    XLSX.writeFile(wb, artifactExcelPath);
    console.log(`Copied to artifact directory: ${artifactExcelPath}`);
  } catch (err) {
    console.warn('Could not copy to artifact directory:', err.message);
  }

  // Save JSON for reporting
  fs.writeFileSync(path.resolve(__dirname, 'all_setups_results.json'), JSON.stringify({
    profileSummaries,
    totalDays: allDates.length
  }, null, 2));
}

main().catch(console.error);
