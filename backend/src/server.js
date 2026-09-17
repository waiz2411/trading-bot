import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { agentLoop } from './services/agentLoop.js';
import { marketDataService } from './services/marketData.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE']
}));
app.use(express.json());

// API: Get complete dashboard state
app.get('/api/dashboard', (req, res) => {
  try {
    const data = agentLoop.getDashboardData();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Toggle autonomous trading mode
app.post('/api/agent/toggle', (req, res) => {
  try {
    const newState = agentLoop.toggleAutoTrading();
    res.json({ success: true, isAutoTradingEnabled: newState });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Update risk management settings
app.post('/api/agent/settings', (req, res) => {
  try {
    agentLoop.riskManager.updateSettings(req.body);
    agentLoop.log(`Settings updated: ${JSON.stringify(req.body)}`, 'INFO');
    res.json({ success: true, settings: agentLoop.riskManager.getSettings() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Set Trade Direction (SHORT_ONLY, BOTH, LONG_ONLY)
app.post('/api/agent/direction', (req, res) => {
  try {
    const { direction } = req.body;
    if (!['SHORT_ONLY', 'BOTH', 'LONG_ONLY'].includes(direction)) {
      return res.status(400).json({ error: 'Invalid direction value' });
    }
    const settings = agentLoop.setTradeDirection(direction);
    res.json({ success: true, settings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Set Trading Style (SCALPING vs SWING)
app.post('/api/agent/style', (req, res) => {
  try {
    const { style } = req.body;
    if (!['SCALPING', 'SWING'].includes(style)) {
      return res.status(400).json({ error: 'Invalid style value' });
    }
    const settings = agentLoop.setTradingStyle(style);
    res.json({ success: true, settings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Set Leverage (1x to 500x)
app.post('/api/agent/leverage', (req, res) => {
  try {
    const { leverage } = req.body;
    const levNum = parseInt(leverage, 10);
    if (isNaN(levNum) || levNum < 1 || levNum > 500) {
      return res.status(400).json({ error: 'Leverage must be between 1x and 500x' });
    }
    agentLoop.riskManager.updateSettings({ defaultLeverage: levNum });
    agentLoop.log(`⚙️ Account leverage updated to ${levNum}x`, 'INFO');
    res.json({ success: true, settings: agentLoop.riskManager.getSettings() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Custom Balance Management (Set exact balance)
app.post('/api/portfolio/balance', (req, res) => {
  try {
    const { balance, closeOpenPositions } = req.body;
    const num = parseFloat(balance);
    if (isNaN(num) || num <= 0) {
      return res.status(400).json({ error: 'Please provide a valid positive balance' });
    }
    const state = agentLoop.setBalance(num, !!closeOpenPositions);
    res.json({ success: true, portfolio: state });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Adjust Balance (Add or Subtract)
app.post('/api/portfolio/adjust', (req, res) => {
  try {
    const { delta } = req.body;
    const num = parseFloat(delta);
    if (isNaN(num)) {
      return res.status(400).json({ error: 'Invalid delta amount' });
    }
    const state = agentLoop.adjustBalance(num);
    res.json({ success: true, portfolio: state });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Close an active trade manually
app.post('/api/trades/close/:id', (req, res) => {
  try {
    const { id } = req.params;
    const closed = agentLoop.tradingEngine.closePosition(id, null, 'MANUAL_USER_EXIT', 'Manual user exit via dashboard');
    if (!closed) {
      return res.status(404).json({ error: 'Trade not found or already closed' });
    }
    agentLoop.log(
      `✋ Manual Exit: ${closed.symbol} (${closed.side}). Realized: ${closed.finalPnL >= 0 ? '+' : ''}$${closed.finalPnL}`,
      closed.finalPnL >= 0 ? 'SUCCESS' : 'WARN'
    );
    res.json({ success: true, closedTrade: closed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Close ALL active trades at once
app.post('/api/trades/close-all', (req, res) => {
  try {
    const active = [...agentLoop.tradingEngine.activePositions];
    const closedList = [];
    for (const pos of active) {
      const closed = agentLoop.tradingEngine.closePosition(pos.id, null, 'MANUAL_USER_EXIT', 'Close All Triggered');
      if (closed) closedList.push(closed);
    }
    agentLoop.log(`🧹 Closed all ${closedList.length} active positions.`, 'INFO');
    res.json({ success: true, closedCount: closedList.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Execute trade on demand
app.post('/api/trades/execute', (req, res) => {
  try {
    const { symbol, side } = req.body;
    const asset = marketDataService.getMarket(symbol);
    if (!asset) return res.status(404).json({ error: 'Asset not found' });

    const scanItem = agentLoop.latestScanResults.find(s => s.symbol === symbol);
    const stopDist = asset.price * 0.003;
    const targetDist = stopDist * 1.55;

    const signal = scanItem?.signal || {
      action: side === 'LONG' ? 'BUY' : 'SELL',
      side,
      confidence: 85,
      entryPrice: asset.price,
      stopLoss: side === 'LONG' ? asset.price - stopDist : asset.price + stopDist,
      takeProfit: side === 'LONG' ? asset.price + targetDist : asset.price - targetDist,
      stopDistance: stopDist,
      targetDistance: targetDist,
      riskRewardRatio: 1.55,
      reason: 'Manual execution triggered via Dashboard'
    };

    const portfolio = agentLoop.tradingEngine.getPortfolioState();
    const riskEval = agentLoop.riskManager.evaluateTradeRisk(portfolio, { ...signal, confidence: 99 }, asset);

    if (!riskEval.allowed) {
      return res.status(400).json({ error: riskEval.reason });
    }

    const trade = agentLoop.tradingEngine.openPosition({
      symbol: asset.symbol,
      name: asset.name,
      category: asset.category,
      side: side || signal.side,
      entryPrice: asset.price,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      stopDistance: signal.stopDistance || stopDist,
      targetDistance: signal.targetDistance || targetDist,
      units: riskEval.units,
      notional: riskEval.notional,
      confidence: signal.confidence,
      reason: `Manual One-Click Scalp (${signal.reason || 'User initiated'})`,
      riskRewardRatio: signal.riskRewardRatio || 1.55,
      tradingStyle: 'SCALPING',
      leverage: riskEval.leverage,
      margin: riskEval.margin,
      liquidationPrice: riskEval.liquidationPrice
    });

    agentLoop.log(`🖐️ MANUAL SCALP OPENED: ${trade.side} ${trade.symbol} @ $${trade.entryPrice} (${riskEval.leverage}x Lev, Margin: $${riskEval.margin})`, 'INFO');
    res.json({ success: true, trade });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Reset paper portfolio to initial state
app.post('/api/portfolio/reset', (req, res) => {
  try {
    const initialBalance = req.body.initialBalance || 10000;
    const resetState = agentLoop.tradingEngine.reset(initialBalance);
    agentLoop.log(`🔄 Portfolio reset to $${initialBalance.toLocaleString('en-US')} virtual balance.`, 'WARN');
    res.json({ success: true, portfolio: resetState });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve static frontend assets in production (Render single-service deployment)
const distPath = path.resolve(__dirname, '../../frontend/dist');
app.use(express.static(distPath));

// Fallback all non-API routes to index.html (SPA client routing)
app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

// Start agent loop and web server
agentLoop.start();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`=======================================================`);
  console.log(`🚀 Scalping Agent Backend running on port ${PORT}`);
  console.log(`📡 Autonomous Scalp Loop active: 27 Global Markets | 500x Lev | 1:1.3 R:R`);
  console.log(`=======================================================`);
});
