import React, { useState } from 'react';
import { X, Check, AlertCircle, RefreshCw, Eye, EyeOff, ShieldCheck, Zap, Coins, Globe, Key, Server, Cpu, ChevronDown, ChevronUp, Cloud, Copy, Download, KeyRound, Radio } from 'lucide-react';

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
  const [mt5Method, setMt5Method] = useState('CLOUD'); // 'CLOUD' | 'EA'
  const [mt5Login, setMt5Login] = useState(user?.brokerConnections?.mt5?.login?.replace(/\*+/g, '') || '');
  const [mt5Password, setMt5Password] = useState('');
  const [mt5Server, setMt5Server] = useState(user?.brokerConnections?.mt5?.server || 'VaultMarkets-Live');
  const [mt5Gateway, setMt5Gateway] = useState('http://localhost:5001');
  const [showMt5Password, setShowMt5Password] = useState(false);
  const [mt5Testing, setMt5Testing] = useState(false);
  const [mt5Result, setMt5Result] = useState(null);
  const [copiedSyncKey, setCopiedSyncKey] = useState(false);

  // Update MT5 fields when user changes
  React.useEffect(() => {
    if (user?.brokerConnections?.mt5) {
      if (user.brokerConnections.mt5.login && !mt5Login) {
        setMt5Login(user.brokerConnections.mt5.login.replace(/\*+/g, ''));
      }
      if (user.brokerConnections.mt5.server && !mt5Server) {
        setMt5Server(user.brokerConnections.mt5.server);
      }
    }
  }, [user]);

  const syncToken = user?.brokerConnections?.mt5?.syncToken || `NQ-SYNC-${(user?.id || 'TEST').slice(-6).toUpperCase()}`;

  const handleCopySyncKey = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(syncToken);
      setCopiedSyncKey(true);
      setTimeout(() => setCopiedSyncKey(false), 2500);
    }
  };

  const POPULAR_SERVERS = [
    'VaultMarkets-Live',
    'VaultMarkets-Demo',
    'Exness-Real',
    'ICMarketsSC-Demo',
    'Pepperstone-Edge',
    'Deriv-Demo',
    'FTMO-Server',
    'XMGlobal-Real'
  ];

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

      // Then test connection with credentials in body
      const res = await fetch('/api/broker/binance/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: user?.email,
          apiKey: binanceKey,
          apiSecret: binanceSecret,
          isTestnet
        })
      });
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
          gatewayUrl: mt5Gateway || 'http://localhost:5001'
        })
      });

      // Then test connection with credentials in body
      const res = await fetch('/api/broker/mt5/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: user?.email,
          login: mt5Login,
          password: mt5Password,
          server: mt5Server,
          gatewayUrl: mt5Gateway || 'http://localhost:5001'
        })
      });
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
                <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono font-semibold">
                  {user?.name || user?.email || 'Active Client'}
                </span>
              </h2>
              <p className="text-[11px] text-slate-400 font-sans">
                Cloud-native integrations for Binance Spot & MetaTrader 5 (100% web-based)
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
                <Cloud className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                <div className="text-[11px] text-slate-300 font-sans leading-relaxed">
                  <strong>Cloud-Native Binance Spot Execution.</strong> All crypto purchases use 100% of your available USDT balance with 0x leverage (direct coin ownership).
                  Enter your API Key & Secret with <strong>Reading</strong> and <strong>Spot Trading</strong> enabled. Zero software or downloads needed.
                </div>
              </div>

              {/* Environment Toggle: Testnet vs Live */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-terminal-950 border border-terminal-border">
                <div>
                  <span className="font-bold text-white text-xs">Trading Network</span>
                  <p className="text-[11px] text-slate-400 font-sans">
                    {isTestnet ? 'Binance Spot Testnet (Safe demo testing)' : 'Binance Live Production (Real money account)'}
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
                    placeholder="Paste your Binance API Key..."
                    className="w-full pl-10 pr-4 py-2 bg-terminal-950 border border-terminal-border rounded-xl text-white font-mono text-xs focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              {/* API Secret */}
              <div>
                <label className="block text-slate-300 font-bold mb-1.5 uppercase tracking-wider text-[10px]">
                  Binance API Secret
                </label>
                <div className="relative">
                  <input
                    type={showBinanceSecret ? 'text' : 'password'}
                    value={binanceSecret}
                    onChange={(e) => setBinanceSecret(e.target.value)}
                    placeholder="Paste your Binance API Secret..."
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
                  <span>{binanceTesting ? 'Testing Cloud Connection...' : 'Connect & Verify Binance'}</span>
                </button>
                {binanceResult?.latencyMs && (
                  <span className="text-[11px] text-emerald-400 font-mono">
                    Ping Latency: {binanceResult.latencyMs}ms
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
                      <span className="text-[10px] uppercase text-slate-400">Live Free Balances:</span>
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
              {/* MT5 Mode Selector */}
              <div className="grid grid-cols-2 gap-2 p-1 bg-terminal-950 rounded-xl border border-terminal-border">
                <button
                  type="button"
                  onClick={() => setMt5Method('CLOUD')}
                  className={`py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                    mt5Method === 'CLOUD'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Cloud className="w-3.5 h-3.5" />
                  <span>⚡ 1-Click Cloud Connect</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMt5Method('EA')}
                  className={`py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                    mt5Method === 'EA'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Cpu className="w-3.5 h-3.5" />
                  <span>🔌 Free MT5 EA Sync ($0 Fee)</span>
                </button>
              </div>

              {/* ---------------------------------------------------- */}
              {/* SUB-TAB 1: 1-CLICK CLOUD CONNECT                     */}
              {/* ---------------------------------------------------- */}
              {mt5Method === 'CLOUD' && (
                <div className="space-y-4">
                  <div className="p-3.5 rounded-xl bg-amber-950/20 border border-amber-500/30 flex items-start gap-3">
                    <Cloud className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                    <div className="text-[11px] text-slate-300 font-sans leading-relaxed">
                      <strong>Cloud MetaTrader 5 Automation.</strong> Pure cloud execution hosted by NexusQuant.
                      No software, no PC, no terminal installation required on your device. Just enter your broker credentials below.
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
                        placeholder="e.g. 8636748"
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
                        placeholder="e.g. VaultMarkets-Live"
                        className="w-full px-3 py-2 bg-terminal-950 border border-terminal-border rounded-xl text-white font-mono text-xs focus:outline-none focus:border-amber-500"
                      />
                    </div>
                  </div>

                  {/* Server Quick Suggestions */}
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase font-semibold block mb-1">
                      Popular Server Shortcuts:
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {POPULAR_SERVERS.map(srv => (
                        <button
                          key={srv}
                          type="button"
                          onClick={() => setMt5Server(srv)}
                          className={`px-2 py-0.5 rounded text-[10px] border transition-colors cursor-pointer ${
                            mt5Server === srv
                              ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 font-bold'
                              : 'bg-terminal-950 text-slate-400 border-terminal-border hover:text-slate-200'
                          }`}
                        >
                          {srv}
                        </button>
                      ))}
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
                        placeholder="Enter MT5 trading password..."
                        className="w-full pl-3.5 pr-10 py-2 bg-terminal-950 border border-terminal-border rounded-xl text-white font-mono text-xs focus:outline-none focus:border-amber-500"
                      />
                      <button
                        type="button"
                        onClick={() => setShowMt5Password(!showMt5Password)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white cursor-pointer"
                      >
                        {showMt5Password ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {/* Action Button */}
                  <div className="flex items-center justify-between pt-1">
                    <button
                      type="button"
                      onClick={handleTestMt5}
                      disabled={mt5Testing || !mt5Login || !mt5Server}
                      className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs flex items-center gap-2 transition-all shadow-md shadow-amber-600/20 disabled:opacity-50 cursor-pointer"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${mt5Testing ? 'animate-spin' : ''}`} />
                      <span>{mt5Testing ? 'Connecting MT5 Cloud...' : 'Connect & Verify MT5 Cloud'}</span>
                    </button>
                    {mt5Result?.latencyMs && (
                      <span className="text-[11px] text-amber-400 font-mono">
                        Ping: {mt5Result.latencyMs}ms
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* ---------------------------------------------------- */}
              {/* SUB-TAB 2: FREE MT5 EXPERT ADVISOR (EA) CONNECTOR   */}
              {/* ---------------------------------------------------- */}
              {mt5Method === 'EA' && (
                <div className="space-y-4">
                  <div className="p-3.5 rounded-xl bg-blue-950/20 border border-blue-500/30 flex items-start gap-3">
                    <Cpu className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
                    <div className="text-[11px] text-slate-300 font-sans leading-relaxed">
                      <strong>100% Free & Unlimited Client Scaling.</strong> Connect directly via our lightweight Expert Advisor running on your MT5 terminal (PC, Mac, or VPS). Zero monthly third-party fees, unlimited accounts, and compatible with Vault Markets, Exness, FTMO, Deriv, and any MT5 broker worldwide!
                    </div>
                  </div>

                  {/* Personal Sync Token */}
                  <div className="p-3.5 rounded-xl bg-terminal-950 border border-terminal-border space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider flex items-center gap-1.5">
                        <KeyRound className="w-3.5 h-3.5 text-amber-400" />
                        Your Unique Account Sync Key
                      </span>
                      <button
                        type="button"
                        onClick={handleCopySyncKey}
                        className="px-2.5 py-1 rounded-lg bg-terminal-800 hover:bg-terminal-700 text-amber-300 text-[11px] font-mono flex items-center gap-1.5 transition-colors cursor-pointer border border-terminal-border"
                      >
                        {copiedSyncKey ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                        <span>{copiedSyncKey ? 'Copied!' : 'Copy Key'}</span>
                      </button>
                    </div>
                    <div className="p-2.5 bg-terminal-900 rounded-lg border border-terminal-border/80 font-mono text-xs text-amber-300 font-bold select-all break-all">
                      {syncToken}
                    </div>
                    <span className="text-[10px] text-slate-500 font-sans block">
                      Paste this key into the <code>InpSyncToken</code> parameter in your MT5 Expert Advisor.
                    </span>
                  </div>

                  {/* Download EA & Instructions */}
                  <div className="p-3.5 rounded-xl bg-terminal-950 border border-terminal-border space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white flex items-center gap-1.5">
                        <Download className="w-3.5 h-3.5 text-blue-400" />
                        Download Expert Advisor File
                      </span>
                      <a
                        href="/api/broker/mt5/download-ea"
                        download="NexusQuant_Sync.mq5"
                        className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-1.5 transition-all shadow-md shadow-blue-600/20 cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Download NexusQuant_Sync.mq5</span>
                      </a>
                    </div>

                    {/* Quick 3-Step Setup Guide */}
                    <div className="border-t border-terminal-border pt-2 space-y-2 text-[11px] text-slate-300 font-sans">
                      <span className="text-[10px] text-slate-400 uppercase font-bold block">
                        Quick 60-Second Setup:
                      </span>
                      <ol className="list-decimal list-inside space-y-1.5 text-slate-300">
                        <li>
                          Open MT5 $\rightarrow$ click <strong>File $\rightarrow$ Open Data Folder $\rightarrow$ MQL5 $\rightarrow$ Experts</strong> and paste <code className="text-blue-300">NexusQuant_Sync.mq5</code>.
                        </li>
                        <li>
                          In MT5: <strong>Tools $\rightarrow$ Options $\rightarrow$ Expert Advisors</strong> $\rightarrow$ Check <strong>Allow WebRequest</strong> and add:
                          <div className="mt-1 p-1 bg-terminal-900 rounded font-mono text-[10px] text-amber-300 select-all inline-block">
                            https://trading-bot-lm51.onrender.com
                          </div>
                        </li>
                        <li>
                          Drag <strong>NexusQuant_Sync</strong> onto any chart (e.g. EURUSD), paste your <strong>Sync Key</strong> in inputs, and click <strong>OK</strong>!
                        </li>
                      </ol>
                    </div>
                  </div>

                  {/* Live Status Badge */}
                  <div className="p-3 rounded-xl bg-terminal-950 border border-terminal-border flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`w-2.5 h-2.5 rounded-full ${
                        user?.brokerConnections?.mt5?.connected || mt5Result?.connected
                          ? 'bg-emerald-500 animate-pulse'
                          : 'bg-amber-500'
                      }`} />
                      <span className="text-xs font-bold text-white">
                        {user?.brokerConnections?.mt5?.connected || mt5Result?.connected
                          ? 'EA Terminal Connected & Streaming'
                          : 'Awaiting EA Heartbeat'}
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-400 font-mono">
                      {user?.brokerConnections?.mt5?.lastChecked
                        ? `Last sync: ${new Date(user.brokerConnections.mt5.lastChecked).toLocaleTimeString()}`
                        : 'Standby'}
                    </span>
                  </div>
                </div>
              )}

              {/* MT5 Result Output Banner */}
              {mt5Result && (
                <div className={`p-4 rounded-xl border ${
                  mt5Result.success
                    ? 'bg-amber-950/40 border-amber-500/50 text-amber-200'
                    : mt5Result.isTopUpRequired
                    ? 'bg-blue-950/40 border-blue-500/50 text-blue-200'
                    : 'bg-rose-950/40 border-rose-500/50 text-rose-200'
                }`}>
                  <div className="flex items-center gap-1.5 font-bold mb-1">
                    {mt5Result.success ? (
                      <Check className="w-4 h-4 text-emerald-400" />
                    ) : mt5Result.isTopUpRequired ? (
                      <Cpu className="w-4 h-4 text-blue-400" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-rose-400" />
                    )}
                    <span>
                      {mt5Result.success
                        ? 'MetaTrader 5 Connected!'
                        : mt5Result.isTopUpRequired
                        ? 'MetaApi Live Cloud Notice: Free Alternative Available'
                        : 'Connection Status'}
                    </span>
                  </div>
                  {mt5Result.error && <p className="text-[11px] font-sans leading-relaxed">{mt5Result.error}</p>}
                  {mt5Result.isTopUpRequired && (
                    <div className="mt-3 p-3 rounded-lg bg-terminal-950 border border-blue-500/40 space-y-2">
                      <div className="text-xs font-bold text-white flex items-center gap-1.5">
                        <Zap className="w-3.5 h-3.5 text-amber-400" />
                        <span>Recommended Solution ($0 Fee):</span>
                      </div>
                      <p className="text-[11px] text-slate-300">
                        MetaApi charges monthly fees to deploy live servers in their cloud. You can bypass this completely for <strong>$0 Free</strong> by using our lightweight Expert Advisor on your MT5 terminal!
                      </p>
                      <button
                        type="button"
                        onClick={() => setMt5Method('EA')}
                        className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center gap-1.5 transition-all shadow-md shadow-blue-600/20 cursor-pointer"
                      >
                        <Cpu className="w-3.5 h-3.5" />
                        <span>Switch to Free MT5 EA Sync Tab &rarr;</span>
                      </button>
                    </div>
                  )}
                  {mt5Result.message && <p className="text-[11px] font-sans text-amber-300">{mt5Result.message}</p>}
                  {mt5Result.accountInfo && (
                    <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono border-t border-amber-500/30 pt-2">
                      <div className="bg-terminal-950 p-1.5 rounded border border-terminal-border">
                        <span className="text-slate-400 block text-[9px] uppercase">Balance</span>
                        <span className="font-bold text-white">${Number(mt5Result.accountInfo.balance || 0).toFixed(2)}</span>
                      </div>
                      <div className="bg-terminal-950 p-1.5 rounded border border-terminal-border">
                        <span className="text-slate-400 block text-[9px] uppercase">Equity</span>
                        <span className="font-bold text-emerald-400">${Number(mt5Result.accountInfo.equity || 0).toFixed(2)}</span>
                      </div>
                      <div className="bg-terminal-950 p-1.5 rounded border border-terminal-border">
                        <span className="text-slate-400 block text-[9px] uppercase">Leverage</span>
                        <span className="font-bold text-amber-300">{mt5Result.accountInfo.leverage || 500}x</span>
                      </div>
                      <div className="bg-terminal-950 p-1.5 rounded border border-terminal-border">
                        <span className="text-slate-400 block text-[9px] uppercase">Server</span>
                        <span className="font-bold text-white truncate block">{mt5Result.accountInfo.server || mt5Server}</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-terminal-850 border-t border-terminal-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-mono">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>Credentials encrypted & isolated to your account session</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-1.5 bg-terminal-700 hover:bg-terminal-600 text-white text-xs font-mono font-bold rounded-lg transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
