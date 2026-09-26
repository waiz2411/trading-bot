import React from 'react';
import { DollarSign, TrendingUp, TrendingDown, Target, Award, ShieldAlert, BarChart3, Edit3, Zap } from 'lucide-react';

export default function MetricCards({ portfolio, riskSettings, onOpenBalanceModal, activeAccount = 'MARGIN', onOpenBrokerModal }) {
  if (!portfolio) return null;

  const isSpot = activeAccount === 'SPOT';
  const isLive = portfolio.isLive === true;
  const isConnected = portfolio.isConnected !== false;
  const brokerName = isSpot ? 'Binance Spot' : 'MetaTrader 5';
  const brokerTab = isSpot ? 'BINANCE' : 'MT5';

  const balance = portfolio.balance != null ? Number(portfolio.balance) : null;
  const equity = portfolio.equity != null ? Number(portfolio.equity) : null;
  const realizedPnL = portfolio.realizedPnL != null ? Number(portfolio.realizedPnL) : 0;
  const unrealizedPnL = portfolio.unrealizedPnL != null ? Number(portfolio.unrealizedPnL) : 0;
  const totalPnL = portfolio.totalPnL != null ? Number(portfolio.totalPnL) : 0;
  const totalPnLPct = portfolio.totalPnLPct != null ? Number(portfolio.totalPnLPct) : 0;
  const profitFactor = portfolio.profitFactor != null ? Number(portfolio.profitFactor) : 0;
  const activePositions = portfolio.activePositions || [];
  const usedMargin = portfolio.margin != null ? Number(portfolio.margin) : (portfolio.usedMargin != null ? Number(portfolio.usedMargin) : 0);
  const freeMargin = portfolio.freeMargin != null ? Number(portfolio.freeMargin) : (equity || 0);
  const marginLevelPercent = portfolio.marginLevelPercent != null ? Number(portfolio.marginLevelPercent) : 100;

  const tradesList = portfolio.closedTrades || [];
  const totalTrades = (portfolio.totalTrades !== undefined && portfolio.totalTrades > 0)
    ? portfolio.totalTrades
    : tradesList.length;

  const winCount = (portfolio.totalTrades !== undefined && portfolio.totalTrades > 0)
    ? (portfolio.winCount || 0)
    : tradesList.filter(t => (t.finalPnL || 0) > 0).length;

  const lossCount = (portfolio.totalTrades !== undefined && portfolio.totalTrades > 0)
    ? (portfolio.lossCount || 0)
    : tradesList.filter(t => (t.finalPnL || 0) < 0).length;

  const breakEvenCount = portfolio.breakEvenCount !== undefined
    ? portfolio.breakEvenCount
    : tradesList.filter(t => t.isBreakEven || (t.finalPnL || 0) === 0).length;

  const decisive = winCount + lossCount;
  const winRate = (portfolio.totalTrades !== undefined && portfolio.totalTrades > 0)
    ? (totalTrades > 0 && lossCount === 0 ? 100 : portfolio.winRate)
    : (decisive > 0 ? Number(((winCount / decisive) * 100).toFixed(1)) : (totalTrades > 0 && lossCount === 0 ? 100 : 0));
  const displayWinRate = !isNaN(Number(winRate)) ? Number(winRate) : 0;

  const isNetProfit = totalPnL >= 0;
  const isUnrealizedProfit = unrealizedPnL >= 0;
  const isRealizedProfit = realizedPnL >= 0;

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {/* Card 1: Total Equity & Custom Balance */}
      <div
        onClick={() => {
          if (isLive && !isConnected) {
            onOpenBrokerModal && onOpenBrokerModal(brokerTab);
          } else if (isLive) {
            onOpenBrokerModal && onOpenBrokerModal(brokerTab);
          } else {
            onOpenBalanceModal && onOpenBalanceModal();
          }
        }}
        className={`bg-terminal-850/80 border rounded-xl p-3.5 relative overflow-hidden group cursor-pointer transition-all shadow-md ${
          isLive && !isConnected
            ? 'border-amber-500/40 hover:border-amber-500/80 bg-amber-950/10'
            : isSpot
            ? 'hover:border-emerald-500/50 border-terminal-border'
            : 'hover:border-indigo-500/50 border-terminal-border'
        }`}
        title={
          isLive && !isConnected
            ? `Click to connect ${brokerName}`
            : isLive
            ? `Connected to ${brokerName}`
            : `Click to edit ${isSpot ? 'Spot' : 'Margin'} demo balance`
        }
      >
        <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
          <span className="font-mono uppercase tracking-wider text-[11px] flex items-center gap-1">
            <span>{isSpot ? 'Spot Equity' : 'Total Equity'}</span>
            {!isLive && (
              <Edit3 className={`w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity ${isSpot ? 'text-emerald-400' : 'text-indigo-400'}`} />
            )}
          </span>
          <DollarSign className={`w-3.5 h-3.5 ${isLive && !isConnected ? 'text-amber-400' : isSpot ? 'text-emerald-400' : 'text-indigo-400'}`} />
        </div>

        {isLive && !isConnected ? (
          <>
            <div className="text-base font-bold font-mono text-amber-400 tracking-tight flex items-center gap-1.5 py-0.5">
              <span>NOT CONNECTED</span>
            </div>
            <div className="text-[11px] font-mono mt-1 text-amber-400/80 flex items-center gap-1">
              <span>⚠️ Connect {isSpot ? 'Binance' : 'MT5'}</span>
            </div>
            <div className="text-[10px] font-sans mt-0.5 text-amber-300 group-hover:underline">
              Click to link broker account →
            </div>
            <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-amber-500 opacity-60" />
          </>
        ) : (
          <>
            <div className="text-xl font-bold font-mono text-white tracking-tight">
              ${(equity ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className={`text-[11px] font-mono mt-1 flex items-center gap-1 ${isNetProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
              {isNetProfit ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              <span>{isNetProfit ? '+' : ''}{totalPnL >= 0 ? `$${totalPnL}` : `-$${Math.abs(totalPnL)}`} ({totalPnLPct}%)</span>
            </div>
            <div className={`text-[10px] font-sans mt-0.5 ${isLive ? 'text-emerald-400' : isSpot ? 'text-emerald-300/80 group-hover:text-emerald-300' : 'text-indigo-300/80 group-hover:text-indigo-300'}`}>
              {isLive
                ? `Live Balance: $${(balance ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })} 🟢`
                : isSpot
                ? activePositions.length > 0
                  ? `Free Cash: $${(portfolio.freeCash ?? 0).toFixed(2)} • 100% In Coin ✏️`
                  : `Available Cash: $${(balance ?? 0).toFixed(2)} USDT ✏️`
                : `Balance: $${(balance ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })} (Edit ✏️)`}
            </div>
            <div className={`absolute bottom-0 left-0 right-0 h-[2px] ${
              isSpot ? 'bg-gradient-to-r from-emerald-500 to-teal-400' : 'bg-gradient-to-r from-indigo-500 to-rose-500'
            } opacity-60`} />
          </>
        )}
      </div>

      {/* Card 2: Unrealized PnL / Spot Holding */}
      <div className="bg-terminal-850/80 border border-terminal-border rounded-xl p-3.5 relative overflow-hidden">
        <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
          <span className="font-mono uppercase tracking-wider text-[11px]">
            {isSpot ? 'Open Spot Holding' : 'Open Scalp PnL'}
          </span>
          <Activity className="w-3.5 h-3.5 text-slate-400" />
        </div>
        {isSpot ? (
          <>
            <div className={`text-xl font-bold font-mono tracking-tight ${activePositions.length > 0 ? 'text-white' : 'text-slate-400'}`}>
              ${activePositions.length > 0 ? (portfolio.holdingValue || ((portfolio.usedMargin || 0) + unrealizedPnL)).toFixed(2) : '0.00'}
            </div>
            <div className={`text-[11px] font-mono mt-1 ${isUnrealizedProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
              {activePositions.length > 0 ? (
                <span>
                  {isUnrealizedProfit ? '+' : '-'}${Math.abs(unrealizedPnL).toFixed(2)} ({activePositions.length} active coin{activePositions.length > 1 ? 's' : ''})
                </span>
              ) : (
                <span className="text-slate-500">Standing by for setup</span>
              )}
            </div>
          </>
        ) : (
          <>
            <div className={`text-xl font-bold font-mono tracking-tight ${isUnrealizedProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
              {isUnrealizedProfit ? '+' : '-'}${Math.abs(unrealizedPnL).toFixed(2)}
            </div>
            <div className="text-[11px] font-mono mt-1 text-slate-400">
              <span>{activePositions.length} active scalp{activePositions.length !== 1 ? 's' : ''}</span>
            </div>
          </>
        )}
        <div className={`absolute bottom-0 left-0 right-0 h-[2px] ${isUnrealizedProfit ? 'bg-emerald-500' : 'bg-rose-500'} opacity-60`} />
      </div>

      {/* Card 3: Realized PnL & Broker Fees */}
      <div className="bg-terminal-850/80 border border-terminal-border rounded-xl p-3.5 relative overflow-hidden">
        <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
          <span className="font-mono uppercase tracking-wider text-[11px]">Net Realized PnL</span>
          <Target className="w-3.5 h-3.5 text-slate-400" />
        </div>
        <div className={`text-xl font-bold font-mono tracking-tight ${isRealizedProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
          {isRealizedProfit ? '+' : '-'}${Math.abs(realizedPnL).toFixed(2)}
        </div>
        <div className="text-[11px] font-mono mt-1 text-slate-400 flex items-center justify-between">
          <span className="text-amber-400/90">Fees: -${(portfolio.totalFeesPaid || 0).toFixed(2)}</span>
          <span>{totalTrades} closed</span>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-slate-600 opacity-60" />
      </div>

      {/* Card 4: Win Rate % */}
      <div className="bg-terminal-850/80 border border-terminal-border rounded-xl p-3.5 relative overflow-hidden">
        <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
          <span className="font-mono uppercase tracking-wider text-[11px]">Win Rate</span>
          <Award className="w-3.5 h-3.5 text-amber-400" />
        </div>
        <div className="text-xl font-bold font-mono text-white tracking-tight flex items-center justify-between">
          <span>{displayWinRate.toFixed(1)}%</span>
          <span className="text-xs text-slate-400 font-mono font-normal">({totalTrades} trades)</span>
        </div>
        <div className="text-[11px] font-mono mt-1 text-slate-400 flex items-center gap-1.5">
          <span className="text-emerald-400 font-semibold">{winCount}W</span>
          <span>/</span>
          <span className="text-rose-400 font-semibold">{lossCount}L</span>
          <span>/</span>
          <span className="text-indigo-300 font-semibold">{breakEvenCount}BE</span>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-amber-500 opacity-60" />
      </div>

      {/* Card 5: Execution Style / Risk-to-Reward Ratio */}
      {isSpot ? (
        <div className="bg-terminal-850/80 border border-terminal-border rounded-xl p-3.5 relative overflow-hidden">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span className="font-mono uppercase tracking-wider text-[11px]">Volatility & Shariah</span>
            <Target className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="text-sm font-bold font-mono text-emerald-300 tracking-tight flex items-center justify-between">
            <span>{riskSettings?.allowHighVolatility !== false ? '⚡ VOLATILE HALAL' : '🛡️ STANDARD HALAL'}</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded bg-teal-950/80 border border-teal-500/40 text-teal-300 font-mono font-bold">
              🕌 100% HALAL
            </span>
          </div>
          <div className="text-[11px] font-mono mt-1 text-emerald-400 font-semibold flex items-center justify-between">
            <span>1:{riskSettings?.targetRiskRewardRatio || '1.3'} R:R</span>
            <span className="text-slate-400 font-normal">SL -{riskSettings?.stopLossPct || '0.6'}% | TP +{riskSettings?.takeProfitPct || '0.78'}%</span>
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-emerald-500 opacity-60" />
        </div>
      ) : (
        <div className="bg-terminal-850/80 border border-terminal-border rounded-xl p-3.5 relative overflow-hidden">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span className="font-mono uppercase tracking-wider text-[11px]">Execution Style</span>
            <Zap className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <div className="text-base font-bold font-mono text-amber-300 tracking-tight flex items-center justify-between">
            <span>SCALPING</span>
            <span className="text-xs px-2 py-0.5 rounded bg-terminal-950 border border-amber-500/40 text-amber-300 font-mono font-bold">
              {riskSettings?.defaultLeverage || 500}x LEV
            </span>
          </div>
          <div className="text-[11px] font-mono mt-1 font-semibold flex items-center justify-between">
            <span className={
              riskSettings?.tradeDirection === 'SHORT_ONLY' ? 'text-rose-400' :
              riskSettings?.tradeDirection === 'LONG_ONLY' ? 'text-emerald-400' : 'text-indigo-400'
            }>
              {riskSettings?.tradeDirection === 'SHORT_ONLY' ? '▼ SHORT ONLY' :
               riskSettings?.tradeDirection === 'LONG_ONLY' ? '▲ LONG ONLY' : '⇅ BI-DIRECTIONAL'}
            </span>
            <span className="text-slate-400 font-normal">1:{riskSettings?.targetRiskRewardRatio || '1.3'} R:R</span>
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-amber-500 opacity-60" />
        </div>
      )}

      {/* Card 6: Margin & Risk / Allocation */}
      {isSpot ? (
        <div className="bg-terminal-850/80 border border-terminal-border rounded-xl p-3.5 relative overflow-hidden">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span className="font-mono uppercase tracking-wider text-[11px]">Capital Allocation</span>
            <ShieldAlert className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="text-base font-bold font-mono text-white tracking-tight flex items-center justify-between">
            <span className="text-emerald-400">
              {riskSettings?.allocationPct || (100 / (riskSettings?.maxConcurrentTrades || 4)).toFixed(0)}% PER TRADE
            </span>
            <span className="text-xs text-slate-300 font-mono font-normal">
              {activePositions.length}/{riskSettings?.maxConcurrentTrades || 4} Portions
            </span>
          </div>
          <div className="text-[11px] font-mono mt-1 text-slate-400 flex items-center justify-between">
            {isLive && !isConnected ? (
              <span className="text-amber-400">Awaiting Binance API</span>
            ) : (
              <span className="text-slate-300 font-mono">${(portfolio.freeCash ?? Math.max(0, balance - usedMargin)).toFixed(2)} free cash</span>
            )}
            <span className="text-emerald-400 font-semibold">0x Lev (Cash)</span>
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-emerald-500 opacity-60" />
        </div>
      ) : (
        <div className="bg-terminal-850/80 border border-terminal-border rounded-xl p-3.5 relative overflow-hidden">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span className="font-mono uppercase tracking-wider text-[11px]">Margin & Slots</span>
            <ShieldAlert className="w-3.5 h-3.5 text-indigo-400" />
          </div>
          {isLive && !isConnected ? (
            <>
              <div className="text-base font-bold font-mono text-amber-400 tracking-tight flex items-center justify-between">
                <span>OFFLINE</span>
                <span className="text-xs text-slate-400 font-mono font-normal">500x Lev</span>
              </div>
              <div className="text-[11px] font-mono mt-1 text-slate-400 flex items-center justify-between">
                <span className="text-amber-400">Awaiting MT5 bridge</span>
                <span>{riskSettings?.riskPerTradePct || 1.5}% risk</span>
              </div>
            </>
          ) : (
            <>
              <div className="text-lg font-bold font-mono text-white tracking-tight flex items-center justify-between">
                <span>${usedMargin.toFixed(0)} <span className="text-xs text-slate-400 font-normal">used</span></span>
                <span className="text-xs text-emerald-400 font-mono">${freeMargin.toFixed(0)} free</span>
              </div>
              <div className="text-[11px] font-mono mt-1 text-slate-400 flex items-center justify-between">
                <span>{activePositions.length}/{riskSettings?.maxConcurrentTrades || 4} slots</span>
                <span>{riskSettings?.riskPerTradePct || 1.5}% risk</span>
              </div>
            </>
          )}
          <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-purple-500 opacity-60" />
        </div>
      )}
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
