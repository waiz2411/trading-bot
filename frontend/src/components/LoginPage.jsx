import React, { useState } from 'react';
import { Zap, Lock, Mail, ShieldCheck, ArrowRight, CheckCircle2, AlertCircle, Coins, UserPlus, User, Phone, TrendingUp, Sparkles, Clock } from 'lucide-react';

export default function LoginPage({ onLoginSuccess }) {
  const [authMode, setAuthMode] = useState('LOGIN'); // 'LOGIN' | 'REGISTER'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [accountType, setAccountType] = useState('SPOT'); // Default to Spot or Margin
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pendingSuccess, setPendingSuccess] = useState(null);

  const handleAuth = async (e, customEmail = null, customPass = null) => {
    e?.preventDefault();
    setError('');
    setPendingSuccess(null);

    const targetEmail = customEmail || email;
    const targetPass = customPass || password;

    if (authMode === 'REGISTER' && !customEmail) {
      if (!phone || phone.trim().length < 7) {
        setError('Please enter a valid phone number (at least 7 digits).');
        return;
      }
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
        ? { email: targetEmail, password: targetPass, name, phone, accountType }
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

      if (data.pendingApproval) {
        setPendingSuccess(data.message || 'Account created! Your account is currently pending admin approval.');
        setAuthMode('LOGIN');
        setEmail(targetEmail);
        setPassword('');
        setConfirmPassword('');
        return;
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
            Autonomous Scalping & Halal Spot Platform • Enterprise SaaS
          </p>
        </div>

        {/* Auth Card */}
        <div className="bg-terminal-900/90 border border-terminal-border rounded-2xl p-6 md:p-8 backdrop-blur-xl shadow-2xl shadow-black/80 space-y-5">
          {/* Sign In vs Register Tabs */}
          <div className="flex border-b border-terminal-border/70 pb-3 gap-2">
            <button
              type="button"
              onClick={() => { setAuthMode('LOGIN'); setError(''); setPendingSuccess(null); }}
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
              onClick={() => { setAuthMode('REGISTER'); setError(''); setPendingSuccess(null); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all ${
                authMode === 'REGISTER'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Create Account</span>
            </button>
          </div>

          {/* Pending Approval Success Notice */}
          {pendingSuccess && (
            <div className="p-3.5 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-300 text-xs font-mono flex items-start gap-2.5 animate-in fade-in duration-200">
              <Clock className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
              <div>
                <p className="font-bold text-amber-200">Application Submitted for Approval</p>
                <p className="mt-0.5 text-amber-300/90 leading-relaxed">{pendingSuccess}</p>
              </div>
            </div>
          )}

          {error && (
            <div className="p-3.5 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-300 text-xs font-mono flex items-start gap-2 animate-in fade-in duration-150">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={(e) => handleAuth(e)} className="space-y-4 font-mono text-xs">
            {authMode === 'REGISTER' && (
              <>
                {/* Account Type Selection (Permanent) */}
                <div>
                  <label className="block text-slate-300 font-semibold mb-1.5 uppercase text-[11px] flex items-center justify-between">
                    <span>Account Trading Type</span>
                    <span className="text-[10px] text-amber-400 normal-case font-normal">Cannot be changed later</span>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setAccountType('SPOT')}
                      className={`p-3 rounded-xl border text-left flex flex-col gap-1 transition-all cursor-pointer ${
                        accountType === 'SPOT'
                          ? 'bg-amber-500/20 border-amber-500 text-white shadow-md shadow-amber-500/20'
                          : 'bg-terminal-950 border-terminal-border text-slate-400 hover:border-slate-600'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 font-bold text-[11px] text-amber-400">
                        <Coins className="w-3.5 h-3.5" />
                        <span>Spot Trading</span>
                      </div>
                      <span className="text-[10px] text-slate-400 leading-tight">
                        Binance 100% Halal Crypto Spot (No leverage/Riba)
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setAccountType('MARGIN')}
                      className={`p-3 rounded-xl border text-left flex flex-col gap-1 transition-all cursor-pointer ${
                        accountType === 'MARGIN'
                          ? 'bg-indigo-500/20 border-indigo-500 text-white shadow-md shadow-indigo-500/20'
                          : 'bg-terminal-950 border-terminal-border text-slate-400 hover:border-slate-600'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 font-bold text-[11px] text-indigo-400">
                        <TrendingUp className="w-3.5 h-3.5" />
                        <span>Margin Trading</span>
                      </div>
                      <span className="text-[10px] text-slate-400 leading-tight">
                        MetaTrader 5 Forex, Commodities & High Leverage
                      </span>
                    </button>
                  </div>
                </div>

                {/* Name */}
                <div>
                  <label className="block text-slate-300 font-semibold mb-1.5 uppercase text-[11px]">
                    Full Name / Organization
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

                {/* Phone */}
                <div>
                  <label className="block text-slate-300 font-semibold mb-1.5 uppercase text-[11px]">
                    Phone Number
                  </label>
                  <div className="relative">
                    <Phone className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="tel"
                      required
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+1 (555) 000-0000"
                      className="w-full pl-10 pr-4 py-2.5 bg-terminal-950 border border-terminal-border rounded-xl text-white font-mono text-xs focus:outline-none focus:border-emerald-500 transition-colors"
                    />
                  </div>
                </div>
              </>
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
                  ? 'Submit Application for Approval'
                  : 'Authorize & Sign In'}
              </span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          {/* Quick Admin Demo Login Button */}
          {authMode === 'LOGIN' && (
            <div className="pt-4 border-t border-terminal-border/60 space-y-2.5">
              <span className="block text-center text-[10px] uppercase font-mono text-slate-400 font-semibold">
                Administrator Quick Access
              </span>

              <button
                type="button"
                onClick={() => fillAndSubmit('test@gmail.com', 'testPass')}
                className="w-full p-2.5 rounded-xl bg-terminal-950 hover:bg-terminal-800 border border-terminal-border hover:border-indigo-500/50 flex items-center justify-between transition-all group cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-indigo-400" />
                  <div className="text-left">
                    <p className="font-mono text-[11px] font-bold text-indigo-300">Admin Account</p>
                    <p className="text-[10px] text-slate-400 font-mono">test@gmail.com</p>
                  </div>
                </div>
                <span className="text-[9px] px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-mono font-bold">
                  ADMIN
                </span>
              </button>
            </div>
          )}
        </div>

        {/* Security & SaaS Policy */}
        <div className="p-4 rounded-xl bg-terminal-900/60 border border-terminal-border/80 text-[11px] font-mono text-slate-400 space-y-1.5">
          <div className="flex items-center gap-1.5 text-slate-300 font-bold">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>SaaS Architecture & Approval Policy:</span>
          </div>
          <p className="text-slate-400">
            • <strong>Admin Verification:</strong> All newly registered accounts are reviewed and activated by the administrator prior to terminal access.
          </p>
          <p className="text-slate-400">
            • <strong>Account Type Locking:</strong> Spot accounts trade 100% Shariah Halal Spot pairs; Margin accounts execute institutional CFD scalps.
          </p>
        </div>
      </div>
    </div>
  );
}
