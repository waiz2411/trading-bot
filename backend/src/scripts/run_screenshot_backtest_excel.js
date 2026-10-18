import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';
import { backtestService } from '../services/backtestService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log('--- STARTING 2026-01-01 to 2026-10-16 SCREENSHOT REPLICATION BACKTEST ---');
  
  // Exact settings from user screenshot (media_1792134392379.png):
  const params = {
    startDate: '2026-01-01',
    endDate: '2026-10-16',
    initialBalance: 10.0,
    symbols: 'ALL',
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
    entryStrategy: 'CROSSOVER',
    useBtcFilter: true,
    maxSlots: 1,
    feeRatePct: 0.10,
    slippagePct: 0.05
  };

  console.log('Settings Applied:', JSON.stringify(params, null, 2));

  const result = backtestService.run(params);

  if (!result || !result.success) {
    console.error('Backtest failed:', result ? result.error : 'Unknown error');
    return;
  }

  const { summary: stats, trades: rawTrades } = result;
  // Sort trades chronologically
  const trades = [...rawTrades].sort((a, b) => new Date(a.entryTime).getTime() - new Date(b.entryTime).getTime());

  console.log('\n--- OVERALL PERFORMANCE SUMMARY ---');
  console.log(`Date Range: ${params.startDate} to ${params.endDate}`);
  console.log(`Initial Capital: $${stats.initialBalance.toFixed(2)}`);
  console.log(`Final Capital: $${stats.finalBalance.toFixed(2)}`);
  console.log(`Total Net Gain (%): ${stats.roiPct >= 0 ? '+' : ''}${stats.roiPct.toFixed(2)}%`);
  console.log(`Total Trades: ${stats.totalTrades}`);
  console.log(`Winning Trades: ${stats.wins} (${stats.winRatePct.toFixed(2)}%)`);
  console.log(`Losing Trades: ${stats.losses}`);
  console.log(`Max Drawdown (%): ${stats.maxDrawdownPct.toFixed(2)}%`);
  console.log(`Profit Factor: ${stats.profitFactor}`);

  // Build calendar from Jan 1, 2026 to Oct 16, 2026
  const start = new Date('2026-01-01T00:00:00Z');
  const end = new Date('2026-10-16T00:00:00Z');
  const allDates = [];
  
  let curr = new Date(start);
  while (curr <= end) {
    allDates.push(curr.toISOString().split('T')[0]);
    curr.setUTCDate(curr.getUTCDate() + 1);
  }

  // Group trades by exit date (or entry date if not exited yet)
  const tradesByDate = {};
  trades.forEach(t => {
    const tradeDate = t.exitTime ? t.exitTime.split('T')[0] : t.entryTime.split('T')[0];
    if (!tradesByDate[tradeDate]) tradesByDate[tradeDate] = [];
    tradesByDate[tradeDate].push(t);
  });

  // Calculate day-by-day percentage performance
  let runningBalance = params.initialBalance;
  let totalWinDays = 0;
  let totalLossDays = 0;
  let totalZeroDays = 0;

  const dailyRows = [];

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
    const cumulativeRoiPct = ((dayEndBalance - params.initialBalance) / params.initialBalance) * 100;

    let dayStatus = 'NO_TRADE';
    if (dayReturnPct > 0) {
      dayStatus = 'WIN_DAY';
      totalWinDays++;
    } else if (dayReturnPct < 0) {
      dayStatus = 'LOSS_DAY';
      totalLossDays++;
    } else {
      totalZeroDays++;
    }

    dailyRows.push({
      date: dateStr,
      dayReturnPct: Number(dayReturnPct.toFixed(2)),
      cumulativeRoiPct: Number(cumulativeRoiPct.toFixed(2)),
      startBalance: Number(dayStartBalance.toFixed(2)),
      endBalance: Number(dayEndBalance.toFixed(2)),
      netPnL: Number(dayNetPnL.toFixed(3)),
      tradeCount: dayTrades.length,
      wins: dayWins,
      losses: dayLosses,
      status: dayStatus,
      tradeDetails: coinsTraded.join('; ') || 'No qualifying entry signals (Capital Protected)'
    });
  }

  // Monthly breakdown
  const monthlyData = {};
  dailyRows.forEach(r => {
    const month = r.date.slice(0, 7);
    if (!monthlyData[month]) {
      monthlyData[month] = {
        month,
        startBalance: r.startBalance,
        endBalance: r.endBalance,
        trades: 0,
        wins: 0,
        losses: 0,
        winDays: 0,
        lossDays: 0,
        neutralDays: 0
      };
    }
    monthlyData[month].endBalance = r.endBalance;
    monthlyData[month].trades += r.tradeCount;
    monthlyData[month].wins += r.wins;
    monthlyData[month].losses += r.losses;
    if (r.dayReturnPct > 0) monthlyData[month].winDays++;
    else if (r.dayReturnPct < 0) monthlyData[month].lossDays++;
    else monthlyData[month].neutralDays++;
  });

  const monthlySummaryRows = Object.values(monthlyData).map(m => {
    const returnPct = m.startBalance > 0 ? ((m.endBalance - m.startBalance) / m.startBalance) * 100 : 0;
    return {
      Month: m.month,
      'Month Return (%)': `${returnPct >= 0 ? '+' : ''}${returnPct.toFixed(2)}%`,
      'Start Balance ($)': `$${m.startBalance.toFixed(2)}`,
      'End Balance ($)': `$${m.endBalance.toFixed(2)}`,
      'Total Trades': m.trades,
      'Win Trades': m.wins,
      'Loss Trades': m.losses,
      'Win Days': m.winDays,
      'Loss Days': m.lossDays,
      'Flat Days (No Trade)': m.neutralDays
    };
  });

  console.log('\n--- MONTHLY BREAKDOWN ---');
  console.table(monthlySummaryRows);

  // Build Excel File
  const wb = XLSX.utils.book_new();

  // Sheet 1: Daily Performance (%)
  const dailyExcelData = dailyRows.map(r => ({
    'Date': r.date,
    'Daily Return (%)': `${r.dayReturnPct >= 0 ? '+' : ''}${r.dayReturnPct.toFixed(2)}%`,
    'Cumulative Account Return (%)': `${r.cumulativeRoiPct >= 0 ? '+' : ''}${r.cumulativeRoiPct.toFixed(2)}%`,
    'Day Status': r.status === 'WIN_DAY' ? 'PROFIT (+)' : (r.status === 'LOSS_DAY' ? 'LOSS (-)' : 'CAPITAL PROTECTED (0.00%)'),
    'Trades Count': r.tradeCount,
    'Wins': r.wins,
    'Losses': r.losses,
    'Account Balance ($)': `$${r.endBalance.toFixed(2)}`,
    'Traded Symbols & Outcome': r.tradeDetails
  }));
  const wsDaily = XLSX.utils.json_to_sheet(dailyExcelData);
  XLSX.utils.book_append_sheet(wb, wsDaily, 'Daily Performance (%)');

  // Sheet 2: All Executed Trades
  const tradesExcelData = trades.map(t => ({
    'Trade #': t.id,
    'Symbol': t.symbol,
    'Entry Time (UTC)': t.entryTime,
    'Exit Time (UTC)': t.exitTime,
    'Hold Time (mins)': t.durationMins,
    'Entry Price ($)': t.entryPrice,
    'Exit Price ($)': t.exitPrice,
    'Trade Return (%)': `${t.returnPct >= 0 ? '+' : ''}${t.returnPct.toFixed(2)}%`,
    'Exit Reason': t.exitReason,
    'Account Balance After ($)': `$${t.balanceAfter.toFixed(2)}`
  }));
  const wsTrades = XLSX.utils.json_to_sheet(tradesExcelData);
  XLSX.utils.book_append_sheet(wb, wsTrades, 'All Executed Trades');

  // Sheet 3: Monthly Breakdown
  const wsMonthly = XLSX.utils.json_to_sheet(monthlySummaryRows);
  XLSX.utils.book_append_sheet(wb, wsMonthly, 'Monthly Summary (%)');

  // Sheet 4: Strategy Settings & Overview
  const summaryOverview = [
    { 'Parameter': 'Backtest Period', 'Value': `${params.startDate} to ${params.endDate} (${allDates.length} Days)` },
    { 'Parameter': 'Initial Capital', 'Value': `$${params.initialBalance.toFixed(2)}` },
    { 'Parameter': 'Final Capital', 'Value': `$${stats.finalBalance.toFixed(2)}` },
    { 'Parameter': 'Cumulative ROI (%)', 'Value': `${stats.roiPct >= 0 ? '+' : ''}${stats.roiPct.toFixed(2)}%` },
    { 'Parameter': 'Max Drawdown (%)', 'Value': `-${stats.maxDrawdownPct.toFixed(2)}%` },
    { 'Parameter': 'Total Trades', 'Value': stats.totalTrades },
    { 'Parameter': 'Winning Trades', 'Value': `${stats.wins} (${stats.winRatePct.toFixed(2)}%)` },
    { 'Parameter': 'Losing Trades', 'Value': stats.losses },
    { 'Parameter': 'Profit Factor', 'Value': stats.profitFactor },
    { 'Parameter': 'Active Win Days', 'Value': `${totalWinDays} Days` },
    { 'Parameter': 'Active Loss Days', 'Value': `${totalLossDays} Days` },
    { 'Parameter': 'Capital Protected Days (No Trade)', 'Value': `${totalZeroDays} Days` },
    { 'Parameter': 'Trigger Setup', 'Value': 'CROSSOVER (Fresh 9/21 EMA Cross)' },
    { 'Parameter': 'Take Profit (%)', 'Value': '10.0%' },
    { 'Parameter': 'Stop Loss (%)', 'Value': '2.0%' },
    { 'Parameter': 'Break-Even Trigger / Lock', 'Value': '2.5% Trigger / 0.2% Lock' },
    { 'Parameter': 'Trailing Stop Trigger / Distance', 'Value': '5.0% Trigger / 1.5% Distance' },
    { 'Parameter': 'Min 24h Gain / Max 24h Gain', 'Value': '7.0% / 45.0%' },
    { 'Parameter': 'Min Volume RVOL', 'Value': '2.0x SMA20' },
    { 'Parameter': 'BTC Health Filter', 'Value': 'Enabled (BTC > EMA21)' },
    { 'Parameter': 'Max Slots', 'Value': '1 Slot (100% Capital allocation)' }
  ];
  const wsOverview = XLSX.utils.json_to_sheet(summaryOverview);
  XLSX.utils.book_append_sheet(wb, wsOverview, 'Strategy Settings');

  // Save to file
  const excelFileName = 'nexus_quant_jan_to_oct_daily_report.xlsx';
  const localExcelPath = path.resolve(__dirname, '../../../', excelFileName);
  const artifactExcelPath = path.resolve('C:/Users/waizt/.gemini/antigravity/brain/9240cc1b-f576-4996-a196-552f1f9e4603', excelFileName);

  XLSX.writeFile(wb, localExcelPath);
  console.log(`Excel file created at: ${localExcelPath}`);

  try {
    XLSX.writeFile(wb, artifactExcelPath);
    console.log(`Excel file copied to artifact directory: ${artifactExcelPath}`);
  } catch (err) {
    console.warn('Could not copy to artifact directory directly:', err.message);
  }

  // Output stats in JSON for presentation
  const outputData = {
    totalDays: allDates.length,
    winDays: totalWinDays,
    lossDays: totalLossDays,
    neutralDays: totalZeroDays,
    totalRoiPct: stats.roiPct,
    maxDrawdownPct: stats.maxDrawdownPct,
    winRatePct: stats.winRatePct,
    totalTrades: stats.totalTrades,
    profitFactor: stats.profitFactor,
    dailyRows,
    monthlySummaryRows
  };

  fs.writeFileSync(path.resolve(__dirname, 'backtest_full_results.json'), JSON.stringify(outputData, null, 2));
  console.log('Results saved to backtest_full_results.json');
}

main().catch(console.error);
