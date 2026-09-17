import React, { useState, useEffect, useCallback } from 'react';
import Header from './components/Header';
import MetricCards from './components/MetricCards';
import MarketRadar from './components/MarketRadar';
import ActivePositions from './components/ActivePositions';
import TradeHistory from './components/TradeHistory';
import AgentLogs from './components/AgentLogs';
import SettingsModal from './components/SettingsModal';
import AssetDetailModal from './components/AssetDetailModal';
import BalanceModal from './components/BalanceModal';
import { Compass, Target, History, Terminal, Zap, ArrowDownRight, Coins } from 'lucide-react';

export default function App() {
  const [data, setData] = useState({
    activeAccount: 'MARGIN',
    margin: null,
    spot: null,
    portfolio: null,
    riskSettings: null,
    isAutoTradingEnabled: true,
    isScanning: false,
    marketScan: [],
    logs: [],
    serverTime: null
  });

  const [activeTab, setActiveTab] = useState('POSITIONS');
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isBalanceModalOpen, setIsBalanceModalOpen] = useState(false);
  const [isClosingId, setIsClosingId] = useState(null);
  const [notification, setNotification] = useState(null);

  const showNotification = (msg, type = 'INFO') => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 4000);
  };

  const fetchDashboard = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard');
      if (!res.ok) return;
      const json = await res.json();
      setData(json);
    } catch (err) {
      console.error('Failed to fetch dashboard data:', err);
    }
  }, []);

  // Poll state every 2.5 seconds for ultra-responsive feel
  useEffect(() => {
    fetchDashboard();
    const interval = setInterval(fetchDashboard, 2500);
    return () => clearInterval(interval);
  }, [fetchDashboard]);

  const handleSwitchAccount = async (account) => {
    try {
      const res = await fetch('/api/account/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account })
      });
      const json = await res.json();
      if (json.success) {
        setData(json);
        showNotification(
          account === 'SPOT'
            ? '🪙 Switched to PURE SPOT CRYPTO Account (100% Capital Allocation)'
            : '⚡ Switched to MARGIN SCALPER (500x Leverage)',
          'SUCCESS'
        );
      }
    } catch (err) {
      showNotification('Failed to switch account view', 'ERROR');
    }
  };

  const handleToggleAutoTrading = async () => {
    try {
      const res = await fetch('/api/agent/toggle', { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        setData(prev => ({ ...prev, isAutoTradingEnabled: json.isAutoTradingEnabled }));
        showNotification(
          json.isAutoTradingEnabled ? 'Auto-Trading Activated' : 'Auto-Trading Paused (Manual Mode)',
          json.isAutoTradingEnabled ? 'SUCCESS' : 'WARN'
        );
      }
    } catch (err) {
      showNotification('Failed to toggle agent state', 'ERROR');
    }
  };

  const handleChangeDirection = async (direction) => {
    try {
      const res = await fetch('/api/agent/direction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ direction })
      });
      const json = await res.json();
      if (json.success) {
        setData(prev => ({ ...prev, riskSettings: json.settings }));
        showNotification(
          direction === 'SHORT_ONLY'
            ? 'Locked to SHORT TRADES ONLY (Bearish Scalps)'
            : direction === 'BOTH'
            ? 'Bi-directional Scalping Enabled'
            : 'Locked to LONG TRADES ONLY',
          'SUCCESS'
        );
      }
    } catch (err) {
      showNotification('Failed to change trade direction', 'ERROR');
    }
  };

  const handleUpdateBalance = async (newBalance, closeOpenPositions, targetAccount = null) => {
    const acc = targetAccount || data.activeAccount || 'MARGIN';
    try {
      const res = await fetch('/api/portfolio/balance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ balance: newBalance, closeOpenPositions, account: acc })
      });
      const json = await res.json();
      if (json.success) {
        if (json.dashboard) {
          setData(json.dashboard);
        } else {
          await fetchDashboard();
        }
        showNotification(`[${acc}] Balance updated to $${Number(newBalance).toLocaleString('en-US')}`, 'SUCCESS');
      }
    } catch (err) {
      showNotification('Failed to update balance', 'ERROR');
    }
  };

  const handleAdjustBalance = async (delta, targetAccount = null) => {
    const acc = targetAccount || data.activeAccount || 'MARGIN';
    try {
      const res = await fetch('/api/portfolio/adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delta, account: acc })
      });
      const json = await res.json();
      if (json.success) {
        if (json.dashboard) {
          setData(json.dashboard);
        } else {
          await fetchDashboard();
        }
        showNotification(`[${acc}] Balance adjusted by ${delta >= 0 ? '+' : ''}$${delta}`, 'SUCCESS');
      }
    } catch (err) {
      showNotification('Failed to adjust balance', 'ERROR');
    }
  };

  const handleCloseTrade = async (id) => {
    setIsClosingId(id);
    try {
      const res = await fetch(`/api/trades/close/${id}`, { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        showNotification(
          `Position closed: ${json.closedTrade?.symbol} (${json.closedTrade?.finalPnL >= 0 ? '+' : ''}$${json.closedTrade?.finalPnL})`,
          json.closedTrade?.finalPnL >= 0 ? 'SUCCESS' : 'WARN'
        );
        await fetchDashboard();
      }
    } catch (err) {
      showNotification('Failed to close position', 'ERROR');
    } finally {
      setIsClosingId(null);
    }
  };

  const handleCloseAllTrades = async () => {
    if (!window.confirm(`Close all active positions in [${data.activeAccount}] immediately?`)) return;
    try {
      const res = await fetch('/api/trades/close-all', { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        showNotification(`Closed all ${json.closedCount} active positions in [${data.activeAccount}]`, 'SUCCESS');
        await fetchDashboard();
      }
    } catch (err) {
      showNotification('Failed to close all positions', 'ERROR');
    }
  };

  const handleExecuteTrade = async (symbol, side) => {
    try {
      const res = await fetch('/api/trades/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, side })
      });
      const json = await res.json();
      if (json.success) {
        showNotification(
          data.activeAccount === 'SPOT'
            ? `100% Spot Buy executed for ${symbol}!`
            : `Demo ${side} Scalp executed for ${symbol}!`,
          'SUCCESS'
        );
        setSelectedAsset(null);
        setActiveTab('POSITIONS');
        await fetchDashboard();
      } else {
        showNotification(json.error || 'Trade rejected by Risk Guardian', 'ERROR');
      }
    } catch (err) {
      showNotification('Error executing trade', 'ERROR');
    }
  };

  const handleSaveSettings = async (newSettings) => {
    try {
      const res = await fetch('/api/agent/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSettings)
      });
      const json = await res.json();
      if (json.success) {
        await fetchDashboard();
        showNotification('Settings updated successfully', 'SUCCESS');
      }
    } catch (err) {
      showNotification('Failed to save settings', 'ERROR');
    }
  };

  const handleResetPortfolio = async (accountToReset = null) => {
    const acc = accountToReset || data.activeAccount || 'MARGIN';
    if (!window.confirm(`Reset [${acc}] demo portfolio balance?`)) return;
    try {
      const res = await fetch('/api/portfolio/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account: acc })
      });
      const json = await res.json();
      if (json.success) {
        showNotification(`[${acc}] Portfolio reset`, 'WARN');
        await fetchDashboard();
      }
    } catch (err) {
      showNotification('Failed to reset portfolio', 'ERROR');
    }
  };

  const isSpot = data.activeAccount === 'SPOT';
  const activePositionsCount = data.portfolio?.activePositions?.length || 0;
  const closedTradesCount = data.portfolio?.closedTrades?.length || 0;
  const tradeDirection = data.riskSettings?.tradeDirection || 'SHORT_ONLY';

  return (
    <div className="min-h-screen bg-[#07090e] text-slate-100 flex flex-col font-sans selection:bg-indigo-600 selection:text-white">
      {/* Top Header */}
      <Header
        activeAccount={data.activeAccount || 'MARGIN'}
        onSwitchAccount={handleSwitchAccount}
        marginPortfolio={data.margin?.portfolio}
        spotPortfolio={data.spot?.portfolio}
        isAutoTrading={data.isAutoTradingEnabled}
        onToggleAutoTrading={handleToggleAutoTrading}
        onManualScan={fetchDashboard}
        isScanning={data.isScanning}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenBalanceModal={() => setIsBalanceModalOpen(true)}
        onCloseAllTrades={handleCloseAllTrades}
        tradeDirection={tradeDirection}
        onChangeDirection={handleChangeDirection}
        tradingStyle={data.riskSettings?.tradingStyle || 'SCALPING'}
        lastUpdated={data.serverTime}
        activePositionsCount={activePositionsCount}
      />

      {/* Main Body */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 lg:p-6 space-y-6">
        {/* Account Mode Banner */}
        {isSpot ? (
          <div className="p-3 rounded-xl bg-gradient-to-r from-emerald-500/10 via-teal-500/10 to-cyan-500/10 border border-emerald-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs font-mono">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              <span className="font-bold text-emerald-300">PURE SPOT CRYPTO ENGINE ACTIVE:</span>
              <span className="text-slate-300">
                100% Capital Allocation per trade (${data.portfolio?.balance?.toFixed(2)} full balance buy). 0x leverage. Stop: -{data.riskSettings?.stopLossPct || 1.0}% | Target: +{data.riskSettings?.takeProfitPct || 2.5}%.
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold flex items-center gap-1">
                <Coins className="w-3.5 h-3.5" />
                LONG ONLY (SPOT)
              </span>
              <button
                onClick={() => setIsBalanceModalOpen(true)}
                className="px-2.5 py-0.5 rounded bg-emerald-600/30 hover:bg-emerald-600 text-emerald-200 hover:text-white border border-emerald-500/50 transition-colors"
              >
                Change Spot Balance (${data.portfolio?.balance?.toLocaleString('en-US')})
              </button>
            </div>
          </div>
        ) : (
          <div className="p-3 rounded-xl bg-gradient-to-r from-amber-500/10 via-rose-500/10 to-indigo-500/10 border border-amber-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs font-mono">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
              <span className="font-bold text-amber-300">SCALPING ENGINE ACTIVE:</span>
              <span className="text-slate-300">
                Fast micro-targets, rapid break-even & profit locks. 500x Leverage | 1:1.3 R:R.
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40 font-bold flex items-center gap-1">
                <ArrowDownRight className="w-3.5 h-3.5" />
                {tradeDirection === 'SHORT_ONLY' ? 'SHORT TRADES ONLY' : tradeDirection}
              </span>
              <button
                onClick={() => setIsBalanceModalOpen(true)}
                className="px-2.5 py-0.5 rounded bg-indigo-600/30 hover:bg-indigo-600 text-indigo-200 hover:text-white border border-indigo-500/50 transition-colors"
              >
                Change Margin Balance (${data.portfolio?.balance?.toLocaleString('en-US')})
              </button>
            </div>
          </div>
        )}

        {/* Toast Notification */}
        {notification && (
          <div className={`p-3 rounded-xl border font-mono text-xs shadow-lg transition-all animate-in fade-in slide-in-from-top-2 flex items-center justify-between ${
            notification.type === 'SUCCESS' ? 'bg-emerald-950/80 border-emerald-500/50 text-emerald-300' :
            notification.type === 'WARN' ? 'bg-amber-950/80 border-amber-500/50 text-amber-300' :
            notification.type === 'ERROR' ? 'bg-rose-950/80 border-rose-500/50 text-rose-300' :
            'bg-indigo-950/80 border-indigo-500/50 text-indigo-300'
          }`}>
            <span>{notification.msg}</span>
            <button onClick={() => setNotification(null)} className="opacity-70 hover:opacity-100 text-xs">✕</button>
          </div>
        )}

        {/* Top KPI Metrics */}
        <MetricCards
          portfolio={data.portfolio}
          riskSettings={data.riskSettings}
          activeAccount={data.activeAccount || 'MARGIN'}
          onOpenBalanceModal={() => setIsBalanceModalOpen(true)}
        />

        {/* Navigation Tabs */}
        <div className="flex items-center space-x-2 border-b border-terminal-border/80 pb-2">
          <button
            onClick={() => setActiveTab('POSITIONS')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-mono font-semibold transition-all ${
              activeTab === 'POSITIONS'
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20'
                : 'bg-terminal-850/60 hover:bg-terminal-800 text-slate-400 hover:text-white border border-terminal-border'
            }`}
          >
            {isSpot ? <Coins className="w-4 h-4 text-emerald-400" /> : <Target className="w-4 h-4 text-amber-400" />}
            <span>{isSpot ? 'Active Spot Positions' : 'Active Scalp Positions'} ({activePositionsCount})</span>
            {activePositionsCount > 0 && (
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            )}
          </button>

          <button
            onClick={() => setActiveTab('RADAR')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-mono font-semibold transition-all ${
              activeTab === 'RADAR'
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20'
                : 'bg-terminal-850/60 hover:bg-terminal-800 text-slate-400 hover:text-white border border-terminal-border'
            }`}
          >
            <Compass className="w-4 h-4" />
            <span>Market Radar ({data.marketScan?.length || 0})</span>
          </button>

          <button
            onClick={() => setActiveTab('LEDGER')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-mono font-semibold transition-all ${
              activeTab === 'LEDGER'
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20'
                : 'bg-terminal-850/60 hover:bg-terminal-800 text-slate-400 hover:text-white border border-terminal-border'
            }`}
          >
            <History className="w-4 h-4" />
            <span>{isSpot ? 'Spot Trade Ledger' : 'Trade Ledger'} ({closedTradesCount})</span>
          </button>

          <button
            onClick={() => setActiveTab('LOGS')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-mono font-semibold transition-all ${
              activeTab === 'LOGS'
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20'
                : 'bg-terminal-850/60 hover:bg-terminal-800 text-slate-400 hover:text-white border border-terminal-border'
            }`}
          >
            <Terminal className="w-4 h-4" />
            <span>Neural Stream</span>
          </button>
        </div>

        {/* Tab Views */}
        {activeTab === 'POSITIONS' && (
          <div className="space-y-6">
            <ActivePositions
              positions={data.portfolio?.activePositions}
              onCloseTrade={handleCloseTrade}
              isClosingId={isClosingId}
            />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <MarketRadar
                marketScan={data.marketScan}
                onSelectAsset={(asset) => setSelectedAsset(asset)}
                onQuickTrade={(symbol, side) => handleExecuteTrade(symbol, side)}
              />
              <AgentLogs logs={data.logs} />
            </div>
          </div>
        )}

        {activeTab === 'RADAR' && (
          <div className="space-y-6">
            <MarketRadar
              marketScan={data.marketScan}
              onSelectAsset={(asset) => setSelectedAsset(asset)}
              onQuickTrade={(symbol, side) => handleExecuteTrade(symbol, side)}
            />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <ActivePositions
                positions={data.portfolio?.activePositions}
                onCloseTrade={handleCloseTrade}
                isClosingId={isClosingId}
              />
              <AgentLogs logs={data.logs} />
            </div>
          </div>
        )}

        {activeTab === 'LEDGER' && (
          <div className="space-y-6">
            <TradeHistory closedTrades={data.portfolio?.closedTrades} />
          </div>
        )}

        {activeTab === 'LOGS' && (
          <div className="space-y-6">
            <AgentLogs logs={data.logs} />
          </div>
        )}
      </main>

      {/* Modals */}
      {isBalanceModalOpen && (
        <BalanceModal
          activeAccount={data.activeAccount || 'MARGIN'}
          marginBalance={data.margin?.portfolio?.balance ?? 10}
          spotBalance={data.spot?.portfolio?.balance ?? 10}
          currentBalance={data.portfolio?.balance}
          onUpdateBalance={handleUpdateBalance}
          onAdjustBalance={handleAdjustBalance}
          onClose={() => setIsBalanceModalOpen(false)}
        />
      )}

      {selectedAsset && (
        <AssetDetailModal
          asset={selectedAsset}
          onClose={() => setSelectedAsset(null)}
          onExecuteTrade={handleExecuteTrade}
        />
      )}

      {isSettingsOpen && (
        <SettingsModal
          settings={data.riskSettings}
          marginSettings={data.margin?.riskSettings}
          spotSettings={data.spot?.riskSettings}
          activeAccount={data.activeAccount || 'MARGIN'}
          onSaveSettings={handleSaveSettings}
          onResetPortfolio={handleResetPortfolio}
          onClose={() => setIsSettingsOpen(false)}
        />
      )}
    </div>
  );
}
