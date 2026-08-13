/**
 * Goalden Lab — live-data proxy.
 *
 * Serves the static site (goalden.html, goalden-door2.html, goalden-lab.html,
 * index.html, vendor/*) via the [assets] binding, and handles a small set of
 * /api/* routes that the Lab's "Live Frontier" tab calls to get real market
 * data without hitting CORS walls or exposing rate limits to the client.
 *
 * Every route normalises its result to the same shape so the calculation
 * engine in goalden-lab.html never has to know which upstream it came from:
 *   { id, label, currency, prices: [{ date: 'YYYY-MM-DD', close: number }, ...] }
 * prices is always oldest-first.
 *
 * Verified live sources (see plan doc for the raw responses this was built
 * against):
 *   - Yahoo Finance chart endpoint for equities/ETFs (SBIN.NS, TITAN.NS both
 *     confirmed working; the final bar's close is null on both — filtered
 *     out below, not treated as an error).
 *   - MFAPI.in for Indian mutual fund NAV history (scheme 119551 confirmed:
 *     2250+ daily entries, newest-first, DD-MM-YYYY — reversed and
 *     reformatted below to match the equity shape).
 *   - Stooq was tried first and rejected: no data for Indian equity symbols.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS },
  });
}

/**
 * GET /api/history?type=equity&symbol=TITAN.NS
 * Pulls daily bars from Yahoo's chart endpoint. Indian tickers need the
 * ".NS" (NSE) or ".BO" (BSE) suffix — that's the caller's job, not this
 * function's; we pass whatever symbol we're given straight through.
 */
async function fetchEquityHistory(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5y&interval=1d`;
  const res = await fetch(url, {
    headers: {
      // Yahoo's chart endpoint 999s requests with no UA at all.
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      Accept: 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Yahoo returned ${res.status} for ${symbol}`);
  const data = await res.json();
  const err = data && data.chart && data.chart.error;
  if (err) throw new Error(err.description || `Yahoo error for ${symbol}`);
  const result = data && data.chart && data.chart.result && data.chart.result[0];
  if (!result) throw new Error(`No chart data for ${symbol} — check the ticker (India needs .NS or .BO)`);

  const timestamps = result.timestamp || [];
  const quote = (result.indicators && result.indicators.quote && result.indicators.quote[0]) || {};
  const rawCloses = quote.close || [];
  // Yahoo's chart endpoint also returns an `adjclose` series alongside
  // `quote.close`, adjusted backward through every dividend and split so
  // it reflects total return (dividends reinvested), not just the price.
  // Reading raw `close` only understates -- and can even sign-flip -- the
  // return of any high-dividend name. Verified on VEDL.NS (Vedanta, large
  // special dividends): raw close gives a 5y CAGR of -3.1%, adjclose gives
  // +12.2%. Prefer adjclose; fall back to raw close only if Yahoo omits
  // the series entirely (seen for some indices/ETFs with nothing to
  // adjust for). Mirrors the identical change in local_server.py.
  const adjcloseSeries = result.indicators && result.indicators.adjclose && result.indicators.adjclose[0] && result.indicators.adjclose[0].adjclose;
  const closes = adjcloseSeries && adjcloseSeries.length ? adjcloseSeries : rawCloses;
  const currency = (result.meta && result.meta.currency) || 'INR';
  const label = (result.meta && (result.meta.longName || result.meta.shortName)) || symbol;

  const prices = [];
  for (let i = 0; i < timestamps.length; i++) {
    const c = closes[i];
    // The most recent bar is frequently an in-progress session with a null
    // close (confirmed on both SBIN.NS and TITAN.NS) — skip it rather than
    // let a NaN return poison every downstream stat.
    if (c === null || c === undefined) continue;
    prices.push({ date: new Date(timestamps[i] * 1000).toISOString().slice(0, 10), close: c });
  }

  if (prices.length < 30) {
    throw new Error(`Only ${prices.length} usable daily bars for ${symbol} — too few to compute reliable stats`);
  }

  return { id: symbol, label, currency, prices };
}

/**
 * GET /api/history?type=fund&scheme=119551
 * MFAPI.in NAV history for an Indian mutual fund scheme code.
 */
async function fetchFundHistory(schemeCode) {
  const url = `https://api.mfapi.in/mf/${encodeURIComponent(schemeCode)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`MFAPI returned ${res.status} for scheme ${schemeCode}`);
  const data = await res.json();
  const rows = data && data.data;
  if (!rows || !rows.length) throw new Error(`No NAV history for scheme ${schemeCode}`);

  // MFAPI returns newest-first, dates as "DD-MM-YYYY". Flip both.
  const prices = rows
    .map((row) => {
      const parts = String(row.date).split('-');
      if (parts.length !== 3) return null;
      const [dd, mm, yyyy] = parts;
      const close = parseFloat(row.nav);
      if (!isFinite(close)) return null;
      return { date: `${yyyy}-${mm}-${dd}`, close };
    })
    .filter(Boolean)
    .reverse();

  if (prices.length < 30) {
    throw new Error(`Only ${prices.length} usable NAV entries for scheme ${schemeCode} — too few to compute reliable stats`);
  }

  const meta = data.meta || {};
  return {
    id: `MF${schemeCode}`,
    label: meta.scheme_name || `Fund ${schemeCode}`,
    currency: 'INR',
    prices,
  };
}

/**
 * GET /api/fundsearch?q=gilt
 * Straight proxy of MFAPI's own search — it already returns reasonable
 * matches, unlike Yahoo's search which returns wrong-country listings for
 * Indian names (verified: searching "titan" on Yahoo returns Shenzhen /
 * Kuala Lumpur / Frankfurt tickers, never TITAN.NS).
 */
async function fundSearch(query) {
  const url = `https://api.mfapi.in/mf/search?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`MFAPI search returned ${res.status}`);
  const data = await res.json();
  return (Array.isArray(data) ? data : []).slice(0, 25).map((r) => ({
    schemeCode: r.schemeCode,
    schemeName: r.schemeName,
  }));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (url.pathname === '/api/history') {
      const type = url.searchParams.get('type');
      try {
        if (type === 'equity') {
          const symbol = url.searchParams.get('symbol');
          if (!symbol) return json({ error: 'symbol is required' }, 400);
          return json(await fetchEquityHistory(symbol));
        }
        if (type === 'fund') {
          const scheme = url.searchParams.get('scheme');
          if (!scheme) return json({ error: 'scheme is required' }, 400);
          return json(await fetchFundHistory(scheme));
        }
        return json({ error: 'type must be "equity" or "fund"' }, 400);
      } catch (e) {
        return json({ error: (e && e.message) || 'Failed to fetch history' }, 502);
      }
    }

    if (url.pathname === '/api/fundsearch') {
      const q = url.searchParams.get('q');
      if (!q) return json({ error: 'q is required' }, 400);
      try {
        return json(await fundSearch(q));
      } catch (e) {
        return json({ error: (e && e.message) || 'Fund search failed' }, 502);
      }
    }

    // Not an API route — serve the static site.
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Not found', { status: 404 });
  },
};
