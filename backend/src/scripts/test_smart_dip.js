import { backtestService } from '../services/backtestService.js';

async function testSmartSetup() {
  console.log('Testing Smart Trend Dip / Value Entry Strategy...');

  const config = {
    startDate: '2026-01-01',
    endDate: '2026-10-16',
    initialBalance: 10.0,
    symbols: 'ALL',
    entryStrategy: 'PULLBACK', // Pullback to EMA
    takeProfitPct: 3.5,
    stopLossPct: 2.5,
    breakEvenTriggerPct: 2.0,
    breakEvenLockPct: 0.25,
    trailingTriggerPct: 2.8,
    trailingDistancePct: 1.0,
    min24hGain: 1.5, // Catches early momentum
    max24hGain: 20.0, // Avoids over-pumped climax coins
    minRvol: 1.2, // Moderate healthy volume
    maxHoldMinutes: 360, // 6 hours
    useBtcFilter: false, // Don't kill trades on mild BTC dips
    maxSlots: 1
  };

  const res = backtestService.run(config);

  if (res && res.success) {
    const { summary, trades } = res;
    const daysWithTrades = new Set(trades.map(t => (t.exitTime || t.entryTime).slice(0, 10))).size;
    console.log('Results:');
    console.log(`  Total Trades: ${summary.totalTrades}`);
    console.log(`  Active Trading Days: ${daysWithTrades}/289 (${((daysWithTrades/289)*100).toFixed(1)}%)`);
    console.log(`  Win Rate: ${summary.winRatePct.toFixed(1)}%`);
    console.log(`  Wins: ${summary.wins}, Losses: ${summary.losses}, BE: ${summary.breakEvens}`);
    console.log(`  Profit Factor: ${summary.profitFactor}`);
    console.log(`  ROI: ${summary.roiPct.toFixed(1)}%`);
    console.log(`  Max Drawdown: ${summary.maxDrawdownPct.toFixed(1)}%`);
    console.log('  Exits:', summary.exitsBreakdown);
  }
}

testSmartSetup().catch(console.error);
