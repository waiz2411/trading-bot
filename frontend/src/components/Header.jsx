import React from 'react';
import { Play, Pause, RefreshCw, Sliders, Cpu, Wallet, Zap, ArrowDownRight, ArrowUpRight, Repeat, Trash2 } from 'lucide-react';

export default function Header({
  isAutoTrading,
  onToggleAutoTrading,
  onManualScan,
  isScanning,
  onOpenSettings,
  onOpenBalanceModal,
  onCloseAllTrades,
  tradeDirection = 'SHORT_ONLY',
  onChangeDirection,
  tradingStyle = 'SCALPING',
  lastUpdated,
  activePositionsCount = 0
}) {
  return (
    <header className="border-b border-terminal-border bg-terminal-900/90 backdrop-blur-md sticky top-0 z-40 px-4 lg:px-8 py-3">
      <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
        {/* Logo & Agent Mode */}
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-tr from-indigo-600 via-rose-500 to-amber-400 p-[1px] flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <div className="w-full h-full bg-terminal-950 rounded-[7px] flex items-center justify-center">
              <Zap className="w-5 h-5 text-amber-400 animate-pulse" />
            </div>
          </div>
          <div>
            <div className="flex items-center flex-wrap gap-2">
              <h1 className="text-base font-bold tracking-tight text-white font-mono">
                NEXUS<span className="text-indigo-400">QUANT</span>
              </h1>
              <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-1 font-bold">
                <Zap className="w-3 h-3" />
                SCALPER CORE
              </span>
              <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40 font-bold flex items-center gap-0.5">
                <ArrowDownRight className="w-3 h-3" />
                SHORT TRADES ONLY
              </span>
            </div>
            <p className="text-xs text-slate-400 flex items-center gap-2">
              <span>High-Frequency Global Scalping Engine (Crypto, Forex, Commodities, Indices)</span>
              <span className="text-slate-600">•</span>
              <span className="text-slate-500 font-mono">
                {lastUpdated ? new Date(lastUpdated).toLocaleTimeString() : 'Scanning...'}
              </span>
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center flex-wrap gap-2">
          {/* Trade Direction Selector (Short Only vs Both vs Long) */}
          <div className="flex items-center bg-terminal-950 p-1 rounded-lg border border-terminal-border text-xs font-mono">
            <span className="text-[10px] text-slate-500 px-1.5 uppercase font-semibold">Direction:</span>
            <button
              onClick={() => onChangeDirection('SHORT_ONLY')}
              className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-all flex items-center gap-1 ${
                tradeDirection === 'SHORT_ONLY'
                  ? 'bg-rose-600 text-white shadow-md shadow-rose-600/30'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="Only open Short / Sell trades"
            >
              <ArrowDownRight className="w-3 h-3" />
              SHORT ONLY
            </button>
            <button
              onClick={() => onChangeDirection('BOTH')}
              className={`px-2 py-1 rounded-md text-[11px] transition-all flex items-center gap-1 ${
                tradeDirection === 'BOTH'
                  ? 'bg-indigo-600 text-white font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="Bi-directional scalping (Long & Short)"
            >
              <Repeat className="w-3 h-3" />
              BOTH
            </button>
            <button
              onClick={() => onChangeDirection('LONG_ONLY')}
              className={`px-2 py-1 rounded-md text-[11px] transition-all flex items-center gap-1 ${
                tradeDirection === 'LONG_ONLY'
                  ? 'bg-emerald-600 text-white font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="Only open Long trades"
            >
              <ArrowUpRight className="w-3 h-3" />
              LONG ONLY
            </button>
          </div>

          {/* Edit Demo Balance Button */}
          <button
            onClick={onOpenBalanceModal}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/40 text-indigo-300 hover:text-white text-xs font-mono font-semibold transition-all shadow-sm"
            title="Edit Demo Account Balance (Custom amount)"
          >
            <Wallet className="w-3.5 h-3.5 text-indigo-400" />
            <span>Edit Balance</span>
          </button>

          {/* Auto-Trading Master Switch */}
          <button
            onClick={onToggleAutoTrading}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-mono text-xs font-semibold transition-all shadow-md ${
              isAutoTrading
                ? 'bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/25 shadow-emerald-500/10'
                : 'bg-amber-500/15 border border-amber-500/40 text-amber-400 hover:bg-amber-500/25'
            }`}
          >
            {isAutoTrading ? (
              <>
                <Pause className="w-3.5 h-3.5" />
                <span>BOT ACTIVE: AUTO-SCALPING</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" />
                <span>BOT PAUSED</span>
              </>
            )}
          </button>

          {/* Close All Open Trades */}
          {activePositionsCount > 0 && (
            <button
              onClick={onCloseAllTrades}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 text-xs font-mono transition-colors"
              title="Close all open trades immediately"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Close All ({activePositionsCount})</span>
            </button>
          )}

          {/* Manual Refresh / Scan */}
          <button
            onClick={onManualScan}
            disabled={isScanning}
            className="p-2 rounded-lg bg-terminal-800 hover:bg-terminal-700 border border-terminal-border text-slate-300 text-xs transition-colors disabled:opacity-50"
            title="Trigger instant market scan"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin text-indigo-400' : ''}`} />
          </button>

          {/* Settings */}
          <button
            onClick={onOpenSettings}
            className="p-2 rounded-lg bg-terminal-800 hover:bg-terminal-700 border border-terminal-border text-slate-300 text-xs transition-colors"
            title="Risk & Strategy Settings"
          >
            <Sliders className="w-3.5 h-3.5 text-indigo-400" />
          </button>
        </div>
      </div>
    </header>
  );
}
