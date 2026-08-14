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
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS },
  });
}

// /api/chat is a paid endpoint (it spends the owner's DeepSeek credits), so
// it is locked down far more tightly than the read-only GET market-data
// routes, which keep the wildcard below. The Origin allowlist + per-IP rate
// limit + body cap are the actual protection: CORS headers only stop a
// *browser* from reading a response, they never stopped a curl from spending
// credits, so the server-side checks are what matter here.
const ALLOWED_ORIGINS = new Set([
  'http://localhost:8000',
  'http://localhost:8080',
]);

function isAllowedOrigin(origin, requestUrl) {
  if (!origin) return true; // non-browser client, or a same-origin request that omitted Origin
  if (ALLOWED_ORIGINS.has(origin)) return true;
  try { return origin === new URL(requestUrl).origin; } catch (e) { return false; }
}

// Per-IP rate limit, keyed on the CF-Connecting-IP header Cloudflare injects
// (falls back to 'unknown' when absent, e.g. under `wrangler dev`). A simple
// in-memory Map of timestamps is fine at demo scale — a Durable Object or KV
// would be overkill for 50-200 people, and would add a billing surface.
const chatHits = new Map();
function rateLimitOk(ip) {
  const now = Date.now();
  const window = 60 * 1000;
  const hits = (chatHits.get(ip) || []).filter((t) => now - t < window);
  if (hits.length >= 20) { chatHits.set(ip, hits); return false; }
  hits.push(now);
  chatHits.set(ip, hits);
  return true;
}

function chatJson(data, status, origin) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8' };
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  else headers['Access-Control-Allow-Origin'] = '*';
  headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
  headers['Access-Control-Allow-Headers'] = 'Content-Type';
  return new Response(JSON.stringify(data), { status: status || 200, headers });
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

/**
 * Conversational AI advisor — POST /api/chat
 *
 * The browser sends the running conversation plus the current app state and
 * the dynamic tool list (built from that page's flow()). We assemble the
 * system prompt here so the model knows what Goalden is, where the user is
 * right now, what they've already told us, and exactly which tools it may
 * call. The frontend owns tool *execution* — we only return the model's
 * assistant message (which may carry a `tool_calls` array the frontend then
 * runs and feeds back) — so the model can never directly mutate app state.
 *
 * The key lives in the `DEEPSEEK_API_KEY` Worker secret, never in any HTML.
 */
const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';

function buildSystemPrompt(body) {
  const state = body.state || {};
  const ctx = body.context || {};
  const page = ctx.page || 'start';
  const app = ctx.app || 'Goalden';
  const screenList = Array.isArray(ctx.screens) ? ctx.screens.join(', ') : '(unknown)';
  const toolDesc = (body.tools || [])
    .map((t) => {
      const f = t.function || {};
      return `- ${f.name}: ${f.description || ''}`;
    })
    .join('\n');
  const knowledge = body.knowledge || '';

  return `You are the Goalden advisor, the friendly in-app assistant for "${app}", an Indian personal-finance planning app (supports India ₹ and United States $).

Your job: answer in plain language AND take action for them — fill in an input, move the app to the right screen, run a real calculation, then explain the result simply.

Adapt your language to the user. If they write in simple everyday words, stay warm and jargon-free. If they use finance terms (SIP, corpus, asset allocation), you may be more technical.

${knowledge ? 'Everything you need to know about this part of Goalden — what it does, where its numbers come from, and its assumptions:\n' + knowledge + '\n' : ''}

The app's live state right now:
- Current screen: "${page}"
- Available screens: ${screenList}
- Goal type chosen: ${state.goalType || 'none yet'}
- User's answers so far: ${JSON.stringify(state)}

Tools you may call (call them to act — never just describe what to do):
${toolDesc || '(none)'}

Rules:
- To change an input, call set_value(field, value) with a valid field and value from its schema.
- To move the user to a screen, call navigate(screen) using ONLY a screen name from "Available screens".
- To run the current calculation, call get_results(); to see what they've entered, call get_state().
- Never invent a number a tool would give you — call the tool and read its result.
- When asked where a figure comes from or what something means, answer from the knowledge above; if it isn't covered there, say so rather than guessing.
- Keep replies short and conversational. Format money with the user's currency symbol (₹ for IN, $ for US).
- Prefer driving the real interface: navigate to the right tool/screen, set the values, scroll the result into view, then explain what the user is looking at. Never describe a number without putting it on screen.
- Narrate BEFORE acting (e.g. "Let me set that up — watch the assumptions panel"), and after a multi-step sequence, say what changed and what it means — not just that it's done.

Advice guardrail (a hard line — never cross it):
You MAY: explain what a mix or calculation does; compare mixes on return and risk; show where a portfolio sits relative to the efficient frontier; describe what history did; run the app's own calculations; and explain every term in plain language.
You MUST NOT: recommend a specific named stock, ETF or mutual fund to buy; predict a price or a future return; or tell the user what they personally should do with their money.
When a user asks "what should I buy?", explain the categories, show the trade-off, offer to model whichever specific instruments the user names, and say plainly that you are not a licensed adviser.`;
}

async function callDeepSeek(messages, tools, apiKey) {
  const res = await fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages,
      tools: tools && tools.length ? tools : undefined,
      tool_choice: tools && tools.length ? 'auto' : undefined,
      temperature: 0.3,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DeepSeek returned ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  const choice = (data.choices && data.choices[0]) || {};
  return choice.message || { role: 'assistant', content: '' };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      // Chat preflight echoes the allowed origin; market-data preflight keeps
      // the wildcard (those routes are read-only and harmless).
      if (url.pathname === '/api/chat') {
        const origin = request.headers.get('Origin');
        if (!isAllowedOrigin(origin, url)) {
          return new Response(null, { status: 403 });
        }
        return new Response(null, { headers: {
          'Access-Control-Allow-Origin': origin || '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        } });
      }
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

    if (url.pathname === '/api/chat' && request.method === 'POST') {
      const origin = request.headers.get('Origin');
      if (!isAllowedOrigin(origin, url)) {
        return chatJson({ error: 'This origin is not allowed to use the advisor.' }, 403, origin);
      }
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      if (!rateLimitOk(ip)) {
        return chatJson({ error: 'Too many requests — please slow down and try again in a minute.' }, 429, origin);
      }
      const contentLength = parseInt(request.headers.get('Content-Length') || '0', 10);
      if (contentLength > 100000) {
        return chatJson({ error: 'Request is too large.' }, 413, origin);
      }
      try {
        const body = await request.json();
        if ((body.messages || []).length > 40) {
          return chatJson({ error: 'This conversation has grown too long — please start a new one.' }, 413, origin);
        }
        const apiKey = env.DEEPSEEK_API_KEY;
        if (!apiKey) throw new Error('DEEPSEEK_API_KEY secret is not set');
        const messages = [{ role: 'system', content: buildSystemPrompt(body) }].concat(body.messages || []);
        const message = await callDeepSeek(messages, body.tools || [], apiKey);
        return chatJson({ message }, 200, origin);
      } catch (e) {
        return chatJson({ error: (e && e.message) || 'Chat failed' }, 502, origin);
      }
    }

    // Not an API route — serve the static site.
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Not found', { status: 404 });
  },
};
