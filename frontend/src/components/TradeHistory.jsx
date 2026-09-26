import React from 'react';
import { History, ArrowUpRight, ArrowDownRight, CheckCircle2, XCircle, AlertCircle, ShieldCheck, Zap, Lock, Sparkles, Timer } from 'lucide-react';
import { formatPrice } from '../utils/formatters.js';

export default function TradeHistory({ closedTrades = [] }) {
  if (!closedTrades || closedTrades.length === 0) {
    return (
      <div className="bg-terminal-850/70 border border-terminal-border rounded-xl p-8 text-center shadow-lg">
        <div className="w-12 h-12 rounded-full bg-terminal-900 border border-terminal-border flex items-center justify-center mx-auto mb-3 text-slate-500">
          <History className="w-6 h-6 text-slate-400" />
        </div>
        <h3 className="text-sm font-bold font-mono text-white mb-1">No Closed Trades Yet</h3>
        <p className="text-xs text-slate-400 max-w-md mx-auto">
          When open positions hit Take-Profit, Trailing Stops, Break-Even, or Signal Reversal exits, they will appear here with full audit telemetry.
        </p>
      </div>
    );
  }

  const getExitBadge = (reason) => {
    switch (reason) {
      case 'TAKE_PROFIT_TRIGGER':
        return (
          <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[10px] font-mono font-semibold flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" />
            TP Target Reached
          </span>
        );
      case 'TIME_LIMIT_EXIT':
        return (
          <span className="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 text-[10px] font-mono font-semibold flex items-center gap-1">
            <Timer className="w-3 h-3 text-cyan-400" />
            5m Scalp Expiry
          </span>
        );
      case 'TRAILING_STOP_TRIGGER':
        return (
          <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-mono font-bold flex items-center gap-1 shadow-sm shadow-emerald-500/10">
            <ShieldCheck className="w-3 h-3 text-emerald-400" />
            Trailing Profit Locked
          </span>
        );
      case 'BREAKEVEN_STOP_TRIGGER':
        return (
          <span className="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 text-[10px] font-mono font-semibold flex items-center gap-1">
            <Lock className="w-3 h-3" />
            Break-Even ($0 Loss)
          </span>
        );
      case 'SIGNAL_REVERSAL_EXIT':
        return (
          <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] font-mono font-semibold flex items-center gap-1">
            <Zap className="w-3 h-3" />
            Signal Reversal Cut
          </span>
        );
      case 'MOMENTUM_EXHAUSTION_EXIT':
        return (
          <span className="px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/40 text-[10px] font-mono font-semibold flex items-center gap-1">
            <Sparkles className="w-3 h-3" />
            Momentum Peak Banked
          </span>
        );
      case 'STOP_LOSS_TRIGGER':
        return (
          <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-400 border border-rose-500/30 text-[10px] font-mono font-semibold flex items-center gap-1">
            <XCircle className="w-3 h-3" />
            Stop Safeguard Hit
          </span>
        );
      case 'LIQUIDATION_TRIGGER':
        return (
          <span className="px-2 py-0.5 rounded bg-rose-600/30 text-rose-300 border border-rose-500/50 text-[10px] font-mono font-bold flex items-center gap-1 shadow-sm shadow-rose-600/20">
            <AlertCircle className="w-3 h-3 text-rose-400" />
            Margin Call / Liquidated
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 text-[10px] font-mono flex items-center gap-1">
            <AlertCircle className="w-3 h-3" />
            Manual Exit
          </span>
        );
    }
  };

  return (
    <div className="bg-terminal-850/70 border border-terminal-border rounded-xl overflow-hidden shadow-lg">
      <div className="p-4 border-b border-terminal-border flex items-center justify-between bg-terminal-900/50">
        <div className="flex items-center space-x-2">
          <History className="w-4 h-4 text-indigo-400" />
          <h2 className="text-sm font-bold font-mono text-white tracking-wide uppercase">
            Closed Trades Audit Ledger ({closedTrades.length})
          </h2>
        </div>
        <span className="text-[11px] font-mono text-slate-400">
          Audited executions with intelligent exit classifications
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-terminal-border bg-terminal-900/70 text-[11px] font-mono text-slate-400 uppercase tracking-wider">
              <th className="py-2.5 px-4">Market / Side</th>
              <th className="py-2.5 px-4 text-right">Entry Price</th>
              <th className="py-2.5 px-4 text-right">Exit Price</th>
              <th className="py-2.5 px-4 text-center">Outcome</th>
              <th className="py-2.5 px-4 text-center">Auto-Close Trigger</th>
              <th className="py-2.5 px-4 text-right">Realized Return</th>
              <th className="py-2.5 px-4 text-right">Close Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-terminal-border/60 text-xs font-mono">
            {closedTrades.map((trade, idx) => {
              const finalPnL = trade.finalPnL !== undefined ? Number(trade.finalPnL) : (trade.profit !== undefined ? Number(trade.profit) : 0);
              const isWin = finalPnL > 0.00001;
              const isLoss = finalPnL < -0.00001;
              const isBE = !isWin && !isLoss;
              const isLong = trade.side === 'LONG' || trade.side === 'BUY';
              const sideLabel = trade.side === 'BUY' ? 'LONG' : (trade.side === 'SELL' ? 'SHORT' : trade.side);

              const entryPrice = trade.entryPrice != null ? trade.entryPrice : trade.price;
              const exitPrice = trade.exitPrice != null ? trade.exitPrice : trade.price;

              const closeTimeRaw = trade.closeTime || trade.exitTime || (trade.time ? trade.time * 1000 : null);
              const closeDate = closeTimeRaw ? new Date(closeTimeRaw) : null;
              const isValidDate = closeDate && !isNaN(closeDate.getTime());
              const formattedTime = isValidDate
                ? `${closeDate.toLocaleDateString([], { month: 'numeric', day: 'numeric' })} ${closeDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
                : '—';

              return (
                <tr key={trade.id || idx} className="hover:bg-terminal-800/30 transition-colors">
                  {/* Symbol and Side */}
                  <td className="py-3 px-4">
                    <div className="flex items-center space-x-2">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        isLong
                          ? 'bg-emerald-500/20 text-emerald-400'
                          : 'bg-rose-500/20 text-rose-400'
                      }`}>
                        {sideLabel}
                      </span>
                      {trade.leverage && (
                        <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                          {trade.leverage}x
                        </span>
                      )}
                      <span className="font-bold text-white">{trade.symbol}</span>
                      {trade.category && <span className="text-[10px] text-slate-500">({trade.category})</span>}
                    </div>
                  </td>

                  {/* Entry Price */}
                  <td className="py-3 px-4 text-right text-slate-300">
                    {entryPrice != null ? `$${formatPrice(entryPrice)}` : '—'}
                  </td>

                  {/* Exit Price */}
                  <td className="py-3 px-4 text-right text-white font-semibold">
                    {exitPrice != null ? `$${formatPrice(exitPrice)}` : '—'}
                  </td>

                  {/* Outcome */}
                  <td className="py-3 px-4 text-center">
                    <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                      isWin
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : isLoss
                        ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                        : 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                    }`}>
                      {isWin ? 'PROFIT' : isLoss ? 'LOSS' : 'BREAK-EVEN'}
                    </span>
                  </td>

                  {/* Exit Reason */}
                  <td className="py-3 px-4 text-center">
                    <div className="flex justify-center">
                      {getExitBadge(trade.exitReason)}
                    </div>
                  </td>

                  {/* Realized PnL & Fee */}
                  <td className="py-3 px-4 text-right">
                    <div className={`font-bold ${isBE ? 'text-indigo-300' : isWin ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {finalPnL >= 0 ? '+' : '-'}${Math.abs(finalPnL).toFixed(2)}
                    </div>
                    <div className="flex items-center justify-end gap-1 text-[10px]">
                      {trade.fee != null && Number(trade.fee) > 0 && (
                        <span className="text-amber-400/90 font-mono">
                          Fee: -${Number(trade.fee).toFixed(2)}
                        </span>
                      )}
                      {trade.finalPnLPercent != null && !isNaN(trade.finalPnLPercent) && (
                        <span className={isBE ? 'text-indigo-400/80' : isWin ? 'text-emerald-500/80' : 'text-rose-500/80'}>
                          ({trade.finalPnLPercent >= 0 ? '+' : ''}{Number(trade.finalPnLPercent).toFixed(2)}%)
                        </span>
                      )}
                      {trade.roePercent != null && !isNaN(trade.roePercent) && trade.leverage > 1 && (
                        <span className={`font-bold ${isBE ? 'text-indigo-300' : isWin ? 'text-emerald-400' : 'text-rose-400'}`}>
                          • {trade.roePercent >= 0 ? '+' : ''}{Number(trade.roePercent).toFixed(1)}% ROE
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Time */}
                  <td className="py-3 px-4 text-right text-slate-400 text-[11px]">
                    {formattedTime}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
