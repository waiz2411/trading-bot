import React, { useState } from 'react';
import { X, Check, AlertCircle, RefreshCw, Eye, EyeOff, ShieldCheck, Zap, Coins, Globe, Key, Server, Cpu } from 'lucide-react';

export default function BrokerModal({ user, onClose, onUpdateBrokers, initialTab = 'BINANCE' }) {
  const [activeTab, setActiveTab] = useState(initialTab || 'BINANCE'); // 'BINANCE' | 'MT5'

  // Update activeTab if initialTab changes
  React.useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
  }, [initialTab]);

  // Binance State
  const [binanceKey, setBinanceKey] = useState('');
  const [binanceSecret, setBinanceSecret] = useState('');
  const [isTestnet, setIsTestnet] = useState(true);
  const [showBinanceSecret, setShowBinanceSecret] = useState(false);
  const [binanceTesting, setBinanceTesting] = useState(false);
  const [binanceResult, setBinanceResult] = useState(null);

  // MT5 State
  const [mt5Login, setMt5Login] = useState('');
  const [mt5Password, setMt5Password] = useState('');
  const [mt5Server, setMt5Server] = useState('');
  const [mt5Gateway, setMt5Gateway] = useState('http://localhost:5001');
  const [showMt5Password, setShowMt5Password] = useState(false);
  const [mt5Testing, setMt5Testing] = useState(false);
  const [mt5Result, setMt5Result] = useState(null);

  // Handle Binance Test
  const handleTestBinance = async (e) => {
    e?.preventDefault();
    setBinanceTesting(true);
    setBinanceResult(null);

    try {
      // First save config
      await fetch('/api/broker/binance/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: user?.email,
          apiKey: binanceKey,
          apiSecret: binanceSecret,
          isTestnet
        })
      });

      // Then test connection
      const res = await fetch('/api/broker/binance/test', { method: 'POST' });
      const data = await res.json();
      setBinanceResult(data);
      if (onUpdateBrokers) onUpdateBrokers();
    } catch (err) {
      setBinanceResult({ success: false, error: err.message });
    } finally {
      setBinanceTesting(false);
    }
  };

  // Handle MT5 Test
  const handleTestMt5 = async (e) => {
    e?.preventDefault();
    setMt5Testing(true);
    setMt5Result(null);

    try {
      // First save config
      await fetch('/api/broker/mt5/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: user?.email,
          login: mt5Login,
          password: mt5Password,
          server: mt5Server,
          gatewayUrl: mt5Gateway
        })
      });

      // Then test connection
      const res = await fetch('/api/broker/mt5/test', { method: 'POST' });
      const data = await res.json();
      setMt5Result(data);
      if (onUpdateBrokers) onUpdateBrokers();
    } catch (err) {
      setMt5Result({ success: false, error: err.message });
    } finally {
      setMt5Testing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-terminal-900 border border-terminal-border rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="p-5 border-b border-terminal-border flex items-center justify-between bg-terminal-850 shrink-0">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
              <Globe className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold font-mono text-white flex items-center gap-2">
                <span>Live Broker & Exchange Integrations</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono">
                  Main Account
                </span>
              </h2>
              <p className="text-[11px] text-slate-400 font-sans">
                Connect your real Binance exchange & MetaTrader 5 broker for live trade execution
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

        {/* Tab Selection */}
        <div className="flex border-b border-terminal-border bg-terminal-950 px-6 pt-3 gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('BINANCE')}
            className={`flex items-center gap-2 pb-2.5 px-3 border-b-2 font-mono text-xs font-bold transition-all ${
              activeTab === 'BINANCE'
                ? 'border-emerald-400 text-emerald-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Coins className="w-4 h-4 text-emerald-400" />
            <span>Binance (Spot Trading ONLY)</span>
            <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">100% Capital</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('MT5')}
            className={`flex items-center gap-2 pb-2.5 px-3 border-b-2 font-mono text-xs font-bold transition-all ${
              activeTab === 'MT5'
                ? 'border-amber-400 text-amber-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Zap className="w-4 h-4 text-amber-400" />
            <span>MetaTrader 5 (Margin Scalp ONLY)</span>
            <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">500x Leverage</span>
          </button>
        </div>

        {/* Body Content */}
        <div className="p-6 space-y-5 font-mono text-xs overflow-y-auto flex-1">
          {/* ==================================================== */}
          {/* TAB 1: BINANCE SPOT INTEGRATION                      */}
          {/* ==================================================== */}
          {activeTab === 'BINANCE' && (
            <div className="space-y-4">
              <div className="p-3.5 rounded-xl bg-emerald-950/20 border border-emerald-500/30 flex items-start gap-3">
                <Coins className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                <div className="text-[11px] text-slate-300 font-sans leading-relaxed">
                  <strong>Binance is dedicated to Spot Trading ONLY.</strong> All crypto purchases use 100% of your current available USDT balance with 0x leverage (safe, direct asset ownership).
                  Enable <strong>Reading</strong> and <strong>Spot Trading</strong> permissions on Binance. Never enable withdrawals.
                </div>
              </div>

              {/* Environment Toggle: Testnet vs Live */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-terminal-950 border border-terminal-border">
                <div>
                  <span className="font-bold text-white text-xs">Trading Network</span>
                  <p className="text-[11px] text-slate-400 font-sans">
                    {isTestnet ? 'Binance Spot Testnet (Safe testing with testnet balances)' : 'Binance Live Production (Real money)'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsTestnet(true)}
                    className={`px-2.5 py-1 rounded text-[11px] font-mono transition-all border ${
                      isTestnet
                        ? 'bg-emerald-600 text-white border-emerald-500 font-bold'
                        : 'bg-terminal-900 text-slate-400 border-terminal-border hover:text-white'
                    }`}
                  >
                    Testnet
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsTestnet(false)}
                    className={`px-2.5 py-1 rounded text-[11px] font-mono transition-all border ${
                      !isTestnet
                        ? 'bg-rose-600 text-white border-rose-500 font-bold shadow-md shadow-rose-600/30'
                        : 'bg-terminal-900 text-slate-400 border-terminal-border hover:text-white'
                    }`}
                  >
                    Live Mainnet
                  </button>
                </div>
              </div>

              {/* API Key */}
              <div>
                <label className="block text-slate-300 font-bold mb-1.5 uppercase tracking-wider text-[10px]">
                  Binance API Key
                </label>
                <div className="relative">
                  <Key className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={binanceKey}
                    onChange={(e) => setBinanceKey(e.target.value)}
                    placeholder="Enter 64-character Binance API Key..."
                    className="w-full pl-10 pr-4 py-2 bg-terminal-950 border border-terminal-border rounded-xl text-white font-mono text-xs focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              {/* API Secret */}
              <div>
                <label className="block text-slate-300 font-bold mb-1.5 uppercase tracking-wider text-[10px]">
                  Binance Secret Key
                </label>
                <div className="relative">
                  <input
                    type={showBinanceSecret ? 'text' : 'password'}
                    value={binanceSecret}
                    onChange={(e) => setBinanceSecret(e.target.value)}
                    placeholder="Enter Binance API Secret..."
                    className="w-full pl-3.5 pr-10 py-2 bg-terminal-950 border border-terminal-border rounded-xl text-white font-mono text-xs focus:outline-none focus:border-emerald-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowBinanceSecret(!showBinanceSecret)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                  >
                    {showBinanceSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={handleTestBinance}
                  disabled={binanceTesting || !binanceKey || !binanceSecret}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-2 transition-all shadow-md shadow-emerald-600/20 disabled:opacity-50 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${binanceTesting ? 'animate-spin' : ''}`} />
                  <span>{binanceTesting ? 'Validating API...' : 'Test Connection & Ping'}</span>
                </button>
                {binanceResult?.latencyMs && (
                  <span className="text-[11px] text-emerald-400 font-mono">
                    Latency: {binanceResult.latencyMs}ms
                  </span>
                )}
              </div>

              {/* Binance Result Output */}
              {binanceResult && (
                <div className={`p-3.5 rounded-xl border ${
                  binanceResult.success
                    ? 'bg-emerald-950/40 border-emerald-500/50 text-emerald-200'
                    : 'bg-rose-950/40 border-rose-500/50 text-rose-200'
                }`}>
                  <div className="flex items-center gap-1.5 font-bold mb-1">
                    {binanceResult.success ? <Check className="w-4 h-4 text-emerald-400" /> : <AlertCircle className="w-4 h-4 text-rose-400" />}
                    <span>{binanceResult.success ? 'Binance Spot Connected!' : 'Connection Failed'}</span>
                  </div>
                  {binanceResult.error && <p className="text-[11px] font-sans">{binanceResult.error}</p>}
                  {binanceResult.balances && binanceResult.balances.length > 0 && (
                    <div className="mt-2 space-y-1 border-t border-emerald-500/30 pt-2">
                      <span className="text-[10px] uppercase text-slate-400">Live Balances:</span>
                      <div className="grid grid-cols-3 gap-1 text-[11px] font-mono">
                        {binanceResult.balances.map(b => (
                          <div key={b.asset} className="bg-terminal-950 p-1.5 rounded border border-terminal-border">
                            <span className="font-bold text-white">{b.asset}:</span> {Number(b.free).toFixed(4)}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ==================================================== */}
          {/* TAB 2: METATRADER 5 (MT5) INTEGRATION                */}
          {/* ==================================================== */}
          {activeTab === 'MT5' && (
            <div className="space-y-4">
              <div className="p-3.5 rounded-xl bg-amber-950/20 border border-amber-500/30 flex items-start gap-3">
                <Zap className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <div className="text-[11px] text-slate-300 font-sans leading-relaxed">
                  Link your <strong>MetaTrader 5 broker account</strong> for high-frequency 500x leverage margin scalping.
                  Tickets are dispatched automatically with exact SL/TP parameters.
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* MT5 Login */}
                <div>
                  <label className="block text-slate-300 font-bold mb-1.5 uppercase tracking-wider text-[10px]">
                    MT5 Account Number / Login
                  </label>
                  <input
                    type="text"
                    value={mt5Login}
                    onChange={(e) => setMt5Login(e.target.value)}
                    placeholder="e.g. 50123984"
                    className="w-full px-3 py-2 bg-terminal-950 border border-terminal-border rounded-xl text-white font-mono text-xs focus:outline-none focus:border-amber-500"
                  />
                </div>

                {/* MT5 Server */}
                <div>
                  <label className="block text-slate-300 font-bold mb-1.5 uppercase tracking-wider text-[10px]">
                    Broker Server Name
                  </label>
                  <input
                    type="text"
                    value={mt5Server}
                    onChange={(e) => setMt5Server(e.target.value)}
                    placeholder="e.g. ICMarketsSC-Demo or Exness-Real"
                    className="w-full px-3 py-2 bg-terminal-950 border border-terminal-border rounded-xl text-white font-mono text-xs focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              {/* MT5 Password */}
              <div>
                <label className="block text-slate-300 font-bold mb-1.5 uppercase tracking-wider text-[10px]">
                  Master / Trading Password
                </label>
                <div className="relative">
                  <input
                    type={showMt5Password ? 'text' : 'password'}
                    value={mt5Password}
                    onChange={(e) => setMt5Password(e.target.value)}
                    placeholder="Enter MT5 account password..."
                    className="w-full pl-3.5 pr-10 py-2 bg-terminal-950 border border-terminal-border rounded-xl text-white font-mono text-xs focus:outline-none focus:border-amber-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowMt5Password(!showMt5Password)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                  >
                    {showMt5Password ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Gateway Bridge URL */}
              <div>
                <label className="block text-slate-300 font-bold mb-1.5 uppercase tracking-wider text-[10px]">
                  MT5 Gateway Terminal Bridge URL
                </label>
                <div className="relative">
                  <Server className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={mt5Gateway}
                    onChange={(e) => setMt5Gateway(e.target.value)}
                    placeholder="http://localhost:5001"
                    className="w-full pl-10 pr-4 py-2 bg-terminal-950 border border-terminal-border rounded-xl text-white font-mono text-xs focus:outline-none focus:border-amber-500"
                  />
                </div>
                <span className="text-[10px] text-slate-500 font-sans mt-1 block">
                  Default local terminal bridge: http://localhost:5001 (or broker REST endpoint)
                </span>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={handleTestMt5}
                  disabled={mt5Testing || !mt5Login || !mt5Server}
                  className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs flex items-center gap-2 transition-all shadow-md shadow-amber-600/20 disabled:opacity-50 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${mt5Testing ? 'animate-spin' : ''}`} />
                  <span>{mt5Testing ? 'Checking MT5 Link...' : 'Test MT5 Connection'}</span>
                </button>
                {mt5Result?.latencyMs && (
                  <span className="text-[11px] text-amber-400 font-mono">
                    Latency: {mt5Result.latencyMs}ms
                  </span>
                )}
              </div>

              {/* MT5 Result Output */}
              {mt5Result && (
                <div className={`p-3.5 rounded-xl border ${
                  mt5Result.success
                    ? 'bg-emerald-950/40 border-emerald-500/50 text-emerald-200'
                    : 'bg-amber-950/40 border-amber-500/50 text-amber-200'
                }`}>
                  <div className="flex items-center gap-1.5 font-bold mb-1">
                    {mt5Result.success ? <Check className="w-4 h-4 text-emerald-400" /> : <AlertCircle className="w-4 h-4 text-amber-400" />}
                    <span>{mt5Result.success ? 'MT5 Account Verified!' : 'Connection Status'}</span>
                  </div>
                  {mt5Result.message && <p className="text-[11px] font-sans">{mt5Result.message}</p>}
                  {mt5Result.error && <p className="text-[11px] font-sans">{mt5Result.error}</p>}
                  {mt5Result.accountInfo && (
                    <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] font-mono border-t border-amber-500/30 pt-2">
                      <div><span className="text-slate-400">Server:</span> {mt5Result.accountInfo.server}</div>
                      <div><span className="text-slate-400">Leverage:</span> {mt5Result.accountInfo.leverage}x</div>
                      <div><span className="text-slate-400">Balance:</span> ${Number(mt5Result.accountInfo.balance).toFixed(2)}</div>
                      <div><span className="text-slate-400">Free Margin:</span> ${Number(mt5Result.accountInfo.freeMargin).toFixed(2)}</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-terminal-border bg-terminal-850 flex items-center justify-between shrink-0">
          <span className="text-[11px] text-slate-400 font-sans">
            Credentials are encrypted and kept local to your active session.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-terminal-800 hover:bg-terminal-700 text-slate-200 font-bold text-xs transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
