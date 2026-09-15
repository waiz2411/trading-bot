import React from 'react';
import { DollarSign, TrendingUp, TrendingDown, Target, Award, ShieldAlert, BarChart3, Edit3, Zap } from 'lucide-react';

export default function MetricCards({ portfolio, riskSettings, onOpenBalanceModal }) {
  if (!portfolio) return null;

  const {
    equity = 10000,
    balance = 10000,
    realizedPnL = 0,
    unrealizedPnL = 0,
    totalPnL = 0,
    totalPnLPct = 0,
    winRate = 0,
    winCount = 0,
    lossCount = 0,
    totalTrades = 0,
    profitFactor = 0,
    activePositions = [],
    usedMargin = 0,
    freeMargin = equity,
    marginLevelPercent = 100
  } = portfolio;

  const isNetProfit = totalPnL >= 0;
  const isUnrealizedProfit = unrealizedPnL >= 0;
  const isRealizedProfit = realizedPnL >= 0;

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {/* Card 1: Total Equity & Custom Balance */}
      <div
        onClick={onOpenBalanceModal}
        className="bg-terminal-850/80 border border-terminal-border hover:border-indigo-500/50 rounded-xl p-3.5 relative overflow-hidden group cursor-pointer transition-all shadow-md"
        title="Click to edit demo account balance"
      >
        <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
          <span className="font-mono uppercase tracking-wider text-[11px] flex items-center gap-1">
            <span>Total Equity</span>
            <Edit3 className="w-3 h-3 text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity" />
          </span>
          <DollarSign className="w-3.5 h-3.5 text-indigo-400" />
        </div>
        <div className="text-xl font-bold font-mono text-white tracking-tight">
          ${equity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
        <div className={`text-[11px] font-mono mt-1 flex items-center gap-1 ${isNetProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
          {isNetProfit ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          <span>{isNetProfit ? '+' : ''}{totalPnL >= 0 ? `$${totalPnL}` : `-$${Math.abs(totalPnL)}`} ({totalPnLPct}%)</span>
        </div>
        <div className="text-[10px] text-indigo-300/80 font-sans mt-0.5 group-hover:text-indigo-300">
          Balance: ${balance.toLocaleString('en-US', { minimumFractionDigits: 2 })} (Edit ✏️)
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-gradient-to-r from-indigo-500 to-rose-500 opacity-60" />
      </div>

      {/* Card 2: Unrealized PnL */}
      <div className="bg-terminal-850/80 border border-terminal-border rounded-xl p-3.5 relative overflow-hidden">
        <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
          <span className="font-mono uppercase tracking-wider text-[11px]">Open Scalp PnL</span>
          <Activity className="w-3.5 h-3.5 text-slate-400" />
        </div>
        <div className={`text-xl font-bold font-mono tracking-tight ${isUnrealizedProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
          {isUnrealizedProfit ? '+' : '-'}${Math.abs(unrealizedPnL).toFixed(2)}
        </div>
        <div className="text-[11px] font-mono mt-1 text-slate-400">
          <span>{activePositions.length} active scalp{activePositions.length !== 1 ? 's' : ''}</span>
        </div>
        <div className={`absolute bottom-0 left-0 right-0 h-[2px] ${isUnrealizedProfit ? 'bg-emerald-500' : 'bg-rose-500'} opacity-60`} />
      </div>

      {/* Card 3: Realized PnL */}
      <div className="bg-terminal-850/80 border border-terminal-border rounded-xl p-3.5 relative overflow-hidden">
        <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
          <span className="font-mono uppercase tracking-wider text-[11px]">Realized PnL</span>
          <Target className="w-3.5 h-3.5 text-slate-400" />
        </div>
        <div className={`text-xl font-bold font-mono tracking-tight ${isRealizedProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
          {isRealizedProfit ? '+' : '-'}${Math.abs(realizedPnL).toFixed(2)}
        </div>
        <div className="text-[11px] font-mono mt-1 text-slate-400">
          <span>{totalTrades} closed scalps</span>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-slate-600 opacity-60" />
      </div>

      {/* Card 4: Win Rate % */}
      <div className="bg-terminal-850/80 border border-terminal-border rounded-xl p-3.5 relative overflow-hidden">
        <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
          <span className="font-mono uppercase tracking-wider text-[11px]">Win Rate</span>
          <Award className="w-3.5 h-3.5 text-amber-400" />
        </div>
        <div className="text-xl font-bold font-mono text-white tracking-tight flex items-baseline gap-1">
          <span>{winRate}%</span>
          <span className="text-xs text-slate-400 font-normal">({totalTrades} trades)</span>
        </div>
        <div className="text-[11px] font-mono mt-1 flex items-center gap-1.5 text-slate-300">
          <span className="text-emerald-400 font-semibold">{winCount}W</span>
          <span className="text-slate-600">/</span>
          <span className="text-rose-400 font-semibold">{lossCount}L</span>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-amber-500 opacity-60" />
      </div>

      {/* Card 5: Scalp Strategy Mode & Leverage */}
      <div className="bg-terminal-850/80 border border-terminal-border rounded-xl p-3.5 relative overflow-hidden">
        <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
          <span className="font-mono uppercase tracking-wider text-[11px]">Execution Style</span>
          <Zap className="w-3.5 h-3.5 text-amber-400" />
        </div>
        <div className="text-base font-bold font-mono text-amber-300 tracking-tight flex items-center justify-between">
          <span>SCALPING</span>
          <span className="text-xs px-2 py-0.5 rounded bg-terminal-950 border border-amber-500/40 text-amber-300 font-mono font-bold">
            {riskSettings?.defaultLeverage || 10}x LEV
          </span>
        </div>
        <div className="text-[11px] font-mono mt-1 text-rose-300 font-semibold flex items-center justify-between">
          <span>{riskSettings?.tradeDirection === 'SHORT_ONLY' ? '▼ SHORT ONLY' : riskSettings?.tradeDirection}</span>
          <span className="text-slate-400 font-normal">1:{riskSettings?.targetRiskRewardRatio || '1.3'} R:R</span>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-amber-500 opacity-60" />
      </div>

      {/* Card 6: Margin & Risk Guardian */}
      <div className="bg-terminal-850/80 border border-terminal-border rounded-xl p-3.5 relative overflow-hidden">
        <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
          <span className="font-mono uppercase tracking-wider text-[11px]">Margin & Slots</span>
          <ShieldAlert className="w-3.5 h-3.5 text-indigo-400" />
        </div>
        <div className="text-lg font-bold font-mono text-white tracking-tight flex items-center justify-between">
          <span>${usedMargin.toFixed(0)} <span className="text-xs text-slate-400 font-normal">used</span></span>
          <span className="text-xs text-emerald-400 font-mono">${freeMargin.toFixed(0)} free</span>
        </div>
        <div className="text-[11px] font-mono mt-1 text-slate-400 flex items-center justify-between">
          <span>{activePositions.length}/{riskSettings?.maxConcurrentTrades || 4} slots</span>
          <span>{riskSettings?.riskPerTradePct || 1.5}% risk</span>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-purple-500 opacity-60" />
      </div>
    </div>
  );
}

function Activity(props) {
  return (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
    </svg>
  );
}
