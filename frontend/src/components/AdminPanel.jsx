import React, { useState, useEffect } from 'react';
import { ShieldCheck, Users, CheckCircle2, XCircle, AlertTriangle, Trash2, Search, Filter, RefreshCw, X, Phone, Mail, Coins, TrendingUp, Clock, UserCheck } from 'lucide-react';

export default function AdminPanel({ isOpen, onClose, token, showNotification }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL'); // 'ALL' | 'PENDING' | 'ACTIVE' | 'SUSPENDED'
  const [actionLoading, setActionLoading] = useState({});

  const fetchUsers = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch('/api/admin/users', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Failed to fetch user list');
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
    if (isOpen) {
      fetchUsers();
    }
  }, [isOpen]);

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
    } catch (err) {
      if (showNotification) showNotification(err.message, 'ERROR');
    } finally {
      setActionLoading(prev => ({ ...prev, [userId]: false }));
    }
  };

  const handleDeleteUser = async (userId, userEmail) => {
    if (!window.confirm(`Are you sure you want to permanently delete account ${userEmail}?`)) return;

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
      await fetchUsers();
    } catch (err) {
      if (showNotification) showNotification(err.message, 'ERROR');
    } finally {
      setActionLoading(prev => ({ ...prev, [userId]: false }));
    }
  };

  if (!isOpen) return null;

  const filteredUsers = users.filter(u => {
    const matchesSearch =
      (u.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (u.email || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (u.phone || '').includes(searchTerm);

    const matchesStatus = statusFilter === 'ALL' || u.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const pendingCount = users.filter(u => u.status === 'PENDING').length;
  const activeCount = users.filter(u => u.status === 'ACTIVE').length;
  const spotCount = users.filter(u => u.account_type === 'SPOT').length;
  const marginCount = users.filter(u => u.account_type === 'MARGIN').length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-terminal-900 border border-terminal-border rounded-2xl w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden font-mono text-xs">
        {/* Header */}
        <div className="p-5 border-b border-terminal-border/80 flex items-center justify-between bg-terminal-950/70">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/30">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-wide">
                Admin Control Panel
              </h2>
              <p className="text-[11px] text-slate-400">
                NexusQuant Multi-Tenant SaaS User Approval & Account Governance
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchUsers}
              disabled={loading}
              className="p-2 rounded-lg bg-terminal-800 hover:bg-terminal-700 text-slate-300 hover:text-white transition-colors cursor-pointer"
              title="Refresh users"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-lg bg-terminal-800 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Stats Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 bg-terminal-950/40 border-b border-terminal-border/60">
          <div className="p-3 rounded-xl bg-terminal-900/80 border border-terminal-border flex items-center justify-between">
            <div>
              <span className="text-[10px] text-slate-400 uppercase font-semibold">Total Accounts</span>
              <p className="text-lg font-bold text-white">{users.length}</p>
            </div>
            <Users className="w-5 h-5 text-indigo-400 opacity-60" />
          </div>

          <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-between">
            <div>
              <span className="text-[10px] text-amber-400 uppercase font-semibold">Pending Approval</span>
              <p className="text-lg font-bold text-amber-300">{pendingCount}</p>
            </div>
            <Clock className="w-5 h-5 text-amber-400 opacity-80" />
          </div>

          <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between">
            <div>
              <span className="text-[10px] text-emerald-400 uppercase font-semibold">Active Clients</span>
              <p className="text-lg font-bold text-emerald-300">{activeCount}</p>
            </div>
            <UserCheck className="w-5 h-5 text-emerald-400 opacity-80" />
          </div>

          <div className="p-3 rounded-xl bg-terminal-900/80 border border-terminal-border flex items-center justify-between">
            <div>
              <span className="text-[10px] text-slate-400 uppercase font-semibold">Type Breakdown</span>
              <p className="text-xs font-bold text-slate-300 mt-1">
                <span className="text-amber-400">{spotCount} Spot</span> • <span className="text-indigo-400">{marginCount} Margin</span>
              </p>
            </div>
            <Coins className="w-5 h-5 text-amber-400 opacity-60" />
          </div>
        </div>

        {/* Filters and Search */}
        <div className="p-4 border-b border-terminal-border/60 flex flex-col sm:flex-row gap-3 items-center justify-between bg-terminal-900/50">
          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by name, email, phone..."
              className="w-full pl-9 pr-3 py-1.5 bg-terminal-950 border border-terminal-border rounded-lg text-slate-200 text-xs focus:outline-none focus:border-indigo-500 font-mono"
            />
          </div>

          <div className="flex items-center gap-1.5 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
            {['ALL', 'PENDING', 'ACTIVE', 'SUSPENDED'].map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                  statusFilter === st
                    ? st === 'PENDING'
                      ? 'bg-amber-500 text-black font-bold shadow-md shadow-amber-500/30'
                      : st === 'ACTIVE'
                      ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                      : 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                    : 'bg-terminal-950 border border-terminal-border text-slate-400 hover:text-slate-200'
                }`}
              >
                {st} {st === 'PENDING' && pendingCount > 0 ? `(${pendingCount})` : ''}
              </button>
            ))}
          </div>
        </div>

        {/* User Table */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {loading ? (
            <div className="py-16 text-center text-slate-500 font-mono space-y-2">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto text-indigo-400" />
              <p>Loading user records from Hostinger database...</p>
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="py-16 text-center text-slate-500 font-mono">
              <p className="text-slate-400 font-semibold">No accounts found</p>
              <p className="text-[11px]">Try adjusting your search query or status filter.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-terminal-border text-slate-400 uppercase text-[10px] bg-terminal-950/60">
                    <th className="p-3">User & Contact</th>
                    <th className="p-3">Account Type</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Registered</th>
                    <th className="p-3 text-right">Approval Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-terminal-border/50">
                  {filteredUsers.map((u) => {
                    const isBusy = actionLoading[u.id];
                    return (
                      <tr key={u.id} className="hover:bg-terminal-800/40 transition-colors">
                        <td className="p-3">
                          <div className="flex flex-col">
                            <div className="flex items-center gap-1.5 font-bold text-white">
                              <span>{u.name || 'Unnamed Client'}</span>
                              {u.role === 'ADMIN' && (
                                <span className="text-[9px] px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 font-bold">
                                  ADMIN
                                </span>
                              )}
                            </div>
                            <span className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
                              <Mail className="w-3 h-3 text-slate-500" /> {u.email}
                            </span>
                            {u.phone && (
                              <span className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
                                <Phone className="w-3 h-3 text-slate-500" /> {u.phone}
                              </span>
                            )}
                          </div>
                        </td>

                        <td className="p-3">
                          {u.account_type === 'SPOT' ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-300 font-bold text-[10px]">
                              <Coins className="w-3 h-3" />
                              <span>Spot (Binance Halal)</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 font-bold text-[10px]">
                              <TrendingUp className="w-3 h-3" />
                              <span>Margin (MT5 Forex)</span>
                            </span>
                          )}
                        </td>

                        <td className="p-3">
                          {u.status === 'PENDING' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 font-bold text-[10px] animate-pulse">
                              <Clock className="w-3 h-3" />
                              <span>PENDING APPROVAL</span>
                            </span>
                          )}
                          {u.status === 'ACTIVE' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 font-bold text-[10px]">
                              <CheckCircle2 className="w-3 h-3" />
                              <span>ACTIVE</span>
                            </span>
                          )}
                          {u.status === 'SUSPENDED' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-500/20 text-rose-300 font-bold text-[10px]">
                              <AlertTriangle className="w-3 h-3" />
                              <span>SUSPENDED</span>
                            </span>
                          )}
                        </td>

                        <td className="p-3 text-[11px] text-slate-400">
                          {u.created_at ? new Date(u.created_at).toLocaleDateString() : 'N/A'}
                        </td>

                        <td className="p-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {u.status === 'PENDING' && (
                              <button
                                onClick={() => handleStatusChange(u.id, 'ACTIVE', u.email)}
                                disabled={isBusy}
                                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] flex items-center gap-1 transition-all shadow-md shadow-emerald-600/30 cursor-pointer disabled:opacity-50"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>Approve</span>
                              </button>
                            )}

                            {u.status === 'ACTIVE' && u.role !== 'ADMIN' && (
                              <button
                                onClick={() => handleStatusChange(u.id, 'SUSPENDED', u.email)}
                                disabled={isBusy}
                                className="px-2.5 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 font-semibold text-[10px] transition-all cursor-pointer disabled:opacity-50"
                              >
                                Suspend
                              </button>
                            )}

                            {u.status === 'SUSPENDED' && (
                              <button
                                onClick={() => handleStatusChange(u.id, 'ACTIVE', u.email)}
                                disabled={isBusy}
                                className="px-2.5 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 font-semibold text-[10px] transition-all cursor-pointer disabled:opacity-50"
                              >
                                Re-Activate
                              </button>
                            )}

                            {u.role !== 'ADMIN' && (
                              <button
                                onClick={() => handleDeleteUser(u.id, u.email)}
                                disabled={isBusy}
                                className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/25 text-rose-400 border border-rose-500/20 transition-all cursor-pointer disabled:opacity-50"
                                title="Delete User"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
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

        {/* Footer */}
        <div className="p-3.5 border-t border-terminal-border bg-terminal-950/80 flex items-center justify-between text-slate-400 text-[11px]">
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-indigo-400" />
            <span>Hostinger MySQL Database • Multi-Tenant Client Architecture</span>
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-terminal-800 hover:bg-terminal-700 text-white font-semibold cursor-pointer"
          >
            Close Panel
          </button>
        </div>
      </div>
    </div>
  );
}
