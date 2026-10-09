# 🚀 Deployment Guide: Hostinger VPS (Frankfurt am Main)

This guide documents the production deployment of **NexusQuant SaaS Platform** on Hostinger VPS in **Frankfurt am Main, Germany**.

---

## 📋 Architecture & Server Details
- **Unified Full-Stack Deployment**: The backend Express server serves the compiled React Vite frontend from `frontend/dist` and REST APIs on port 5000.
- **Server Location**: Frankfurt am Main, Germany (`82.198.229.98`, port `65002`)
- **Direct Binance Execution**: Germany location eliminates Binance US restrictions and Geo-blocking. Outbound requests connect directly to Binance API (`api.binance.com`).
- **Database**: Hostinger MySQL Enterprise database for multi-tenant users, trades, portfolios, and broker configurations.
- **Process Manager**: PM2 running in background:
  ```bash
  pm2 start ecosystem.config.cjs
  pm2 restart ecosystem.config.cjs
  ```

---

## 🔧 Continuous Deployment Steps

1. **Commit and Push to GitHub**:
   ```bash
   git add .
   git commit -m "feat: updates"
   git push origin main
   ```

2. **Deploy to Hostinger Server via SSH**:
   ```bash
   ssh -p 65002 u932536786@82.198.229.98
   cd ~/trading-bot
   git pull origin main
   npm run build:frontend
   ~/.local/bin/pm2 restart ecosystem.config.cjs
   ```

3. **Verify Live Health**:
   - Web App: `https://slategrey-reindeer-680249.hostingersite.com`
   - IP Diagnostic: `https://slategrey-reindeer-680249.hostingersite.com/api/system/ip`
