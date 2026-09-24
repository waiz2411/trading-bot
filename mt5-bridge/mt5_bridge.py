"""
MetaTrader 5 Python Gateway Bridge for NexusQuant
Runs a local HTTP REST microservice on port 5001 that bridges
NexusQuant requests directly to your locally installed MetaTrader 5 terminal.
"""
from flask import Flask, request, jsonify
from flask_cors import CORS
import MetaTrader5 as mt5

app = Flask(__name__)
CORS(app)

@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ONLINE', 'bridge': 'MT5-Python-Bridge', 'port': 5001})

@app.route('/api/mt5/status', methods=['GET', 'POST'])
def status():
    mt5.initialize()
    data = {}
    if request.is_json and request.json:
        data = request.json

    login = data.get('login')
    password = data.get('password')
    server = data.get('server')

    if login and server and password:
        login_int = int(login) if str(login).isdigit() else login
        current_acc = mt5.account_info()
        # Only re-initialize if not already logged into this account
        if current_acc is None or str(current_acc.login) != str(login):
            mt5.initialize(login=login_int, password=str(password), server=str(server))

    account_info = mt5.account_info()
    if account_info is None:
        return jsonify({
            'success': False,
            'error': f'Failed to fetch account info: {mt5.last_error()}'
        }), 400

    terminal_info = mt5.terminal_info()
    algo_allowed = bool(terminal_info.trade_allowed) if terminal_info else True

    # Retrieve live open positions
    open_positions = []
    try:
        positions = mt5.positions_get()
        if positions:
            for p in positions:
                broker_profit = round(float(p.profit) + float(getattr(p, 'swap', 0.0)), 2)
                open_positions.append({
                    'ticket': int(p.ticket),
                    'symbol': str(p.symbol),
                    'type': 'BUY' if p.type == mt5.ORDER_TYPE_BUY else 'SELL',
                    'volume': float(p.volume),
                    'priceOpen': float(p.price_open),
                    'priceCurrent': float(getattr(p, 'price_current', p.price_open)),
                    'sl': float(p.sl) if p.sl else 0.0,
                    'tp': float(p.tp) if p.tp else 0.0,
                    'profit': broker_profit,
                    'time': int(getattr(p, 'time', 0)),
                    'timeMsc': int(getattr(p, 'time_msc', 0)),
                    'comment': str(p.comment)
                })
    except Exception as e:
        print(f"[Status] Error fetching positions: {e}")

    # Retrieve recent closed deals from broker history (last 7 days)
    deals_history = []
    total_realized_profit = 0.0
    try:
        import datetime
        from_date = datetime.datetime.now() - datetime.timedelta(days=7)
        deals = mt5.history_deals_get(from_date, datetime.datetime.now())
        if deals:
            for d in deals:
                if getattr(d, 'entry', None) in (mt5.DEAL_ENTRY_OUT, mt5.DEAL_ENTRY_INOUT, 1, 2):
                    deal_profit = round(float(getattr(d, 'profit', 0.0)) + float(getattr(d, 'swap', 0.0)) + float(getattr(d, 'commission', 0.0)), 2)
                    total_realized_profit += deal_profit
                    deals_history.append({
                        'id': f"MT5-{d.ticket}",
                        'ticket': int(d.ticket),
                        'order': int(getattr(d, 'order', d.ticket)),
                        'positionId': int(getattr(d, 'position_id', d.ticket)),
                        'time': int(getattr(d, 'time', 0)),
                        'symbol': str(d.symbol),
                        'side': 'BUY' if getattr(d, 'type', 0) == mt5.DEAL_TYPE_BUY else 'SELL',
                        'volume': float(getattr(d, 'volume', 0.01)),
                        'units': float(getattr(d, 'volume', 0.01)),
                        'price': float(getattr(d, 'price', 0.0)),
                        'profit': deal_profit,
                        'finalPnL': deal_profit,
                        'exitReason': 'BROKER_CLOSE',
                        'comment': str(getattr(d, 'comment', ''))
                    })
    except Exception as e:
        print(f"[Deals] Error retrieving deals history: {e}")

    return jsonify({
        'success': True,
        'login': account_info.login,
        'balance': float(account_info.balance),
        'equity': float(account_info.equity),
        'margin': float(account_info.margin),
        'freeMargin': float(account_info.margin_free),
        'leverage': int(account_info.leverage),
        'currency': account_info.currency,
        'company': account_info.company,
        'server': account_info.server,
        'algoTradingEnabled': algo_allowed,
        'positions': open_positions,
        'realizedProfit': round(total_realized_profit, 2),
        'closedDeals': deals_history
    })

@app.route('/api/mt5/order', methods=['POST'])
def place_order():
    mt5.initialize()
    data = request.json or {}
    symbol = data.get('symbol', 'BTCUSD')
    side = (data.get('side') or data.get('action') or 'BUY').upper()
    volume = float(data.get('volume', 0.01))
    sl = data.get('sl')
    tp = data.get('tp')
    comment = data.get('comment', 'NexusQuant Scalp')

    terminal_info = mt5.terminal_info()
    if terminal_info and not terminal_info.trade_allowed:
        return jsonify({
            'success': False,
            'retcode': 10027,
            'comment': 'AutoTrading disabled by client',
            'error': "MetaTrader 5 'Algo Trading' is disabled. Please click the 'Algo Trading' button in your MetaTrader 5 toolbar on AWS (or press Ctrl+E) to allow automated trades."
        }), 400

    target_sym = symbol
    if mt5.symbol_info(target_sym) is None:
        for suffix in ['m', 'c', '.raw', '_i', '.r']:
            if mt5.symbol_info(target_sym + suffix) is not None:
                target_sym = target_sym + suffix
                break

    symbol_info = mt5.symbol_info(target_sym)
    if symbol_info is None:
        return jsonify({'success': False, 'error': f'Symbol {symbol} (or with suffix) not found in Market Watch'}), 400

    if not symbol_info.visible:
        mt5.symbol_select(target_sym, True)

    tick = mt5.symbol_info_tick(target_sym)
    if tick is None:
        return jsonify({'success': False, 'error': f'Cannot get live tick for {target_sym}'}), 400

    order_type = mt5.ORDER_TYPE_BUY if side == 'BUY' else mt5.ORDER_TYPE_SELL
    price = tick.ask if side == 'BUY' else tick.bid

    filling_mode = mt5.ORDER_FILLING_IOC
    if symbol_info.filling_mode & 1:
        filling_mode = mt5.ORDER_FILLING_FOK
    elif symbol_info.filling_mode & 2:
        filling_mode = mt5.ORDER_FILLING_IOC
    else:
        filling_mode = mt5.ORDER_FILLING_RETURN

    digits = symbol_info.digits
    point = symbol_info.point
    stops_level = getattr(symbol_info, 'stops_level', 0) or 0
    spread = tick.ask - tick.bid
    min_dist = max((stops_level + 15) * point, spread * 1.5, 30 * point)

    safe_sl = None
    safe_tp = None

    if sl is not None:
        raw_sl = float(sl)
        if order_type == mt5.ORDER_TYPE_BUY:
            if (price - raw_sl) < min_dist:
                raw_sl = price - min_dist
        else:
            if (raw_sl - price) < min_dist:
                raw_sl = price + min_dist
        safe_sl = round(raw_sl, digits)

    if tp is not None:
        raw_tp = float(tp)
        if order_type == mt5.ORDER_TYPE_BUY:
            if (raw_tp - price) < min_dist:
                raw_tp = price + min_dist
        else:
            if (price - raw_tp) < min_dist:
                raw_tp = price - min_dist
        safe_tp = round(raw_tp, digits)

    request_payload = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": target_sym,
        "volume": volume,
        "type": order_type,
        "price": price,
        "deviation": 20,
        "magic": 241100,
        "comment": comment,
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": filling_mode,
    }
    if safe_sl is not None:
        request_payload["sl"] = safe_sl
    if safe_tp is not None:
        request_payload["tp"] = safe_tp

    result = mt5.order_send(request_payload)

    # If rejected due to invalid stops (retcode 10016), retry without SL/TP and then set stops via SLTP action
    # If rejected due to invalid stops (retcode 10016), retry without SL/TP and then set stops via SLTP action
    if result.retcode == 10016:
        request_payload.pop("sl", None)
        request_payload.pop("tp", None)
        result = mt5.order_send(request_payload)

    if result.retcode != mt5.TRADE_RETCODE_DONE:
        return jsonify({
            'success': False,
            'retcode': result.retcode,
            'comment': result.comment,
            'error': f'Order failed: {result.comment} (code {result.retcode})'
        }), 400

    pos_ticket = result.order
    # Match the actual live position ticket
    import time
    time.sleep(0.15)
    positions = mt5.positions_get(symbol=target_sym)
    if positions:
        matched = [p for p in positions if getattr(p, 'identifier', None) == result.order or p.ticket == result.order]
        if matched:
            pos_ticket = matched[0].ticket
        else:
            pos_ticket = positions[-1].ticket

    # Apply Stop Loss & Take Profit directly to the confirmed live position ticket
    if safe_sl is not None or safe_tp is not None:
        pos_check = mt5.positions_get(ticket=int(pos_ticket))
        curr_p = pos_check[0] if (pos_check and len(pos_check) > 0) else None
        if curr_p is None or not curr_p.sl or not curr_p.tp:
            sltp_req = {
                "action": mt5.TRADE_ACTION_SLTP,
                "position": int(pos_ticket),
                "symbol": target_sym,
                "sl": safe_sl if safe_sl is not None else 0.0,
                "tp": safe_tp if safe_tp is not None else 0.0,
            }
            sltp_res = mt5.order_send(sltp_req)
            if sltp_res and sltp_res.retcode != mt5.TRADE_RETCODE_DONE:
                print(f"[Order] Setting SL/TP failed for #{pos_ticket} ({sltp_res.comment}). Widening safety distance...")
                wider_dist = min_dist * 2.0
                if order_type == mt5.ORDER_TYPE_BUY:
                    sltp_req["sl"] = round(price - wider_dist, digits)
                    sltp_req["tp"] = round(price + (wider_dist * 1.3), digits)
                else:
                    sltp_req["sl"] = round(price + wider_dist, digits)
                    sltp_req["tp"] = round(price - (wider_dist * 1.3), digits)
                mt5.order_send(sltp_req)

    return jsonify({
        'success': True,
        'retcode': result.retcode,
        'order': result.order,
        'ticket': int(pos_ticket),
        'volume': result.volume,
        'price': result.price,
        'symbol': target_sym,
        'sl': safe_sl,
        'tp': safe_tp,
        'comment': result.comment
    })

@app.route('/api/mt5/close', methods=['POST'])
def close_order():
    mt5.initialize()
    data = request.json or {}
    symbol = data.get('symbol')
    ticket = data.get('ticket')

    positions = mt5.positions_get()
    if positions is None or len(positions) == 0:
        return jsonify({'success': True, 'closed': 0, 'message': 'No open positions found.'})

    def normalize_sym(s):
        return str(s).upper().replace('/', '').replace('_', '').replace('.', '').replace('-M', '').replace('M', '').replace('=X', '')

    target_norm = normalize_sym(symbol) if symbol else None
    target_ticket = int(ticket) if (ticket and str(ticket).isdigit()) else None

    closed_count = 0
    for pos in positions:
        # Match by ticket if ticket is provided (tickets are globally unique)
        if target_ticket is not None:
            if int(pos.ticket) != target_ticket:
                continue
        elif target_norm:
            pos_norm = normalize_sym(pos.symbol)
            if not (pos_norm.startswith(target_norm) or target_norm.startswith(pos_norm)):
                continue

        close_type = mt5.ORDER_TYPE_SELL if pos.type == mt5.ORDER_TYPE_BUY else mt5.ORDER_TYPE_BUY

        # Try multiple filling modes until successful
        filling_modes = [mt5.ORDER_FILLING_IOC, mt5.ORDER_FILLING_RETURN, mt5.ORDER_FILLING_FOK]
        sym_info = mt5.symbol_info(pos.symbol)
        if sym_info and sym_info.filling_mode:
            if sym_info.filling_mode & 1:
                filling_modes = [mt5.ORDER_FILLING_FOK, mt5.ORDER_FILLING_IOC, mt5.ORDER_FILLING_RETURN]
            elif sym_info.filling_mode & 2:
                filling_modes = [mt5.ORDER_FILLING_IOC, mt5.ORDER_FILLING_RETURN, mt5.ORDER_FILLING_FOK]

        for fm in filling_modes:
            tick = mt5.symbol_info_tick(pos.symbol)
            if tick is None:
                continue
            close_price = tick.bid if pos.type == mt5.ORDER_TYPE_BUY else tick.ask

            close_req = {
                "action": mt5.TRADE_ACTION_DEAL,
                "position": int(pos.ticket),
                "symbol": str(pos.symbol),
                "volume": float(pos.volume),
                "type": close_type,
                "price": close_price,
                "deviation": 25,
                "magic": 241100,
                "comment": "NexusQuant Scalp Close",
                "type_time": mt5.ORDER_TIME_GTC,
                "type_filling": fm,
            }
            res = mt5.order_send(close_req)
            if res and res.retcode == mt5.TRADE_RETCODE_DONE:
                closed_count += 1
                print(f"[Close] Position #{pos.ticket} ({pos.symbol}) closed successfully with filling mode {fm}.")
                break
            else:
                print(f"[Close] Position #{pos.ticket} attempt failed (mode {fm}, retcode {getattr(res, 'retcode', 'None')}: {getattr(res, 'comment', 'error')})")

    return jsonify({'success': True, 'closed': closed_count})

RENDER_BACKEND = "https://trading-bot-test-z6bi.onrender.com"

def register_tunnel_with_render(tunnel_url):
    target = f"{RENDER_BACKEND}/api/broker/mt5/register-tunnel"
    try:
        import urllib.request
        import json
        req = urllib.request.Request(
            target,
            data=json.dumps({"url": tunnel_url}).encode("utf-8"),
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if data.get("success"):
                print(f"[OK] Successfully auto-registered Cloudflare Tunnel with Render: {tunnel_url}")
                return True
    except Exception as e:
        print(f"[WARN] Failed to auto-register tunnel with Render: {e}")
    return False

def start_cloudflared_subservice():
    import os
    import sys
    import shutil
    import subprocess
    import threading
    import re

    candidates = [
        os.path.join(os.path.expanduser("~"), "cloudflared.exe"),
        os.path.join(os.getcwd(), "cloudflared.exe"),
        shutil.which("cloudflared.exe") or "",
        shutil.which("cloudflared") or ""
    ]
    cf_path = next((p for p in candidates if p and os.path.exists(p)), None)
    if not cf_path:
        print("[INFO] cloudflared.exe not found in $HOME or PATH. Skipping auto-tunnel.")
        print("[INFO] If running cloudflared manually, use: & \"$HOME\\cloudflared.exe\" tunnel --url http://localhost:5001")
        return None

    print(f"[*] Starting Cloudflare Tunnel using: {cf_path}")
    try:
        proc = subprocess.Popen(
            [cf_path, "tunnel", "--url", "http://localhost:5001"],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1
        )

        def monitor_tunnel():
            registered = False
            for line in proc.stdout:
                line_str = line.strip()
                match = re.search(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com", line_str)
                if match:
                    tunnel_url = match.group(0)
                    if not registered:
                        registered = True
                        print("\n" + "=" * 60)
                        print(f"[*] DETECTED CLOUDFLARE PUBLIC TUNNEL: {tunnel_url}")
                        print("=" * 60)
                        register_tunnel_with_render(tunnel_url)

        t = threading.Thread(target=monitor_tunnel, daemon=True)
        t.start()
        return proc
    except Exception as e:
        print(f"[WARN] Could not launch cloudflared: {e}")
        return None

if __name__ == '__main__':
    import sys
    parser_tunnel = None
    no_cf = '--no-cf' in sys.argv
    for i, arg in enumerate(sys.argv):
        if arg == '--tunnel' and i + 1 < len(sys.argv):
            parser_tunnel = sys.argv[i + 1]

    print("=" * 60)
    print("MetaTrader 5 Python Gateway Bridge active on http://localhost:5001")
    print("Bridge endpoint: POST http://localhost:5001/api/mt5/status")
    print("=" * 60)

    if parser_tunnel:
        print(f"[*] Custom tunnel passed: {parser_tunnel}")
        register_tunnel_with_render(parser_tunnel)
    elif not no_cf:
        start_cloudflared_subservice()

    app.run(host='0.0.0.0', port=5001, debug=False)

