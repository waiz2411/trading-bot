import React from 'react';
import { Play, Pause, RefreshCw, Sliders, Wallet, Zap, ArrowDownRight, ArrowUpRight, Repeat, Trash2, Coins } from 'lucide-react';

export default function Header({
  activeAccount = 'MARGIN',
  onSwitchAccount,
  marginPortfolio,
  spotPortfolio,
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
  const isSpot = activeAccount === 'SPOT';
  const marginBal = marginPortfolio?.balance || 0;
  const spotBal = spotPortfolio?.balance || 0;

  return (
    <header className="border-b border-terminal-border bg-terminal-900/90 backdrop-blur-md sticky top-0 z-40 px-4 lg:px-8 py-3">
      <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
        {/* Logo & Agent Mode */}
        <div className="flex items-center space-x-3">
          <div className={`w-9 h-9 rounded-lg p-[1px] flex items-center justify-center shadow-lg transition-all ${
            isSpot
              ? 'bg-gradient-to-tr from-emerald-600 via-teal-500 to-cyan-400 shadow-emerald-500/20'
              : 'bg-gradient-to-tr from-indigo-600 via-rose-500 to-amber-400 shadow-indigo-500/20'
          }`}>
            <div className="w-full h-full bg-terminal-950 rounded-[7px] flex items-center justify-center">
              {isSpot ? (
                <Coins className="w-5 h-5 text-emerald-400 animate-pulse" />
              ) : (
                <Zap className="w-5 h-5 text-amber-400 animate-pulse" />
              )}
            </div>
          </div>
          <div>
            <div className="flex items-center flex-wrap gap-2">
              <h1 className="text-base font-bold tracking-tight text-white font-mono">
                NEXUS<span className={isSpot ? "text-emerald-400" : "text-indigo-400"}>QUANT</span>
              </h1>
              {isSpot ? (
                <>
                  <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-1 font-bold">
                    <Coins className="w-3 h-3" />
                    PURE SPOT CRYPTO
                  </span>
                  <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-bold">
                    100% CAPITAL ALLOCATION
                  </span>
                </>
              ) : (
                <>
                  <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-1 font-bold">
                    <Zap className="w-3 h-3" />
                    SCALPER CORE (500x)
                  </span>
                  <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40 font-bold flex items-center gap-0.5">
                    <ArrowDownRight className="w-3 h-3" />
                    {tradeDirection === 'SHORT_ONLY' ? 'SHORT TRADES ONLY' : tradeDirection}
                  </span>
                </>
              )}
            </div>
            <p className="text-xs text-slate-400 flex items-center gap-2">
              <span>
                {isSpot
                  ? 'Pure Crypto Spot Engine • 100% Balance Buying Power • Long Only • 0x Leverage'
                  : 'High-Frequency Global Scalping Engine (Crypto, Forex, Commodities, Indices)'}
              </span>
              <span className="text-slate-600">•</span>
              <span className="text-slate-500 font-mono">
                {lastUpdated ? new Date(lastUpdated).toLocaleTimeString() : 'Scanning...'}
              </span>
            </p>
          </div>
        </div>

        {/* Center: Dual Account Switcher */}
        <div className="flex items-center bg-terminal-950 p-1 rounded-xl border border-terminal-border text-xs font-mono shadow-inner self-start xl:self-center">
          {/* Account 1: Margin Scalper */}
          <button
            onClick={() => onSwitchAccount && onSwitchAccount('MARGIN')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-mono transition-all ${
              !isSpot
                ? 'bg-gradient-to-r from-amber-500/20 to-indigo-600/30 text-amber-300 border border-amber-500/50 shadow-md shadow-amber-500/10 font-bold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-terminal-800/60'
            }`}
            title="Switch to 500x Margin Scalper Account (Multi-asset, 4 slots)"
          >
            <Zap className={`w-3.5 h-3.5 ${!isSpot ? 'text-amber-400 animate-pulse' : 'text-slate-400'}`} />
            <div className="flex flex-col items-start leading-tight">
              <div className="flex items-center gap-1.5">
                <span>MARGIN SCALPER</span>
                <span className="text-[9px] px-1 py-0.2 rounded bg-amber-500/20 text-amber-300 font-semibold">500x</span>
              </div>
              <span className="text-[10px] text-slate-300 font-mono font-normal">
                ${marginBal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          </button>

          {/* Account 2: Pure Spot Crypto */}
          <button
            onClick={() => onSwitchAccount && onSwitchAccount('SPOT')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-mono transition-all ${
              isSpot
                ? 'bg-gradient-to-r from-emerald-500/20 to-teal-600/30 text-emerald-300 border border-emerald-500/50 shadow-md shadow-emerald-500/10 font-bold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-terminal-800/60'
            }`}
            title="Switch to Pure Spot Crypto Account (100% Capital Allocation, Long only)"
          >
            <Coins className={`w-3.5 h-3.5 ${isSpot ? 'text-emerald-400 animate-pulse' : 'text-slate-400'}`} />
            <div className="flex flex-col items-start leading-tight">
              <div className="flex items-center gap-1.5">
                <span>PURE SPOT</span>
                <span className="text-[9px] px-1 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-semibold">100%</span>
              </div>
              <span className="text-[10px] text-slate-300 font-mono font-normal">
                ${spotBal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          </button>
        </div>

        {/* Action Controls */}
        <div className="flex items-center flex-wrap gap-2">
          {/* Trade Direction Selector (Short Only vs Both vs Long for Margin; Locked for Spot) */}
          {isSpot ? (
            <div className="flex items-center gap-1.5 bg-terminal-950 px-3 py-1.5 rounded-lg border border-emerald-500/30 text-xs font-mono text-emerald-300">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="font-bold">LONG SPOT ONLY</span>
              <span className="text-[10px] text-emerald-400/70">(100% Capital)</span>
            </div>
          ) : (
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
          )}

          {/* Edit Demo Balance Button */}
          <button
            onClick={onOpenBalanceModal}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-mono font-semibold transition-all shadow-sm ${
              isSpot
                ? 'bg-emerald-600/20 hover:bg-emerald-600/30 border-emerald-500/40 text-emerald-300 hover:text-white'
                : 'bg-indigo-600/20 hover:bg-indigo-600/30 border-indigo-500/40 text-indigo-300 hover:text-white'
            }`}
            title={`Edit ${isSpot ? 'Spot' : 'Margin'} Account Balance`}
          >
            <Wallet className={`w-3.5 h-3.5 ${isSpot ? 'text-emerald-400' : 'text-indigo-400'}`} />
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
                <span>{isSpot ? 'SPOT AUTO-BUY ACTIVE' : 'BOT ACTIVE: AUTO-SCALPING'}</span>
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
              title="Close all open trades in active account"
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
            <Sliders className={`w-3.5 h-3.5 ${isSpot ? 'text-emerald-400' : 'text-indigo-400'}`} />
          </button>
        </div>
      </div>
    </header>
  );
}
