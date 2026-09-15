# 🚀 Deployment Guide: Live on Render via GitHub

This guide will walk you through deploying your **Autonomous Scalping Trading Agent** live to **Render** (Free Tier) connected directly to your **GitHub** repository.

---

## 📋 Overview of Architecture
- **Unified Full-Stack Deployment**: The backend Express server builds and serves the React + Vite frontend directly from `frontend/dist`.
- **Zero CORS / Domain issues**: Both frontend UI and backend REST API run on the exact same domain and port.
- **Dynamic Port**: Configured to bind to `process.env.PORT || 5000` on `0.0.0.0` as required by Render.

---

## Step 1: Initialize Git & Push to GitHub

1. Open your terminal in this project root (`Trading/`):
   ```bash
   git init
   ```

2. Stage and commit all files:
   ```bash
   git add .
   git commit -m "feat: Scalping agent with margin, leverage, and Render deployment"
   ```

3. Go to [GitHub.com](https://github.com/new) and create a **New Repository** (e.g. `trading-agent`).
   - Leave it **Public** or **Private**.
   - Do NOT initialize with a README, .gitignore, or license (we already created them).

4. Link and push your local repository to GitHub:
   ```bash
   git branch -M main
   git remote add origin https://github.com/<YOUR_GITHUB_USERNAME>/<YOUR_REPO_NAME>.git
   git push -u origin main
   ```

---

## Step 2: Deploy to Render (100% Free)

You can deploy using either **Option A (Manual Web Service)** or **Option B (Blueprint with `render.yaml`)**.

### Option A: Standard Web Service (Recommended)
1. Log in to [Render.com](https://dashboard.render.com).
2. Click the **"New +"** button at the top right and select **"Web Service"**.
3. Select **"Build and deploy from a Git repository"** and connect your GitHub account.
4. Pick your `trading-agent` repository.
5. Configure the service settings:
   - **Name**: `nexus-scalping-trading-agent` (or any name you prefer)
   - **Region**: Choose the closest region (e.g., Oregon, Frankfurt, Singapore)
   - **Branch**: `main`
   - **Runtime**: `Node`
   - **Build Command**:
     ```bash
     npm run build
     ```
   - **Start Command**:
     ```bash
     npm start
     ```
   - **Instance Type**: Select **"Free"** ($0/month).
6. Under **Environment Variables**, add:
   - `NODE_ENV` = `production`
7. Click **"Create Web Service"**.

---

### Option B: Render Blueprint (One-Click)
1. In Render Dashboard, click **"New +"** -> **"Blueprint"**.
2. Select your repository.
3. Render will automatically read `render.yaml` and set up the build and start commands automatically.
4. Click **"Apply"**.

---

## Step 3: Verify Your Live Agent

1. Once Render finishes the build (usually takes 2-3 minutes), you will receive your free live HTTPS URL:
   ```
   https://nexus-scalping-trading-agent.onrender.com
   ```
2. Open the URL in your browser:
   - You will see the **Scalping Trading Dashboard**.
   - Real-time market scanning and technical indicators will begin running.
   - You can toggle Auto-Scalping, adjust leverage (1x–50x), change risk parameters, and edit your virtual balance right from your phone or laptop!
