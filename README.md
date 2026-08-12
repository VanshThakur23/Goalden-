# Goalden

## Live-data proxy (Cloudflare Worker)

The Lab's "Live Frontier" tool fetches real market data (Yahoo Finance for
equities/ETFs, MFAPI.in for Indian mutual fund NAVs) through a small proxy
worker, because both are blocked by CORS when called directly from a
browser. The proxy also normalises both sources to one response shape and
strips a null-close bug on Yahoo's most recent bar.

- Worker code: [`src/worker.js`](src/worker.js)
- Config: [`wrangler.toml`](wrangler.toml) — serves the static site (this
  repo root) via the `[assets]` binding, and routes only `/api/*` to the
  worker's `fetch` handler.

Routes:

| Route | Example | Source |
|---|---|---|
| `GET /api/history?type=equity&symbol=TITAN.NS` | NSE-listed equity/ETF daily bars | Yahoo Finance chart endpoint |
| `GET /api/history?type=fund&scheme=119551` | Mutual fund NAV history | MFAPI.in |
| `GET /api/fundsearch?q=gilt` | Fund name / scheme-code search | MFAPI.in |

All three return `{ id, label, currency, prices: [{ date, close }, ...] }`,
oldest-first.

**To run and deploy** (this environment has no Node.js installed, so this
was built and structurally verified against live API responses but never
run under `wrangler dev` — do that yourself before deploying):

```bash
npm install -g wrangler
wrangler dev
```

Then confirm all three routes above return real data, and that everything
else (`/`, `/goalden.html`, etc.) still serves the static site. Deploy with:

```bash
wrangler deploy
```

You may need to switch the Cloudflare Pages/Workers project off pure
static-asset mode to pick up the worker script, depending on how it is
currently configured.
