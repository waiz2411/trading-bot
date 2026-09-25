"""
MetaTrader 5 Python Gateway Bridge for NexusQuant
Runs a local HTTP REST microservice on port 5001 that bridges
NexusQuant requests directly to your locally installed MetaTrader 5 terminal.
"""
import time
import datetime
from flask import Flask, request, jsonify
from flask_cors import CORS
import MetaTrader5 as mt5

app = Flask(__name__)
CORS(app)

position_first_seen = {}
last_deals_fetch_ts = 0
cached_deals_history = []
cached_total_realized_profit = 0.0

def safe_float(val, default=0.0):
    if val is None:
        return default
    try:
        return float(val)
    except (ValueError, TypeError):
        return default

def safe_int(val, default=0):
    if val is None:
        return default
    try:
        return int(val)
    except (ValueError, TypeError):
        return default

def is_tradable(s_info):
    if s_info is None:
        return False
    # trade_mode == 0 is SYMBOL_TRADE_MODE_DISABLED
    trade_mode = getattr(s_info, 'trade_mode', None)
    if trade_mode is not None and trade_mode == 0:
        return False
    return True

def prewarm_symbols():
    common_syms = [
        'EURUSDm', 'GBPUSDm', 'USDJPYm', 'AUDUSDm', 'USDCADm', 'USDCHFm', 'NZDUSDm',
        'EURGBPm', 'EURJPYm', 'GBPJPYm', 'AUDJPYm', 'CADJPYm', 'CHFJPYm', 'EURCADm',
        'XAUUSDm', 'XAGUSDm', 'BTCUSDm', 'ETHUSDm', 'BTCm', 'ETHm',
        'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'USDCHF', 'NZDUSD',
        'XAUUSD', 'BTCUSD', 'ETHUSD'
    ]
    for sym in common_syms:
        try:
            mt5.symbol_select(sym, True)
        except Exception:
            pass

def ensure_mt5(login=None, password=None, server=None):
    term = mt5.terminal_info()
    curr_acc = mt5.account_info()

    if login and server and password:
        login_int = int(login) if str(login).isdigit() else login
        server_str = str(server).strip()
        needs_login = (
            curr_acc is None or 
            str(curr_acc.login) != str(login) or 
            (getattr(curr_acc, 'server', None) and str(curr_acc.server).strip().lower() != server_str.lower())
        )
        if needs_login:
            print(f"[*] Switching/Logging into MT5 account #{login} on {server}...")
            ok = False
            try:
                ok = mt5.login(login=login_int, password=str(password), server=server_str)
            except Exception as e:
                print(f"[!] mt5.login exception: {e}")
            if not ok:
                ok = mt5.initialize(login=login_int, password=str(password), server=server_str)
            if not ok:
                print(f"[!] Login failed: {mt5.last_error()}")
                return False
            print(f"[OK] Successfully logged into account #{login} on {server}")
            prewarm_symbols()
            return True
        return True

    if term is None or curr_acc is None:
        ok = mt5.initialize()
        if ok:
            prewarm_symbols()
        return ok
    return True

def find_broker_symbol(raw_sym):
    if not raw_sym:
        return 'EURUSDm'
    clean = str(raw_sym).upper().strip()
    if clean.endswith('=X') or clean.endswith('=F'):
        clean = clean[:-2]
    clean = clean.replace('=', '').replace('/', '').replace('_', '').replace('-', '').replace('^', '')
    if clean.endswith('USDT'):
        clean = clean[:-1]  # BTCUSDT -> BTCUSD

    # 1. First, check tradable standard suffix variations (m=Exness standard, c=cent, raw, etc.)
    # Exness standard accounts almost always use the 'm' suffix for active trading!
    for cand in [clean + 'm', clean + 'M', clean, raw_sym, clean + 'c', clean + '.raw', clean + '_i']:
        s_info = mt5.symbol_info(cand)
        if is_tradable(s_info):
            if not s_info.visible:
                mt5.symbol_select(cand, True)
            return cand

    # 2. Crypto short names (e.g. BTC, ETH on Exness)
    if clean.startswith('BTC'):
        for cand in ['BTCUSDm', 'BTCm', 'BTC', 'BTCUSD', 'BTC/USD', 'BTCUSDT']:
            s_info = mt5.symbol_info(cand)
            if is_tradable(s_info):
                if not s_info.visible:
                    mt5.symbol_select(cand, True)
                return cand
    if clean.startswith('ETH'):
        for cand in ['ETHUSDm', 'ETHm', 'ETH', 'ETHUSD', 'ETH/USD', 'ETHUSDT']:
            s_info = mt5.symbol_info(cand)
            if is_tradable(s_info):
                if not s_info.visible:
                    mt5.symbol_select(cand, True)
                return cand

    # 3. Gold / Silver commodities
    if clean.startswith('GC') or clean.startswith('XAU'):
        for cand in ['XAUUSDm', 'XAUUSD', 'GOLDm', 'GOLD']:
            s_info = mt5.symbol_info(cand)
            if is_tradable(s_info):
                if not s_info.visible:
                    mt5.symbol_select(cand, True)
                return cand

    # 4. Slashes for Forex (EUR/USD)
    if len(clean) == 6:
        slash_cand = f"{clean[:3]}/{clean[3:]}"
        s_info = mt5.symbol_info(slash_cand)
        if is_tradable(s_info):
            if not s_info.visible:
                mt5.symbol_select(slash_cand, True)
            return slash_cand

    # 5. Dynamic search through all symbols in terminal catalog for tradable match
    try:
        all_syms = mt5.symbols_get()
        if all_syms:
            for s in all_syms:
                if getattr(s, 'trade_mode', None) == 0:
                    continue
                s_clean = s.name.upper().replace('/', '').replace('_', '').replace('.', '').replace('-', '')
                if s_clean == clean or s_clean == clean + 'M' or s_clean == clean + 'C':
                    if not s.visible:
                        mt5.symbol_select(s.name, True)
                    return s.name
            for s in all_syms:
                if getattr(s, 'trade_mode', None) == 0:
                    continue
                s_clean = s.name.upper().replace('/', '').replace('_', '').replace('.', '').replace('-', '')
                if (clean in s_clean and len(s_clean) <= len(clean) + 3) or (s_clean in clean and len(clean) <= len(s_clean) + 3):
                    if not s.visible:
                        mt5.symbol_select(s.name, True)
                    return s.name
    except Exception as e:
        print(f"[Symbols] Error searching symbol catalog: {e}")

    return clean + 'm' if len(clean) == 6 else clean

@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ONLINE', 'bridge': 'MT5-Python-Bridge', 'port': 5001})

@app.route('/api/mt5/status', methods=['GET', 'POST'])
def status():
    data = {}
    if request.is_json and request.json:
        data = request.json

    login = data.get('login')
    password = data.get('password')
    server = data.get('server')

    if login and password and server:
        login_ok = ensure_mt5(login, password, server)
        if not login_ok:
            return jsonify({
                'success': False,
                'error': f'Failed to log into MT5 account #{login} on {server}: {mt5.last_error()}'
            }), 400
    else:
        ensure_mt5()

    account_info = mt5.account_info()
    if account_info is None:
        return jsonify({
            'success': False,
            'error': f'Failed to fetch account info from MT5 terminal: {mt5.last_error()}'
        }), 400

    terminal_info = mt5.terminal_info()
    algo_allowed = bool(terminal_info.trade_allowed) if terminal_info else True

    # Retrieve live open positions with multi-attempt fallback
    open_positions = []
    positions = None
    try:
        for attempt in range(3):
            positions = mt5.positions_get()
            if positions is not None and len(positions) > 0:
                break
            # Try with group filter
            positions = mt5.positions_get(group="*")
            if positions is not None and len(positions) > 0:
                break
            time.sleep(0.06)

        tot = mt5.positions_total()
        if (positions is None or len(positions) == 0) and tot and tot > 0:
            print(f"[Positions] positions_total={tot} but positions_get was empty. Scanning common symbols...")
            for sym_name in ['BTC', 'BTCUSD', 'BTC/USD', 'BTCUSDm', 'EURUSD', 'EUR/USD', 'EURUSDm', 'GBPUSD', 'GBP/USD', 'XAUUSD', 'XAU/USD', 'AUDUSD', 'AUD/USD']:
                try:
                    sym_pos = mt5.positions_get(symbol=sym_name)
                    if sym_pos and len(sym_pos) > 0:
                        positions = (positions or ()) + sym_pos
                        print(f"[Positions] Found {len(sym_pos)} open positions for symbol='{sym_name}'")
                except Exception:
                    pass

        if positions:
            now_ts = int(time.time())
            for p in positions:
                try:
                    ticket_id = safe_int(getattr(p, 'ticket', 0))
                    if ticket_id not in position_first_seen:
                        position_first_seen[ticket_id] = now_ts

                    p_profit = safe_float(getattr(p, 'profit', 0.0))
                    p_swap = safe_float(getattr(p, 'swap', 0.0))
                    broker_profit = round(p_profit + p_swap, 2)
                    open_price = safe_float(getattr(p, 'price_open', 0.0))
                    curr_price = safe_float(getattr(p, 'price_current', 0.0), default=open_price)
                    raw_symbol = str(getattr(p, 'symbol', '') or '')
                    pos_type = safe_int(getattr(p, 'type', 0))
                    side_str = 'BUY' if pos_type in (mt5.ORDER_TYPE_BUY, 0) else 'SELL'
                    pos_time = safe_int(getattr(p, 'time', 0))

                    # Accurate age: compare against broker tick time or wall-clock tracking
                    ref_tick = mt5.symbol_info_tick(raw_symbol) if raw_symbol else None
                    server_now = safe_int(getattr(ref_tick, 'time', 0))
                    if server_now > 0 and pos_time > 0:
                        calc_age = max(0, server_now - pos_time)
                    else:
                        calc_age = max(0, now_ts - pos_time) if pos_time > 0 else 0

                    wall_age = max(0, now_ts - position_first_seen[ticket_id])
                    age_seconds = max(calc_age, wall_age)

                    open_positions.append({
                        'ticket': ticket_id,
                        'symbol': raw_symbol,
                        'type': side_str,
                        'volume': safe_float(getattr(p, 'volume', 0.01)),
                        'priceOpen': open_price,
                        'priceCurrent': curr_price,
                        'sl': safe_float(getattr(p, 'sl', 0.0)),
                        'tp': safe_float(getattr(p, 'tp', 0.0)),
                        'profit': broker_profit,
                        'time': pos_time,
                        'timeMsc': safe_int(getattr(p, 'time_msc', 0)),
                        'ageSeconds': age_seconds,
                        'comment': str(getattr(p, 'comment', '') or '')
                    })
                except Exception as pos_err:
                    print(f"[Positions] Error parsing position: {pos_err}")
    except Exception as e:
        print(f"[Status] Error fetching positions: {e}")

    # Retrieve recent closed deals from broker history (with 25s cache to guarantee < 50ms responses)
    global last_deals_fetch_ts, cached_deals_history, cached_total_realized_profit
    now_ts = int(time.time())

    if (now_ts - last_deals_fetch_ts > 25) or not cached_deals_history:
        deals_history = []
        total_realized_profit = 0.0
        try:
            from_date = datetime.datetime.now() - datetime.timedelta(days=14)
            to_date = datetime.datetime.now() + datetime.timedelta(days=1)
            deals = mt5.history_deals_get(from_date, to_date)
            if deals:
                for d in deals:
                    deal_type = safe_int(getattr(d, 'type', -1))
                    if deal_type in (mt5.DEAL_TYPE_BUY, mt5.DEAL_TYPE_SELL, 0, 1) and getattr(d, 'entry', None) in (mt5.DEAL_ENTRY_OUT, mt5.DEAL_ENTRY_INOUT, 1, 2):
                        deal_profit = round(
                            safe_float(getattr(d, 'profit', 0.0)) +
                            safe_float(getattr(d, 'swap', 0.0)) +
                            safe_float(getattr(d, 'commission', 0.0)),
                            2
                        )
                        total_realized_profit += deal_profit
                        deal_time = safe_int(getattr(d, 'time', 0))
                        deal_price = safe_float(getattr(d, 'price', 0.0))
                        deal_side = 'BUY' if deal_type == mt5.DEAL_TYPE_BUY else 'SELL'
                        deals_history.append({
                            'id': f"MT5-{safe_int(d.ticket)}",
                            'ticket': safe_int(d.ticket),
                            'order': safe_int(getattr(d, 'order', d.ticket)),
                            'positionId': safe_int(getattr(d, 'position_id', d.ticket)),
                            'time': deal_time,
                            'exitTime': datetime.datetime.fromtimestamp(deal_time).isoformat() if deal_time > 0 else '',
                            'symbol': str(getattr(d, 'symbol', '') or ''),
                            'side': deal_side,
                            'volume': safe_float(getattr(d, 'volume', 0.01)),
                            'units': safe_float(getattr(d, 'volume', 0.01)),
                            'price': deal_price,
                            'entryPrice': deal_price,
                            'exitPrice': deal_price,
                            'profit': deal_profit,
                            'finalPnL': deal_profit,
                            'exitReason': 'BROKER_CLOSE',
                            'comment': str(getattr(d, 'comment', '') or '')
                        })
                cached_deals_history = deals_history
                cached_total_realized_profit = round(total_realized_profit, 2)
                last_deals_fetch_ts = now_ts
        except Exception as e:
            print(f"[Deals] Error retrieving deals history: {e}")
    else:
        deals_history = cached_deals_history
        total_realized_profit = cached_total_realized_profit

    # Log clean summary to terminal
    print(f"[Status] Acc #{account_info.login} ({account_info.server}): Bal=${account_info.balance:.2f}, Eq=${account_info.equity:.2f}, Margin=${account_info.margin:.2f} | Open={len(open_positions)} deals={len(deals_history)}")
    if open_positions:
        for op in open_positions:
            print(f"   -> #{op['ticket']}: {op['symbol']} {op['type']} {op['volume']} lots @ {op['priceOpen']} | PnL: ${op['profit']}")

    # Collect live market ticks for major Forex scalping symbols
    market_ticks = {}
    major_symbols = [
        'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'USDCHF', 'NZDUSD',
        'CHFJPY', 'EURJPY', 'GBPJPY', 'AUDJPY', 'CADJPY', 'GBPCAD', 'GBPAUD', 'EURAUD'
    ]
    for ms in major_symbols:
        tsym = find_broker_symbol(ms)
        tk = mt5.symbol_info_tick(tsym)
        if tk and getattr(tk, 'bid', 0) > 0:
            market_ticks[ms] = {
                'symbol': ms,
                'brokerSymbol': tsym,
                'bid': safe_float(tk.bid),
                'ask': safe_float(tk.ask),
                'price': round(safe_float((tk.bid + tk.ask) / 2.0), 5),
                'spread': round(safe_float(tk.ask - tk.bid), 5),
                'time': safe_int(getattr(tk, 'time', int(time.time())))
            }

    return jsonify({
        'success': True,
        'login': account_info.login,
        'balance': safe_float(account_info.balance),
        'equity': safe_float(account_info.equity),
        'margin': safe_float(account_info.margin),
        'freeMargin': safe_float(account_info.margin_free),
        'leverage': safe_int(account_info.leverage, 500),
        'currency': str(getattr(account_info, 'currency', 'USD')),
        'company': str(getattr(account_info, 'company', 'Exness')),
        'server': str(getattr(account_info, 'server', '')),
        'algoTradingEnabled': algo_allowed,
        'positions': open_positions,
        'realizedProfit': round(total_realized_profit, 2),
        'closedDeals': deals_history,
        'marketTicks': market_ticks,
        'serverTime': int(time.time())
    })

@app.route('/api/mt5/order', methods=['POST'])
def place_order():
    ensure_mt5()
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

    target_sym = find_broker_symbol(symbol)
    symbol_info = mt5.symbol_info(target_sym) if target_sym else None
    if symbol_info is None:
        return jsonify({'success': False, 'error': f'Symbol {symbol} (resolved: {target_sym}) not found in broker catalog'}), 400

    if not symbol_info.visible:
        mt5.symbol_select(target_sym, True)
        time.sleep(0.1)

    tick = None
    for _ in range(15):
        tick = mt5.symbol_info_tick(target_sym)
        if tick is not None and getattr(tick, 'bid', 0) > 0 and getattr(tick, 'ask', 0) > 0:
            break
        time.sleep(0.1)

    if tick is None or getattr(tick, 'bid', 0) <= 0 or getattr(tick, 'ask', 0) <= 0:
        return jsonify({'success': False, 'error': f'Cannot get live tick for {target_sym}'}), 400

    order_type = mt5.ORDER_TYPE_BUY if side == 'BUY' else mt5.ORDER_TYPE_SELL
    price = tick.ask if side == 'BUY' else tick.bid

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

    vol_min = safe_float(getattr(symbol_info, 'volume_min', 0.01), default=0.01)
    vol_max = safe_float(getattr(symbol_info, 'volume_max', 100.0), default=100.0)
    vol_step = safe_float(getattr(symbol_info, 'volume_step', 0.01), default=0.01)
    volume = max(vol_min, min(vol_max, volume))
    if vol_step > 0:
        volume = round(round(volume / vol_step) * vol_step, 2)

    dev = 100 if any(k in target_sym.upper() for k in ['BTC', 'ETH', 'XAU', 'GOLD', 'USOIL', 'OIL', 'US30', 'US500']) else 50

    request_payload = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": target_sym,
        "volume": volume,
        "type": order_type,
        "price": price,
        "deviation": dev,
        "magic": 241100,
        "comment": comment,
        "type_time": mt5.ORDER_TIME_GTC,
    }
    if safe_sl is not None:
        request_payload["sl"] = safe_sl
    if safe_tp is not None:
        request_payload["tp"] = safe_tp

    filling_modes = [mt5.ORDER_FILLING_IOC, mt5.ORDER_FILLING_RETURN, mt5.ORDER_FILLING_FOK]
    if symbol_info.filling_mode & 1:
        filling_modes = [mt5.ORDER_FILLING_FOK, mt5.ORDER_FILLING_IOC, mt5.ORDER_FILLING_RETURN]
    elif symbol_info.filling_mode & 2:
        filling_modes = [mt5.ORDER_FILLING_IOC, mt5.ORDER_FILLING_RETURN, mt5.ORDER_FILLING_FOK]

    result = None
    for fm in filling_modes:
        request_payload["type_filling"] = fm
        result = mt5.order_send(request_payload)
        if result and result.retcode == mt5.TRADE_RETCODE_DONE:
            break
        # If rejected due to invalid stops (retcode 10016), retry without SL/TP and then set stops via SLTP action
        if result and result.retcode == 10016:
            request_payload.pop("sl", None)
            request_payload.pop("tp", None)
            result = mt5.order_send(request_payload)
            if result and result.retcode == mt5.TRADE_RETCODE_DONE:
                break

    if result is None or result.retcode != mt5.TRADE_RETCODE_DONE:
        err_msg = result.comment if result else f'order_send failed: {mt5.last_error()}'
        retcode = result.retcode if result else -1
        return jsonify({
            'success': False,
            'retcode': retcode,
            'comment': err_msg,
            'error': f'Order failed: {err_msg} (code {retcode})'
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
    ensure_mt5()
    data = request.json or {}
    symbol = data.get('symbol')
    ticket = data.get('ticket')

    positions = None
    target_ticket = int(ticket) if (ticket and str(ticket).isdigit()) else None

    if target_ticket is not None:
        positions = mt5.positions_get(ticket=target_ticket)
    if (positions is None or len(positions) == 0) and symbol:
        target_sym = find_broker_symbol(symbol)
        positions = mt5.positions_get(symbol=target_sym)
    if positions is None or len(positions) == 0:
        positions = mt5.positions_get()

    if positions is None or len(positions) == 0:
        return jsonify({'success': True, 'closed': 0, 'message': 'No open positions found.'})

    def normalize_sym(s):
        return str(s).upper().replace('/', '').replace('_', '').replace('.', '').replace('-M', '').replace('M', '').replace('=X', '')

    target_norm = normalize_sym(symbol) if symbol else None

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

        # Make sure symbol is selected and visible
        mt5.symbol_select(pos.symbol, True)

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
                time.sleep(0.06)
                tick = mt5.symbol_info_tick(pos.symbol)
            if tick is None:
                continue
            close_price = tick.bid if pos.type == mt5.ORDER_TYPE_BUY else tick.ask

            dev = 100 if any(k in str(pos.symbol).upper() for k in ['BTC', 'ETH', 'XAU', 'GOLD', 'USOIL', 'OIL', 'US30', 'US500']) else 50
            close_req = {
                "action": mt5.TRADE_ACTION_DEAL,
                "position": int(pos.ticket),
                "symbol": str(pos.symbol),
                "volume": float(pos.volume),
                "type": close_type,
                "price": close_price,
                "deviation": dev,
                "magic": 241100,
                "comment": "NexusQuant Scalp Close",
                "type_time": mt5.ORDER_TIME_GTC,
                "type_filling": fm,
            }
            res = mt5.order_send(close_req)
            if res and res.retcode == mt5.TRADE_RETCODE_DONE:
                closed_count += 1
                print(f"[Close] Position #{pos.ticket} ({pos.symbol}) closed successfully with filling mode {fm}.")
                position_first_seen.pop(int(pos.ticket), None)
                break
            else:
                print(f"[Close] Position #{pos.ticket} attempt failed (mode {fm}, retcode {getattr(res, 'retcode', 'None')}: {getattr(res, 'comment', 'error')})")

    return jsonify({'success': True, 'closed': closed_count})

RENDER_BACKEND = "https://trading-bot-test-z6bi.onrender.com"

def register_tunnel_with_render(tunnel_url):
    import os
    import urllib.request
    import json
    backends = [
        "http://localhost:5000",
        os.environ.get("BACKEND_URL"),
        RENDER_BACKEND
    ]
    registered_any = False
    for base in backends:
        if not base:
            continue
        target = f"{base.rstrip('/')}/api/broker/mt5/register-tunnel"
        try:
            req = urllib.request.Request(
                target,
                data=json.dumps({"url": tunnel_url}).encode("utf-8"),
                headers={"Content-Type": "application/json"}
            )
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                if data.get("success"):
                    print(f"[OK] Successfully auto-registered Cloudflare Tunnel with {target}: {tunnel_url}")
                    registered_any = True
        except Exception:
            pass
    return registered_any

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

                        # Keep Render synced via periodic heartbeat every 60s
                        def heartbeat():
                            import time
                            while True:
                                time.sleep(60)
                                register_tunnel_with_render(tunnel_url)
                        threading.Thread(target=heartbeat, daemon=True).start()

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

