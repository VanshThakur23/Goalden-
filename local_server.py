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

    def log_message(self, fmt, *args):
        sys.stderr.write('%s - %s\n' % (self.address_string(), fmt % args))


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    print(f'Serving Goalden at http://localhost:{port}/index.html  (Ctrl+C to stop)')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
