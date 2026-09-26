import React, { useState } from 'react';
import { X, ShieldAlert, Sliders, RotateCcw, Check, Target, Zap, Coins, TrendingUp, ShieldCheck, Sparkles, Layers, Timer } from 'lucide-react';

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
  const [maxConcurrentTrades, setMaxConcurrentTrades] = useState(initialMargin.maxConcurrentTrades || 20);
  const [minConfidenceThreshold, setMinConfidenceThreshold] = useState(initialMargin.minConfidenceThreshold || 75);
  const [targetRiskRewardRatio, setTargetRiskRewardRatio] = useState(initialMargin.targetRiskRewardRatio || 1.6);
  const [defaultLeverage, setDefaultLeverage] = useState(initialMargin.defaultLeverage || 500);
  const [maxTradesPerPair, setMaxTradesPerPair] = useState(initialMargin.maxTradesPerPair || 1);

  // Spot Settings State (Fast 5-Minute Scalping & Halal Filtering)
  const initialSpot = spotSettings || {};
  const [spotStopLossPct, setSpotStopLossPct] = useState(initialSpot.stopLossPct || 0.6);
  const [spotTakeProfitPct, setSpotTakeProfitPct] = useState(initialSpot.takeProfitPct || 0.78);
  const [spotMinConfidence, setSpotMinConfidence] = useState(initialSpot.minConfidenceThreshold || 90);
  const [spotMaxSlots, setSpotMaxSlots] = useState(initialSpot.maxSlots || 4);
  const [spotMaxTradesPerPair, setSpotMaxTradesPerPair] = useState(initialSpot.maxTradesPerPair || 2);
  const [spotMaxHoldMinutes, setSpotMaxHoldMinutes] = useState(initialSpot.maxHoldMinutes || 5);
  const [spotAllowHighVolatility, setSpotAllowHighVolatility] = useState(initialSpot.allowHighVolatility !== undefined ? initialSpot.allowHighVolatility : true);

  const [savedSuccess, setSavedSuccess] = useState(false);

  const marginPerPairPresets = [
    { label: '1 Trade', value: 1, tag: 'Strict Isolated' },
    { label: '2 Trades ⭐', value: 2, tag: 'Hedge & Scale' },
    { label: '3 Trades 🔥', value: 3, tag: 'Multi-Scalp' }
  ];

  const spotPerCoinPresets = [
    { label: '1 Portion', value: 1, tag: 'Max Diversify' },
    { label: '2 Portions ⭐', value: 2, tag: 'Dip Ladder' },
    { label: '3 Portions 🔥', value: 3, tag: 'Multi-Entry' }
  ];

  const spotMaxHoldPresets = [
    { label: '3 Mins', value: 3, tag: 'Hyper Scalp' },
    { label: '5 Mins ⭐', value: 5, tag: 'Optimal Cap' },
    { label: '8 Mins', value: 8, tag: 'Balanced' },
    { label: '10 Mins', value: 10, tag: 'Extended' }
  ];

  const spotPortionPresets = [
    { label: '1 Portion (100%)', value: 1, tag: 'All-in' },
    { label: '2 Portions (50%)', value: 2, tag: 'Dual Setup' },
    { label: '4 Portions (25%)', value: 4, tag: 'Multi-Scalp ⭐' },
    { label: '6 Portions (16.7%)', value: 6, tag: 'Active' },
    { label: '8 Portions (12.5%)', value: 8, tag: 'Max 8 Scalps 🔥' }
  ];

  const slotPresets = [
    { label: '2 Slots', value: 2, tag: '$10 Standard Cap' },
    { label: '6 Slots', value: 6, tag: '$50 Standard' },
    { label: '12 Slots', value: 12, tag: '$100 Multi-Scalp' },
    { label: '20 Slots ⭐', value: 20, tag: 'Cent / Max 20 Scalps 🔥' }
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
    { label: '-0.4%', value: 0.4, tag: 'Ultra Tight' },
    { label: '-0.6%', value: 0.6, tag: 'Fast Scalp ⭐' },
    { label: '-0.8%', value: 0.8, tag: 'Tight' },
    { label: '-1.0%', value: 1.0, tag: 'Standard' },
    { label: '-1.5%', value: 1.5, tag: 'Wide' }
  ];

  const spotTpPresets = [
    { label: '+0.8%', value: 0.8, tag: 'Quick Lock' },
    { label: '+1.0%', value: 1.0, tag: 'Fast Scalp ⭐' },
    { label: '+1.2%', value: 1.2, tag: 'Target 1:2' },
    { label: '+1.6%', value: 1.6, tag: 'Impulse' },
    { label: '+2.2%', value: 2.2, tag: 'Runner' }
  ];

  const handleSave = (e) => {
    e.preventDefault();
    if (selectedTab === 'SPOT') {
      onSaveSettings({
        account: 'SPOT',
        stopLossPct: parseFloat(spotStopLossPct),
        takeProfitPct: parseFloat(spotTakeProfitPct),
        minConfidenceThreshold: parseInt(spotMinConfidence, 10),
        maxSlots: parseInt(spotMaxSlots, 10),
        maxTradesPerPair: parseInt(spotMaxTradesPerPair, 10),
        maxHoldMinutes: parseInt(spotMaxHoldMinutes, 10),
        allowHighVolatility: Boolean(spotAllowHighVolatility),
        volatilityMode: spotAllowHighVolatility ? 'HIGH_VOLATILITY_HALAL' : 'ESTABLISHED_HALAL'
      });
    } else {
      onSaveSettings({
        account: 'MARGIN',
        riskPerTradePct: parseFloat(riskPerTradePct),
        maxConcurrentTrades: parseInt(maxConcurrentTrades, 10),
        minConfidenceThreshold: parseInt(minConfidenceThreshold, 10),
        targetRiskRewardRatio: parseFloat(targetRiskRewardRatio),
        defaultLeverage: parseInt(defaultLeverage, 10),
        maxTradesPerPair: parseInt(maxTradesPerPair, 10)
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
                  max="20"
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

              {/* Max Trades Per Pair & Bi-Directional Hedging */}
              <div className="p-3.5 rounded-xl bg-indigo-950/20 border border-indigo-500/30">
                <div className="flex justify-between items-center mb-1.5">
                  <label className="text-indigo-300 font-bold uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Max Trades Per Pair & Hedging</span>
                  </label>
                  <span className="text-indigo-400 font-bold text-sm bg-terminal-950 px-2.5 py-0.5 rounded border border-indigo-500/40 font-mono">
                    {maxTradesPerPair} Trade{maxTradesPerPair > 1 ? 's' : ''} Max
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 font-sans mb-2">
                  Enables bi-directional hedging (e.g. simultaneous LONG & SHORT on DOGE) and allows scaling into strong trend pullbacks.
                </p>
                <div className="grid grid-cols-3 gap-1.5">
                  {marginPerPairPresets.map((p) => {
                    const active = Number(maxTradesPerPair) === p.value;
                    return (
                      <button
                        key={p.value}
                        type="button"
                        onClick={() => setMaxTradesPerPair(p.value)}
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
              {/* Shariah Halal Compliance Guarantee Banner */}
              <div className="p-3.5 rounded-xl bg-teal-950/30 border border-teal-500/40 space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-teal-300 font-bold uppercase tracking-wider text-[11px]">
                    <span>🕌 100% Shariah-Compliant Crypto Shield</span>
                  </div>
                  <span className="text-teal-300 font-bold text-[10px] bg-teal-900/60 border border-teal-500/40 px-2 py-0.5 rounded font-mono">
                    ALWAYS ENFORCED
                  </span>
                </div>
                <p className="text-[11px] text-slate-300 font-sans leading-relaxed">
                  Strictly blocks all <strong>Meme Coins</strong> (DOGE, SHIB, PEPE, BONK, WIF), <strong>Riba Lending Protocols</strong> (AAVE, COMP, PENDLE), and <strong>Casino/Gambling Tokens</strong>. Only vetted Halal utility, Layer 1/2, AI, decentralized storage, and oracle infrastructure cryptos are scanned.
                </p>
              </div>

              {/* Volatile Coins Selection Option */}
              <div className="p-3.5 rounded-xl bg-indigo-950/25 border border-indigo-500/40 space-y-2.5">
                <div className="flex justify-between items-center">
                  <label className="text-indigo-300 font-bold uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5 text-amber-400" />
                    <span>Market Volatility Selection</span>
                  </label>
                  <span className={`text-xs font-bold font-mono px-2.5 py-0.5 rounded border ${
                    spotAllowHighVolatility
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                      : 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40'
                  }`}>
                    {spotAllowHighVolatility ? '⚡ High-Volatility Halal' : '🛡️ Standard Halal Majors'}
                  </span>
                </div>
                <p className="text-[11px] text-slate-300 font-sans">
                  Choose whether the autonomous agent should dynamically hunt high-volatility Halal tokens on the internet or stick to established large-cap Halal coins:
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setSpotAllowHighVolatility(true)}
                    className={`p-2.5 rounded-xl border text-left transition-all ${
                      spotAllowHighVolatility
                        ? 'bg-amber-950/40 border-amber-500/60 text-white shadow-md shadow-amber-500/10'
                        : 'bg-terminal-950 border-terminal-border text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="font-bold text-xs text-amber-400 flex items-center gap-1">
                        <Zap className="w-3.5 h-3.5" /> High-Volatility Halal ⚡
                      </span>
                      {spotAllowHighVolatility && <Check className="w-3.5 h-3.5 text-amber-400" />}
                    </div>
                    <p className="text-[10px] text-slate-300 leading-tight">
                      Dynamically scans explosive Halal alts (SUI, APT, INJ, RENDER, FET, SEI, TIA, AVAX, NEAR) for rapid 5m scalping.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSpotAllowHighVolatility(false)}
                    className={`p-2.5 rounded-xl border text-left transition-all ${
                      !spotAllowHighVolatility
                        ? 'bg-indigo-950/40 border-indigo-500/60 text-white shadow-md shadow-indigo-500/10'
                        : 'bg-terminal-950 border-terminal-border text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="font-bold text-xs text-indigo-300 flex items-center gap-1">
                        <ShieldCheck className="w-3.5 h-3.5" /> Standard Halal Majors 🛡️
                      </span>
                      {!spotAllowHighVolatility && <Check className="w-3.5 h-3.5 text-indigo-300" />}
                    </div>
                    <p className="text-[10px] text-slate-300 leading-tight">
                      Trades established large-cap Halal cryptos (BTC, ETH, SOL, LINK, ADA, DOT, AVAX, NEAR) with steady momentum.
                    </p>
                  </button>
                </div>
              </div>

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

              {/* Spot Balance Partitioning & Portions */}
              <div className="p-3.5 rounded-xl bg-emerald-950/30 border border-emerald-500/40">
                <div className="flex justify-between items-center mb-1.5">
                  <label className="text-emerald-300 font-bold uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                    <Coins className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Balance Partitioning & Concurrent Scalps</span>
                  </label>
                  <span className="text-emerald-400 font-bold text-sm bg-terminal-950 px-2.5 py-0.5 rounded border border-emerald-500/40 font-mono">
                    {spotMaxSlots} Portion{spotMaxSlots > 1 ? 's' : ''} ({(100 / spotMaxSlots).toFixed(1)}% each)
                  </span>
                </div>

                <p className="text-[11px] text-slate-300 font-sans mb-2.5">
                  Splits your cash balance into equal portions so multiple volatile altcoins and memecoins can be scalped simultaneously.
                </p>

                <div className="flex flex-wrap gap-1.5">
                  {spotPortionPresets.map(preset => (
                    <button
                      key={preset.value}
                      type="button"
                      onClick={() => setSpotMaxSlots(preset.value)}
                      className={`px-2.5 py-1.5 rounded text-[11px] font-mono transition-all border ${
                        parseInt(spotMaxSlots, 10) === preset.value
                          ? 'bg-emerald-600 text-white border-emerald-400 font-bold shadow-sm shadow-emerald-500/30'
                          : 'bg-terminal-950 text-slate-400 border-terminal-border hover:text-white hover:border-slate-500'
                      }`}
                    >
                      {preset.label} <span className="opacity-75">({preset.tag})</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Max Portions Per Coin */}
              <div className="p-3.5 rounded-xl bg-emerald-950/20 border border-emerald-500/30">
                <div className="flex justify-between items-center mb-1.5">
                  <label className="text-emerald-300 font-bold uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Max Portions Per Coin</span>
                  </label>
                  <span className="text-emerald-400 font-bold text-sm bg-terminal-950 px-2.5 py-0.5 rounded border border-emerald-500/40 font-mono">
                    {spotMaxTradesPerPair} Portion{spotMaxTradesPerPair > 1 ? 's' : ''} Max
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 font-sans mb-2">
                  Allows allocating multiple free portions to top-performing volatile altcoins/memecoins on high-confluence dip pullbacks.
                </p>
                <div className="grid grid-cols-3 gap-1.5">
                  {spotPerCoinPresets.map((p) => {
                    const active = Number(spotMaxTradesPerPair) === p.value;
                    return (
                      <button
                        key={p.value}
                        type="button"
                        onClick={() => setSpotMaxTradesPerPair(p.value)}
                        className={`px-2 py-1.5 rounded text-xs font-semibold border transition-all text-center ${
                          active
                            ? 'bg-emerald-600/30 border-emerald-500 text-white shadow-sm'
                            : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                        }`}
                      >
                        <div className="font-bold">{p.label}</div>
                        <div className="text-[10px] opacity-75 font-normal truncate">{p.tag}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Max Hold Duration (Fast 5m Scalp Hard Cap) */}
              <div className="p-3.5 rounded-xl bg-cyan-950/25 border border-cyan-500/40">
                <div className="flex justify-between items-center mb-1.5">
                  <label className="text-cyan-300 font-bold uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                    <Timer className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Max Hold Time Per Trade (Auto-Exit)</span>
                  </label>
                  <span className="text-cyan-400 font-bold text-sm bg-terminal-950 px-2.5 py-0.5 rounded border border-cyan-500/40 font-mono">
                    {spotMaxHoldMinutes} Min{spotMaxHoldMinutes > 1 ? 's' : ''} Max
                  </span>
                </div>
                <p className="text-[11px] text-slate-300 font-sans mb-2">
                  Guarantees fast turnover: Trades held for {spotMaxHoldMinutes} minutes are auto-closed at market price to bank micro-profits and recycle cash into new high-conviction setups.
                </p>
                <div className="grid grid-cols-4 gap-1.5">
                  {spotMaxHoldPresets.map((p) => {
                    const active = Number(spotMaxHoldMinutes) === p.value;
                    return (
                      <button
                        key={p.value}
                        type="button"
                        onClick={() => setSpotMaxHoldMinutes(p.value)}
                        className={`px-2 py-1.5 rounded text-xs font-semibold border transition-all text-center ${
                          active
                            ? 'bg-cyan-600/30 border-cyan-500 text-white shadow-sm'
                            : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                        }`}
                      >
                        <div className="font-bold">{p.label}</div>
                        <div className="text-[10px] opacity-75 font-normal truncate">{p.tag}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Quick Strategy Combo Presets */}
              <div className="p-3 rounded-xl bg-terminal-950 border border-terminal-border space-y-2">
                <div className="text-[11px] font-bold text-slate-300 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  <span>High Win-Rate Fast Scalp Presets</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSpotStopLossPct(0.5);
                      setSpotTakeProfitPct(0.9);
                      setSpotMinConfidence(80);
                      setSpotMaxHoldMinutes(5);
                    }}
                    className={`p-2 rounded-lg border text-left transition-all ${
                      Math.abs(parseFloat(spotStopLossPct) - 0.5) < 0.05 && Math.abs(parseFloat(spotTakeProfitPct) - 0.9) < 0.05
                        ? 'bg-emerald-950/60 border-emerald-500/60 text-white'
                        : 'bg-terminal-900 border-terminal-border text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <div className="font-bold text-emerald-400">Ultra-Fast 5m ⚡</div>
                    <div className="text-[10px] text-slate-400">-0.5% SL / +0.9% TP</div>
                    <div className="text-[9px] text-cyan-400 mt-0.5">1-5 Min Micro-Burst</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSpotStopLossPct(0.6);
                      setSpotTakeProfitPct(1.1);
                      setSpotMinConfidence(80);
                      setSpotMaxHoldMinutes(5);
                    }}
                    className={`p-2 rounded-lg border text-left transition-all ${
                      Math.abs(parseFloat(spotStopLossPct) - 0.6) < 0.05 && Math.abs(parseFloat(spotTakeProfitPct) - 1.1) < 0.05
                        ? 'bg-emerald-950/60 border-emerald-500/60 text-white'
                        : 'bg-terminal-900 border-terminal-border text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <div className="font-bold text-amber-400">Sniper Scalp ⭐</div>
                    <div className="text-[10px] text-slate-400">-0.6% SL / +1.1% TP</div>
                    <div className="text-[9px] text-emerald-400 mt-0.5">80%–85% Target</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSpotStopLossPct(0.8);
                      setSpotTakeProfitPct(1.6);
                      setSpotMinConfidence(80);
                      setSpotMaxHoldMinutes(5);
                    }}
                    className={`p-2 rounded-lg border text-left transition-all ${
                      Math.abs(parseFloat(spotStopLossPct) - 0.8) < 0.05 && Math.abs(parseFloat(spotTakeProfitPct) - 1.6) < 0.05
                        ? 'bg-emerald-950/60 border-emerald-500/60 text-white'
                        : 'bg-terminal-900 border-terminal-border text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <div className="font-bold text-indigo-400">Momentum Runner</div>
                    <div className="text-[10px] text-slate-400">-0.8% SL / +1.6% TP</div>
                    <div className="text-[9px] text-indigo-300 mt-0.5">1:2 R:R Ratio</div>
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
