import React from 'react';
import { X, ArrowUpRight, ArrowDownRight, Shield, Target, Zap, BarChart2, CheckCircle2 } from 'lucide-react';
import { formatPrice } from '../utils/formatters.js';

export default function AssetDetailModal({ asset, onClose, onExecuteTrade }) {
  if (!asset) return null;

  const { symbol, name, category, price, change24h, technicals, signal } = asset;
  const isPositive = change24h >= 0;
  const conf = signal?.confidence || 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-terminal-900 border border-terminal-border rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        {/* Modal Header */}
        <div className="p-5 border-b border-terminal-border flex items-center justify-between bg-terminal-850">
          <div className="flex items-center space-x-3">
            <span className="w-10 h-10 rounded-xl bg-terminal-950 border border-terminal-border flex items-center justify-center text-lg shadow-inner">
              {asset.icon || '•'}
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold font-mono text-white">{symbol}</h2>
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-terminal-950 text-slate-400 border border-terminal-border">
                  {category}
                </span>
              </div>
              <p className="text-xs text-slate-400 font-sans">{name}</p>
            </div>
          </div>

          <div className="flex items-center space-x-4">
            <div className="text-right font-mono">
              <div className="text-lg font-bold text-white">
                ${formatPrice(price)}
              </div>
              <div className={`text-xs font-semibold ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
                {isPositive ? '+' : ''}{change24h}% (24h)
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-terminal-800 hover:bg-terminal-700 text-slate-400 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-6 max-h-[80vh] overflow-y-auto font-mono text-xs">
          {/* Signal & Edge Banner */}
          <div className="p-4 rounded-xl bg-terminal-950 border border-terminal-border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <div className="text-slate-400 text-[11px] mb-1">AGENT STRATEGY BIAS</div>
              <div className="text-base font-bold text-white flex items-center gap-2">
                {signal?.action === 'STRONG_BUY' && <span className="text-emerald-400 flex items-center gap-1"><ArrowUpRight className="w-5 h-5" /> STRONG BUY SETUP</span>}
                {signal?.action === 'BUY' && <span className="text-emerald-400 flex items-center gap-1"><ArrowUpRight className="w-4 h-4" /> MODERATE BUY</span>}
                {signal?.action === 'STRONG_SELL' && <span className="text-rose-400 flex items-center gap-1"><ArrowDownRight className="w-5 h-5" /> STRONG SELL SETUP</span>}
                {signal?.action === 'SELL' && <span className="text-rose-400 flex items-center gap-1"><ArrowDownRight className="w-4 h-4" /> MODERATE SELL</span>}
                {signal?.action === 'NEUTRAL' && <span className="text-slate-400">NEUTRAL / CONSOLIDATION</span>}
              </div>
            </div>

            <div className="sm:text-right">
              <div className="text-slate-400 text-[11px] mb-1">CONFLUENCE CONFIDENCE</div>
              <div className="flex items-center gap-2">
                <div className="w-28 h-2 bg-terminal-850 rounded-full overflow-hidden border border-terminal-border">
                  <div
                    className={`h-full rounded-full ${
                      conf >= 75 ? 'bg-emerald-400' : conf >= 50 ? 'bg-indigo-400' : 'bg-slate-600'
                    }`}
                    style={{ width: `${conf}%` }}
                  />
                </div>
                <span className="font-bold text-sm text-white">{conf}%</span>
              </div>
            </div>
          </div>

          {/* Trade Parameters (Entry, SL, TP, R:R) */}
          {signal?.stopLoss && signal?.takeProfit && (
            <div>
              <h3 className="text-xs uppercase tracking-wider text-slate-400 font-semibold mb-3 flex items-center gap-1.5">
                <Target className="w-3.5 h-3.5 text-indigo-400" />
                <span>Asymmetrical Trade Plan (R:R 1:{signal.riskRewardRatio})</span>
              </h3>

              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 rounded-lg bg-terminal-850 border border-terminal-border">
                  <div className="text-slate-500 text-[10px] uppercase">Entry Price</div>
                  <div className="text-sm font-bold text-white mt-1">${formatPrice(signal.entryPrice)}</div>
                </div>

                <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20">
                  <div className="text-rose-400 text-[10px] uppercase flex items-center gap-1">
                    <Shield className="w-3 h-3" /> Stop-Loss (SL)
                  </div>
                  <div className="text-sm font-bold text-rose-300 mt-1">${formatPrice(signal.stopLoss)}</div>
                </div>

                <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                  <div className="text-emerald-400 text-[10px] uppercase flex items-center gap-1">
                    <Target className="w-3 h-3" /> Take-Profit (TP)
                  </div>
                  <div className="text-sm font-bold text-emerald-300 mt-1">${formatPrice(signal.takeProfit)}</div>
                </div>
              </div>
            </div>
          )}

          {/* Technical Indicator Dashboard */}
          <div>
            <h3 className="text-xs uppercase tracking-wider text-slate-400 font-semibold mb-3 flex items-center gap-1.5">
              <BarChart2 className="w-3.5 h-3.5 text-indigo-400" />
              <span>Technical Analysis Indicators</span>
            </h3>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div className="p-2.5 rounded-lg bg-terminal-950 border border-terminal-border">
                <span className="text-slate-500 text-[10px]">RSI (14)</span>
                <div className="text-sm font-bold text-white mt-0.5">
                  {technicals?.rsi !== null ? technicals?.rsi : '—'}
                </div>
              </div>

              <div className="p-2.5 rounded-lg bg-terminal-950 border border-terminal-border">
                <span className="text-slate-500 text-[10px]">EMA 50</span>
                <div className="text-sm font-bold text-white mt-0.5">
                  ${technicals?.ema50 || '—'}
                </div>
              </div>

              <div className="p-2.5 rounded-lg bg-terminal-950 border border-terminal-border">
                <span className="text-slate-500 text-[10px]">EMA 200</span>
                <div className="text-sm font-bold text-white mt-0.5">
                  ${technicals?.ema200 || '—'}
                </div>
              </div>

              <div className="p-2.5 rounded-lg bg-terminal-950 border border-terminal-border">
                <span className="text-slate-500 text-[10px]">ATR Volatility</span>
                <div className="text-sm font-bold text-white mt-0.5">
                  ${technicals?.atr || '—'}
                </div>
              </div>
            </div>
          </div>

          {/* Agent Thesis Reasoning */}
          <div>
            <h3 className="text-xs uppercase tracking-wider text-slate-400 font-semibold mb-2">
              Agent Confluence Thesis
            </h3>
            <div className="p-3.5 rounded-xl bg-terminal-950 border border-terminal-border space-y-2 text-slate-300">
              <p className="font-sans leading-relaxed text-xs">
                {signal?.reason}
              </p>
              {signal?.factors && signal.factors.length > 0 && (
                <div className="pt-2 border-t border-terminal-border/60 space-y-1">
                  {signal.factors.map((factor, i) => (
                    <div key={i} className="flex items-center gap-2 text-slate-400 text-[11px]">
                      <CheckCircle2 className="w-3 h-3 text-indigo-400 shrink-0" />
                      <span>{factor}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Modal Footer Controls */}
        <div className="p-4 border-t border-terminal-border bg-terminal-850 flex items-center justify-between gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-terminal-800 hover:bg-terminal-700 text-slate-300 text-xs font-mono transition-colors"
          >
            Close
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={() => onExecuteTrade(symbol, 'LONG')}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-mono font-bold flex items-center gap-1.5 transition-all shadow-lg shadow-emerald-600/20"
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Execute Demo LONG</span>
            </button>
            <button
              onClick={() => onExecuteTrade(symbol, 'SHORT')}
              className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-mono font-bold flex items-center gap-1.5 transition-all shadow-lg shadow-rose-600/20"
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Execute Demo SHORT</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
