import React, { useState } from 'react';
import { X, DollarSign, Wallet, Plus, Minus, Check, Zap, Coins } from 'lucide-react';

export default function BalanceModal({
  activeAccount = 'MARGIN',
  marginBalance = 10,
  spotBalance = 10,
  currentBalance,
  onUpdateBalance,
  onAdjustBalance,
  onClose
}) {
  const [targetAccount, setTargetAccount] = useState(activeAccount || 'MARGIN');
  const activeBal = targetAccount === 'SPOT' ? spotBalance : marginBalance;

  const [customBalance, setCustomBalance] = useState((activeBal ?? currentBalance ?? 10).toString());
  const [closePositions, setClosePositions] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  const isSpot = targetAccount === 'SPOT';

  const presets = [
    { value: 5, label: '$5', tag: 'Micro 🔥' },
    { value: 10, label: '$10', tag: 'Low Test ⭐' },
    { value: 25, label: '$25' },
    { value: 50, label: '$50' },
    { value: 100, label: '$100' },
    { value: 500, label: '$500' },
    { value: 1000, label: '$1,000' },
    { value: 5000, label: '$5,000' },
    { value: 10000, label: '$10,000' }
  ];

  const handleAccountChange = (acc) => {
    setTargetAccount(acc);
    const bal = acc === 'SPOT' ? spotBalance : marginBalance;
    setCustomBalance((bal ?? 10).toString());
  };

  const handleApply = async (e) => {
    e?.preventDefault();
    const val = parseFloat(customBalance);
    if (isNaN(val) || val <= 0) return;

    setIsSubmitting(true);
    await onUpdateBalance(val, closePositions, targetAccount);
    setIsSubmitting(false);
    setSuccessMsg(`[${targetAccount}] Balance updated to $${val.toLocaleString('en-US')}`);
    setTimeout(() => {
      setSuccessMsg('');
      onClose();
    }, 900);
  };

  const handleQuickAdjust = async (delta) => {
    setIsSubmitting(true);
    await onAdjustBalance(delta, targetAccount);
    setIsSubmitting(false);
    const newBal = Math.max(1, (parseFloat(customBalance) || 0) + delta);
    setCustomBalance(newBal.toString());
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-terminal-900 border border-terminal-border rounded-2xl w-full max-w-md overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        {/* Modal Header */}
        <div className="p-5 border-b border-terminal-border flex items-center justify-between bg-terminal-850">
          <div className="flex items-center space-x-2.5">
            <div className={`w-8 h-8 rounded-lg border flex items-center justify-center ${
              isSpot ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400' : 'bg-indigo-500/20 border-indigo-500/40 text-indigo-400'
            }`}>
              <Wallet className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold font-mono text-white">Edit Demo Account Balance</h2>
              <p className="text-[11px] text-slate-400 font-sans">
                {isSpot ? 'Set capital for 100% Pure Spot Trades' : 'Set capital for 500x Margin Scalper'}
              </p>
            </div>
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
            onClick={() => handleAccountChange('MARGIN')}
            className={`flex items-center gap-1.5 pb-2.5 px-3 border-b-2 font-mono text-xs font-bold transition-all ${
              !isSpot
                ? 'border-amber-400 text-amber-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Zap className="w-3.5 h-3.5 text-amber-400" />
            <span>Margin (${marginBalance.toLocaleString('en-US')})</span>
          </button>
          <button
            type="button"
            onClick={() => handleAccountChange('SPOT')}
            className={`flex items-center gap-1.5 pb-2.5 px-3 border-b-2 font-mono text-xs font-bold transition-all ${
              isSpot
                ? 'border-emerald-400 text-emerald-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Coins className="w-3.5 h-3.5 text-emerald-400" />
            <span>Spot (${spotBalance.toLocaleString('en-US')})</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5 font-mono text-xs">
          {/* Current Balance Display */}
          <div className="p-3.5 rounded-xl bg-terminal-950 border border-terminal-border flex items-center justify-between">
            <div>
              <span className="text-slate-500 text-[10px] uppercase">
                {isSpot ? 'Spot Account Capital' : 'Margin Account Capital'}
              </span>
              <div className="text-lg font-bold text-white tracking-tight">
                ${(isSpot ? spotBalance : marginBalance)?.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </div>
            </div>
            <div className="text-right">
              <span className={`text-[10px] px-2 py-0.5 rounded border font-semibold ${
                isSpot
                  ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                  : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
              }`}>
                {isSpot ? '100% Capital Per Buy' : '500x Leverage Margin'}
              </span>
            </div>
          </div>

          {/* Custom Balance Input */}
          <div>
            <label className="block text-slate-300 font-bold mb-2 uppercase tracking-wider text-[11px]">
              Set Custom Balance for {isSpot ? 'Spot' : 'Margin'} ($)
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">$</span>
              <input
                type="number"
                step="any"
                min="1"
                value={customBalance}
                onChange={(e) => setCustomBalance(e.target.value)}
                placeholder="Enter custom amount (e.g. 5, 10, 500)..."
                className="w-full pl-8 pr-4 py-2.5 bg-terminal-950 border border-terminal-border rounded-xl text-white font-mono text-sm focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          {/* Quick Increment / Decrement */}
          <div>
            <span className="block text-slate-400 text-[10px] uppercase mb-1.5">Quick Adjust</span>
            <div className="grid grid-cols-4 gap-2">
              <button
                type="button"
                onClick={() => handleQuickAdjust(-10)}
                className="py-1.5 px-2 rounded-lg bg-terminal-800 hover:bg-terminal-700 border border-terminal-border text-rose-300 flex items-center justify-center gap-1 transition-colors text-[11px]"
              >
                <Minus className="w-3 h-3" /> $10
              </button>
              <button
                type="button"
                onClick={() => handleQuickAdjust(-5)}
                className="py-1.5 px-2 rounded-lg bg-terminal-800 hover:bg-terminal-700 border border-terminal-border text-rose-300 flex items-center justify-center gap-1 transition-colors text-[11px]"
              >
                <Minus className="w-3 h-3" /> $5
              </button>
              <button
                type="button"
                onClick={() => handleQuickAdjust(5)}
                className="py-1.5 px-2 rounded-lg bg-terminal-800 hover:bg-terminal-700 border border-terminal-border text-emerald-300 flex items-center justify-center gap-1 transition-colors text-[11px]"
              >
                <Plus className="w-3 h-3" /> $5
              </button>
              <button
                type="button"
                onClick={() => handleQuickAdjust(10)}
                className="py-1.5 px-2 rounded-lg bg-terminal-800 hover:bg-terminal-700 border border-terminal-border text-emerald-300 flex items-center justify-center gap-1 transition-colors text-[11px]"
              >
                <Plus className="w-3 h-3" /> $10
              </button>
            </div>
          </div>

          {/* Amount Presets */}
          <div>
            <span className="block text-slate-400 text-[10px] uppercase mb-1.5">Preset Amounts (Micro to Standard)</span>
            <div className="flex flex-wrap gap-1.5">
              {presets.map(item => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setCustomBalance(item.value.toString())}
                  className={`px-2.5 py-1 rounded-lg border text-[11px] font-mono transition-all flex items-center gap-1 ${
                    parseFloat(customBalance) === item.value
                      ? 'bg-indigo-600 text-white border-indigo-400 font-bold shadow-md shadow-indigo-600/30'
                      : 'bg-terminal-950 text-slate-300 border-terminal-border hover:border-slate-500 hover:text-white'
                  }`}
                >
                  <span>{item.label}</span>
                  {item.tag && (
                    <span className="text-[9px] px-1 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                      {item.tag}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Close Open Positions Checkbox */}
          <label className="flex items-center space-x-2 text-slate-300 cursor-pointer pt-2 border-t border-terminal-border/60">
            <input
              type="checkbox"
              checked={closePositions}
              onChange={(e) => setClosePositions(e.target.checked)}
              className="rounded bg-terminal-950 border-terminal-border text-indigo-600 focus:ring-0 w-4 h-4 cursor-pointer"
            />
            <span className="text-[11px] font-sans text-slate-400">
              Clear & reset existing open demo positions with this balance
            </span>
          </label>

          {successMsg && (
            <div className="p-2.5 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs flex items-center gap-1.5">
              <Check className="w-4 h-4" />
              <span>{successMsg}</span>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-terminal-border bg-terminal-850 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-terminal-800 hover:bg-terminal-700 text-slate-300 text-xs transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={isSubmitting}
            className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center gap-1.5 transition-all shadow-lg shadow-indigo-600/25 disabled:opacity-50"
          >
            <Check className="w-3.5 h-3.5" />
            <span>{isSubmitting ? 'Updating...' : 'Save New Balance'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
