"""
Local stand-in for src/worker.js, for testing Live Frontier without Node/wrangler.

Serves the static site from this directory and implements the same two
/api/* routes as the Cloudflare Worker (same upstreams, same response shape),
so goalden-lab.html works identically to how it will once the real Worker is
deployed. This file is a dev convenience only — it is not deployed anywhere;
src/worker.js remains the source of truth for the real proxy.

Usage:
    python local_server.py [port]      (default port 8000)
Then open http://localhost:8000/index.html
"""

import json
import os
import sys
import urllib.request
import urllib.parse
import urllib.error
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/124.0 Safari/537.36')


def upstream_json(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {'Accept': 'application/json'})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode('utf-8'))


def fetch_equity_history(symbol):
    url = ('https://query1.finance.yahoo.com/v8/finance/chart/'
           f'{urllib.parse.quote(symbol)}?range=5y&interval=1d')
    data = upstream_json(url, headers={'User-Agent': UA, 'Accept': 'application/json'})
    chart = data.get('chart') or {}
    if chart.get('error'):
        raise ValueError(chart['error'].get('description') or f'Yahoo error for {symbol}')
    results = chart.get('result') or []
    if not results:
        raise ValueError(f'No chart data for {symbol} — check the ticker (India needs .NS or .BO)')
    result = results[0]
    timestamps = result.get('timestamp') or []
    indicators = result.get('indicators') or {}
    quote = (indicators.get('quote') or [{}])[0]
    raw_closes = quote.get('close') or []
    # Yahoo's chart endpoint also returns an `adjclose` series alongside
    # `quote.close`, adjusted backward through every dividend and split so
    # it reflects total return (dividends reinvested), not just the price.
    # We used to read raw `close` only, which understates -- and can even
    # sign-flip -- the return of any high-dividend name. Verified on
    # VEDL.NS (Vedanta, large special dividends): raw close gives a 5y
    # CAGR of -3.1%, adjclose gives +12.2%. Prefer adjclose; fall back to
    # raw close only if Yahoo omits the series entirely (has happened for
    # some indices/ETFs with no distributions to adjust for).
    adjclose_series = ((indicators.get('adjclose') or [{}])[0]).get('adjclose')
    closes = adjclose_series if adjclose_series else raw_closes
    currency = (result.get('meta') or {}).get('currency') or 'INR'
    meta = result.get('meta') or {}
    label = meta.get('longName') or meta.get('shortName') or symbol

    prices = []
    for ts, c in zip(timestamps, closes):
        if c is None:
            continue
        import datetime
        d = datetime.datetime.utcfromtimestamp(ts).strftime('%Y-%m-%d')
        prices.append({'date': d, 'close': c})

    if len(prices) < 30:
        raise ValueError(f'Only {len(prices)} usable daily bars for {symbol} — too few to compute reliable stats')

    return {'id': symbol, 'label': label, 'currency': currency, 'prices': prices}


def fetch_fund_history(scheme_code):
    url = f'https://api.mfapi.in/mf/{urllib.parse.quote(str(scheme_code))}'
    data = upstream_json(url)
    rows = data.get('data') or []
    if not rows:
        raise ValueError(f'No NAV history for scheme {scheme_code}')

    prices = []
    for row in rows:
        parts = str(row.get('date', '')).split('-')
        if len(parts) != 3:
            continue
        dd, mm, yyyy = parts
        try:
            close = float(row.get('nav'))
        except (TypeError, ValueError):
            continue
        prices.append({'date': f'{yyyy}-{mm}-{dd}', 'close': close})
    prices.reverse()

    if len(prices) < 30:
        raise ValueError(f'Only {len(prices)} usable NAV entries for scheme {scheme_code} — too few to compute reliable stats')

    meta = data.get('meta') or {}
    return {
        'id': f'MF{scheme_code}',
        'label': meta.get('scheme_name') or f'Fund {scheme_code}',
        'currency': 'INR',
        'prices': prices,
    }


def fund_search(query):
    url = f'https://api.mfapi.in/mf/search?q={urllib.parse.quote(query)}'
    data = upstream_json(url)
    if not isinstance(data, list):
        data = []
    return [{'schemeCode': r.get('schemeCode'), 'schemeName': r.get('schemeName')} for r in data[:25]]


# ---------------------------------------------------------------------------
# Conversational AI advisor — /api/chat (POST)
# Mirrors the Cloudflare Worker's /api/chat. Reads DEEPSEEK_API_KEY from the
# environment; if it's absent, falls back to a deterministic mock reply so the
# chat UI and its tool loop can be exercised with no key and no network call.
# ---------------------------------------------------------------------------
DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions'


def _build_system_prompt(body):
    state = body.get('state') or {}
    ctx = body.get('context') or {}
    page = ctx.get('page') or 'start'
    app = ctx.get('app') or 'Goalden'
    screen_list = ', '.join(ctx.get('screens') or []) or '(unknown)'
    tools = body.get('tools') or []
    tool_desc = '\n'.join(
        f"- {t['function']['name']}: {t['function'].get('description', '')}"
        for t in tools if isinstance(t, dict) and t.get('function')
    )
    knowledge = body.get('knowledge') or ''
    knowledge_block = (
        'Everything you need to know about this part of Goalden — what it '
        'does, where its numbers come from, and its assumptions:\n'
        f'{knowledge}\n'
    ) if knowledge else ''
    return (
        f'You are the Goalden advisor, the friendly in-app assistant for '
        f'"{app}", an Indian personal-finance planning app (supports India ₹ '
        f'and United States $).\n\n'
        f'Your job: answer in plain language AND take action for them — fill '
        f'in an input, move the app to the right screen, run a real '
        f'calculation, then explain the result simply.\n\n'
        f'Adapt your language to the user. If they write in simple everyday '
        f'words, stay warm and jargon-free. If they use finance terms (SIP, '
        f'corpus, asset allocation), you may be more technical.\n\n'
        f'{knowledge_block}'
        f'The app\'s live state right now:\n'
        f'- Current screen: "{page}"\n'
        f'- Available screens: {screen_list}\n'
        f"- Goal type chosen: {state.get('goalType') or 'none yet'}\n"
        f"- User's answers so far: {json.dumps(state)}\n\n"
        f'Tools you may call (call them to act — never just describe what to '
        f'do):\n{tool_desc or "(none)"}\n\n'
        f'Rules:\n'
        f'- To change an input, call set_value(field, value) with a valid '
        f'field and value from its schema.\n'
        f'- To move the user to a screen, call navigate(screen) using ONLY a '
        f'screen name from "Available screens".\n'
        f'- To run the current calculation, call get_results(); to see what '
        f'they\'ve entered, call get_state().\n'
        f'- Never invent a number a tool would give you — call the tool and '
        f'read its result.\n'
        f'- When asked where a figure comes from or what something means, '
        f'answer from the knowledge above; if it isn\'t covered there, say '
        f'so rather than guessing.\n'
        f'- Keep replies short and conversational. Format money with the '
        f'user\'s currency symbol (₹ for IN, $ for US).\n'
        f'- Prefer driving the real interface: navigate to the right tool/'
        f'screen, set the values, scroll the result into view, then explain '
        f'what the user is looking at. Never describe a number without '
        f'putting it on screen.\n'
        f'- Narrate BEFORE acting (e.g. "Let me set that up — watch the '
        f'assumptions panel"), and after a multi-step sequence, say what '
        f'changed and what it means — not just that it\'s done.\n'
        f'- Choice before action (mandatory): When the user gives you enough '
        f'information to fill in multiple fields automatically (e.g. "I\'m 30, '
        f'retire at 60, expenses 50,000"), NEVER start acting immediately. First '
        f'offer them a clear choice on two lines:\n'
        f'  "I can either:\n'
        f'  A) Do it all for you — fill in the details, run the calculation, explain the result.\n'
        f'  B) Walk you through it step by step — you do each screen, I explain as we go.\n'
        f'  Which would you prefer?"\n'
        f'Wait for their reply before touching any field or calling any tool that mutates state.\n\n'
        f'Advice guardrail (a hard line — never cross it):\n'
        f'You MAY: explain what a mix or calculation does; compare mixes on '
        f'return and risk; show where a portfolio sits relative to the '
        f'efficient frontier; describe what history did; run the app\'s own '
        f'calculations; and explain every term in plain language.\n'
        f'You MUST NOT: recommend a specific named stock, ETF or mutual fund '
        f'to buy; predict a price or a future return; or tell the user what '
        f'they personally should do with their money.\n'
        f'When a user asks "what should I buy?", explain the categories, '
        f'show the trade-off, offer to model whichever specific instruments '
        f'the user names, and say plainly that you are not a licensed adviser.'
    )


def _deepseek_chat(messages, tools, api_key):
    req = urllib.request.Request(
        DEEPSEEK_URL,
        data=json.dumps({
            'model': 'deepseek-chat',
            'messages': messages,
            'tools': tools if tools else None,
            'tool_choice': 'auto' if tools else None,
            'temperature': 0.3,
        }).encode('utf-8'),
        headers={
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {api_key}',
        },
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read().decode('utf-8'))
    choice = (data.get('choices') or [{}])[0]
    return choice.get('message') or {'role': 'assistant', 'content': ''}


def _mock_chat(body):
    """Deterministic stand-in when no API key is set.

    Drives the same tool loop the frontend would run against a real model: if
    there's any app state yet (S/G have goalType, L has a tab and inputs), it
    requests get_results(); once the tool result comes back it replies with
    plain text and stops. This exercises executeTool -> feed-back -> plain-
    answer with no network and no key, on every page (not just Door 1).
    """
    messages = body.get('messages') or []
    state = body.get('state') or {}
    if messages and messages[-1].get('role') == 'tool':
        result = (messages[-1].get('content') or '')[:400]
        return {'role': 'assistant',
                'content': f'(mock mode) Here is what your numbers look like:\n{result}'}
    if not state:
        return {'role': 'assistant',
                'content': "Hi, I'm your Goalden advisor (mock mode — no API key set). "
                           "Tell me what you're planning for — retirement, education, a "
                           "big purchase — or ask a question, and I'll walk you through it."}
    return {'role': 'assistant', 'content': None,
            'tool_calls': [{'id': 'call_mock_1', 'type': 'function',
                            'function': {'name': 'get_results', 'arguments': '{}'}}]}


def chat(body):
    messages = [{'role': 'system', 'content': _build_system_prompt(body)}]
    messages += body.get('messages') or []
    api_key = os.environ.get('DEEPSEEK_API_KEY')
    if api_key:
        return _deepseek_chat(messages, body.get('tools') or [], api_key)
    return _mock_chat(body)


class Handler(SimpleHTTPRequestHandler):
    def _send_json(self, obj, status=200):
        body = json.dumps(obj).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)

        if parsed.path == '/api/history':
            kind = (qs.get('type') or [None])[0]
            try:
                if kind == 'equity':
                    symbol = (qs.get('symbol') or [None])[0]
                    if not symbol:
                        return self._send_json({'error': 'symbol is required'}, 400)
                    return self._send_json(fetch_equity_history(symbol))
                if kind == 'fund':
                    scheme = (qs.get('scheme') or [None])[0]
                    if not scheme:
                        return self._send_json({'error': 'scheme is required'}, 400)
                    return self._send_json(fetch_fund_history(scheme))
                return self._send_json({'error': 'type must be "equity" or "fund"'}, 400)
            except Exception as e:
                return self._send_json({'error': str(e) or 'Failed to fetch history'}, 502)

        if parsed.path == '/api/fundsearch':
            q = (qs.get('q') or [None])[0]
            if not q:
                return self._send_json({'error': 'q is required'}, 400)
            try:
                return self._send_json(fund_search(q))
            except Exception as e:
                return self._send_json({'error': str(e) or 'Fund search failed'}, 502)

        return super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == '/api/chat':
            try:
                length = int(self.headers.get('Content-Length') or 0)
                body = json.loads(self.rfile.read(length).decode('utf-8') or '{}')
                return self._send_json({'message': chat(body)})
            except Exception as e:
                return self._send_json({'error': str(e) or 'Chat failed'}, 502)
        return self._send_json({'error': 'Not found'}, 404)

    def log_message(self, fmt, *args):
        sys.stderr.write('%s - %s\n' % (self.address_string(), fmt % args))


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    _key_status = 'REAL AI (DeepSeek key found)' if os.environ.get('DEEPSEEK_API_KEY') else 'MOCK MODE (no DEEPSEEK_API_KEY set)'
    print(f'Serving Goalden at http://localhost:{port}/index.html  (Ctrl+C to stop)')
    print(f'Advisor: {_key_status}')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
