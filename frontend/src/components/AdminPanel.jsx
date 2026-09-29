import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  Users,
  CheckCircle2,
  AlertTriangle,
  Trash2,
  Search,
  RefreshCw,
  Phone,
  Mail,
  Coins,
  TrendingUp,
  Clock,
  UserCheck,
  Activity,
  LogOut,
  Sliders,
  DollarSign,
  ArrowUpRight,
  ArrowDownRight,
  ExternalLink,
  Eye,
  X,
  Server,
  Radio,
  Check,
  BarChart3,
  Flame,
  Shield,
  Layers
} from 'lucide-react';

export default function AdminPanel({ user, token, onLogout, showNotification }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL'); // 'ALL' | 'PENDING' | 'ACTIVE' | 'SUSPENDED'
  const [accountFilter, setAccountFilter] = useState('ALL'); // 'ALL' | 'MARGIN' | 'SPOT'
  const [actionLoading, setActionLoading] = useState({});

  // Client Progress & Trades Inspector Modal state
  const [inspectingUser, setInspectingUser] = useState(null);
  const [userTrades, setUserTrades] = useState([]);
  const [tradesLoading, setTradesLoading] = useState(false);

  const fetchUsers = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch('/api/admin/users', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Failed to fetch user list from MySQL');
      const data = await res.json();
      if (data.success && Array.isArray(data.users)) {
        setUsers(data.users);
      }
    } catch (err) {
      if (showNotification) showNotification(err.message, 'ERROR');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
    // Auto-refresh every 10 seconds to track live client progresses
    const timer = setInterval(fetchUsers, 10000);
    return () => clearInterval(timer);
  }, [token]);

  const handleStatusChange = async (userId, newStatus, userEmail) => {
    setActionLoading(prev => ({ ...prev, [userId]: true }));
    try {
      const res = await fetch('/api/admin/users/status', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ userId, status: newStatus })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to update status');

      if (showNotification) {
        showNotification(`User ${userEmail} status updated to ${newStatus}`, 'SUCCESS');
      }
      await fetchUsers();
      if (inspectingUser && inspectingUser.id === userId) {
        setInspectingUser(prev => prev ? { ...prev, status: newStatus } : null);
      }
    } catch (err) {
      if (showNotification) showNotification(err.message, 'ERROR');
    } finally {
      setActionLoading(prev => ({ ...prev, [userId]: false }));
    }
  };

  const handleDeleteUser = async (userId, userEmail) => {
    if (!window.confirm(`Are you sure you want to permanently delete account ${userEmail}? This action cannot be undone.`)) return;

    setActionLoading(prev => ({ ...prev, [userId]: true }));
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to delete user');

      if (showNotification) {
        showNotification(`User ${userEmail} deleted successfully`, 'INFO');
      }
      if (inspectingUser && inspectingUser.id === userId) {
        setInspectingUser(null);
      }
      await fetchUsers();
    } catch (err) {
      if (showNotification) showNotification(err.message, 'ERROR');
    } finally {
      setActionLoading(prev => ({ ...prev, [userId]: false }));
    }
  };

  const openProgressInspector = async (targetUser) => {
    setInspectingUser(targetUser);
    setTradesLoading(true);
    setUserTrades([]);
    try {
      const res = await fetch(`/api/admin/users/${targetUser.id}/trades`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success && Array.isArray(data.trades)) {
        setUserTrades(data.trades);
      }
    } catch (err) {
      if (showNotification) showNotification('Failed to fetch user trade history', 'WARN');
    } finally {
      setTradesLoading(false);
    }
  };

  const filteredUsers = users.filter(u => {
    const matchesSearch =
      (u.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (u.email || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (u.phone || '').includes(searchTerm);

    const matchesStatus = statusFilter === 'ALL' || u.status === statusFilter;
    const matchesAccount = accountFilter === 'ALL' || (u.account_type || u.accountType) === accountFilter;
    return matchesSearch && matchesStatus && matchesAccount;
  });

  const totalUsers = users.length;
  const pendingUsers = users.filter(u => u.status === 'PENDING');
  const pendingCount = pendingUsers.length;
  const activeCount = users.filter(u => u.status === 'ACTIVE').length;
  const suspendedCount = users.filter(u => u.status === 'SUSPENDED').length;
  const spotCount = users.filter(u => (u.account_type || u.accountType) === 'SPOT').length;
  const marginCount = users.filter(u => (u.account_type || u.accountType) === 'MARGIN').length;

  const totalPlatformTrades = users.reduce((acc, u) => acc + (u.stats?.totalTrades || 0), 0);
  const totalRealizedPnL = users.reduce((acc, u) => acc + (u.stats?.totalRealizedPnL || 0), 0);

  return (
    <div className="min-h-screen bg-[#07090e] text-slate-100 font-sans flex flex-col antialiased selection:bg-indigo-500 selection:text-white">
      {/* Top SaaS Admin Navigation Bar */}
      <header className="border-b border-terminal-border/80 bg-terminal-950/90 backdrop-blur sticky top-0 z-40 px-4 lg:px-8 py-3.5 flex flex-wrap items-center justify-between gap-4">
        {/* Brand & Admin Badge */}
        <div className="flex items-center gap-3.5">
          <div className="p-2 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-lg shadow-indigo-500/20">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold tracking-wider text-base text-white">NEXUS<span className="text-indigo-400">QUANT</span></span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 uppercase tracking-wider">
                SAAS ADMIN PORTAL
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-mono flex items-center gap-1.5 mt-0.5">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              Hostinger MariaDB / MySQL Persistent Database
            </p>
          </div>
        </div>

        {/* Global Controls & Admin Profile */}
        <div className="flex items-center gap-3">
          <button
            onClick={fetchUsers}
            disabled={loading}
            className="px-3 py-1.5 rounded-lg bg-terminal-800 hover:bg-terminal-700 text-slate-300 hover:text-white text-xs font-mono flex items-center gap-2 transition-all border border-terminal-border cursor-pointer disabled:opacity-50"
            title="Refresh Users & Progress"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-indigo-400' : ''}`} />
            <span>Refresh</span>
          </button>

          <div className="h-6 w-px bg-terminal-border"></div>

          {/* Admin Identity Card */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-terminal-900 border border-terminal-border text-xs font-mono">
            <div className="w-2 h-2 rounded-full bg-indigo-400"></div>
            <span className="font-semibold text-slate-200">{user?.name || 'Administrator'}</span>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-500/30 text-indigo-200 font-bold">
              SUPERADMIN
            </span>
          </div>

          {/* Logout Button */}
          <button
            onClick={onLogout}
            className="p-2 rounded-lg bg-terminal-900 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 border border-terminal-border transition-all cursor-pointer"
            title="Sign Out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main SaaS Administration Dashboard */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
        {/* Pending Approvals Alert Banner (if any pending) */}
        {pendingCount > 0 && (
          <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-lg shadow-amber-500/5 animate-pulse">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-amber-500/20 text-amber-300">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-amber-200">
                  {pendingCount} Pending Account Application{pendingCount > 1 ? 's' : ''} Awaiting Approval
                </h3>
                <p className="text-xs text-amber-300/80 font-mono mt-0.5">
                  New clients cannot log in until you approve their registrations.
                </p>
              </div>
            </div>
            <button
              onClick={() => setStatusFilter('PENDING')}
              className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs transition-all shadow-md shadow-amber-500/20 cursor-pointer self-start sm:self-auto"
            >
              Review Pending Applications ({pendingCount})
            </button>
          </div>
        )}

        {/* Top Executive Stats Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="p-4 rounded-2xl bg-terminal-900/90 border border-terminal-border/80 shadow-lg">
            <div className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-xs uppercase font-mono font-semibold">Total Accounts</span>
              <Users className="w-4 h-4 text-indigo-400" />
            </div>
            <div className="text-2xl font-bold font-mono text-white">{totalUsers}</div>
            <div className="text-[11px] text-slate-400 font-mono mt-1">
              Registered SaaS Clients
            </div>
          </div>

          <div className={`p-4 rounded-2xl border shadow-lg transition-all ${pendingCount > 0 ? 'bg-amber-500/10 border-amber-500/40 shadow-amber-500/10' : 'bg-terminal-900/90 border-terminal-border/80'}`}>
            <div className="flex items-center justify-between mb-2">
              <span className={`text-xs uppercase font-mono font-semibold ${pendingCount > 0 ? 'text-amber-400 font-bold' : 'text-slate-400'}`}>
                Pending Approval
              </span>
              <Clock className={`w-4 h-4 ${pendingCount > 0 ? 'text-amber-400' : 'text-slate-500'}`} />
            </div>
            <div className={`text-2xl font-bold font-mono ${pendingCount > 0 ? 'text-amber-300' : 'text-slate-200'}`}>
              {pendingCount}
            </div>
            <div className="text-[11px] text-slate-400 font-mono mt-1">
              Requires Admin Action
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-terminal-900/90 border border-terminal-border/80 shadow-lg">
            <div className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-xs uppercase font-mono font-semibold">Active Clients</span>
              <UserCheck className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-2xl font-bold font-mono text-emerald-400">{activeCount}</div>
            <div className="text-[11px] text-slate-400 font-mono mt-1">
              Approved & Trading
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-terminal-900/90 border border-terminal-border/80 shadow-lg">
            <div className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-xs uppercase font-mono font-semibold">Account Types</span>
              <Coins className="w-4 h-4 text-amber-400" />
            </div>
            <div className="text-sm font-bold font-mono text-white mt-1 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-amber-300">🕌 Spot (Binance):</span>
                <span className="text-slate-200">{spotCount}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-indigo-300">⚡ Margin (MT5):</span>
                <span className="text-slate-200">{marginCount}</span>
              </div>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-terminal-900/90 border border-terminal-border/80 shadow-lg">
            <div className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-xs uppercase font-mono font-semibold">Platform Volume</span>
              <Activity className="w-4 h-4 text-purple-400" />
            </div>
            <div className="text-2xl font-bold font-mono text-purple-300">{totalPlatformTrades}</div>
            <div className="text-[11px] text-slate-400 font-mono mt-1">
              Total Client Trades Executed
            </div>
          </div>
        </div>

        {/* Filter & Search Bar */}
        <div className="p-4 rounded-2xl bg-terminal-900/80 border border-terminal-border flex flex-col md:flex-row gap-4 items-center justify-between">
          {/* Search */}
          <div className="relative w-full md:w-80">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by client name, email, phone..."
              className="w-full pl-9 pr-3 py-2 bg-terminal-950 border border-terminal-border rounded-xl text-slate-200 text-xs font-mono focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Status & Type Filter Pills */}
          <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
            <div className="flex items-center bg-terminal-950 p-1 rounded-xl border border-terminal-border">
              {['ALL', 'PENDING', 'ACTIVE', 'SUSPENDED'].map((st) => (
                <button
                  key={st}
                  onClick={() => setStatusFilter(st)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer ${
                    statusFilter === st
                      ? st === 'PENDING'
                        ? 'bg-amber-500 text-black shadow'
                        : st === 'ACTIVE'
                        ? 'bg-emerald-600 text-white shadow'
                        : 'bg-indigo-600 text-white shadow'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {st} {st === 'PENDING' && pendingCount > 0 ? `(${pendingCount})` : ''}
                </button>
              ))}
            </div>

            <div className="flex items-center bg-terminal-950 p-1 rounded-xl border border-terminal-border">
              {['ALL', 'MARGIN', 'SPOT'].map((acc) => (
                <button
                  key={acc}
                  onClick={() => setAccountFilter(acc)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer ${
                    accountFilter === acc
                      ? 'bg-terminal-800 text-indigo-300 border border-indigo-500/30'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {acc === 'ALL' ? 'All Types' : acc === 'SPOT' ? '🕌 Spot' : '⚡ Margin'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Client Management & Progress Grid */}
        <div className="rounded-2xl bg-terminal-900/90 border border-terminal-border overflow-hidden shadow-2xl">
          <div className="p-4 border-b border-terminal-border/80 bg-terminal-950/60 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-indigo-400" />
              <h2 className="text-sm font-bold text-white font-mono tracking-wide">
                CLIENT ACCOUNTS & TRADING PROGRESS ({filteredUsers.length})
              </h2>
            </div>
            <span className="text-xs text-slate-400 font-mono">
              Auto-syncs with MySQL
            </span>
          </div>

          {loading ? (
            <div className="py-20 text-center text-slate-500 font-mono space-y-3">
              <RefreshCw className="w-8 h-8 animate-spin mx-auto text-indigo-400" />
              <p className="text-sm">Fetching user accounts and live trade progress...</p>
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="py-20 text-center text-slate-500 font-mono space-y-2">
              <p className="text-slate-300 text-sm font-semibold">No client accounts found matching criteria</p>
              <p className="text-xs">Adjust search query or filter tags.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse font-mono text-xs">
                <thead>
                  <tr className="border-b border-terminal-border text-slate-400 uppercase text-[11px] bg-terminal-950/80">
                    <th className="p-4">Client / Contact</th>
                    <th className="p-4">Account Type</th>
                    <th className="p-4">Live Telemetry & Mode</th>
                    <th className="p-4">Trading Progress</th>
                    <th className="p-4">Status</th>
                    <th className="p-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-terminal-border/40">
                  {filteredUsers.map((u) => {
                    const isBusy = actionLoading[u.id];
                    const isSpot = (u.account_type || u.accountType) === 'SPOT';
                    const isLiveMode = (u.active_mode || u.mode) === 'LIVE';
                    const isAutoTrading = Boolean(u.is_auto_trading || u.isAutoTradingEnabled);
                    const brokerInfo = u.brokerConnections || {};
                    const relevantBroker = isSpot ? brokerInfo.binance : brokerInfo.mt5;
                    const isBrokerConnected = Boolean(relevantBroker?.connected);

                    const stats = u.stats || {
                      totalTrades: 0,
                      closedTrades: 0,
                      winTrades: 0,
                      winRate: 0,
                      totalRealizedPnL: 0
                    };

                    return (
                      <tr key={u.id} className="hover:bg-terminal-800/30 transition-colors">
                        {/* User Contact */}
                        <td className="p-4">
                          <div className="flex flex-col">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-white text-sm">{u.name || 'Unnamed Client'}</span>
                              {u.role === 'ADMIN' && (
                                <span className="text-[9px] px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-bold border border-indigo-500/40">
                                  ADMIN
                                </span>
                              )}
                            </div>
                            <span className="text-slate-400 flex items-center gap-1.5 mt-1 text-xs">
                              <Mail className="w-3.5 h-3.5 text-slate-500" /> {u.email}
                            </span>
                            {u.phone ? (
                              <span className="text-slate-400 flex items-center gap-1.5 mt-0.5 text-xs font-semibold">
                                <Phone className="w-3.5 h-3.5 text-emerald-400" /> {u.phone}
                              </span>
                            ) : (
                              <span className="text-slate-600 text-[11px] mt-0.5">No phone provided</span>
                            )}
                            <span className="text-[10px] text-slate-500 mt-1">
                              Joined: {u.created_at ? new Date(u.created_at).toLocaleDateString() : 'N/A'}
                            </span>
                          </div>
                        </td>

                        {/* Account Type */}
                        <td className="p-4">
                          {isSpot ? (
                            <div className="space-y-1">
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-300 font-bold text-xs">
                                <Coins className="w-3.5 h-3.5" />
                                <span>Pure Spot Halal</span>
                              </span>
                              <p className="text-[10px] text-slate-400">Binance 100% Cash</p>
                            </div>
                          ) : (
                            <div className="space-y-1">
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 font-bold text-xs">
                                <TrendingUp className="w-3.5 h-3.5" />
                                <span>Margin Scalper</span>
                              </span>
                              <p className="text-[10px] text-slate-400">Exness MT5 (500x)</p>
                            </div>
                          )}
                        </td>

                        {/* Telemetry & Mode */}
                        <td className="p-4">
                          <div className="space-y-1.5">
                            {/* Mode pill */}
                            <div>
                              {isLiveMode ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-500/20 text-rose-300 border border-rose-500/30 text-[11px] font-bold">
                                  <Radio className="w-3 h-3 text-rose-400 animate-pulse" />
                                  <span>REAL BROKER</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[11px] font-bold">
                                  <Activity className="w-3 h-3 text-emerald-400" />
                                  <span>DEMO PAPER</span>
                                </span>
                              )}
                            </div>

                            {/* Broker Status */}
                            <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
                              <Server className="w-3 h-3 text-slate-500" />
                              <span>{isSpot ? 'Binance API' : 'MT5 Broker'}: </span>
                              <span className={`font-bold ${isBrokerConnected ? 'text-emerald-400' : 'text-slate-500'}`}>
                                {isBrokerConnected ? 'Connected' : 'Offline'}
                              </span>
                            </div>

                            {/* Bot State */}
                            <div className="text-[11px] flex items-center gap-1.5">
                              <span className={`w-2 h-2 rounded-full ${isAutoTrading ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`}></span>
                              <span className={isAutoTrading ? 'text-emerald-300 font-semibold' : 'text-slate-500'}>
                                {isAutoTrading ? 'Bot 24/7 Active' : 'Bot Paused'}
                              </span>
                            </div>
                          </div>
                        </td>

                        {/* Trading Progress */}
                        <td className="p-4">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-slate-400 text-xs">Realized PnL:</span>
                              <span className={`text-xs font-bold ${stats.totalRealizedPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {stats.totalRealizedPnL >= 0 ? '+' : ''}${stats.totalRealizedPnL.toFixed(2)}
                              </span>
                            </div>

                            <div className="flex items-center gap-2 text-xs">
                              <span className="text-slate-400">Total Trades:</span>
                              <span className="text-slate-200 font-semibold">{stats.totalTrades}</span>
                              <span className="text-slate-500">({stats.winTrades}W / {stats.lossTrades}L)</span>
                            </div>

                            <div className="flex items-center gap-2 text-xs">
                              <span className="text-slate-400">Win Rate:</span>
                              <span className={`font-bold ${stats.winRate >= 60 ? 'text-emerald-400' : stats.winRate > 0 ? 'text-amber-400' : 'text-slate-500'}`}>
                                {stats.winRate}%
                              </span>
                            </div>
                          </div>
                        </td>

                        {/* Status */}
                        <td className="p-4">
                          {u.status === 'PENDING' && (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold text-xs animate-pulse">
                              <Clock className="w-3.5 h-3.5" />
                              <span>PENDING</span>
                            </span>
                          )}
                          {u.status === 'ACTIVE' && (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold text-xs">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>ACTIVE</span>
                            </span>
                          )}
                          {u.status === 'SUSPENDED' && (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/30 font-bold text-xs">
                              <AlertTriangle className="w-3.5 h-3.5" />
                              <span>SUSPENDED</span>
                            </span>
                          )}
                        </td>

                        {/* Action Buttons */}
                        <td className="p-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {/* Approve button for Pending */}
                            {u.status === 'PENDING' && (
                              <button
                                onClick={() => handleStatusChange(u.id, 'ACTIVE', u.email)}
                                disabled={isBusy}
                                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 transition-all shadow-md shadow-emerald-600/30 cursor-pointer disabled:opacity-50"
                              >
                                <Check className="w-4 h-4" />
                                <span>Approve</span>
                              </button>
                            )}

                            {/* View Progress / Trades Inspector */}
                            <button
                              onClick={() => openProgressInspector(u)}
                              className="px-2.5 py-1.5 rounded-lg bg-terminal-800 hover:bg-indigo-600/30 text-indigo-300 hover:text-indigo-200 border border-indigo-500/30 font-semibold text-xs flex items-center gap-1.5 transition-all cursor-pointer"
                              title="Inspect Full Trade Progress"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>Track Progress</span>
                            </button>

                            {/* Suspend / Activate toggle */}
                            {u.status === 'ACTIVE' && u.role !== 'ADMIN' && (
                              <button
                                onClick={() => handleStatusChange(u.id, 'SUSPENDED', u.email)}
                                disabled={isBusy}
                                className="px-2.5 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 font-semibold text-xs transition-all cursor-pointer disabled:opacity-50"
                              >
                                Suspend
                              </button>
                            )}

                            {u.status === 'SUSPENDED' && (
                              <button
                                onClick={() => handleStatusChange(u.id, 'ACTIVE', u.email)}
                                disabled={isBusy}
                                className="px-2.5 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 font-semibold text-xs transition-all cursor-pointer disabled:opacity-50"
                              >
                                Activate
                              </button>
                            )}

                            {/* Delete User */}
                            {u.role !== 'ADMIN' && (
                              <button
                                onClick={() => handleDeleteUser(u.id, u.email)}
                                disabled={isBusy}
                                className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/25 text-rose-400 border border-rose-500/20 transition-all cursor-pointer disabled:opacity-50"
                                title="Delete Account"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {/* Deep Client Progress & Trade History Inspector Modal */}
      {inspectingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-terminal-900 border border-terminal-border rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden font-mono text-xs">
            {/* Modal Header */}
            <div className="p-5 border-b border-terminal-border bg-terminal-950/80 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                  <BarChart3 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white tracking-wide flex items-center gap-2">
                    <span>Client Progress: {inspectingUser.name || inspectingUser.email}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-terminal-800 text-slate-300 border border-terminal-border">
                      {inspectingUser.account_type || inspectingUser.accountType} ACCOUNT
                    </span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {inspectingUser.email} {inspectingUser.phone ? `• ${inspectingUser.phone}` : ''}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setInspectingUser(null)}
                className="p-2 rounded-lg bg-terminal-800 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Client Telemetry Summary */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 bg-terminal-950/40 border-b border-terminal-border/60">
              <div className="p-3 rounded-xl bg-terminal-950 border border-terminal-border">
                <span className="text-[10px] text-slate-400 uppercase font-semibold">Account Status</span>
                <p className={`text-sm font-bold mt-1 ${inspectingUser.status === 'ACTIVE' ? 'text-emerald-400' : inspectingUser.status === 'PENDING' ? 'text-amber-400' : 'text-rose-400'}`}>
                  {inspectingUser.status}
                </p>
              </div>

              <div className="p-3 rounded-xl bg-terminal-950 border border-terminal-border">
                <span className="text-[10px] text-slate-400 uppercase font-semibold">Trading Mode</span>
                <p className={`text-sm font-bold mt-1 ${inspectingUser.active_mode === 'LIVE' ? 'text-rose-400' : 'text-emerald-400'}`}>
                  {inspectingUser.active_mode === 'LIVE' ? '🔴 REAL BROKER' : '🟢 PAPER DEMO'}
                </p>
              </div>

              <div className="p-3 rounded-xl bg-terminal-950 border border-terminal-border">
                <span className="text-[10px] text-slate-400 uppercase font-semibold">Total Realized PnL</span>
                <p className={`text-sm font-bold mt-1 ${(inspectingUser.stats?.totalRealizedPnL || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {(inspectingUser.stats?.totalRealizedPnL || 0) >= 0 ? '+' : ''}${Number(inspectingUser.stats?.totalRealizedPnL || 0).toFixed(2)}
                </p>
              </div>

              <div className="p-3 rounded-xl bg-terminal-950 border border-terminal-border">
                <span className="text-[10px] text-slate-400 uppercase font-semibold">Win Rate / Trades</span>
                <p className="text-sm font-bold mt-1 text-slate-200">
                  {inspectingUser.stats?.winRate || 0}% ({inspectingUser.stats?.totalTrades || 0} trades)
                </p>
              </div>
            </div>

            {/* Trade History Ledger for this Client */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Activity className="w-4 h-4 text-indigo-400" />
                  <span>Executed Trade Ledger</span>
                </h4>
                <span className="text-[11px] text-slate-400 font-mono">
                  {userTrades.length} Trade{userTrades.length === 1 ? '' : 's'} Logged
                </span>
              </div>

              {tradesLoading ? (
                <div className="py-12 text-center text-slate-500 font-mono space-y-2">
                  <RefreshCw className="w-6 h-6 animate-spin mx-auto text-indigo-400" />
                  <p>Loading client trade history...</p>
                </div>
              ) : userTrades.length === 0 ? (
                <div className="py-12 text-center text-slate-500 font-mono bg-terminal-950/40 rounded-xl border border-terminal-border/50">
                  <p className="text-slate-300 font-semibold">No trade records yet for this client</p>
                  <p className="text-[11px] text-slate-500 mt-1">Trades executed in Demo or Live broker mode will appear here.</p>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-terminal-border">
                  <table className="w-full text-left border-collapse font-mono text-xs">
                    <thead>
                      <tr className="border-b border-terminal-border text-slate-400 uppercase text-[10px] bg-terminal-950/80">
                        <th className="p-3">Symbol / Side</th>
                        <th className="p-3">Mode</th>
                        <th className="p-3">Entry Price</th>
                        <th className="p-3">Exit Price</th>
                        <th className="p-3">PnL</th>
                        <th className="p-3">Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-terminal-border/40">
                      {userTrades.map((t, idx) => (
                        <tr key={t.id || idx} className="hover:bg-terminal-800/30 transition-colors">
                          <td className="p-3">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-white">{t.symbol}</span>
                              <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${t.side === 'LONG' || t.side === 'BUY' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'}`}>
                                {t.side}
                              </span>
                            </div>
                          </td>
                          <td className="p-3">
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-terminal-800 text-slate-400">
                              {t.mode || 'SIMULATED'}
                            </span>
                          </td>
                          <td className="p-3 text-slate-200 font-semibold">
                            ${Number(t.entryPrice || 0).toFixed(4)}
                          </td>
                          <td className="p-3 text-slate-200 font-semibold">
                            {t.exitPrice ? `$${Number(t.exitPrice).toFixed(4)}` : <span className="text-amber-400">OPEN</span>}
                          </td>
                          <td className="p-3">
                            {t.pnl !== null && t.pnl !== undefined ? (
                              <span className={`font-bold ${t.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {t.pnl >= 0 ? '+' : ''}${Number(t.pnl).toFixed(2)}
                              </span>
                            ) : (
                              <span className="text-slate-500">In Progress</span>
                            )}
                          </td>
                          <td className="p-3 text-slate-400 text-[10px]">
                            {t.timestamp ? new Date(t.timestamp).toLocaleString() : 'N/A'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-terminal-border bg-terminal-950/80 flex items-center justify-between">
              <div className="flex items-center gap-2">
                {inspectingUser.status === 'PENDING' && (
                  <button
                    onClick={() => handleStatusChange(inspectingUser.id, 'ACTIVE', inspectingUser.email)}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 transition-all shadow-md shadow-emerald-600/30 cursor-pointer"
                  >
                    <Check className="w-4 h-4" />
                    <span>Approve Client Account</span>
                  </button>
                )}
              </div>
              <button
                onClick={() => setInspectingUser(null)}
                className="px-4 py-2 rounded-xl bg-terminal-800 hover:bg-terminal-700 text-white font-semibold text-xs cursor-pointer"
              >
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
