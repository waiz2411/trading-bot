# MetaTrader 5 Bridge for NexusQuant

This lightweight microservice connects NexusQuant directly to your local MetaTrader 5 desktop terminal on Windows.

## Quick Start (3 Steps)

### Step 1: Install Python & Libraries
Open PowerShell or Command Prompt and run:
```bash
pip install MetaTrader5 flask flask-cors
```

### Step 2: Ensure MetaTrader 5 Terminal is Running
- Open your MetaTrader 5 desktop application.
- Log into your broker account in MT5: `File -> Login to Trade Account`.
- Go to `Tools -> Options -> Expert Advisors` and ensure:
  - ☑ Allow Algo Trading is checked.

### Step 3: Run the Bridge
```bash
python mt5_bridge.py
```
You will see:
```
============================================================
MetaTrader 5 Python Gateway Bridge active on http://localhost:5001
Bridge endpoint: POST http://localhost:5001/api/mt5/status
============================================================
```

Now return to NexusQuant -> click **Brokers** -> **MetaTrader 5** tab -> enter your Account Login & Server -> click **Test MT5 Connection**!
