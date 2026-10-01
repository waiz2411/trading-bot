---
title: "NexusQuant Trading Algorithms: Technical Strategy Blueprint"
author: "NexusQuant Systems"
date: "October 2026"
---

# NexusQuant Technical Strategy Blueprint

Welcome to the internal documentation for the **NexusQuant Dual-Engine Trading System**. This document breaks down the exact logic, safety gates, and exit protocols utilized by both the Spot Crypto and Margin Scalper engines to ensure strict risk management and high-probability algorithmic trading.

---

## 1. Pure Spot Crypto Engine (The Pullback Sniper)

The Spot engine is designed for unleveraged, strict Shariah-compliant altcoin trading. Because it does not use leverage, time is on our side. The core strategy is **Mean-Reversion in a Macro Uptrend**, avoiding "falling knives" and strictly rejecting overextended assets.

### A. The Selection Gates
* **Shariah Filter:** The bot queries a live Halal compliance list, immediately discarding any coins associated with interest-based protocols, gambling, or meme-coin gambling.
* **Volatility Selection:** Under the "High-Volatility Hunter" mode, it scans over 600 Binance pairs and isolates assets with a 24-hour volatility index greater than 1.4, ensuring the asset has enough liquidity and momentum to hit our take-profit targets.

### B. The Entry Gates
The bot evaluates a continuous stream of 5-minute candlestick data to find entries that satisfy **all** of the following conditions simultaneously:

1. **Macro Trend Alignment:** The 50-period Exponential Moving Average (EMA) must be strictly above the 200-period EMA. We only buy when the overall structural trend is bullish.
2. **The "Value Pullback":** The bot absolutely refuses to buy tops. It requires the current price to drop *below* the fast EMA 9, but hold steadily above the major EMA 50 support level. 
3. **Overbought Rejection:** If the Relative Strength Index (RSI) is above 70, the coin is considered overextended and immediately rejected.
4. **Anti-Falling Knife (Candlestick Reversal):** This is our strictest safety gate. Even if the price falls perfectly into our EMA support pocket, the bot will wait. It will only execute the trade if the **latest 5-minute candlestick closes GREEN and higher than the previous red candle**, confirming that buyers have stepped in and the bounce has officially started.

### C. The Exit & Risk Management Protocols
* **Capital Sizing:** Automatically splits your available balance into defined portions (e.g., 25% per trade across 4 slots) to prevent being 100% all-in on a single altcoin.
* **Stop Loss (-2.5%):** A wide stop loss to allow the coin breathing room against normal crypto market noise.
* **Take Profit (+5.0%):** A strict 1:2 Risk-to-Reward ratio.
* **Break-Even Lock:** If the trade reaches 70% of the way to the Take Profit (or hits a +0.80% fee-clearing buffer), the bot permanently moves the stop loss to the entry price, guaranteeing a risk-free trade.
* **Time Expiry (4 Hours):** If the trade fails to hit the TP or SL within 240 minutes, the bot recognizes that momentum has died and auto-closes the position at the current market price to recycle capital.

---

## 2. Margin Scalper Engine (Institutional Momentum)

The Margin engine is built for 500x high-leverage scalping across 24/7 Crypto Majors (BTC, ETH) and the Top 18 Liquid Forex Pairs (EUR/USD, GBP/JPY). Due to the massive leverage, entries must be incredibly precise, and exits must be lightning-fast.

### A. The 100-Point Confluence Scoring System
Unlike the Spot engine which uses strict "Yes/No" gates, the Margin engine uses a dynamic scoring matrix. A trade is only executed if it achieves a score of **70 or higher**.

* **Trend Alignment (+32 points):** Price must demonstrate a clean "Bullish Fan" (EMA 9 > 21 > 50) or a "Bearish Fan" for shorting.
* **Value Pocket (+16 points):** Price must have pulled back to within 1.2% of the EMA 21 support line. Buying at the upper Bollinger Band is heavily penalized (-12 points).
* **Candle Reversal (+18 points):** A confirmed green reversal candle for longs, or red reversal candle for shorts. Entering on the wrong colored candle applies a massive penalty (-30 points).
* **RSI Runway (+14 points):** RSI must be in the "sweet spot" (between 40 and 60), ensuring it is neither exhausted nor dumping.
* **MACD Acceleration (+10 points):** The MACD histogram must be positive and expanding, confirming micro-momentum is on our side.

### B. Scalp Exit Protocols
Because 500x leverage magnifies risk, the bot operates as an automated safeguard to protect your equity:

* **Fixed Capital Risk:** It dynamically calculates the lot size so that if the stop loss is hit, you only ever lose exactly **1.5%** of your total account balance.
* **Optimized R:R:** Hardcoded at 1:1.6 Risk-to-Reward, perfectly calibrated for Forex bid-ask spreads.
* **Trailing Profit Locks:** Once a scalp reaches 75% of its target profit, the bot activates a trailing stop. If the market suddenly reverses, the bot locks in the profit automatically.
* **Time Expiry (2 Hours):** Scalp trades that stall in chop are forcefully closed after 120 minutes to prevent overnight swap fees and exposure to unexpected news events.

---
*Generated by NexusQuant AI*
