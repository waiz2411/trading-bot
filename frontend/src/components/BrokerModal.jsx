import React, { useState } from 'react';
import { X, Check, AlertCircle, RefreshCw, Eye, EyeOff, ShieldCheck, Zap, Coins, Globe, Key, Server, Cpu, Cloud, Copy, Download, KeyRound } from 'lucide-react';

export default function BrokerModal({ user, onClose, onUpdateBrokers, onBrokerUpdated, initialTab = 'BINANCE' }) {
  const isUserMargin = user?.accountType === 'MARGIN';
  const isUserSpot = user?.accountType === 'SPOT';
  const isAdmin = user?.role === 'ADMIN';

  // Strict account-type locked default tab:
  const getLockedTab = () => {
    if (isUserMargin) return 'MT5';
    if (isUserSpot) return 'BINANCE';
    return initialTab || 'BINANCE';
  };

  const [activeTab, setActiveTab] = useState(getLockedTab); // 'BINANCE' | 'MT5'

  const notifyBrokersUpdated = () => {
    if (onBrokerUpdated) onBrokerUpdated();
    if (onUpdateBrokers) onUpdateBrokers();
  };

  React.useEffect(() => {
    if (isUserMargin) {
      setActiveTab('MT5');
    } else if (isUserSpot) {
      setActiveTab('BINANCE');
    } else if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [user?.accountType, isUserMargin, isUserSpot, initialTab]);

  // Binance State
  const [binanceKey, setBinanceKey] = useState(user?.brokerConnections?.binance?.apiKey || '');
  const [binanceSecret, setBinanceSecret] = useState(user?.brokerConnections?.binance?.apiSecret || '');
  const [isTestnet, setIsTestnet] = useState(user?.brokerConnections?.binance?.isTestnet ?? true);
  const [binanceProxyUrl, setBinanceProxyUrl] = useState(user?.brokerConnections?.binance?.proxyUrl || '');
  const [showBinanceSecret, setShowBinanceSecret] = useState(false);
  const [binanceTesting, setBinanceTesting] = useState(false);
  const [binanceResult, setBinanceResult] = useState(null);
  const [serverGeo, setServerGeo] = useState(null);

  // MT5 State
  const [mt5Method, setMt5Method] = useState('METAAPI'); // 'METAAPI' | 'EA' | 'BRIDGE'
  const [mt5Login, setMt5Login] = useState(user?.brokerConnections?.mt5?.login?.toString().replace(/\*+/g, '') || '');
  const [mt5Password, setMt5Password] = useState('');
  const [mt5Server, setMt5Server] = useState(user?.brokerConnections?.mt5?.server || 'Exness-MT5Trial15');
  const [metaApiToken, setMetaApiToken] = useState(user?.brokerConnections?.mt5?.metaApiToken || '');
  const [showMetaApiToken, setShowMetaApiToken] = useState(false);
  const [showMt5Password, setShowMt5Password] = useState(false);
  const [mt5Testing, setMt5Testing] = useState(false);
  const [mt5Result, setMt5Result] = useState(null);
  const [mt5GatewayUrl, setMt5GatewayUrl] = useState('');
  const [copiedSyncKey, setCopiedSyncKey] = useState(false);
  const [copiedWebhookUrl, setCopiedWebhookUrl] = useState(false);
  const [serverIp, setServerIp] = useState('');
  const [copiedIp, setCopiedIp] = useState(false);

  // Live domain URL for WebRequest whitelist in MT5
  const liveWebhookUrl = typeof window !== 'undefined' ? window.location.origin : 'https://slategrey-reindeer-680249.hostingersite.com';

  // Fetch outbound server IP for Binance whitelisting and active MT5 gateway URL
  React.useEffect(() => {
    fetch('/api/system/ip')
      .then(r => r.json())
      .then(d => { 
        if (d.success && d.ip) {
          setServerIp(d.ip);
          setServerGeo(d);
        }
      })
      .catch(() => null);

    fetch('/api/broker/mt5/gateway-url')
      .then(r => r.json())
      .then(d => { if (d.success && d.gatewayUrl) setMt5GatewayUrl(d.gatewayUrl); })
      .catch(() => null);
  }, []);

  // Update fields when user changes
  React.useEffect(() => {
    if (user?.brokerConnections?.binance) {
      if (user.brokerConnections.binance.apiKey && !binanceKey) {
        setBinanceKey(user.brokerConnections.binance.apiKey);
      }
      if (user.brokerConnections.binance.proxyUrl && !binanceProxyUrl) {
        setBinanceProxyUrl(user.brokerConnections.binance.proxyUrl);
      }
    }
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

  const handleCopyWebhookUrl = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(liveWebhookUrl);
      setCopiedWebhookUrl(true);
      setTimeout(() => setCopiedWebhookUrl(false), 2500);
    }
  };

  const POPULAR_SERVERS = [
    'Exness-MT5Trial15',
    'Exness-MT5Trial16',
    'Exness-Trial',
    'Exness-Real',
    'Exness-Real2',
    'Exness-Real3',
    'VaultMarkets-Live',
    'ICMarketsSC-Demo',
    'Pepperstone-Edge',
    'Deriv-Demo',
    'XMGlobal-Real'
  ];

  // Handle Binance Test
  const handleTestBinance = async (e) => {
    e?.preventDefault();
    setBinanceTesting(true);
    setBinanceResult(null);

    try {
      await fetch('/api/broker/binance/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: user?.email,
          apiKey: binanceKey,
          apiSecret: binanceSecret,
          isTestnet,
          proxyUrl: binanceProxyUrl?.trim() || undefined
        })
      });

      const res = await fetch('/api/broker/binance/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: user?.email,
          apiKey: binanceKey,
          apiSecret: binanceSecret,
          isTestnet,
          proxyUrl: binanceProxyUrl?.trim() || undefined
        })
      });
      const data = await res.json();
      setBinanceResult(data);
      notifyBrokersUpdated();
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

    const targetGateway = mt5Method === 'BRIDGE' ? (mt5GatewayUrl?.trim() || undefined) : undefined;

    try {
      await fetch('/api/broker/mt5/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: user?.email,
          login: mt5Login,
          password: mt5Password,
          server: mt5Server,
          gatewayUrl: targetGateway,
          metaApiToken: metaApiToken.trim(),
          connectionType: mt5Method
        })
      });

      const res = await fetch('/api/broker/mt5/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: user?.email,
          login: mt5Login,
          password: mt5Password,
          server: mt5Server,
          gatewayUrl: targetGateway,
          metaApiToken: metaApiToken.trim(),
          connectionType: mt5Method
        })
      });
      const data = await res.json();
      setMt5Result(data);
      notifyBrokersUpdated();
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
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
              activeTab === 'SPOT' || isUserSpot
                ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-400'
                : 'bg-amber-500/20 border border-amber-500/40 text-amber-400'
            }`}>
              {activeTab === 'SPOT' || isUserSpot ? <Coins className="w-4 h-4" /> : <Zap className="w-4 h-4" />}
            </div>
            <div>
              <h2 className="text-sm font-bold font-mono text-white flex items-center gap-2">
                <span>
                  {isUserMargin ? 'MetaTrader 5 Account Connection' : isUserSpot ? 'Binance Spot Connection' : 'Live Broker & Exchange Integrations'}
                </span>
                <span className={`text-[10px] px-2 py-0.5 rounded font-mono font-semibold ${
                  isUserSpot
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                }`}>
                  {user?.name || user?.email || (isUserMargin ? 'Margin Account' : 'Spot Account')}
                </span>
              </h2>
              <p className="text-[11px] text-slate-400 font-sans">
                {isUserMargin 
                  ? 'Connect your MT5 broker account (Exness, Vault Markets, FTMO, Deriv) for automated 500x margin scalping'
                  : 'Connect your Binance Spot account for 100% capital spot trading (0x leverage)'}
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

        {/* Tab Selection Header (Only shown if user is Admin or has unrestricted account view) */}
        {(!isUserMargin && !isUserSpot) && (
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
        )}

        {/* Body Content */}
        <div className="p-6 space-y-5 font-mono text-xs overflow-y-auto flex-1">
          {/* ==================================================== */}
          {/* TAB 1: BINANCE SPOT INTEGRATION (Spot Accounts ONLY) */}
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
                        ? 'bg-emerald-600 text-white border-emerald-500 font-bold'
                        : 'bg-terminal-900 text-slate-400 border-terminal-border hover:text-white'
                    }`}
                  >
                    Live Mainnet
                  </button>
                </div>
              </div>

              {/* Binance API Key */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-slate-300 font-bold uppercase tracking-wider text-[10px]">
                    Binance {isTestnet ? 'Testnet' : 'Live'} API Key
                  </label>
                  {isTestnet && (
                    <a
                      href="https://testnet.binance.vision/"
                      target="_blank"
                      rel="noreferrer"
                      className="text-[10px] text-emerald-400 hover:underline flex items-center gap-1 font-sans font-medium"
                    >
                      <span>Get Free Testnet Keys ($10,000 Demo USDT)</span> &rarr;
                    </a>
                  )}
                </div>
                <input
                  type="text"
                  value={binanceKey}
                  onChange={(e) => setBinanceKey(e.target.value)}
                  placeholder={isTestnet ? "Paste Binance Testnet API Key from testnet.binance.vision..." : "Enter Binance API Key..."}
                  className="w-full px-3.5 py-2.5 bg-terminal-950 border border-terminal-border rounded-xl text-white font-mono text-xs focus:outline-none focus:border-emerald-500"
                />
              </div>

              {/* Binance Secret Key */}
              <div>
                <label className="block text-slate-300 font-bold mb-1.5 uppercase tracking-wider text-[10px]">
                  Binance Secret Key
                </label>
                <div className="relative">
                  <input
                    type={showBinanceSecret ? 'text' : 'password'}
                    value={binanceSecret}
                    onChange={(e) => setBinanceSecret(e.target.value)}
                    placeholder="Enter Binance Secret Key..."
                    className="w-full pl-3.5 pr-10 py-2.5 bg-terminal-950 border border-terminal-border rounded-xl text-white font-mono text-xs focus:outline-none focus:border-emerald-500"
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

              {/* Outbound IP Whitelist Helper & Server Location Detection */}
              {serverIp && (
                <div className="p-3 bg-terminal-950 rounded-xl border border-terminal-border space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Server className="w-4 h-4 text-emerald-400" />
                      <div>
                        <span className="text-[10px] text-slate-400 block uppercase font-bold">Cloud Server Outbound IP (For Whitelisting):</span>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-emerald-300 font-mono font-bold">{serverIp}</span>
                          {serverGeo?.country && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-terminal-900 border border-terminal-border text-slate-300 font-mono flex items-center gap-1">
                              <span>{serverGeo.countryCode === 'US' ? '🇺🇸' : '🌍'}</span>
                              <span>{serverGeo.country}</span>
                              {serverGeo.city && <span className="text-slate-400">({serverGeo.city})</span>}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (navigator.clipboard) {
                          navigator.clipboard.writeText(serverIp);
                          setCopiedIp(true);
                          setTimeout(() => setCopiedIp(false), 2000);
                        }
                      }}
                      className="px-2.5 py-1 rounded bg-terminal-900 border border-terminal-border text-[10px] text-slate-300 hover:text-white font-mono"
                    >
                      {copiedIp ? 'Copied!' : 'Copy IP'}
                    </button>
                  </div>
                  {(serverGeo?.isUS || serverIp === '217.196.54.11') && !isTestnet && (
                    <div className="p-2.5 rounded-lg bg-amber-950/40 border border-amber-500/30 text-[11px] text-amber-200/90 leading-relaxed">
                      ⚠️ <strong>US Server Detected:</strong> Binance Global restricts direct API traffic from US datacenters (HTTP 451). To route your real Binance account cleanly, enter a free Cloudflare Worker proxy URL below.
                    </div>
                  )}
                </div>
              )}

              {/* Cloudflare Worker / Non-US Proxy URL */}
              {!isTestnet && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-slate-300 font-bold uppercase tracking-wider text-[10px]">
                      Cloudflare Worker / Non-US Proxy URL (Optional)
                    </label>
                    <span className="text-[10px] text-emerald-400 font-mono">Bypasses US IP block</span>
                  </div>
                  <input
                    type="text"
                    value={binanceProxyUrl}
                    onChange={(e) => setBinanceProxyUrl(e.target.value)}
                    placeholder="https://binance-proxy.yourname.workers.dev (leave empty if non-US server)..."
                    className="w-full px-3.5 py-2.5 bg-terminal-950 border border-terminal-border rounded-xl text-white font-mono text-xs focus:outline-none focus:border-emerald-500"
                  />
                  <div className="flex items-center justify-between mt-1 text-[10px]">
                    <span className="text-slate-400">
                      Free Cloudflare Workers ($0 cost) or built-in European gateway.
                    </span>
                    <button
                      type="button"
                      onClick={() => setBinanceProxyUrl('https://trading-bot-test-z6bi.onrender.com/api/binance-proxy')}
                      className="text-emerald-400 hover:text-emerald-300 hover:underline font-mono font-bold flex items-center gap-1"
                    >
                      <span>⚡ Use Germany Gateway</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Action Button */}
              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={handleTestBinance}
                  disabled={binanceTesting || !binanceKey || !binanceSecret}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-2 transition-all shadow-md shadow-emerald-600/20 disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${binanceTesting ? 'animate-spin' : ''}`} />
                  <span>{binanceTesting ? 'Connecting Binance...' : 'Connect & Verify Binance Spot'}</span>
                </button>
                {binanceResult?.latencyMs && (
                  <span className="text-[11px] text-emerald-400 font-mono">
                    Ping: {binanceResult.latencyMs}ms
                  </span>
                )}
              </div>

              {/* Binance Result Output Banner */}
              {binanceResult && (
                <div className={`p-4 rounded-xl border ${
                  binanceResult.success
                    ? 'bg-emerald-950/40 border-emerald-500/50 text-emerald-200'
                    : 'bg-rose-950/40 border-rose-500/50 text-rose-200'
                }`}>
                  <div className="flex items-center gap-1.5 font-bold mb-1">
                    {binanceResult.success ? (
                      <Check className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-rose-400" />
                    )}
                    <span>{binanceResult.success ? 'Binance Spot Connected & Verified!' : 'Binance Connection Error'}</span>
                  </div>
                  {binanceResult.error && <p className="text-[11px] font-sans leading-relaxed">{binanceResult.error}</p>}
                  {binanceResult.balances && (
                    <div className="mt-2 text-[11px] font-mono border-t border-emerald-500/30 pt-2 space-y-1">
                      <span className="text-slate-300 font-bold block text-[10px] uppercase">Available Spot Assets:</span>
                      <div className="grid grid-cols-2 gap-2">
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
          {/* TAB 2: METATRADER 5 (MT5) (Margin Accounts ONLY)     */}
          {/* ==================================================== */}
          {activeTab === 'MT5' && (
            <div className="space-y-4">
              {/* MT5 Connection Mode Selector */}
              <div className="grid grid-cols-3 gap-1.5 p-1 bg-terminal-950 rounded-xl border border-terminal-border">
                <button
                  type="button"
                  onClick={() => setMt5Method('METAAPI')}
                  className={`py-2 px-2 rounded-lg text-[11px] font-bold transition-all flex items-center justify-center gap-1 cursor-pointer ${
                    mt5Method === 'METAAPI'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Cloud className="w-3.5 h-3.5" />
                  <span>⚡ MetaApi Cloud</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMt5Method('EA')}
                  className={`py-2 px-2 rounded-lg text-[11px] font-bold transition-all flex items-center justify-center gap-1 cursor-pointer ${
                    mt5Method === 'EA'
                      ? 'bg-blue-500/20 text-blue-300 border border-blue-500/50 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Cpu className="w-3.5 h-3.5" />
                  <span>🔌 Free EA Sync</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMt5Method('BRIDGE')}
                  className={`py-2 px-2 rounded-lg text-[11px] font-bold transition-all flex items-center justify-center gap-1 cursor-pointer ${
                    mt5Method === 'BRIDGE'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/50 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Server className="w-3.5 h-3.5" />
                  <span>💻 Local Bridge</span>
                </button>
              </div>

              {/* ---------------------------------------------------- */}
              {/* SUB-TAB 1: METAAPI CLOUD (100% Web - No PC Needed)   */}
              {/* ---------------------------------------------------- */}
              {mt5Method === 'METAAPI' && (
                <div className="space-y-4">
                  <div className="p-3.5 rounded-xl bg-amber-950/20 border border-amber-500/30 flex items-start gap-3">
                    <Cloud className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                    <div className="text-[11px] text-slate-300 font-sans leading-relaxed">
                      <strong>100% Web Cloud Automation (MetaApi).</strong> Runs 24/7 in the cloud without keeping your PC on.
                      Enter your MT5 Account Number, Password, and Broker Server name below.
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
                        placeholder="e.g. 472787962"
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
                        placeholder="e.g. Exness-MT5Trial16"
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

                  {/* MetaApi Token (Optional / Cloud) */}
                  <div className="p-3 bg-terminal-950 rounded-xl border border-terminal-border space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-slate-300 font-bold uppercase tracking-wider text-[10px] flex items-center gap-1.5">
                        <Key className="w-3.5 h-3.5 text-amber-400" />
                        <span>Personal MetaApi Cloud Token (Optional)</span>
                      </label>
                      <a
                        href="https://app.metaapi.cloud/token"
                        target="_blank"
                        rel="noreferrer"
                        className="text-[10px] text-amber-400 hover:underline flex items-center gap-1 font-sans"
                      >
                        <span>Get Free Token (API Access &rarr; Security Tokens)</span> &rarr;
                      </a>
                    </div>
                    <div className="relative">
                      <input
                        type={showMetaApiToken ? 'text' : 'password'}
                        value={metaApiToken}
                        onChange={(e) => setMetaApiToken(e.target.value)}
                        placeholder="Paste MetaApi token (from app.metaapi.cloud)..."
                        className="w-full pl-3.5 pr-10 py-2 bg-terminal-900 border border-terminal-border rounded-lg text-white font-mono text-xs focus:outline-none focus:border-amber-500"
                      />
                      <button
                        type="button"
                        onClick={() => setShowMetaApiToken(!showMetaApiToken)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white cursor-pointer"
                      >
                        {showMetaApiToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <p className="text-[10px] text-slate-400 font-sans">
                      Leave blank to use system cloud bridge, or paste your personal token for dedicated 24/7 cloud scaling.
                    </p>
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
                      <span>{mt5Testing ? 'Connecting MetaApi Cloud...' : 'Connect & Verify MetaApi Cloud'}</span>
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
              {/* SUB-TAB 3: LOCAL / VPS PYTHON BRIDGE                 */}
              {/* ---------------------------------------------------- */}
              {mt5Method === 'BRIDGE' && (
                <div className="space-y-4">
                  <div className="p-3.5 rounded-xl bg-emerald-950/20 border border-emerald-500/30 flex items-start gap-3">
                    <Server className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                    <div className="text-[11px] text-slate-300 font-sans leading-relaxed">
                      <strong>Dedicated Python Gateway Bridge.</strong> Connect directly to a running <code>mt5_bridge.py</code> instance on localhost or your cloud VPS.
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-slate-300 font-bold mb-1.5 uppercase tracking-wider text-[10px]">
                        MT5 Login ID
                      </label>
                      <input
                        type="text"
                        value={mt5Login}
                        onChange={(e) => setMt5Login(e.target.value)}
                        placeholder="e.g. 472787962"
                        className="w-full px-3 py-2 bg-terminal-950 border border-terminal-border rounded-xl text-white font-mono text-xs focus:outline-none focus:border-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-300 font-bold mb-1.5 uppercase tracking-wider text-[10px]">
                        Broker Server
                      </label>
                      <input
                        type="text"
                        value={mt5Server}
                        onChange={(e) => setMt5Server(e.target.value)}
                        placeholder="e.g. Exness-MT5Trial16"
                        className="w-full px-3 py-2 bg-terminal-950 border border-terminal-border rounded-xl text-white font-mono text-xs focus:outline-none focus:border-emerald-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1 font-bold uppercase">
                      Bridge Gateway URL:
                    </label>
                    <input
                      type="text"
                      value={mt5GatewayUrl}
                      onChange={(e) => setMt5GatewayUrl(e.target.value)}
                      placeholder="http://localhost:5001 or cloud VPS URL"
                      className="w-full bg-terminal-900 border border-terminal-border rounded-lg px-2.5 py-1.5 text-[11px] text-emerald-300 font-mono focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <button
                      type="button"
                      onClick={handleTestMt5}
                      disabled={mt5Testing || !mt5Login || !mt5Server}
                      className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-2 transition-all shadow-md shadow-emerald-600/20 disabled:opacity-50 cursor-pointer"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${mt5Testing ? 'animate-spin' : ''}`} />
                      <span>{mt5Testing ? 'Connecting Bridge...' : 'Connect & Verify Bridge'}</span>
                    </button>
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
                      <strong>100% Free MT5 Direct Terminal Sync.</strong> Connect your MT5 terminal (PC or VPS) directly to our cloud server using the lightweight NexusQuant Expert Advisor. Zero monthly 3rd party fees, works with Exness, Vault Markets, FTMO, Deriv, XM, IC Markets!
                    </div>
                  </div>

                  {/* Personal Sync Token */}
                  <div className="p-3.5 rounded-xl bg-terminal-950 border border-terminal-border space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider flex items-center gap-1.5">
                        <KeyRound className="w-3.5 h-3.5 text-amber-400" />
                        Your Unique Account Sync Token
                      </span>
                      <button
                        type="button"
                        onClick={handleCopySyncKey}
                        className="px-2.5 py-1 rounded-lg bg-terminal-800 hover:bg-terminal-700 text-amber-300 text-[11px] font-mono flex items-center gap-1.5 transition-colors cursor-pointer border border-terminal-border"
                      >
                        {copiedSyncKey ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                        <span>{copiedSyncKey ? 'Copied!' : 'Copy Token'}</span>
                      </button>
                    </div>
                    <div className="p-2.5 bg-terminal-900 rounded-lg border border-terminal-border/80 font-mono text-xs text-amber-300 font-bold select-all break-all">
                      {syncToken}
                    </div>
                  </div>

                  {/* WebRequest URL */}
                  <div className="p-3.5 rounded-xl bg-terminal-950 border border-terminal-border space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider flex items-center gap-1.5">
                        <Globe className="w-3.5 h-3.5 text-emerald-400" />
                        Server WebRequest Whitelist URL
                      </span>
                      <button
                        type="button"
                        onClick={handleCopyWebhookUrl}
                        className="px-2.5 py-1 rounded-lg bg-terminal-800 hover:bg-terminal-700 text-emerald-300 text-[11px] font-mono flex items-center gap-1.5 transition-colors cursor-pointer border border-terminal-border"
                      >
                        {copiedWebhookUrl ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                        <span>{copiedWebhookUrl ? 'Copied!' : 'Copy URL'}</span>
                      </button>
                    </div>
                    <div className="p-2.5 bg-terminal-900 rounded-lg border border-terminal-border/80 font-mono text-xs text-emerald-300 font-bold select-all break-all">
                      {liveWebhookUrl}
                    </div>
                  </div>

                  {/* Download EA & Instructions */}
                  <div className="p-3.5 rounded-xl bg-terminal-950 border border-terminal-border space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white flex items-center gap-1.5">
                        <Download className="w-3.5 h-3.5 text-blue-400" />
                        Expert Advisor File
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
                          In MT5: click <strong>File &rarr; Open Data Folder &rarr; MQL5 &rarr; Experts</strong> and paste <code className="text-blue-300">NexusQuant_Sync.mq5</code>.
                        </li>
                        <li>
                          In MT5: <strong>Tools &rarr; Options &rarr; Expert Advisors</strong> &rarr; Check <strong>Allow WebRequest</strong> and add:
                          <div className="mt-1 p-1.5 bg-terminal-900 rounded font-mono text-[11px] text-emerald-300 select-all block">
                            {liveWebhookUrl}
                          </div>
                        </li>
                        <li>
                          Drag <strong>NexusQuant_Sync</strong> onto any active chart (e.g. EURUSD), paste your <strong>Sync Token</strong> in inputs, make sure <strong>Algo Trading</strong> is enabled (Green), and click <strong>OK</strong>!
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
                          ? 'EA Terminal Connected & Streaming Live'
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
                    : 'bg-rose-950/40 border-rose-500/50 text-rose-200'
                }`}>
                  <div className="flex items-center gap-1.5 font-bold mb-1">
                    {mt5Result.success ? (
                      <Check className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-rose-400" />
                    )}
                    <span>{mt5Result.success ? 'MetaTrader 5 Connected & Verified!' : 'MT5 Connection Notice'}</span>
                  </div>
                  {mt5Result.error && <p className="text-[11px] font-sans leading-relaxed">{mt5Result.error}</p>}
                  
                  {/* If gateway failed, suggest EA Sync */}
                  {!mt5Result.success && (
                    <div className="mt-3 p-3 rounded-lg bg-terminal-950 border border-blue-500/40 space-y-2">
                      <div className="text-xs font-bold text-white flex items-center gap-1.5">
                        <Cpu className="w-3.5 h-3.5 text-blue-400" />
                        <span>Direct MT5 Connection (Zero Gateway/Tunnel Needed):</span>
                      </div>
                      <p className="text-[11px] text-slate-300">
                        Instead of running a local python tunnel bridge, attach our <strong>NexusQuant_Sync Expert Advisor</strong> to your MT5 terminal on your PC or VPS. It syncs balance, equity, and positions directly with zero fees.
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
                  {mt5Result.algoTradingEnabled === false && (
                    <div className="mt-3 p-2.5 rounded-lg bg-rose-950/80 border border-rose-500/50 text-rose-200 text-xs font-sans space-y-1">
                      <div className="font-bold flex items-center gap-1.5 text-rose-300">
                        <AlertCircle className="w-3.5 h-3.5" />
                        <span>Action Required in MetaTrader 5:</span>
                      </div>
                      <p>
                        "Algo Trading" is turned <strong>OFF</strong> in your MetaTrader 5 terminal window.
                        Please click the <strong>"Algo Trading"</strong> button in the top toolbar of MetaTrader 5 (or press <strong>Ctrl + E</strong>) so it turns green to allow automated bot trades to execute!
                      </p>
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
            className="px-5 py-1.5 bg-terminal-700 hover:bg-terminal-600 text-white text-xs font-mono font-bold rounded-lg transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
