import React, { useState } from 'react';
import { Zap, Lock, Mail, ShieldCheck, ArrowRight, CheckCircle2, AlertCircle, Coins, UserPlus, User, Building } from 'lucide-react';

export default function LoginPage({ onLoginSuccess }) {
  const [authMode, setAuthMode] = useState('LOGIN'); // 'LOGIN' | 'REGISTER'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleAuth = async (e, customEmail = null, customPass = null) => {
    e?.preventDefault();
    setError('');

    const targetEmail = customEmail || email;
    const targetPass = customPass || password;

    if (authMode === 'REGISTER' && !customEmail) {
      if (password !== confirmPassword) {
        setError('Passwords do not match. Please re-enter.');
        return;
      }
      if (password.length < 5) {
        setError('Password must be at least 5 characters long.');
        return;
      }
    }

    setLoading(true);

    try {
      const endpoint = (authMode === 'REGISTER' && !customEmail) ? '/api/auth/register' : '/api/auth/login';
      const body = (authMode === 'REGISTER' && !customEmail)
        ? { email: targetEmail, password: targetPass, name }
        : { email: targetEmail, password: targetPass };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Authentication failed');
      }

      onLoginSuccess(data);
    } catch (err) {
      setError(err.message || 'Authentication failed. Please check your details.');
    } finally {
      setLoading(false);
    }
  };

  const fillAndSubmit = (demoEmail, demoPass) => {
    setAuthMode('LOGIN');
    setEmail(demoEmail);
    setPassword(demoPass);
    handleAuth(null, demoEmail, demoPass);
  };

  return (
    <div className="min-h-screen bg-[#06080d] text-slate-100 flex flex-col justify-center items-center p-4 selection:bg-indigo-600 selection:text-white relative overflow-hidden">
      {/* Ambient background glows */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[550px] h-[550px] bg-gradient-to-br from-indigo-600/15 via-rose-500/10 to-amber-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-10 right-10 w-[300px] h-[300px] bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-md w-full relative z-10 space-y-6">
        {/* Branding & Logo */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-tr from-indigo-600 via-rose-500 to-amber-400 p-[1px] shadow-2xl shadow-indigo-500/30">
            <div className="w-full h-full bg-terminal-950 rounded-[15px] flex items-center justify-center">
              <Zap className="w-7 h-7 text-amber-400 animate-pulse" />
            </div>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white font-mono">
            NEXUS<span className="text-indigo-400">QUANT</span>
          </h1>
          <p className="text-xs text-slate-400 font-mono">
            Autonomous Quant Scalper & Spot Architecture • Cloud SaaS
          </p>
        </div>

        {/* Auth Card */}
        <div className="bg-terminal-900/90 border border-terminal-border rounded-2xl p-6 md:p-8 backdrop-blur-xl shadow-2xl shadow-black/80 space-y-5">
          {/* Sign In vs Register Tabs */}
          <div className="flex border-b border-terminal-border/70 pb-3 gap-2">
            <button
              type="button"
              onClick={() => { setAuthMode('LOGIN'); setError(''); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all ${
                authMode === 'LOGIN'
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Lock className="w-3.5 h-3.5" />
              <span>Sign In</span>
            </button>
            <button
              type="button"
              onClick={() => { setAuthMode('REGISTER'); setError(''); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all ${
                authMode === 'REGISTER'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Create Client Account</span>
            </button>
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-300 text-xs font-mono flex items-start gap-2 animate-in fade-in duration-150">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={(e) => handleAuth(e)} className="space-y-4 font-mono text-xs">
            {authMode === 'REGISTER' && (
              <div>
                <label className="block text-slate-300 font-semibold mb-1.5 uppercase text-[11px]">
                  Client / Organization Name
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. John Doe or Alpha Capital"
                    className="w-full pl-10 pr-4 py-2.5 bg-terminal-950 border border-terminal-border rounded-xl text-white font-mono text-xs focus:outline-none focus:border-emerald-500 transition-colors"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-slate-300 font-semibold mb-1.5 uppercase text-[11px]">
                Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  className={`w-full pl-10 pr-4 py-2.5 bg-terminal-950 border border-terminal-border rounded-xl text-white font-mono text-xs focus:outline-none transition-colors ${
                    authMode === 'REGISTER' ? 'focus:border-emerald-500' : 'focus:border-indigo-500'
                  }`}
                />
              </div>
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1.5 uppercase text-[11px]">
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className={`w-full pl-10 pr-4 py-2.5 bg-terminal-950 border border-terminal-border rounded-xl text-white font-mono text-xs focus:outline-none transition-colors ${
                    authMode === 'REGISTER' ? 'focus:border-emerald-500' : 'focus:border-indigo-500'
                  }`}
                />
              </div>
            </div>

            {authMode === 'REGISTER' && (
              <div>
                <label className="block text-slate-300 font-semibold mb-1.5 uppercase text-[11px]">
                  Confirm Password
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-10 pr-4 py-2.5 bg-terminal-950 border border-terminal-border rounded-xl text-white font-mono text-xs focus:outline-none focus:border-emerald-500 transition-colors"
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className={`w-full py-2.5 rounded-xl font-mono font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-lg disabled:opacity-50 mt-2 cursor-pointer text-white ${
                authMode === 'REGISTER'
                  ? 'bg-gradient-to-r from-emerald-600 to-teal-600 shadow-emerald-600/30'
                  : 'bg-gradient-to-r from-indigo-600 via-indigo-500 to-rose-600 shadow-indigo-600/30'
              }`}
            >
              <span>
                {loading
                  ? 'Processing...'
                  : authMode === 'REGISTER'
                  ? 'Create Client Account & Launch'
                  : 'Authorize & Launch Terminal'}
              </span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          {/* Quick Access Account Buttons (Only in Login Mode) */}
          {authMode === 'LOGIN' && (
            <div className="pt-4 border-t border-terminal-border/60 space-y-2.5">
              <span className="block text-center text-[10px] uppercase font-mono text-slate-400 font-semibold">
                Instant One-Click Login
              </span>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {/* Demo Account Button */}
                <button
                  type="button"
                  onClick={() => fillAndSubmit('demo@gmail.com', 'demoPass')}
                  className="p-2.5 rounded-xl bg-terminal-950 hover:bg-terminal-800 border border-terminal-border hover:border-amber-500/50 flex flex-col items-start gap-1 transition-all text-left group cursor-pointer"
                >
                  <div className="flex items-center justify-between w-full">
                    <div className="flex items-center gap-1.5 font-mono text-[11px] font-bold text-amber-300">
                      <Zap className="w-3.5 h-3.5 text-amber-400" />
                      <span>Demo Account</span>
                    </div>
                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 font-mono">
                      Paper
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono">
                    demo@gmail.com
                  </span>
                </button>

                {/* Live Test Account Button */}
                <button
                  type="button"
                  onClick={() => fillAndSubmit('test@gmail.com', 'testPass')}
                  className="p-2.5 rounded-xl bg-terminal-950 hover:bg-terminal-800 border border-terminal-border hover:border-emerald-500/50 flex flex-col items-start gap-1 transition-all text-left group cursor-pointer"
                >
                  <div className="flex items-center justify-between w-full">
                    <div className="flex items-center gap-1.5 font-mono text-[11px] font-bold text-emerald-300">
                      <Coins className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Main Account</span>
                    </div>
                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-mono">
                      Live Broker
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono">
                    test@gmail.com
                  </span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Security & Credentials info card */}
        <div className="p-4 rounded-xl bg-terminal-900/60 border border-terminal-border/80 text-[11px] font-mono text-slate-400 space-y-1.5">
          <div className="flex items-center gap-1.5 text-slate-300 font-bold">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Multi-Tenant SaaS Architecture:</span>
          </div>
          <p className="text-slate-400">
            • <strong>Isolated Accounts:</strong> Each client creates their own account. All Binance API keys and MetaTrader 5 broker credentials are encrypted and isolated per user.
          </p>
          <p className="text-slate-400">
            • <strong>100% Cloud-Native:</strong> Clients connect directly through their browser. No local terminal or Python installation required.
          </p>
        </div>
      </div>
    </div>
  );
}
