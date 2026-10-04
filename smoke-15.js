// smoke-15.js — price-history fallback for Indian stocks Yahoo doesn't carry
// (SME-board listings such as SPEB Adhesives: SPEB.NS is a 404 on Yahoo and
// SPEB-SM.NS returns one bar). Checks that src/worker.js and local_server.py
// (a) map the same symbols to the same screener.in code, (b) fall back to
// screener.in's price chart only after Yahoo fails, without ?q= (screener's
// robots.txt disallows "/*?q="), and (c) keep Yahoo's error when the
// fallback has nothing either. Upstreams are stubbed with the recorded
// fixture in fixtures/screener-chart/SPEB.json — no network.
// Run with: node smoke-15.js   (needs python3 on PATH for the parity checks)
'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const root = __dirname;
let fail = 0;
const check = (cond, label) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + label);
  if (!cond) fail++;
};

const CHART = fs.readFileSync(path.join(root, 'fixtures', 'screener-chart', 'SPEB.json'), 'utf8');
const PAGE = '<html><head><title>SPEB Adhesives Ltd share price | About SPEB Adhesives | Key Insights - Screener</title></head>'
  + '<body><div id="company-info" data-company-id="1285787" data-warehouse-id="147421146"></div></body></html>';
const SYMBOLS = ['SPEB-SM.NS', 'SPEB.NS', 'SPEB.BO', 'speb', 'BAJAJ-AUTO.NS', 'M&M.NS', '^NSEI', 'INR=X', 'BRK-B', 'AAPL'];

// ---------------------------------------------------------------------------
// Worker: evaluate the real fallback functions with stubbed collaborators.
// ---------------------------------------------------------------------------
async function workerRun() {
  const src = fs.readFileSync(path.join(root, 'src', 'worker.js'), 'utf8');
  const a = src.indexOf('function screenerCodeFor');
  const b = src.indexOf('function buildFinancialsResult');
  const body = src.slice(a, b);
  const urls = [];
  const fetchStub = async (url) => { urls.push(String(url)); return { ok: true, status: 200, json: async () => JSON.parse(CHART) }; };
  const fetchScreenerPage = async (code) => {
    if (code === 'SPEB') return { html: PAGE, url: 'https://www.screener.in/company/SPEB/', consolidated: false };
    throw new Error('screener.in has no page for "' + code + '"');
  };
  const fetchEquityHistory = async (sym) => {
    if (sym === 'SPEB-SM.NS') throw new Error('Only 1 usable daily bars for SPEB-SM.NS — too few to compute reliable stats');
    throw new Error('No chart data for ' + sym + ' — check the ticker (India needs .NS or .BO)');
  };
  class UpstreamError extends Error {}
  const make = new Function('fetch', 'fetchScreenerPage', 'fetchEquityHistory', 'UpstreamError', 'console',
    body + '\nreturn { screenerCodeFor, fetchEquityHistoryAny };');
  const api = make(fetchStub, fetchScreenerPage, fetchEquityHistory, UpstreamError, { warn() {} });
  const codes = SYMBOLS.map((s) => api.screenerCodeFor(s));
  const ok = await api.fetchEquityHistoryAny('SPEB-SM.NS');
  let err = null; try { await api.fetchEquityHistoryAny('NOSUCH.NS'); } catch (e) { err = e.message; }
  let err2 = null; try { await api.fetchEquityHistoryAny('^NSEI'); } catch (e) { err2 = e.message; }
  return { codes, ok, err, err2, urls };
}

// ---------------------------------------------------------------------------
// local_server.py: same stubs, same questions, answers printed as JSON.
// ---------------------------------------------------------------------------
function pythonRun() {
  const script = `
import json, sys
sys.dont_write_bytecode = True
sys.path.insert(0, ${JSON.stringify(root)})
import local_server as ls
CHART = json.loads(${JSON.stringify(CHART)})
PAGE = ${JSON.stringify(PAGE)}
urls = []
def yahoo(sym):
    if sym == 'SPEB-SM.NS': raise ValueError('Only 1 usable daily bars for SPEB-SM.NS — too few to compute reliable stats')
    raise ValueError('No chart data for ' + sym + ' — check the ticker (India needs .NS or .BO)')
def page(code):
    if code == 'SPEB': return PAGE, 'https://www.screener.in/company/SPEB/', False
    raise ls.ScreenerPageError('not_found', 'screener.in has no page for "' + code + '"')
def uj(url, headers=None):
    urls.append(url); return CHART
ls.fetch_equity_history = yahoo; ls._fetch_screener_page = page; ls.upstream_json = uj
import io, contextlib
out = {'codes': [ls._screener_code_for(s) for s in ${JSON.stringify(SYMBOLS)}]}
out['ok'] = ls.fetch_equity_history_any('SPEB-SM.NS')
with contextlib.redirect_stderr(io.StringIO()):
    for key, sym in (('err', 'NOSUCH.NS'), ('err2', '^NSEI')):
        try: ls.fetch_equity_history_any(sym); out[key] = None
        except Exception as e: out[key] = str(e)
out['urls'] = urls
print(json.dumps(out))
`;
  const r = cp.spawnSync('python3', ['-c', script], { encoding: 'utf8', env: Object.assign({}, process.env, { PYTHONDONTWRITEBYTECODE: '1' }) });
  if (r.status !== 0) { console.log(r.stderr); return null; }
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

(async () => {
  const w = await workerRun();
  const p = pythonRun();
  check(!!p, 'local_server.py harness ran');
  const expectCodes = ['SPEB', 'SPEB', 'SPEB', 'SPEB', 'BAJAJ-AUTO', 'M&M', null, null, null, 'AAPL'];
  check(JSON.stringify(w.codes) === JSON.stringify(expectCodes), 'worker: Indian symbols map to the bare screener code; ^NSEI / INR=X / BRK-B do not');
  check(p && JSON.stringify(p.codes) === JSON.stringify(w.codes), 'local_server.py maps every symbol the same way as the worker');
  for (const [name, r] of [['worker', w], ['local_server.py', p || {}]]) {
    const ok = r.ok || {};
    check(ok.source === 'screener.in' && ok.currency === 'INR' && ok.label === 'SPEB Adhesives Ltd', name + ': SPEB-SM.NS falls back to screener.in (label, INR)');
    check(Array.isArray(ok.prices) && ok.prices.length === 147 && ok.prices[0].date === '2025-12-08' && ok.prices[0].close === 57 && ok.prices[146].date === '2026-10-01' && ok.prices[146].close === 86,
      name + ': all 147 recorded closes come through, oldest first (57.00 on 2025-12-08 to 86.00 on 2026-10-01)');
    check(/Yahoo Finance has no history/.test(ok.sourceNote || ''), name + ': result says where the prices came from');
    check((r.urls || []).length > 0 && r.urls.every((u) => /\/api\/company\/1285787\/chart\/\?days=3650$/.test(u)), name + ': price chart requested without ?q= (robots.txt)');
    check(/^No chart data for NOSUCH\.NS/.test(r.err || ''), name + ': no screener page either -> Yahoo\'s ticker error is kept');
    check(/^No chart data for \^NSEI/.test(r.err2 || ''), name + ': non-Indian symbol never tries screener.in, keeps Yahoo\'s error');
  }
  console.log(fail ? `\n${fail} check(s) FAILED` : '\nAll checks passed');
  process.exit(fail ? 1 : 0);
})();
