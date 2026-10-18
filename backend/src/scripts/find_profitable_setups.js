import { backtestService } from '../services/backtestService.js';

async function test() {
  const tests = [
    // 1. Scalping quick 3% with 1.8% SL
    { name: 'Scalp TP 3.0%, SL 1.5%, BE 1.5%, Tr 2.2%', tp: 3.0, sl: 1.5, be: 1.5, tr: 2.2, hold: 180, min24: 3.0, max24: 35.0, rvol: 2.0 },
    // 2. High momentum breakout 4% TP, 2.5% SL
    { name: 'Breakout TP 4.0%, SL 2.2%, BE 2.0%, Tr 3.0%', tp: 4.0, sl: 2.2, be: 2.0, tr: 3.0, hold: 300, min24: 4.0, max24: 35.0, rvol: 2.0 },
    // 3. Wider swing TP 6.0%, SL 3.0%, BE 2.5%, Tr 4.0%
    { name: 'Swing TP 6.0%, SL 3.0%, BE 2.5%, Tr 4.0%', tp: 6.0, sl: 3.0, be: 2.5, tr: 4.0, hold: 480, min24: 3.0, max24: 35.0, rvol: 1.8 },
    // 4. Large TP 8.0%, SL 3.5%, BE 3.0%, Tr 5.0%
    { name: 'Large TP 8.0%, SL 3.5%, BE 3.0%, Tr 5.0%', tp: 8.0, sl: 3.5, be: 3.0, tr: 5.0, hold: 720, min24: 3.0, max24: 40.0, rvol: 1.8 },
    // 5. High RVOL 2.5x with TP 5.0%, SL 2.5%
    { name: 'High RVOL 2.5x, TP 5.0%, SL 2.5%, BE 2.5%', tp: 5.0, sl: 2.5, be: 2.5, tr: 3.5, hold: 360, min24: 3.0, max24: 35.0, rvol: 2.5 },
    // 6. Super Momentum: min 24h gain 8%, TP 6.0%, SL 3.0%
    { name: 'Super Momentum min24h=8%, TP 6.0%, SL 3.0%', tp: 6.0, sl: 3.0, be: 2.5, tr: 4.0, hold: 480, min24: 8.0, max24: 45.0, rvol: 2.0 },
    // 7. Early trend: min 24h gain 1-10%, TP 4.0%, SL 2.5%
    { name: 'Early Trend min24h=1-10%, TP 4.0%, SL 2.5%', tp: 4.0, sl: 2.5, be: 2.2, tr: 3.0, hold: 360, min24: 1.0, max24: 10.0, rvol: 1.8 },
    // 8. 2 slots (50% allocation each)
    { name: '2 Slots (50% alloc), TP 5.0%, SL 2.5%', tp: 5.0, sl: 2.5, be: 2.5, tr: 3.5, hold: 480, min24: 3.0, max24: 35.0, rvol: 2.0, slots: 2 },
  ];

  const setups = ['BREAKOUT', 'PULLBACK', 'CROSSOVER', 'ANY_VALID'];

  const results = [];

  for (const s of setups) {
    for (const t of tests) {
      const res = backtestService.run({
        startDate: '2026-01-01',
        endDate: '2026-10-16',
        initialBalance: 10.0,
        symbols: 'ALL',
        entryStrategy: s,
        takeProfitPct: t.tp,
        stopLossPct: t.sl,
        breakEvenTriggerPct: t.be,
        breakEvenLockPct: 0.25,
        trailingTriggerPct: t.tr,
        trailingDistancePct: 1.2,
        min24hGain: t.min24,
        max24hGain: t.max24,
        minRvol: t.rvol || 1.8,
        maxHoldMinutes: t.hold,
        useBtcFilter: true,
        maxSlots: t.slots || 1
      });

      if (res && res.success) {
        results.push({
          setup: s,
          name: t.name,
          roi: Number(res.summary.roiPct.toFixed(2)),
          trades: res.summary.totalTrades,
          winRate: Number(res.summary.winRatePct.toFixed(2)),
          wins: res.summary.wins,
          losses: res.summary.losses,
          be: res.summary.breakEvens,
          pf: Number(res.summary.profitFactor.toFixed(2)),
          maxDD: Number(res.summary.maxDrawdownPct.toFixed(2))
        });
      }
    }
  }

  results.sort((a, b) => b.roi - a.roi);

  console.log('\n=== TOP 10 PROFITABLE CONFIGURATIONS ===');
  console.table(results.slice(0, 10));

  console.log('\n=== BOTTOM 5 CONFIGURATIONS ===');
  console.table(results.slice(-5));
}

test().catch(console.error);
