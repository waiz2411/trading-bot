import React, { useState } from 'react';
import { Search, Filter, ArrowUpRight, ArrowDownRight, Compass, ShieldCheck, Zap, Info } from 'lucide-react';
import { formatPrice } from '../utils/formatters.js';

export default function MarketRadar({ marketScan = [], onSelectAsset, onQuickTrade }) {
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [highConfidenceOnly, setHighConfidenceOnly] = useState(false);

  const categories = ['ALL', 'Crypto', 'Forex', 'Commodities', 'Indices'];

  const filtered = marketScan.filter(item => {
    const matchesCategory = selectedCategory === 'ALL' || item.category.toLowerCase() === selectedCategory.toLowerCase();
    const matchesSearch = item.symbol.toLowerCase().includes(searchQuery.toLowerCase()) || item.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesConfidence = !highConfidenceOnly || (item.signal && item.signal.confidence >= 70);
    return matchesCategory && matchesSearch && matchesConfidence;
  });

  const getSignalBadge = (signal) => {
    if (!signal) return null;
    const { action, confidence } = signal;

    if (action === 'STRONG_BUY') {
      return (
        <span className="px-2.5 py-1 rounded-md text-xs font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm shadow-emerald-500/20 flex items-center gap-1">
          <ArrowUpRight className="w-3.5 h-3.5" />
          STRONG BUY ({confidence}%)
        </span>
      );
    }
    if (action === 'BUY') {
      return (
        <span className="px-2 py-0.5 rounded-md text-xs font-mono font-semibold bg-emerald-950/60 text-emerald-400 border border-emerald-600/30 flex items-center gap-1">
          <ArrowUpRight className="w-3 h-3" />
          BUY ({confidence}%)
        </span>
      );
    }
    if (action === 'STRONG_SELL') {
      return (
        <span className="px-2.5 py-1 rounded-md text-xs font-mono font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40 shadow-sm shadow-rose-500/20 flex items-center gap-1">
          <ArrowDownRight className="w-3.5 h-3.5" />
          STRONG SELL ({confidence}%)
        </span>
      );
    }
    if (action === 'SELL') {
      return (
        <span className="px-2 py-0.5 rounded-md text-xs font-mono font-semibold bg-rose-950/60 text-rose-400 border border-rose-600/30 flex items-center gap-1">
          <ArrowDownRight className="w-3 h-3" />
          SELL ({confidence}%)
        </span>
      );
    }
    return (
      <span className="px-2 py-0.5 rounded-md text-xs font-mono text-slate-400 bg-slate-800/60 border border-slate-700/50">
        NEUTRAL ({confidence}%)
      </span>
    );
  };

  const getRsiColor = (rsi) => {
    if (!rsi) return 'text-slate-400';
    if (rsi <= 32) return 'text-emerald-400 font-bold'; // Oversold -> bullish bounce setup
    if (rsi >= 68) return 'text-rose-400 font-bold'; // Overbought -> bearish exhaustion setup
    return 'text-slate-300';
  };

  return (
    <div className="bg-terminal-850/70 border border-terminal-border rounded-xl overflow-hidden shadow-lg">
      {/* Table Toolbar */}
      <div className="p-4 border-b border-terminal-border flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-terminal-900/50">
        <div className="flex items-center space-x-2">
          <Compass className="w-4 h-4 text-indigo-400" />
          <h2 className="text-sm font-bold font-mono text-white tracking-wide uppercase">
            Global Market Radar
          </h2>
          <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-terminal-800 text-slate-400 border border-terminal-border">
            {filtered.length} Assets
          </span>
        </div>

        <div className="flex items-center flex-wrap gap-2">
          {/* Category Tabs */}
          <div className="flex items-center bg-terminal-950 p-1 rounded-lg border border-terminal-border text-xs font-mono">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  selectedCategory === cat
                    ? 'bg-indigo-600 text-white font-semibold shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Search bar */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search symbol..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-1 bg-terminal-950 border border-terminal-border rounded-lg text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 w-36 sm:w-44"
            />
          </div>

          {/* High confidence toggle */}
          <button
            onClick={() => setHighConfidenceOnly(!highConfidenceOnly)}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-mono transition-all border ${
              highConfidenceOnly
                ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40'
                : 'bg-terminal-950 text-slate-400 border-terminal-border hover:text-white'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" />
            <span>Sniper Edge (≥70%)</span>
          </button>
        </div>
      </div>

      {/* Asset Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-terminal-border bg-terminal-900/70 text-[11px] font-mono text-slate-400 uppercase tracking-wider">
              <th className="py-2.5 px-4">Market / Symbol</th>
              <th className="py-2.5 px-4 text-right">Current Price</th>
              <th className="py-2.5 px-4 text-right">24h Vol</th>
              <th className="py-2.5 px-4 text-center">RSI (14)</th>
              <th className="py-2.5 px-4 text-center">Trend Filter</th>
              <th className="py-2.5 px-4">Strategy Confluence Edge</th>
              <th className="py-2.5 px-4 text-center">Primary Signal</th>
              <th className="py-2.5 px-4 text-right">Setup / Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-terminal-border/60 text-xs font-mono">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan="8" className="py-8 text-center text-slate-500 font-mono">
                  No assets matching criteria.
                </td>
              </tr>
            ) : (
              filtered.map(item => {
                const isPositive = item.change24h >= 0;
                const conf = item.signal?.confidence || 0;
                const isStrong = conf >= 75;

                return (
                  <tr
                    key={item.symbol}
                    className="hover:bg-terminal-800/40 transition-colors group cursor-pointer"
                    onClick={() => onSelectAsset(item)}
                  >
                    {/* Market Name & Category */}
                    <td className="py-3 px-4">
                      <div className="flex items-center space-x-2.5">
                        <span className="w-7 h-7 rounded-md bg-terminal-800 border border-terminal-border flex items-center justify-center text-sm">
                          {item.icon || '•'}
                        </span>
                        <div>
                          <div className="font-bold text-white group-hover:text-indigo-300 transition-colors flex items-center gap-1.5">
                            <span>{item.symbol}</span>
                            <span className="text-[10px] font-normal px-1.5 py-0.2 rounded bg-terminal-900 text-slate-400 border border-terminal-border">
                              {item.category}
                            </span>
                            {item.category === 'Crypto' && (
                              <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-teal-500/15 text-teal-300 border border-teal-500/30">
                                🕌 Halal
                              </span>
                            )}
                            {item.isHighVolatility && (
                              <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                                ⚡ Volatile
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-400 font-sans truncate max-w-[140px]">
                            {item.name} {item.halalSector ? `(${item.halalSector})` : ''}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Price */}
                    <td className="py-3 px-4 text-right font-bold text-white">
                      ${formatPrice(item.price)}
                    </td>

                    {/* 24h Change */}
                    <td className={`py-3 px-4 text-right font-semibold ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {isPositive ? '+' : ''}{item.change24h}%
                    </td>

                    {/* RSI */}
                    <td className="py-3 px-4 text-center">
                      <span className={`px-2 py-0.5 rounded bg-terminal-900 border border-terminal-border ${getRsiColor(item.technicals?.rsi)}`}>
                        {item.technicals?.rsi !== null ? item.technicals.rsi : '—'}
                      </span>
                    </td>

                    {/* Trend EMA Alignment */}
                    <td className="py-3 px-4 text-center">
                      {item.price > item.technicals?.ema50 ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          Above EMA50
                        </span>
                      ) : (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20">
                          Below EMA50
                        </span>
                      )}
                    </td>

                    {/* Confluence Meter */}
                    <td className="py-3 px-4">
                      <div className="w-full max-w-[150px]">
                        <div className="flex justify-between items-center text-[10px] text-slate-400 mb-1">
                          <span>Edge Score</span>
                          <span className={isStrong ? 'text-indigo-300 font-bold' : ''}>{conf}%</span>
                        </div>
                        <div className="w-full h-1.5 bg-terminal-950 rounded-full overflow-hidden border border-terminal-border">
                          <div
                            className={`h-full transition-all duration-500 rounded-full ${
                              conf >= 75
                                ? 'bg-gradient-to-r from-indigo-500 to-emerald-400'
                                : conf >= 50
                                ? 'bg-indigo-500'
                                : 'bg-slate-600'
                            }`}
                            style={{ width: `${conf}%` }}
                          />
                        </div>
                      </div>
                    </td>

                    {/* Signal */}
                    <td className="py-3 px-4 text-center">
                      {item.isCooldown ? (
                        <div className="flex flex-col items-center gap-0.5">
                          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                            COOLDOWN ({item.cooldownCycles}c)
                          </span>
                          <span className="text-[9px] text-slate-500">{item.signal?.action || 'NEUTRAL'}</span>
                        </div>
                      ) : (
                        getSignalBadge(item.signal)
                      )}
                    </td>

                    {/* Actions */}
                    <td className="py-3 px-4 text-right" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => onSelectAsset(item)}
                          className="px-2.5 py-1 rounded bg-terminal-800 hover:bg-terminal-700 border border-terminal-border text-slate-300 text-xs flex items-center gap-1 transition-colors"
                          title="View Technical Reasoning"
                        >
                          <Info className="w-3 h-3 text-indigo-400" />
                          <span>Thesis</span>
                        </button>
                        {item.signal?.action !== 'NEUTRAL' && (
                          <button
                            onClick={() => onQuickTrade(item.symbol, item.signal.side)}
                            className="px-2 py-1 rounded bg-indigo-600/30 hover:bg-indigo-600 border border-indigo-500/50 text-indigo-200 hover:text-white text-xs flex items-center gap-1 transition-colors"
                            title={`Execute Demo ${item.signal.side}`}
                          >
                            <Zap className="w-3 h-3" />
                            <span>Trade</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
