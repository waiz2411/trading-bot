# 🤖 Nexus Quant Scalping Trading Agent

An autonomous multi-market algorithmic trading agent equipped with a real-time technical analysis engine, sniper scalp strategies, margin & leverage system (500x on MT5), pure spot halal crypto engine (100% capital allocation on Binance), automated liquidation calculation, dynamic risk management, and a high-performance React dashboard.

---

## ⚡ Key Capabilities

- **Strict Account Isolation**:
  - **Pure Spot Crypto Account**: Dedicated to 100% capital spot trading (0x leverage, long only) on Binance. Filtered strictly to Shariah-compliant halal cryptocurrencies.
  - **Margin Scalper Core (500x)**: High-frequency multi-asset scalping on MetaTrader 5 (MT5) with instant margin calculation, available free margin checking, and live estimated liquidation price tracking.
- **Sniper Scalping Strategy**: Optimized for rapid scalp trades with high win rates (75%+), utilizing EMA ribbon confluence (EMA 9, 21, 50, 200), RSI momentum, and MACD histograms.
- **Dynamic Trade Protection**:
  - Auto-moving **Break-Even Stop Loss** once a trade moves 40% towards Take-Profit ($0 loss guarantee).
  - Multi-tiered **Trailing Stop Loss** to lock in peak momentum profits.
  - Directional filtering (e.g. **LONG ONLY**, **SHORT ONLY**, or **BI-DIRECTIONAL**).
- **Production Server**: Deployed on Hostinger VPS in Frankfurt am Main, Germany, with direct Binance API connectivity and MySQL database synchronization.

---

## 💻 Local Development

```bash
# Install all dependencies and build frontend
npm run build

# Start local server (Runs at http://localhost:5000)
npm start
```
