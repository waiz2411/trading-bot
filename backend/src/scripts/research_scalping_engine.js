import { backtestService } from '../services/backtestService.js';

async function runResearch() {
  console.log('=== QUANT SCALPING ENGINE RESEARCH (JAN 1 - OCT 16, 2026) ===\n');

  const scalpingProfiles = [
    {
      name: 'Micro Scalp 1.5% TP / 1.0% SL (Ultra Quick 45m)',
      tp: 1.5,
      sl: 1.0,
      be: 0.8,
      beLock: 0.15,
      tr: 1.0,
      trDist: 0.4,
      hold: 45,
      min24: 1.5,
      max24: 30.0,
      rvol: 1.3,
      btcFilter: false,
      strategy: 'PULLBACK'
    },
    {
      name: 'Micro Scalp 2.0% TP / 1.2% SL (Quick 60m Hold)',
      tp: 2.0,
      sl: 1.2,
      be: 1.0,
      beLock: 0.15,
      tr: 1.4,
      trDist: 0.5,
      hold: 60,
      min24: 1.5,
      max24: 30.0,
      rvol: 1.3,
      btcFilter: false,
      strategy: 'PULLBACK'
    },
    {
      name: 'Momentum Scalp 2.5% TP / 1.5% SL (90m Hold)',
      tp: 2.5,
      sl: 1.5,
      be: 1.2,
      beLock: 0.20,
      tr: 1.8,
      trDist: 0.6,
      hold: 90,
      min24: 2.0,
      max24: 30.0,
      rvol: 1.4,
      btcFilter: false,
      strategy: 'BREAKOUT'
    },
    {
      name: 'Dynamic Scalp 2.0% TP / 1.2% SL (ANY_VALID, Relaxed Filter)',
      tp: 2.0,
      sl: 1.2,
      be: 1.0,
      beLock: 0.15,
      tr: 1.4,
      trDist: 0.5,
      hold: 60,
      min24: 1.0,
      max24: 30.0,
      rvol: 1.2,
      btcFilter: false,
      strategy: 'ANY_VALID'
    },
    {
      name: 'Dynamic Scalp 2.5% TP / 1.4% SL (ANY_VALID, 90m Hold)',
      tp: 2.5,
      sl: 1.4,
      be: 1.2,
      beLock: 0.20,
      tr: 1.8,
      trDist: 0.6,
      hold: 90,
      min24: 1.5,
      max24: 30.0,
      rvol: 1.3,
      btcFilter: false,
      strategy: 'ANY_VALID'
    },
    {
      name: 'Dynamic Scalp 3.0% TP / 1.5% SL (ANY_VALID, 120m Hold)',
      tp: 3.0,
      sl: 1.5,
      be: 1.4,
      beLock: 0.20,
      tr: 2.0,
      trDist: 0.7,
      hold: 120,
      min24: 1.5,
      max24: 30.0,
      rvol: 1.3,
      btcFilter: false,
      strategy: 'ANY_VALID'
    },
    {
      name: 'Dynamic Scalp 2.5% TP / 1.4% SL with BTC Filter ON',
      tp: 2.5,
      sl: 1.4,
      be: 1.2,
      beLock: 0.20,
      tr: 1.8,
      trDist: 0.6,
      hold: 90,
      min24: 1.5,
      max24: 30.0,
      rvol: 1.3,
      btcFilter: true,
      strategy: 'ANY_VALID'
    }
  ];

  const results = [];

  for (const p of scalpingProfiles) {
    const t0 = Date.now();
    const res = backtestService.run({
      startDate: '2026-01-01',
      endDate: '2026-10-16',
      initialBalance: 10.0,
      symbols: 'ALL',
      entryStrategy: p.strategy,
      takeProfitPct: p.tp,
      stopLossPct: p.sl,
      breakEvenTriggerPct: p.be,
      breakEvenLockPct: p.beLock,
      trailingTriggerPct: p.tr,
      trailingDistancePct: p.trDist,
      min24hGain: p.min24,
      max24hGain: p.max24,
      minRvol: p.rvol,
      maxHoldMinutes: p.hold,
      useBtcFilter: p.btcFilter,
      maxSlots: 1,
      feeRatePct: 0.10,
      slippagePct: 0.05
    });

    const duration = ((Date.now() - t0) / 1000).toFixed(1);

    if (res && res.success) {
      const { summary, trades } = res;
      // Calculate active days
      const daysWithTrades = new Set(trades.map(t => (t.exitTime || t.entryTime).slice(0, 10))).size;

      results.push({
        Profile: p.name,
        'ROI (%)': `${summary.roiPct >= 0 ? '+' : ''}${summary.roiPct.toFixed(1)}%`,
        'Total Trades': summary.totalTrades,
        'Active Days': `${daysWithTrades}/289 (${((daysWithTrades / 289) * 100).toFixed(1)}%)`,
        'Win Rate (%)': `${summary.winRatePct.toFixed(1)}%`,
        'Profit Factor': summary.profitFactor,
        'Max DD (%)': `${summary.maxDrawdownPct.toFixed(1)}%`,
        'Wins / Losses / BE': `${summary.wins} / ${summary.losses} / ${summary.breakEvens}`,
        Exits: JSON.stringify(summary.exitsBreakdown)
      });
      console.log(`[${duration}s] ${p.name} -> ROI: ${summary.roiPct.toFixed(1)}%, Trades: ${summary.totalTrades}, WinRate: ${summary.winRatePct.toFixed(1)}%, ActiveDays: ${daysWithTrades}`);
    }
  }

  console.log('\n=== SCALPING EXPERIMENT COMPARISON TABLE ===');
  console.table(results);
}

runResearch().catch(console.error);
