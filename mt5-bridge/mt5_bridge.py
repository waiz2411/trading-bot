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

@app.route('/api/mt5/status', methods=['POST'])
def status():
    mt5.initialize()
    data = request.json or {}
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
    positions = mt5.positions_get()
    if positions:
        for p in positions:
            open_positions.append({
                'ticket': p.ticket,
                'symbol': p.symbol,
                'type': 'BUY' if p.type == mt5.ORDER_TYPE_BUY else 'SELL',
                'volume': float(p.volume),
                'priceOpen': float(p.price_open),
                'sl': float(p.sl) if p.sl else 0.0,
                'tp': float(p.tp) if p.tp else 0.0,
                'profit': float(p.profit),
                'comment': p.comment
            })

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
        'positions': open_positions
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
    if sl:
        request_payload["sl"] = float(sl)
    if tp:
        request_payload["tp"] = float(tp)

    result = mt5.order_send(request_payload)

    # If rejected due to invalid stops (retcode 10016), retry without SL/TP so market order executes
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

    return jsonify({
        'success': True,
        'ticket': result.order,
        'volume': result.volume,
        'price': result.price,
        'symbol': target_sym,
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

    closed_count = 0
    for pos in positions:
        if ticket and pos.ticket != int(ticket):
            continue
        if symbol and not pos.symbol.startswith(symbol):
            continue

        close_type = mt5.ORDER_TYPE_SELL if pos.type == mt5.ORDER_TYPE_BUY else mt5.ORDER_TYPE_BUY
        tick = mt5.symbol_info_tick(pos.symbol)
        if tick is None:
            continue
        close_price = tick.bid if pos.type == mt5.ORDER_TYPE_BUY else tick.ask

        sym_info = mt5.symbol_info(pos.symbol)
        filling_mode = mt5.ORDER_FILLING_IOC
        if sym_info:
            if sym_info.filling_mode & 1:
                filling_mode = mt5.ORDER_FILLING_FOK
            elif sym_info.filling_mode & 2:
                filling_mode = mt5.ORDER_FILLING_IOC
            else:
                filling_mode = mt5.ORDER_FILLING_RETURN

        close_req = {
            "action": mt5.TRADE_ACTION_DEAL,
            "position": pos.ticket,
            "symbol": pos.symbol,
            "volume": pos.volume,
            "type": close_type,
            "price": close_price,
            "deviation": 20,
            "magic": 241100,
            "comment": "NexusQuant Scalp Close",
            "type_time": mt5.ORDER_TIME_GTC,
            "type_filling": filling_mode,
        }
        res = mt5.order_send(close_req)
        if res and res.retcode == mt5.TRADE_RETCODE_DONE:
            closed_count += 1

    return jsonify({'success': True, 'closed': closed_count})

if __name__ == '__main__':
    print("=" * 60)
    print("MetaTrader 5 Python Gateway Bridge active on http://localhost:5001")
    print("Bridge endpoint: POST http://localhost:5001/api/mt5/status")
    print("=" * 60)
    app.run(host='0.0.0.0', port=5001, debug=False)
