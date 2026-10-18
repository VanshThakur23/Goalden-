// smoke-16.js — which screener.in page fetchScreenerPage (src/worker.js) and
// _fetch_screener_page (local_server.py) settle on, and the error kind when
// neither page has statement data. screener.in used to redirect /consolidated/
// to the standalone page for a company with no consolidated accounts; for SPEB
// (Oct 2026) it instead serves a 200 consolidated page with empty tables, and
// both fetchers used to stop there with 'layout' instead of trying standalone.
// Every upstream is stubbed (fetch / urllib.request.urlopen) — no network.
// The two implementations must agree on every case.
// Run with: node smoke-16.js   (needs python3 on PATH for the parity checks)
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

const GOOD = '<table class="data-table"><tr><th data-date-key="2025-03-31">Mar 2025</th></tr><tr><td>Sales</td><td>10</td></tr></table>';
const EMPTY = '<table class="data-table"><tr><td>Sales</td></tr></table>';
const C = 'https://www.screener.in/company/X/consolidated/';
const S = 'https://www.screener.in/company/X/';

// Per case: what each URL returns. [status, html, finalUrl] or 'NET' (the
// request never reaches screener.in). A missing standalone entry means the
// fetcher must not ask for it.
const CASES = {
  'consolidated has data':              { [C]: [200, GOOD, C] },
  'consolidated redirects to standalone': { [C]: [200, GOOD, S] },
  'consolidated empty, standalone has data': { [C]: [200, EMPTY, C], [S]: [200, GOOD, S] },
  'consolidated empty, standalone empty':    { [C]: [200, EMPTY, C], [S]: [200, EMPTY, S] },
  'consolidated empty, standalone 404':      { [C]: [200, EMPTY, C], [S]: [404, '', S] },
  'consolidated empty, standalone 429':      { [C]: [200, EMPTY, C], [S]: [429, '', S] },
  'consolidated empty, standalone network':  { [C]: [200, EMPTY, C], [S]: 'NET' },
  'both 404':                                { [C]: [404, '', C], [S]: [404, '', S] },
  'consolidated 429, standalone has data':   { [C]: [429, '', C], [S]: [200, GOOD, S] },
  'consolidated 404, standalone empty':      { [C]: [404, '', C], [S]: [200, EMPTY, S] },
  'consolidated 503, standalone 404':        { [C]: [503, '', C], [S]: [404, '', S] },
  'consolidated network, standalone has data': { [C]: 'NET', [S]: [200, GOOD, S] },
  'both network':                            { [C]: 'NET', [S]: 'NET' },
};
// ok:true -> {consolidated, calls}; otherwise {kind, calls}
const EXPECT = {
  'consolidated has data':                     { consolidated: true, calls: 1 },
  'consolidated redirects to standalone':      { consolidated: false, calls: 1 },
  'consolidated empty, standalone has data':   { consolidated: false, calls: 2 },
  'consolidated empty, standalone empty':      { kind: 'layout', calls: 2 },
  'consolidated empty, standalone 404':        { kind: 'layout', calls: 2 },
  'consolidated empty, standalone 429':        { kind: 'transient', calls: 2 },
  'consolidated empty, standalone network':    { kind: 'transient', calls: 2 },
  'both 404':                                  { kind: 'not_found', calls: 2 },
  'consolidated 429, standalone has data':     { consolidated: false, calls: 2 },
  'consolidated 404, standalone empty':        { kind: 'layout', calls: 2 },
  'consolidated 503, standalone 404':          { kind: 'transient', calls: 2 },
  'consolidated network, standalone has data': { consolidated: false, calls: 2 },
  'both network':                              { kind: 'transient', calls: 2 },
};

async function workerRun() {
  const src = fs.readFileSync(path.join(root, 'src', 'worker.js'), 'utf8');
  const a = src.indexOf('class ScreenerPageError');
  const b = src.indexOf('// Price-history fallback for Indian stocks');
  const make = new Function('fetch', 'ScreenerParser', src.slice(a, b) + '\nreturn fetchScreenerPage;');
  const parser = require(path.join(root, 'screener-parser.js'));
  const out = {};
  for (const [name, map] of Object.entries(CASES)) {
    let calls = 0;
    const fetch = async (url) => {
      calls++;
      const spec = map[url];
      if (spec === undefined) throw new Error('unexpected request ' + url);
      if (spec === 'NET') throw new TypeError('fetch failed');
      return { ok: spec[0] >= 200 && spec[0] < 300, status: spec[0], url: spec[2], text: async () => spec[1] };
    };
    try {
      const r = await make(fetch, parser)('X');
      out[name] = { consolidated: r.consolidated, calls };
    } catch (e) {
      out[name] = e.kind ? { kind: e.kind, calls } : { threw: String(e && e.message), calls };
    }
  }
  return out;
}

function pythonRun() {
  const script = `
import io, json, sys, urllib.error
sys.dont_write_bytecode = True
sys.path.insert(0, ${JSON.stringify(root)})
import local_server as ls
CASES = json.loads(${JSON.stringify(JSON.stringify(CASES))})
class R:
    def __init__(s, status, body, final): s.status = status; s._b = body; s._f = final
    def read(s): return s._b.encode()
    def geturl(s): return s._f
    def __enter__(s): return s
    def __exit__(s, *a): return False
out = {}
for name, mp in CASES.items():
    calls = [0]
    def urlopen(req, timeout=None, mp=mp, calls=calls):
        calls[0] += 1
        url = req.full_url
        if url not in mp: raise AssertionError('unexpected request ' + url)
        spec = mp[url]
        if spec == 'NET': raise urllib.error.URLError('down')
        status, body, final = spec
        if status >= 400: raise urllib.error.HTTPError(url, status, 'x', {}, io.BytesIO(b''))
        return R(status, body, final)
    ls.urllib.request.urlopen = urlopen
    try:
        _html, _url, cons = ls._fetch_screener_page('X')
        out[name] = {'consolidated': cons, 'calls': calls[0]}
    except ls.ScreenerPageError as e:
        out[name] = {'kind': e.kind, 'calls': calls[0]}
    except Exception as e:
        out[name] = {'threw': str(e), 'calls': calls[0]}
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
  for (const name of Object.keys(CASES)) {
    const want = JSON.stringify(EXPECT[name]);
    check(JSON.stringify(w[name]) === want, 'worker: ' + name + ' -> ' + want + (JSON.stringify(w[name]) === want ? '' : ' (got ' + JSON.stringify(w[name]) + ')'));
    check(p && JSON.stringify(p[name]) === want, 'local_server.py: ' + name + (p && JSON.stringify(p[name]) !== want ? ' (got ' + JSON.stringify(p[name]) + ')' : ''));
  }
  console.log(fail ? `\n${fail} check(s) FAILED` : '\nAll checks passed');
  process.exit(fail ? 1 : 0);
})();
