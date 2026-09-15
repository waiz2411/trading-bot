import React, { useState } from 'react';
import { X, ShieldAlert, Sliders, RotateCcw, Check, Target, Zap } from 'lucide-react';

export default function SettingsModal({ settings, onSaveSettings, onResetPortfolio, onClose }) {
  const [riskPerTradePct, setRiskPerTradePct] = useState(settings?.riskPerTradePct || 1.5);
  const [maxConcurrentTrades, setMaxConcurrentTrades] = useState(settings?.maxConcurrentTrades || 4);
  const [minConfidenceThreshold, setMinConfidenceThreshold] = useState(settings?.minConfidenceThreshold || 78);
  const [targetRiskRewardRatio, setTargetRiskRewardRatio] = useState(settings?.targetRiskRewardRatio || 1.3);
  const [defaultLeverage, setDefaultLeverage] = useState(settings?.defaultLeverage || 10);
  const [savedSuccess, setSavedSuccess] = useState(false);

  const rrPresets = [
    { label: '1:1.0', value: 1.0, tag: 'Ultra Fast' },
    { label: '1:1.3', value: 1.3, tag: '75-80% Win Rate' },
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

  const handleSave = (e) => {
    e.preventDefault();
    onSaveSettings({
      riskPerTradePct: parseFloat(riskPerTradePct),
      maxConcurrentTrades: parseInt(maxConcurrentTrades, 10),
      minConfidenceThreshold: parseInt(minConfidenceThreshold, 10),
      targetRiskRewardRatio: parseFloat(targetRiskRewardRatio),
      defaultLeverage: parseInt(defaultLeverage, 10)
    });
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      onClose();
    }, 800);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-terminal-900 border border-terminal-border rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        <div className="p-5 border-b border-terminal-border flex items-center justify-between bg-terminal-850">
          <div className="flex items-center space-x-2.5">
            <Sliders className="w-5 h-5 text-indigo-400" />
            <h2 className="text-base font-bold font-mono text-white">Risk Guardian & Strategy Controls</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-terminal-800 hover:bg-terminal-700 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-6 space-y-5 font-mono text-xs max-h-[80vh] overflow-y-auto">
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

            {/* Quick R:R presets */}
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
              Sets how far your Take-Profit is from entry relative to Stop-Loss. Lower ratios (<strong>1:1.0 to 1:1.3</strong>) achieve the highest <strong>75%–85% win rate</strong> because targets are reached rapidly before market pullbacks.
            </p>
          </div>

          {/* Account Leverage & Margin Multiplier (1x - 500x) */}
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

            {/* Quick Leverage presets */}
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
              At <strong>{defaultLeverage}x leverage</strong>, required margin is <strong>${(1000 / defaultLeverage).toFixed(2)}</strong> per $1,000 position {defaultLeverage >= 100 ? `(Just $${(1000 / defaultLeverage).toFixed(2)} controls $1,000!)` : ''}. Stop-loss triggers safeguard your equity before liquidation thresholds.
            </p>
          </div>

          {/* Risk Per Trade */}
          <div>
            <div className="flex justify-between items-center mb-1.5">
              <label className="text-slate-300 font-bold uppercase tracking-wider text-[11px]">
                Risk Per Trade (% of Account Equity)
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
            <p className="text-[11px] text-slate-400 font-sans mt-1">
              Limits the maximum dollar amount risked per scalp (Recommended: 1.0% - 2.0%).
            </p>
          </div>

          {/* Max Concurrent Positions */}
          <div>
            <div className="flex justify-between items-center mb-1.5">
              <label className="text-slate-300 font-bold uppercase tracking-wider text-[11px]">
                Max Concurrent Positions
              </label>
              <span className="text-indigo-400 font-bold text-sm">{maxConcurrentTrades} trades</span>
            </div>
            <input
              type="range"
              min="1"
              max="8"
              step="1"
              value={maxConcurrentTrades}
              onChange={(e) => setMaxConcurrentTrades(e.target.value)}
              className="w-full accent-indigo-500 cursor-pointer"
            />
            <p className="text-[11px] text-slate-400 font-sans mt-1">
              Limits simultaneous open scalps to prevent over-exposure.
            </p>
          </div>

          {/* Min Confluence Score */}
          <div>
            <div className="flex justify-between items-center mb-1.5">
              <label className="text-slate-300 font-bold uppercase tracking-wider text-[11px]">
                Minimum Sniper Confluence Score
              </label>
              <span className="text-indigo-400 font-bold text-sm">{minConfidenceThreshold}%</span>
            </div>
            <input
              type="range"
              min="65"
              max="90"
              step="1"
              value={minConfidenceThreshold}
              onChange={(e) => setMinConfidenceThreshold(e.target.value)}
              className="w-full accent-indigo-500 cursor-pointer"
            />
            <p className="text-[11px] text-slate-400 font-sans mt-1">
              Only opens trades when indicator agreement reaches this score (Default: 78% for sniper precision).
            </p>
          </div>

          {/* Reset Demo Capital */}
          <div className="pt-4 border-t border-terminal-border/60">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-white font-bold">Reset Demo Account</h4>
                <p className="text-[11px] text-slate-400 font-sans">
                  Clear active trades & restore default virtual balance.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  onResetPortfolio();
                  onClose();
                }}
                className="px-3 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 font-mono text-xs flex items-center gap-1.5 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset Capital</span>
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
              className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center gap-1.5 transition-all shadow-lg shadow-indigo-600/25"
            >
              {savedSuccess ? <Check className="w-4 h-4 text-emerald-300" /> : null}
              <span>{savedSuccess ? 'Saved!' : 'Save Risk Parameters'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
