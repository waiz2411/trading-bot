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
import { Compass, Target, History, Terminal, Zap, ArrowDownRight } from 'lucide-react';

export default function App() {
  const [data, setData] = useState({
    portfolio: null,
    riskSettings: null,
    isAutoTradingEnabled: true,
    isScanning: false,
    marketScan: [],
    logs: [],
    serverTime: null
  });

  const [activeTab, setActiveTab] = useState('POSITIONS'); // Default to POSITIONS tab so user sees scalps!
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

  // Poll state every 2.5 seconds for ultra-responsive scalping feel
  useEffect(() => {
    fetchDashboard();
    const interval = setInterval(fetchDashboard, 2500);
    return () => clearInterval(interval);
  }, [fetchDashboard]);

  const handleToggleAutoTrading = async () => {
    try {
      const res = await fetch('/api/agent/toggle', { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        setData(prev => ({ ...prev, isAutoTradingEnabled: json.isAutoTradingEnabled }));
        showNotification(
          json.isAutoTradingEnabled ? 'Auto-Scalping Activated' : 'Auto-Scalping Paused (Manual Mode)',
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

  const handleUpdateBalance = async (newBalance, closeOpenPositions) => {
    try {
      const res = await fetch('/api/portfolio/balance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ balance: newBalance, closeOpenPositions })
      });
      const json = await res.json();
      if (json.success) {
        setData(prev => ({ ...prev, portfolio: json.portfolio }));
        showNotification(`Demo Balance updated to $${Number(newBalance).toLocaleString('en-US')}`, 'SUCCESS');
      }
    } catch (err) {
      showNotification('Failed to update balance', 'ERROR');
    }
  };

  const handleAdjustBalance = async (delta) => {
    try {
      const res = await fetch('/api/portfolio/adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delta })
      });
      const json = await res.json();
      if (json.success) {
        setData(prev => ({ ...prev, portfolio: json.portfolio }));
        showNotification(`Balance adjusted by ${delta >= 0 ? '+' : ''}$${delta}`, 'SUCCESS');
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
          `Scalp closed: ${json.closedTrade?.symbol} (${json.closedTrade?.finalPnL >= 0 ? '+' : ''}$${json.closedTrade?.finalPnL})`,
          json.closedTrade?.finalPnL >= 0 ? 'SUCCESS' : 'WARN'
        );
        await fetchDashboard();
      }
    } catch (err) {
      showNotification('Failed to close scalp', 'ERROR');
    } finally {
      setIsClosingId(null);
    }
  };

  const handleCloseAllTrades = async () => {
    if (!window.confirm('Close all currently active demo positions immediately?')) return;
    try {
      const res = await fetch('/api/trades/close-all', { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        showNotification(`Closed all ${json.closedCount} active positions`, 'SUCCESS');
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
        showNotification(`Demo ${side} Scalp executed for ${symbol}!`, 'SUCCESS');
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
        setData(prev => ({ ...prev, riskSettings: json.settings }));
        showNotification('Settings updated successfully', 'SUCCESS');
      }
    } catch (err) {
      showNotification('Failed to save settings', 'ERROR');
    }
  };

  const handleResetPortfolio = async () => {
    if (!window.confirm('Reset demo portfolio balance?')) return;
    try {
      const res = await fetch('/api/portfolio/reset', { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        showNotification('Portfolio reset', 'WARN');
        await fetchDashboard();
      }
    } catch (err) {
      showNotification('Failed to reset portfolio', 'ERROR');
    }
  };

  const activePositionsCount = data.portfolio?.activePositions?.length || 0;
  const closedTradesCount = data.portfolio?.closedTrades?.length || 0;
  const tradeDirection = data.riskSettings?.tradeDirection || 'SHORT_ONLY';

  return (
    <div className="min-h-screen bg-[#07090e] text-slate-100 flex flex-col font-sans selection:bg-indigo-600 selection:text-white">
      {/* Top Header */}
      <Header
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
        {/* Scalp Mode Banner */}
        <div className="p-3 rounded-xl bg-gradient-to-r from-amber-500/10 via-rose-500/10 to-indigo-500/10 border border-amber-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs font-mono">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
            <span className="font-bold text-amber-300">SCALPING ENGINE ACTIVE:</span>
            <span className="text-slate-300">
              Fast micro-targets, rapid break-even & profit locks. Holding horizon: ~1-3 minutes.
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
              Change Balance (${data.portfolio?.balance?.toLocaleString('en-US')})
            </button>
          </div>
        </div>

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
            <Target className="w-4 h-4 text-amber-400" />
            <span>Active Scalp Positions ({activePositionsCount})</span>
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
            <span>Trade Ledger ({closedTradesCount})</span>
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
            <span>Scalper Neural Stream</span>
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
          onSaveSettings={handleSaveSettings}
          onResetPortfolio={handleResetPortfolio}
          onClose={() => setIsSettingsOpen(false)}
        />
      )}
    </div>
  );
}
