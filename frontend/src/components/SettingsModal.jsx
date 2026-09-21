import React, { useState } from 'react';
import { X, ShieldAlert, Sliders, RotateCcw, Check, Target, Zap, Coins, TrendingUp, ShieldCheck, Sparkles } from 'lucide-react';

export default function SettingsModal({
  settings,
  marginSettings,
  spotSettings,
  activeAccount = 'MARGIN',
  onSaveSettings,
  onResetPortfolio,
  onClose
}) {
  const [selectedTab, setSelectedTab] = useState(activeAccount || 'MARGIN');

  // Margin Settings State
  const initialMargin = marginSettings || settings || {};
  const [riskPerTradePct, setRiskPerTradePct] = useState(initialMargin.riskPerTradePct || 1.5);
  const [maxConcurrentTrades, setMaxConcurrentTrades] = useState(initialMargin.maxConcurrentTrades || 2);
  const [minConfidenceThreshold, setMinConfidenceThreshold] = useState(initialMargin.minConfidenceThreshold || 82);
  const [targetRiskRewardRatio, setTargetRiskRewardRatio] = useState(initialMargin.targetRiskRewardRatio || 1.3);
  const [defaultLeverage, setDefaultLeverage] = useState(initialMargin.defaultLeverage || 500);

  // Spot Settings State
  const initialSpot = spotSettings || {};
  const [spotStopLossPct, setSpotStopLossPct] = useState(initialSpot.stopLossPct || 1.0);
  const [spotTakeProfitPct, setSpotTakeProfitPct] = useState(initialSpot.takeProfitPct || 2.5);
  const [spotMinConfidence, setSpotMinConfidence] = useState(initialSpot.minConfidenceThreshold || 82);

  const [savedSuccess, setSavedSuccess] = useState(false);

  const slotPresets = [
    { label: '2 Slots', value: 2, tag: 'Sniper Focus' },
    { label: '4 Slots', value: 4, tag: 'Multi-Scalp ⭐' },
    { label: '6 Slots', value: 6, tag: 'Active Scalper' },
    { label: '8 Slots', value: 8, tag: 'Max 8 Scalps 🔥' }
  ];

  const rrPresets = [
    { label: '1:1.0', value: 1.0, tag: 'Ultra Fast' },
    { label: '1:1.3', value: 1.3, tag: '75-85% Win Rate ⭐' },
    { label: '1:1.5', value: 1.5, tag: 'Balanced' },
    { label: '1:2.0', value: 2.0, tag: 'Swing Scalp' },
    { label: '1:3.0', value: 3.0, tag: 'Trend Runner' }
  ];

  const leveragePresets = [
    { label: '1x', value: 1, tag: 'Spot' },
    { label: '10x', value: 10, tag: 'Standard' },
    { label: '50x', value: 50, tag: 'High' },
    { label: '100x', value: 100, tag: 'Ultra' },
    { label: '200x', value: 200, tag: 'Extreme' },
    { label: '500x', value: 500, tag: 'Max 500x 🔥' }
  ];

  const spotSlPresets = [
    { label: '-0.8%', value: 0.8, tag: 'Tight' },
    { label: '-1.0%', value: 1.0, tag: 'Optimal 80-85% ⭐' },
    { label: '-1.2%', value: 1.2, tag: 'Balanced' },
    { label: '-1.5%', value: 1.5, tag: 'Standard' },
    { label: '-2.0%', value: 2.0, tag: 'Wide' }
  ];

  const spotTpPresets = [
    { label: '+1.6%', value: 1.6, tag: 'Fast Lock' },
    { label: '+2.0%', value: 2.0, tag: 'Target 1:2' },
    { label: '+2.2%', value: 2.2, tag: 'Optimal 80-85% ⭐' },
    { label: '+2.5%', value: 2.5, tag: 'Standard' },
    { label: '+3.0%', value: 3.0, tag: 'Trend Runner' }
  ];

  const handleSave = (e) => {
    e.preventDefault();
    if (selectedTab === 'SPOT') {
      onSaveSettings({
        account: 'SPOT',
        stopLossPct: parseFloat(spotStopLossPct),
        takeProfitPct: parseFloat(spotTakeProfitPct),
        minConfidenceThreshold: parseInt(spotMinConfidence, 10)
      });
    } else {
      onSaveSettings({
        account: 'MARGIN',
        riskPerTradePct: parseFloat(riskPerTradePct),
        maxConcurrentTrades: parseInt(maxConcurrentTrades, 10),
        minConfidenceThreshold: parseInt(minConfidenceThreshold, 10),
        targetRiskRewardRatio: parseFloat(targetRiskRewardRatio),
        defaultLeverage: parseInt(defaultLeverage, 10)
      });
    }
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      onClose();
    }, 800);
  };

  const calculatedSpotRR = (parseFloat(spotTakeProfitPct) / parseFloat(spotStopLossPct)).toFixed(1);

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-terminal-900 border border-terminal-border rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        <div className="p-5 border-b border-terminal-border flex items-center justify-between bg-terminal-850">
          <div className="flex items-center space-x-2.5">
            <Sliders className="w-5 h-5 text-indigo-400" />
            <h2 className="text-base font-bold font-mono text-white">Strategy & Risk Controls</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-terminal-800 hover:bg-terminal-700 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Account Selector Tabs */}
        <div className="flex border-b border-terminal-border bg-terminal-950 px-6 pt-3 gap-2">
          <button
            type="button"
            onClick={() => setSelectedTab('MARGIN')}
            className={`flex items-center gap-1.5 pb-2.5 px-3 border-b-2 font-mono text-xs font-bold transition-all ${
              selectedTab === 'MARGIN'
                ? 'border-amber-400 text-amber-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Zap className="w-3.5 h-3.5 text-amber-400" />
            <span>Margin Scalper (500x)</span>
          </button>
          <button
            type="button"
            onClick={() => setSelectedTab('SPOT')}
            className={`flex items-center gap-1.5 pb-2.5 px-3 border-b-2 font-mono text-xs font-bold transition-all ${
              selectedTab === 'SPOT'
                ? 'border-emerald-400 text-emerald-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Coins className="w-3.5 h-3.5 text-emerald-400" />
            <span>Pure Spot Crypto (100% Capital)</span>
          </button>
        </div>

        <form onSubmit={handleSave} className="p-6 space-y-5 font-mono text-xs max-h-[75vh] overflow-y-auto">
          {/* ========================================================= */}
          {/* TAB 1: MARGIN SCALPER SETTINGS                            */}
          {/* ========================================================= */}
          {selectedTab === 'MARGIN' && (
            <>
              {/* Target Risk-to-Reward Ratio (R:R) */}
              <div className="p-3.5 rounded-xl bg-indigo-950/30 border border-indigo-500/40">
                <div className="flex justify-between items-center mb-1.5">
                  <label className="text-indigo-300 font-bold uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                    <Target className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Target Risk : Reward Ratio (R:R)</span>
                  </label>
                  <span className="text-emerald-400 font-bold text-sm bg-terminal-950 px-2.5 py-0.5 rounded border border-emerald-500/40 font-mono">
                    1 : {parseFloat(targetRiskRewardRatio).toFixed(1)}
                  </span>
                </div>

                <input
                  type="range"
                  min="0.8"
                  max="4.0"
                  step="0.1"
                  value={targetRiskRewardRatio}
                  onChange={(e) => setTargetRiskRewardRatio(e.target.value)}
                  className="w-full accent-indigo-500 cursor-pointer my-2"
                />

                <div className="flex flex-wrap gap-1.5 mt-2">
                  {rrPresets.map(preset => (
                    <button
                      key={preset.value}
                      type="button"
                      onClick={() => setTargetRiskRewardRatio(preset.value)}
                      className={`px-2 py-1 rounded text-[10px] font-mono transition-all border ${
                        Math.abs(parseFloat(targetRiskRewardRatio) - preset.value) < 0.05
                          ? 'bg-indigo-600 text-white border-indigo-400 font-bold'
                          : 'bg-terminal-950 text-slate-400 border-terminal-border hover:text-white'
                      }`}
                    >
                      {preset.label} <span className="opacity-75">({preset.tag})</span>
                    </button>
                  ))}
                </div>

                <p className="text-[11px] text-slate-400 font-sans mt-2 leading-relaxed">
                  Lower ratios (<strong>1:1.0 to 1:1.3</strong>) achieve the highest <strong>75%–85% win rate</strong> because targets are reached rapidly before market pullbacks.
                </p>
              </div>

              {/* Account Leverage (1x - 500x) */}
              <div className="p-3.5 rounded-xl bg-amber-950/25 border border-amber-500/40">
                <div className="flex justify-between items-center mb-1.5">
                  <label className="text-amber-300 font-bold uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5 text-amber-400" />
                    <span>Account Leverage (1x – 500x)</span>
                  </label>
                  <div className="flex items-center gap-1 bg-terminal-950 px-2 py-0.5 rounded border border-amber-500/40">
                    <input
                      type="number"
                      min="1"
                      max="500"
                      value={defaultLeverage}
                      onChange={(e) => {
                        const v = parseInt(e.target.value, 10);
                        if (!isNaN(v)) setDefaultLeverage(Math.max(1, Math.min(500, v)));
                      }}
                      className="w-12 bg-transparent text-amber-400 font-bold text-sm text-right font-mono focus:outline-none"
                    />
                    <span className="text-amber-400 font-bold text-sm font-mono">x</span>
                  </div>
                </div>

                <input
                  type="range"
                  min="1"
                  max="500"
                  step="1"
                  value={defaultLeverage}
                  onChange={(e) => setDefaultLeverage(parseInt(e.target.value, 10))}
                  className="w-full accent-amber-500 cursor-pointer my-2"
                />

                <div className="flex flex-wrap gap-1.5 mt-2">
                  {leveragePresets.map(preset => (
                    <button
                      key={preset.value}
                      type="button"
                      onClick={() => setDefaultLeverage(preset.value)}
                      className={`px-2 py-1 rounded text-[10px] font-mono transition-all border ${
                        parseInt(defaultLeverage, 10) === preset.value
                          ? 'bg-amber-600 text-white border-amber-400 font-bold shadow-md shadow-amber-600/30'
                          : 'bg-terminal-950 text-slate-400 border-terminal-border hover:text-white'
                      }`}
                    >
                      {preset.label} <span className="opacity-75">({preset.tag})</span>
                    </button>
                  ))}
                </div>

                <p className="text-[11px] text-slate-400 font-sans mt-2 leading-relaxed">
                  At <strong>{defaultLeverage}x leverage</strong>, required margin is <strong>${(1000 / defaultLeverage).toFixed(2)}</strong> per $1,000 position.
                </p>
              </div>

              {/* Risk Per Trade */}
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="text-slate-300 font-bold uppercase tracking-wider text-[11px]">
                    Risk Per Trade (% of Margin Capital)
                  </label>
                  <span className="text-indigo-400 font-bold text-sm">{riskPerTradePct}%</span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="5.0"
                  step="0.25"
                  value={riskPerTradePct}
                  onChange={(e) => setRiskPerTradePct(e.target.value)}
                  className="w-full accent-indigo-500 cursor-pointer"
                />
              </div>

              {/* Max Concurrent Positions */}
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="text-slate-300 font-bold uppercase tracking-wider text-[11px]">
                    Max Concurrent Positions
                  </label>
                  <span className="text-indigo-400 font-bold text-sm">
                    {maxConcurrentTrades} {Number(maxConcurrentTrades) === 1 ? 'scalp (Sniper)' : 'concurrent scalps'}
                  </span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="8"
                  step="1"
                  value={maxConcurrentTrades}
                  onChange={(e) => setMaxConcurrentTrades(Number(e.target.value))}
                  className="w-full accent-indigo-500 cursor-pointer"
                />
                <div className="grid grid-cols-4 gap-1.5 mt-2">
                  {slotPresets.map((p) => {
                    const active = Number(maxConcurrentTrades) === p.value;
                    return (
                      <button
                        key={p.value}
                        type="button"
                        onClick={() => setMaxConcurrentTrades(p.value)}
                        className={`px-2 py-1.5 rounded text-xs font-semibold border transition-all text-center ${
                          active
                            ? 'bg-indigo-600/30 border-indigo-500 text-white shadow-sm'
                            : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                        }`}
                      >
                        <div className="font-bold">{p.label}</div>
                        <div className="text-[10px] opacity-75 font-normal truncate">{p.tag}</div>
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11px] text-slate-500 mt-1.5">
                  Currency & Sector Diversification Limiter protects multi-slot scalping by spreading positions across non-correlated markets.
                </p>
              </div>

              {/* Min Confluence Score */}
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="text-slate-300 font-bold uppercase tracking-wider text-[11px]">
                    Minimum Scalp Confluence Score
                  </label>
                  <span className="text-indigo-400 font-bold text-sm">{minConfidenceThreshold}%</span>
                </div>
                <input
                  type="range"
                  min="70"
                  max="95"
                  step="1"
                  value={minConfidenceThreshold}
                  onChange={(e) => setMinConfidenceThreshold(e.target.value)}
                  className="w-full accent-indigo-500 cursor-pointer"
                />
              </div>
            </>
          )}

          {/* ========================================================= */}
          {/* TAB 2: PURE SPOT CRYPTO SETTINGS                          */}
          {/* ========================================================= */}
          {selectedTab === 'SPOT' && (
            <>
              {/* Capital Allocation Info Banner */}
              <div className="p-3.5 rounded-xl bg-emerald-950/30 border border-emerald-500/40 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-emerald-300 font-bold uppercase tracking-wider text-[11px]">
                    <Coins className="w-4 h-4 text-emerald-400" />
                    <span>Pure Spot Capital Allocation</span>
                  </div>
                  <span className="text-emerald-300 font-bold text-xs bg-emerald-900/50 border border-emerald-500/40 px-2.5 py-0.5 rounded">
                    100% BALANCE ALLOCATED
                  </span>
                </div>
                <p className="text-[11px] text-slate-300 font-sans leading-relaxed">
                  Every spot trade buys the coin using <strong>100% of your current Spot Balance</strong> (e.g. $10 balance buys $10 of coin, $50 buys $50). 
                  <strong> 0x Leverage</strong> means zero liquidation risk — you own the underlying asset directly.
                </p>
              </div>

              {/* Quick Strategy Combo Presets */}
              <div className="p-3 rounded-xl bg-terminal-950 border border-terminal-border space-y-2">
                <div className="text-[11px] font-bold text-slate-300 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  <span>High Win-Rate Spot Presets</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSpotStopLossPct(0.8);
                      setSpotTakeProfitPct(1.6);
                      setSpotMinConfidence(82);
                    }}
                    className={`p-2 rounded-lg border text-left transition-all ${
                      Math.abs(parseFloat(spotStopLossPct) - 0.8) < 0.05 && Math.abs(parseFloat(spotTakeProfitPct) - 1.6) < 0.05
                        ? 'bg-emerald-950/60 border-emerald-500/60 text-white'
                        : 'bg-terminal-900 border-terminal-border text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <div className="font-bold text-emerald-400">Fast Scalp</div>
                    <div className="text-[10px] text-slate-400">-0.8% SL / +1.6% TP</div>
                    <div className="text-[9px] text-cyan-400 mt-0.5">1:2 R:R Ratio</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSpotStopLossPct(1.0);
                      setSpotTakeProfitPct(2.2);
                      setSpotMinConfidence(82);
                    }}
                    className={`p-2 rounded-lg border text-left transition-all ${
                      Math.abs(parseFloat(spotStopLossPct) - 1.0) < 0.05 && Math.abs(parseFloat(spotTakeProfitPct) - 2.2) < 0.05
                        ? 'bg-emerald-950/60 border-emerald-500/60 text-white'
                        : 'bg-terminal-900 border-terminal-border text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <div className="font-bold text-amber-400">High Win Rate ⭐</div>
                    <div className="text-[10px] text-slate-400">-1.0% SL / +2.2% TP</div>
                    <div className="text-[9px] text-emerald-400 mt-0.5">80%–85% Target</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSpotStopLossPct(1.5);
                      setSpotTakeProfitPct(3.0);
                      setSpotMinConfidence(80);
                    }}
                    className={`p-2 rounded-lg border text-left transition-all ${
                      Math.abs(parseFloat(spotStopLossPct) - 1.5) < 0.05 && Math.abs(parseFloat(spotTakeProfitPct) - 3.0) < 0.05
                        ? 'bg-emerald-950/60 border-emerald-500/60 text-white'
                        : 'bg-terminal-900 border-terminal-border text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <div className="font-bold text-indigo-400">Trend Runner</div>
                    <div className="text-[10px] text-slate-400">-1.5% SL / +3.0% TP</div>
                    <div className="text-[9px] text-indigo-300 mt-0.5">Wide Noise Buffer</div>
                  </button>
                </div>
              </div>

              {/* Spot Stop Loss % */}
              <div className="p-3.5 rounded-xl bg-rose-950/20 border border-rose-500/40">
                <div className="flex justify-between items-center mb-1.5">
                  <label className="text-rose-300 font-bold uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                    <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
                    <span>Stop Loss Percentage</span>
                  </label>
                  <span className="text-rose-400 font-bold text-sm bg-terminal-950 px-2.5 py-0.5 rounded border border-rose-500/40 font-mono">
                    -{parseFloat(spotStopLossPct).toFixed(1)}%
                  </span>
                </div>

                <input
                  type="range"
                  min="0.2"
                  max="5.0"
                  step="0.1"
                  value={spotStopLossPct}
                  onChange={(e) => setSpotStopLossPct(e.target.value)}
                  className="w-full accent-rose-500 cursor-pointer my-2"
                />

                <div className="flex flex-wrap gap-1.5 mt-2">
                  {spotSlPresets.map(preset => (
                    <button
                      key={preset.value}
                      type="button"
                      onClick={() => setSpotStopLossPct(preset.value)}
                      className={`px-2 py-1 rounded text-[10px] font-mono transition-all border ${
                        Math.abs(parseFloat(spotStopLossPct) - preset.value) < 0.05
                          ? 'bg-rose-600 text-white border-rose-400 font-bold'
                          : 'bg-terminal-950 text-slate-400 border-terminal-border hover:text-white'
                      }`}
                    >
                      {preset.label} <span className="opacity-75">({preset.tag})</span>
                    </button>
                  ))}
                </div>

                {parseFloat(spotStopLossPct) <= 0.4 ? (
                  <div className="mt-2.5 p-2.5 rounded-lg bg-cyan-950/40 border border-cyan-500/40 text-[11px] text-cyan-200 leading-relaxed flex items-start gap-2">
                    <ShieldCheck className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold text-cyan-300">Micro-Wick Noise Shield Active: </span>
                      Because stop is ultra-tight (-{parseFloat(spotStopLossPct).toFixed(1)}%), entries strictly require lower-wick dip rejection & RSI value exhaustion so trades aren't clipped by regular 0.2% crypto spread noise.
                    </div>
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-400 font-sans mt-2">
                    Safely sells the holding if price dips by this percentage from your buy price.
                  </p>
                )}
              </div>

              {/* Spot Take Profit % */}
              <div className="p-3.5 rounded-xl bg-emerald-950/20 border border-emerald-500/40">
                <div className="flex justify-between items-center mb-1.5">
                  <label className="text-emerald-300 font-bold uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                    <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Take Profit Percentage</span>
                  </label>
                  <span className="text-emerald-400 font-bold text-sm bg-terminal-950 px-2.5 py-0.5 rounded border border-emerald-500/40 font-mono">
                    +{parseFloat(spotTakeProfitPct).toFixed(1)}%
                  </span>
                </div>

                <input
                  type="range"
                  min="0.5"
                  max="15.0"
                  step="0.25"
                  value={spotTakeProfitPct}
                  onChange={(e) => setSpotTakeProfitPct(e.target.value)}
                  className="w-full accent-emerald-500 cursor-pointer my-2"
                />

                <div className="flex flex-wrap gap-1.5 mt-2">
                  {spotTpPresets.map(preset => (
                    <button
                      key={preset.value}
                      type="button"
                      onClick={() => setSpotTakeProfitPct(preset.value)}
                      className={`px-2 py-1 rounded text-[10px] font-mono transition-all border ${
                        Math.abs(parseFloat(spotTakeProfitPct) - preset.value) < 0.05
                          ? 'bg-emerald-600 text-white border-emerald-400 font-bold'
                          : 'bg-terminal-950 text-slate-400 border-terminal-border hover:text-white'
                      }`}
                    >
                      {preset.label} <span className="opacity-75">({preset.tag})</span>
                    </button>
                  ))}
                </div>

                <div className="mt-2.5 flex items-center justify-between text-[11px] bg-terminal-950 p-2 rounded border border-terminal-border">
                  <span className="text-slate-400">Effective Spot Risk-to-Reward:</span>
                  <span className="text-emerald-300 font-bold font-mono">1 : {calculatedSpotRR} R:R</span>
                </div>
              </div>

              {/* Spot Min Confidence */}
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="text-slate-300 font-bold uppercase tracking-wider text-[11px]">
                    Minimum Crypto Buy Confluence Score
                  </label>
                  <span className="text-emerald-400 font-bold text-sm">{spotMinConfidence}%</span>
                </div>
                <input
                  type="range"
                  min="70"
                  max="95"
                  step="1"
                  value={spotMinConfidence}
                  onChange={(e) => setSpotMinConfidence(e.target.value)}
                  className="w-full accent-emerald-500 cursor-pointer"
                />
                <p className="text-[11px] text-slate-400 font-sans mt-1">
                  Only buys coins when multi-indicator score meets or exceeds {spotMinConfidence}% (Default: 82%).
                </p>
              </div>
            </>
          )}

          {/* Reset Capital */}
          <div className="pt-4 border-t border-terminal-border/60">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-white font-bold">
                  Reset {selectedTab === 'SPOT' ? 'Spot' : 'Margin'} Account
                </h4>
                <p className="text-[11px] text-slate-400 font-sans">
                  Clear {selectedTab === 'SPOT' ? 'spot coin holding' : 'active scalps'} & restore default balance.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  onResetPortfolio(selectedTab);
                  onClose();
                }}
                className="px-3 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 font-mono text-xs flex items-center gap-1.5 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset {selectedTab}</span>
              </button>
            </div>
          </div>

          {/* Action buttons */}
          <div className="pt-4 border-t border-terminal-border/60 flex items-center justify-end space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-terminal-800 hover:bg-terminal-700 text-slate-300 text-xs transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className={`px-5 py-2 rounded-lg text-white font-bold text-xs flex items-center gap-1.5 transition-all shadow-lg ${
                selectedTab === 'SPOT'
                  ? 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-600/25'
                  : 'bg-indigo-600 hover:bg-indigo-500 shadow-indigo-600/25'
              }`}
            >
              {savedSuccess ? <Check className="w-4 h-4 text-emerald-300" /> : null}
              <span>{savedSuccess ? 'Saved!' : `Save ${selectedTab} Settings`}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
