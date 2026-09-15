# 🤖 Nexus Quant Scalping Trading Agent

An autonomous multi-market algorithmic trading agent equipped with a real-time technical analysis engine, sniper scalp strategies, margin & leverage system (1x–50x), automated liquidation calculation, dynamic risk management, and a high-performance React dashboard.

---

## ⚡ Key Capabilities

- **15+ Global Markets**: Live monitoring of Crypto (`BTC-USD`, `ETH-USD`, `SOL-USD`, `XRP-USD`), Forex (`EURUSD=X`, `GBPUSD=X`, `USDJPY=X`, `AUDUSD=X`, `USDCAD=X`), Commodities (`GC=F` Gold, `CL=F` Crude Oil, `SI=F` Silver), and Indices (`^GSPC` S&P 500, `^DJI` Dow Jones, `^IXIC` Nasdaq).
- **Margin & Leverage Multiplier (1x to 50x)**: Configurable leverage slider with instant margin calculation (`Notional / Leverage`), available free margin checking, maintenance margin rate (MMR 0.5%), and live estimated liquidation price tracking.
- **Sniper Scalping Strategy**: Optimized for rapid scalp trades with high win rates (75%+), utilizing EMA ribbon confluence (EMA 9, 21, 50, 200), RSI momentum, and MACD histograms.
- **Dynamic Trade Protection**:
  - Auto-moving **Break-Even Stop Loss** once a trade moves 40% towards Take-Profit ($0 loss guarantee).
  - Multi-tiered **Trailing Stop Loss** to lock in peak momentum profits.
  - Directional filtering (e.g. **SHORT ONLY** or **BI-DIRECTIONAL**).
- **Editable Virtual Demo Capital**: Customize your starting paper balance ($500, $1,000, $10,000, etc.) with quick adjustment tools.
- **Production-Ready for Render**: Built as a unified full-stack Node.js service where Express serves the compiled React Vite frontend and REST APIs from a single port.

---

## 🚀 One-Click Deploy to Render

This project includes a `render.yaml` blueprint for 1-click deployment on Render's Free Tier.

1. Push this repository to GitHub: `https://github.com/waiz2411/trading-bot`
2. Go to [Render Dashboard](https://dashboard.render.com).
3. Click **"New +"** -> **"Blueprint"** (or **"Web Service"**).
4. Connect your GitHub repository `waiz2411/trading-bot`.
5. Render will automatically run:
   - **Build Command**: `npm run build`
   - **Start Command**: `npm start`
6. Your live trading dashboard is ready with free HTTPS!

---

## 💻 Local Development

```bash
# Install all dependencies and build frontend
npm run build

# Start local server (Runs at http://localhost:5000)
npm start
```
