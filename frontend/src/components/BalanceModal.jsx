import React, { useState } from 'react';
import { X, DollarSign, Wallet, Plus, Minus, Check, AlertCircle } from 'lucide-react';

export default function BalanceModal({ currentBalance, onUpdateBalance, onAdjustBalance, onClose }) {
  const [customBalance, setCustomBalance] = useState(currentBalance?.toString() || '10000');
  const [closePositions, setClosePositions] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  const presets = [500, 1000, 5000, 10000, 25000, 50000, 100000];

  const handleApply = async (e) => {
    e?.preventDefault();
    const val = parseFloat(customBalance);
    if (isNaN(val) || val <= 0) return;

    setIsSubmitting(true);
    await onUpdateBalance(val, closePositions);
    setIsSubmitting(false);
    setSuccessMsg(`Balance updated to $${val.toLocaleString('en-US')}`);
    setTimeout(() => {
      setSuccessMsg('');
      onClose();
    }, 900);
  };

  const handleQuickAdjust = async (delta) => {
    setIsSubmitting(true);
    await onAdjustBalance(delta);
    setIsSubmitting(false);
    const newBal = Math.max(10, (parseFloat(customBalance) || 0) + delta);
    setCustomBalance(newBal.toString());
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-terminal-900 border border-terminal-border rounded-2xl w-full max-w-md overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        {/* Modal Header */}
        <div className="p-5 border-b border-terminal-border flex items-center justify-between bg-terminal-850">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
              <Wallet className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold font-mono text-white">Edit Demo Account Balance</h2>
              <p className="text-[11px] text-slate-400 font-sans">Set custom simulated capital for scalping</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-terminal-800 hover:bg-terminal-700 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5 font-mono text-xs">
          {/* Current Balance Display */}
          <div className="p-3.5 rounded-xl bg-terminal-950 border border-terminal-border flex items-center justify-between">
            <div>
              <span className="text-slate-500 text-[10px] uppercase">Active Capital</span>
              <div className="text-lg font-bold text-white tracking-tight">
                ${currentBalance?.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </div>
            </div>
            <div className="text-right">
              <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                Simulated USD
              </span>
            </div>
          </div>

          {/* Custom Balance Input */}
          <div>
            <label className="block text-slate-300 font-bold mb-2 uppercase tracking-wider text-[11px]">
              Set Custom Balance ($)
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">$</span>
              <input
                type="number"
                step="any"
                min="10"
                value={customBalance}
                onChange={(e) => setCustomBalance(e.target.value)}
                placeholder="Enter custom amount..."
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
                onClick={() => handleQuickAdjust(-1000)}
                className="py-1.5 px-2 rounded-lg bg-terminal-800 hover:bg-terminal-700 border border-terminal-border text-rose-300 flex items-center justify-center gap-1 transition-colors text-[11px]"
              >
                <Minus className="w-3 h-3" /> $1,000
              </button>
              <button
                type="button"
                onClick={() => handleQuickAdjust(-500)}
                className="py-1.5 px-2 rounded-lg bg-terminal-800 hover:bg-terminal-700 border border-terminal-border text-rose-300 flex items-center justify-center gap-1 transition-colors text-[11px]"
              >
                <Minus className="w-3 h-3" /> $500
              </button>
              <button
                type="button"
                onClick={() => handleQuickAdjust(500)}
                className="py-1.5 px-2 rounded-lg bg-terminal-800 hover:bg-terminal-700 border border-terminal-border text-emerald-300 flex items-center justify-center gap-1 transition-colors text-[11px]"
              >
                <Plus className="w-3 h-3" /> $500
              </button>
              <button
                type="button"
                onClick={() => handleQuickAdjust(1000)}
                className="py-1.5 px-2 rounded-lg bg-terminal-800 hover:bg-terminal-700 border border-terminal-border text-emerald-300 flex items-center justify-center gap-1 transition-colors text-[11px]"
              >
                <Plus className="w-3 h-3" /> $1,000
              </button>
            </div>
          </div>

          {/* Amount Presets */}
          <div>
            <span className="block text-slate-400 text-[10px] uppercase mb-1.5">Standard Presets</span>
            <div className="flex flex-wrap gap-1.5">
              {presets.map(amt => (
                <button
                  key={amt}
                  type="button"
                  onClick={() => setCustomBalance(amt.toString())}
                  className={`px-2.5 py-1 rounded-lg border text-[11px] transition-all ${
                    parseFloat(customBalance) === amt
                      ? 'bg-indigo-600 text-white border-indigo-500 font-bold'
                      : 'bg-terminal-950 text-slate-300 border-terminal-border hover:border-slate-500'
                  }`}
                >
                  ${amt >= 1000 ? `${amt / 1000}k` : amt}
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
