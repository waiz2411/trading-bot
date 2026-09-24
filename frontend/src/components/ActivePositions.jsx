import React from 'react';
import { ArrowUpRight, ArrowDownRight, XCircle, Shield, Target, ShieldCheck, Lock, Activity, Timer } from 'lucide-react';

export default function ActivePositions({ positions = [], onCloseTrade, isClosingId, isLive = false, activeAccount = 'MARGIN' }) {
  const [, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!positions || positions.length === 0) {
    return (
      <div className="bg-terminal-850/70 border border-terminal-border rounded-xl p-8 text-center shadow-lg">
        <div className="w-12 h-12 rounded-full bg-terminal-900 border border-terminal-border flex items-center justify-center mx-auto mb-3 text-slate-500">
          <Target className="w-6 h-6 text-indigo-400" />
        </div>
        <h3 className="text-sm font-bold font-mono text-white mb-1">No Active Positions</h3>
        <p className="text-xs text-slate-400 max-w-md mx-auto">
          The agent monitors global markets. High-probability setups will auto-open and auto-close with dynamic profit protection.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-terminal-850/70 border border-terminal-border rounded-xl overflow-hidden shadow-lg">
      <div className="p-4 border-b border-terminal-border flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-terminal-900/50">
        <div className="flex items-center space-x-2">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
          <h2 className="text-sm font-bold font-mono text-white tracking-wide uppercase flex items-center gap-2">
            <span>{isLive ? (activeAccount === 'SPOT' ? 'Active Binance Positions' : 'Active MetaTrader 5 Positions') : 'Active Demo Positions'} ({positions.length})</span>
            {isLive && (
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 font-mono">
                LIVE BROKER
              </span>
            )}
          </h2>
        </div>
        <div className="flex items-center gap-2 text-[11px] font-mono text-slate-400">
          <span className="flex items-center gap-1 text-emerald-400">
            <ShieldCheck className="w-3.5 h-3.5" />
            Trailing Stops & Break-Even Active
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-terminal-border bg-terminal-900/70 text-[11px] font-mono text-slate-400 uppercase tracking-wider">
              <th className="py-2.5 px-4">Market / Side / Lev</th>
              <th className="py-2.5 px-4 text-right">Entry Price</th>
              <th className="py-2.5 px-4 text-right">Mark Price</th>
              <th className="py-2.5 px-4 text-right">Protection (SL)</th>
              <th className="py-2.5 px-4 text-right">Target (TP)</th>
              <th className="py-2.5 px-4 text-right">Est. Liq. Price</th>
              <th className="py-2.5 px-4 text-right">Margin / Size</th>
              <th className="py-2.5 px-4 text-right">Unrealized PnL (ROE%)</th>
              <th className="py-2.5 px-4 text-center">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-terminal-border/60 text-xs font-mono">
            {positions.map(pos => {
              const isLong = pos.side === 'LONG';
              const isProfit = pos.unrealizedPnL >= 0;
              const isClosing = isClosingId === pos.id;
              const leverage = pos.leverage || 10;
              const marginVal = pos.margin !== undefined ? pos.margin : Number((pos.notional / leverage).toFixed(2));
              const roeVal = pos.roePercent !== undefined ? pos.roePercent : Number(((pos.unrealizedPnL / marginVal) * 100).toFixed(1));

              const sameSymbolPositions = positions.filter(p => p.symbol === pos.symbol);
              const isHedged = sameSymbolPositions.some(p => p.side !== pos.side);
              const isMultiTrade = sameSymbolPositions.length > 1;
              const tradeIndex = sameSymbolPositions.findIndex(p => p.id === pos.id) + 1;
              const isSpot = pos.tradingStyle === 'SPOT_BUY' || leverage === 1;
              const maxHoldMins = pos.maxHoldMinutes || 5;
              const elapsedSec = pos.openTime ? Math.max(0, Math.floor((Date.now() - new Date(pos.openTime).getTime()) / 1000)) : ((pos.cycleCount || 0) * 5);
              const remainSec = Math.max(0, (maxHoldMins * 60) - elapsedSec);
              const elapsedStr = `${Math.floor(elapsedSec / 60)}m ${elapsedSec % 60}s`;
              const isExpiringSoon = remainSec <= 60;

              return (
                <tr key={pos.id} className="hover:bg-terminal-800/30 transition-colors">
                  {/* Symbol, Side, and Leverage */}
                  <td className="py-3 px-4">
                    <div className="flex items-center space-x-2">
                      <span className={`px-2 py-0.5 rounded text-[11px] font-bold flex items-center gap-1 ${
                        isLong
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                      }`}>
                        {isLong ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                        {pos.side}
                      </span>
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                        {leverage}x
                      </span>
                      <div>
                        <div className="font-bold text-white flex items-center gap-1.5">
                          <span>{pos.symbol}</span>
                          {pos.ticket && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/25 text-amber-300 border border-amber-500/40 font-mono font-bold tracking-tight">
                              TICKET #{pos.ticket}
                            </span>
                          )}
                          {isHedged && (
                            <span className="text-[9px] px-1.5 py-0.2 rounded bg-purple-500/25 text-purple-300 border border-purple-500/40 font-mono font-bold tracking-tight">
                              HEDGE
                            </span>
                          )}
                          {isMultiTrade && !isHedged && (
                            <span className="text-[9px] px-1.5 py-0.2 rounded bg-cyan-500/25 text-cyan-300 border border-cyan-500/40 font-mono font-bold">
                              #{tradeIndex}
                            </span>
                          )}
                          <span className="text-[10px] text-slate-400 font-normal">
                            ({pos.category})
                          </span>
                        </div>
                        <div className="flex items-center gap-1 mt-0.5">
                          <span className={`text-[9px] px-1.5 py-0.2 rounded font-mono font-bold flex items-center gap-0.5 ${
                            isExpiringSoon
                              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-pulse'
                              : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                          }`}>
                            <Timer className="w-2.5 h-2.5" /> {elapsedStr} / {maxHoldMins}m cap
                          </span>
                          {pos.trailingStopActive && (
                            <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-0.5">
                              <ShieldCheck className="w-2.5 h-2.5" /> Trailing Locked
                            </span>
                          )}
                          {pos.breakEvenLocked && !pos.trailingStopActive && (
                            <span className="text-[9px] px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 flex items-center gap-0.5">
                              <Lock className="w-2.5 h-2.5" /> Break-Even Guard
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* Entry Price */}
                  <td className="py-3 px-4 text-right text-slate-300 font-semibold">
                    {pos.entryPrice != null ? `$${Number(pos.entryPrice).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}` : '—'}
                  </td>

                  {/* Current Live Price */}
                  <td className="py-3 px-4 text-right font-bold text-white">
                    {pos.currentPrice != null ? `$${Number(pos.currentPrice).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}` : '—'}
                  </td>

                  {/* Stop Loss (or Trailing Stop) */}
                  <td className="py-3 px-4 text-right">
                    {pos.stopLoss && Number(pos.stopLoss) > 0 ? (
                      <div className={`flex items-center justify-end gap-1 ${
                        pos.trailingStopActive
                          ? 'text-emerald-400 font-bold'
                          : pos.breakEvenLocked
                          ? 'text-indigo-400 font-semibold'
                          : 'text-rose-400'
                      }`}>
                        <Shield className="w-3 h-3 opacity-80" />
                        <span>${Number(pos.stopLoss).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</span>
                      </div>
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </td>

                  {/* Take Profit */}
                  <td className="py-3 px-4 text-right font-semibold">
                    {pos.takeProfit && Number(pos.takeProfit) > 0 ? (
                      <div className="flex items-center justify-end gap-1 text-emerald-400">
                        <Target className="w-3 h-3 opacity-60" />
                        <span>${Number(pos.takeProfit).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</span>
                      </div>
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </td>

                  {/* Est. Liquidation Price */}
                  <td className="py-3 px-4 text-right">
                    <div className="font-mono text-amber-400 font-semibold">
                      {pos.liquidationPrice && Number(pos.liquidationPrice) > 0 ? `$${Number(pos.liquidationPrice).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}` : '—'}
                    </div>
                    <div className="text-[10px] text-slate-500">Liq. Threshold</div>
                  </td>

                  {/* Margin & Size */}
                  <td className="py-3 px-4 text-right text-slate-300">
                    <div className="font-bold text-white flex items-center justify-end gap-1">
                      <span className="text-[10px] text-indigo-400 font-normal">Margin:</span>
                      <span>${marginVal}</span>
                    </div>
                    <div className="text-[10px] text-slate-400 font-medium">{pos.units} units (${pos.notional})</div>
                    <div className="text-[9px] text-amber-400/80 font-mono mt-0.5">{leverage}x Buying Power</div>
                  </td>

                  {/* Live PnL & Leveraged ROE% */}
                  <td className="py-3 px-4 text-right">
                    <div className={`font-bold text-sm ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {isProfit ? '+' : '-'}${Math.abs(pos.unrealizedPnL || 0).toFixed(2)}
                    </div>
                    <div className="flex items-center justify-end gap-1 mt-0.5">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        isProfit ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                      }`}>
                        ROE: {roeVal >= 0 ? '+' : ''}{roeVal.toFixed(1)}%
                      </span>
                    </div>
                  </td>

                  {/* Close Action */}
                  <td className="py-3 px-4 text-center">
                    <button
                      onClick={() => onCloseTrade(pos.id)}
                      disabled={isClosing}
                      className="px-2.5 py-1 rounded bg-rose-500/15 hover:bg-rose-500/30 border border-rose-500/30 text-rose-300 text-xs font-mono transition-all flex items-center gap-1 mx-auto disabled:opacity-50"
                      title="Close position manually"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      <span>{isClosing ? 'Closing...' : 'Close'}</span>
                    </button>
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
