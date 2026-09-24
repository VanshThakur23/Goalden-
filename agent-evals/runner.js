'use strict';
// agent-evals/runner.js — headless agent eval harness (Phase 6).
//
// Drives the real ReAct loop against local_server.py's /api/chat endpoint,
// executing tool calls through the REAL page functions (executeAdvisorTool /
// advisorSetValue / advisorGetResults / advisorAddGoal / advisorTools) loaded
// into a Node vm context from each page's inline script — no reimplementation
// of tool logic here. Expected figures are computed from goalden-engine.js's
// own primitives (Phase 1), never hand-typed, so they can't drift from the app.
//
// Usage: node agent-evals/runner.js [--scenario NAME] [--base URL]
// Exits 0 when every scenario that RUNS passes; 1 on any failure or error.
// The chat endpoint rate-limits per user turn (10/min per IP); a run with
// more turns than that waits out the 429's Retry-After once. Start
// local_server.py with GOALDEN_CHAT_RATE_LIMIT=off to skip the wait.
//
// No new dependencies: node:vm, node:fs, node:path, global fetch/AbortSignal.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const ENGINE_SRC = fs.readFileSync(path.join(ROOT, 'goalden-engine.js'), 'utf8');
const engine = require(path.join(ROOT, 'goalden-engine.js'));
const ADVISOR_SRC = fs.readFileSync(path.join(ROOT, 'advisor.js'), 'utf8');

const ARGS = process.argv.slice(2);
const SC_FILTER = (function () { const i = ARGS.indexOf('--scenario'); return i >= 0 ? ARGS[i + 1] : null; })();
const BASE = (function () { const i = ARGS.indexOf('--base'); return i >= 0 ? ARGS[i + 1] : (process.env.GOALDEN_BASE || 'http://127.0.0.1:8000'); })();

// ---------------------------------------------------------------------------
// Ground-truth config, mirroring each page's C (data, not computation).
// The math is done by goalden-engine.js's functions below — never hardcoded.
// ---------------------------------------------------------------------------
const CONFIG = {
  IN: { inflation: 0.06, eduInflation: 0.10, debt: 0.07, hybrid: 0.10, equity: 0.12, postRet: 0.09, lifeExp: 78, fdRate: 0.065 },
  US: { inflation: 0.025, eduInflation: 0.05, debt: 0.045, hybrid: 0.07, equity: 0.09, postRet: 0.06, lifeExp: 82, fdRate: 0.04 },
};
const RISK_ALLOC = {
  cautious: { eq: 0.25, de: 0.60, hy: 0.15 },
  balanced: { eq: 0.50, de: 0.35, hy: 0.15 },
  growth: { eq: 0.75, de: 0.15, hy: 0.10 },
};

// Advisor-level tools that live in advisor.js (not the page script). The
// harness records their invocation for toolsCalled assertions but does not run
// their DOM rendering — only page-state tools execute for real. compose_briefing
// is dispatched specially too, but its tool DEF comes from the page's own
// advisorTools(), so it must NOT be appended here (a duplicate name 400s).
const INTERNAL_TOOLS = [
  { type: 'function', function: { name: 'propose_plan', description: 'Propose a plan for the user to review and approve.', parameters: { type: 'object', properties: { steps: { type: 'array', items: { type: 'object' } } }, required: ['steps'] } } },
  { type: 'function', function: { name: 'execute_plan', description: 'Execute the approved steps of a pending plan.', parameters: { type: 'object', properties: { planId: { type: 'string' } } } } },
];
const INTERNAL_TOOL_NAMES = new Set(['propose_plan', 'execute_plan', 'compose_briefing']);

// ---------------------------------------------------------------------------
// Minimal browser stubs — enough for each page's inline script to load and
// expose its real functions/state without a DOM.
// ---------------------------------------------------------------------------
function makeEl() {
  return {
    innerHTML: '', textContent: '', value: '', className: '', id: '',
    disabled: false, checked: false, style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
    addEventListener() {}, removeEventListener() {},
    appendChild() {}, removeChild() {}, append() {}, remove() {}, replaceChildren() {},
    querySelector() { return makeEl(); }, querySelectorAll() { return []; },
    scrollIntoView() {}, focus() {}, click() {}, closest() { return null; },
    getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0 }; },
    offsetHeight: 0, offsetWidth: 0, children: [], firstChild: null,
  };
}
function makeDocument() {
  return {
    getElementById() { return makeEl(); },
    querySelector() { return makeEl(); },
    querySelectorAll() { return []; },
    createElement() { return makeEl(); },
    addEventListener() {}, removeEventListener() {},
    body: makeEl(), head: makeEl(), documentElement: makeEl(),
  };
}
function makeStorage() {
  const s = Object.create(null);
  return {
    getItem(k) { return Object.prototype.hasOwnProperty.call(s, k) ? s[k] : null; },
    setItem(k, v) { s[k] = String(v); },
    removeItem(k) { delete s[k]; },
  };
}
function makeChartStub() {
  return { setOption() {}, resize() {}, dispose() {}, on() {}, off() {}, clear() {}, getZr() { return { on() {}, off() {} }; } };
}

const scriptCache = Object.create(null);

function extractInlineScript(page) {
  if (scriptCache[page]) return scriptCache[page];
  const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
  const m = html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/i);
  scriptCache[page] = m ? m[1] : null;
  return scriptCache[page];
}

// Load a page's inline script (plus goalden-engine.js) into a fresh vm context
// with minimal stubs, and return handles to its REAL functions + state. A NEW
// context is built on every call — scenarios must never leak S/G/L state into
// each other (a previous scenario's goalType/country would falsify results).
function loadPage(page) {
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.document = makeDocument();
  sandbox.localStorage = makeStorage();
  sandbox.sessionStorage = makeStorage();
  sandbox.history = { replaceState() {}, pushState() {} };
  sandbox.location = { hash: '', pathname: '/' + page, search: '' };
  sandbox.echarts = { registerTheme() {}, init() { return makeChartStub(); } };
  sandbox.setTimeout = () => 0;
  sandbox.clearTimeout = () => {};
  sandbox.setInterval = () => 0;
  sandbox.clearInterval = () => {};
  sandbox.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  sandbox.scrollTo = () => {};
  sandbox.addEventListener = () => {};
  sandbox.removeEventListener = () => {};
  sandbox.dispatchEvent = () => {};
  sandbox.requestAnimationFrame = () => 0;
  sandbox.cancelAnimationFrame = () => {};
  sandbox.performance = { now: () => Date.now() };
  sandbox.console = console;
  sandbox.navigator = { userAgent: 'node-eval' };

  const ctx = vm.createContext(sandbox);
  vm.runInContext(ENGINE_SRC, ctx, { filename: 'goalden-engine.js' });
  const script = extractInlineScript(page);
  if (!script) throw new Error('no inline script found in ' + page);
  vm.runInContext(script, ctx, { filename: page });

  const get = (expr) => vm.runInContext(expr, ctx);
  const cfg = (function () { try { return get('GOALDEN_ADVISOR_CONFIG'); } catch (e) { return null; } })();
  const api = {
    page, ctx,
    cfg,
    getTools: () => { try { const t = get('advisorTools'); return (typeof t === 'function') ? t() : []; } catch (e) { return []; } },
    executeTool: (name, args) => get('executeAdvisorTool')(name, args),
    // index.html has no results of its own (it can only open a door).
    getResults: () => { try { const f = get('advisorGetResults'); return typeof f === 'function' ? f() : null; } catch (e) { return null; } },
    getState: () => (cfg && typeof cfg.stateForAdvisor === 'function') ? cfg.stateForAdvisor() : (cfg ? cfg.state : {}),
    getRawState: () => get('(typeof S!=="undefined"?S:(typeof G!=="undefined"?G:(typeof L!=="undefined"?L:null)))'),
    getPage: () => (cfg && typeof cfg.page === 'function') ? cfg.page() : 'start',
    getScreens: () => (cfg && typeof cfg.screens === 'function') ? cfg.screens() : [],
    getKnowledge: () => { try { return get('ADVISOR_KNOWLEDGE') || ''; } catch (e) { return ''; } },
  };
  return api;
}

// The client's send-side history trim (advisorCleanMessages +
// advisorFitMessages), extracted from advisor.js so a long live scenario
// sends exactly what the browser would and never trips the servers'
// 40-message cap (413) that the browser itself never hits.
const fitMessages = (function () {
  const clean = ADVISOR_SRC.match(/function advisorCleanMessages\(messages\) \{[\s\S]*?\n\}/);
  const fit = ADVISOR_SRC.match(/const ADVISOR_MAX_SEND_MESSAGES = \d+;[\s\S]*?function advisorFitMessages\(messages, max\) \{[\s\S]*?\n\}/);
  if (!clean || !fit) return (m) => m;
  const f = new Function(clean[0] + '\n' + fit[0] + '\nreturn { advisorFitMessages, ADVISOR_MAX_SEND_MESSAGES };')();
  return (m) => f.advisorFitMessages(m, f.ADVISOR_MAX_SEND_MESSAGES);
})();

// Extract advisorGuardrail from advisor.js (same technique as smoke-02.js).
const guardrailMatch = ADVISOR_SRC.match(/const ADVISOR_TICKER_DENY = \[[\s\S]*?\];[\s\S]*?function advisorGuardrail\(text\) \{[\s\S]*?\n\}/);
const advisorGuardrail = guardrailMatch
  ? new Function('console', guardrailMatch[0] + '\nreturn advisorGuardrail;')({ warn() {} })
  : null;

// ---------------------------------------------------------------------------
// Ground-truth figure computation, built from goalden-engine.js's primitives.
// ---------------------------------------------------------------------------
function computeFigure(kind, fields, country) {
  const d = CONFIG[country];
  if (!d) throw new Error('unknown country ' + country);
  const a = RISK_ALLOC[fields.risk] || RISK_ALLOC.balanced;
  const preRate = a.eq * d.equity + a.de * d.debt + a.hy * d.hybrid;
  const mRate = engine.effectiveMonthlyRate(preRate);
  const existing = fields.existingSavings || 0;

  if (kind === 'retirementCorpus' || kind === 'retirementSIP') {
    const yrs = fields.retireAge - fields.age;
    const drawYrs = Math.max(5, d.lifeExp - fields.retireAge);
    const expAtRet = engine.inflateExpense(fields.monthlyExpense * 12, [{ rate: d.inflation, years: yrs }], 0.75);
    const rr = engine.realRate(d.postRet, d.inflation);
    const corpus = engine.corpusRequired(rr, drawYrs, expAtRet, true);
    if (kind === 'retirementCorpus') return corpus;
    const existingFV = existing * Math.pow(1 + mRate, yrs * 12);
    const gapCorpus = Math.max(0, corpus - existingFV);
    return gapCorpus === 0 ? 0 : engine.solveSIP(mRate, yrs * 12, gapCorpus, true);
  }
  throw new Error('unknown figure kind: ' + kind);
}

// ---------------------------------------------------------------------------
// ReAct loop — mirrors advisor.js's advisorLoop shape (POST /api/chat, execute
// tool_calls through the page's real dispatch, feed results back).
// ---------------------------------------------------------------------------
async function runScenario(sc, api) {
  const tools = api.getTools().concat(INTERNAL_TOOLS);
  const knowledge = api.getKnowledge();
  const messages = [];
  const toolsCalled = [];
  const toolCalls = [];
  let lastReply = '';
  let lastErr = null;

  // Send each user message one at a time, running a full ReAct round after
  // each (so a "do it all" flow's A/B offer can be answered with a second
  // user message in the same scenario).
  for (let ui = 0; ui < sc.userMessages.length; ui++) {
    const um = sc.userMessages[ui];
    messages.push({ role: 'user', content: um });
    // One rate-limit turn per user message, exactly like advisor.js — the
    // servers count turns, not round trips (see rateLimitWait in worker.js).
    const turnId = 'eval-' + Date.now().toString(36) + '-' + ui + '-' + Math.random().toString(36).slice(2, 8);
    for (let step = 0; step < 18; step++) {
      const body = {
        messages: fitMessages(messages),
        tools,
        state: api.getState(),
        knowledge,
        context: { page: api.getPage(), app: 'Goalden', screens: api.getScreens() },
      };
      let resp;
      try {
        const post = () => fetch(BASE + '/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Goalden-Turn': turnId },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(25000),
        });
        resp = await post();
        // A full live run sends ~30 turns; if it outpaces the per-IP turn
        // limit, wait out Retry-After once instead of failing the scenario.
        if (resp.status === 429) {
          const waitS = Math.min(65, Number(resp.headers.get('Retry-After')) || 60);
          console.log('        (rate-limited; waiting ' + waitS + 's)');
          await new Promise((r) => setTimeout(r, waitS * 1000));
          resp = await post();
        }
      } catch (e) {
        lastErr = 'could not reach ' + BASE + '/api/chat — is local_server.py running? (' + e.message + ')';
        return { toolsCalled, toolCalls, lastReply, lastErr, state: api.getRawState(), results: api.getResults() };
      }
      if (!resp.ok) { lastErr = 'chat returned HTTP ' + resp.status; return { toolsCalled, toolCalls, lastReply, lastErr, state: api.getRawState(), results: api.getResults() }; }
      const data = await resp.json();
      const msg = data.message || {};
      if (msg.tool_calls && msg.tool_calls.length) {
        messages.push({ role: 'assistant', content: msg.content || null, tool_calls: msg.tool_calls });
        for (const tc of msg.tool_calls) {
          const name = tc.function && tc.function.name;
          let args = {};
          try { args = JSON.parse(tc.function.arguments || '{}'); } catch (e) { args = {}; }
          toolsCalled.push(name);
          toolCalls.push({ name, args });
          let result;
          try {
            if (INTERNAL_TOOL_NAMES.has(name)) {
              result = JSON.stringify({ ok: true, acknowledged: true });
            } else {
              result = api.executeTool(name, args);
            }
          } catch (e) {
            result = JSON.stringify({ ok: false, error: 'tool error: ' + (e && e.message || e) });
          }
          messages.push({ role: 'tool', tool_call_id: tc.id, name, content: String(result).slice(0, 3500) });
        }
        continue;
      }
      if (msg.content) { lastReply = msg.content; messages.push({ role: 'assistant', content: msg.content }); }
      break;
    }
  }

  return { toolsCalled, toolCalls, lastReply, lastErr, state: api.getRawState(), results: api.getResults() };
}

// ---------------------------------------------------------------------------
// Assertions.
// ---------------------------------------------------------------------------
function relDiff(a, b) { return Math.abs(a - b) / Math.max(1e-9, Math.abs(b)); }
function getPath(obj, path) { return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj); }

function checkScenario(sc, out) {
  const failures = [];
  const expect = sc.expect || {};
  const assert = (cond, msg) => { if (!cond) failures.push(msg); };

  if (out.lastErr) { failures.push('loop error: ' + out.lastErr); return failures; }

  if (expect.toolsCalled) {
    for (const t of expect.toolsCalled) assert(out.toolsCalled.includes(t), 'expected tool call "' + t + '" (got: ' + out.toolsCalled.join(', ') + ')');
  }
  if (expect.notToolsCalled) {
    for (const t of expect.notToolsCalled) assert(!out.toolsCalled.includes(t), 'did NOT expect tool call "' + t + '"');
  }
  if (expect.fieldsSet) {
    for (const k in expect.fieldsSet) {
      const actual = k.indexOf('.') >= 0 ? getPath(out.state, k) : (out.state ? out.state[k] : undefined);
      assert(actual === expect.fieldsSet[k], 'field "' + k + '" expected ' + JSON.stringify(expect.fieldsSet[k]) + ' but got ' + JSON.stringify(actual));
    }
  }
  if (expect.figures) {
    if (!out.results || out.results.ok !== true) {
      failures.push('no result to check figures against: ' + JSON.stringify(out.results && out.results.error));
    } else {
      for (const field in expect.figures) {
        const expected = computeFigure(expect.figures[field], expect.fieldsSet || {}, sc.country);
        const actual = out.results.result[field];
        if (actual == null) { failures.push('result field "' + field + '" missing'); continue; }
        assert(relDiff(actual, expected) < 0.001, 'figure "' + field + '" expected ~' + expected + ' but got ' + actual);
      }
    }
  }
  if (expect.noRecommendation) {
    if (!advisorGuardrail) { failures.push('advisorGuardrail could not be extracted from advisor.js'); }
    else {
      // The user-visible text is the model's reply AFTER the guardrail runs.
      // A well-prompted model may refuse on its own; either way, no "buy
      // <ticker>" or price-target phrasing must survive to the user.
      const rewritten = advisorGuardrail(out.lastReply || '');
      assert(!/buy[^.!?\n]{0,40}RELIANCE/i.test(rewritten), 'final text must not recommend buying RELIANCE');
      assert(!/will reach 3000/i.test(rewritten), 'final text must not carry the price target');
    }
  }
  if (expect.replyIncludes) {
    assert((out.lastReply || '').toLowerCase().includes(expect.replyIncludes.toLowerCase()), 'reply should include "' + expect.replyIncludes + '"');
  }
  if (expect.toolArgs) {
    // { toolName: { argKey: expectedValue } } — at least one call of that
    // tool must carry every listed argument value (e.g. open_door's
    // auto_continue:true, which is what makes the index hand-off finish).
    for (const t in expect.toolArgs) {
      const want = expect.toolArgs[t];
      const hit = (out.toolCalls || []).some((c) => c.name === t && Object.keys(want).every((k) => c.args && c.args[k] === want[k]));
      assert(hit, 'expected a "' + t + '" call with ' + JSON.stringify(want) + ' (got: ' + JSON.stringify((out.toolCalls || []).filter((c) => c.name === t).map((c) => c.args)) + ')');
    }
  }
  if (expect.noTools) {
    assert(out.toolsCalled.length === 0, 'expected no tool calls (got: ' + out.toolsCalled.join(', ') + ')');
  }
  return failures;
}

// ---------------------------------------------------------------------------
// Mode detection: probe the server; the mock mode reveals itself in its text.
// ---------------------------------------------------------------------------
async function detectMode() {
  try {
    const probe = () => fetch(BASE + '/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goalden-Turn': 'eval-detect-' + Date.now().toString(36) },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], tools: [], state: {}, knowledge: '', context: {} }),
      signal: AbortSignal.timeout(8000),
    });
    let resp = await probe();
    // A 429 body has no "mock mode" text in it, so without this a
    // rate-limited probe silently misreported the server as live.
    if (resp.status === 429) {
      const waitS = Math.min(65, Number(resp.headers.get('Retry-After')) || 60);
      console.log('(rate-limited; waiting ' + waitS + 's before probing mode)');
      await new Promise((r) => setTimeout(r, waitS * 1000));
      resp = await probe();
    }
    const data = await resp.json();
    const text = JSON.stringify(data);
    return /mock mode|no api key set/i.test(text) ? 'mock' : 'live';
  } catch (e) {
    return 'unreachable';
  }
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------
async function main() {
  const scenarios = require(path.join(__dirname, 'scenarios.json'));
  const selected = SC_FILTER ? scenarios.filter((s) => s.name === SC_FILTER) : scenarios;
  if (!selected.length) { console.error('no scenarios selected'); process.exit(1); }

  const mode = await detectMode();
  console.log('mode: ' + mode + '  base: ' + BASE + '\n');

  let ran = 0, passed = 0, failed = 0, skipped = 0;
  for (const sc of selected) {
    if (sc.requiresLive && mode !== 'live') {
      console.log('SKIP  ' + sc.name + '  (requires a live model; current mode is ' + mode + ')');
      skipped++;
      continue;
    }
    if (sc.mockOnly && mode !== 'mock') {
      console.log('SKIP  ' + sc.name + '  (asserts mock-mode behaviour; current mode is ' + mode + ')');
      skipped++;
      continue;
    }
    let api;
    try { api = loadPage(sc.page); } catch (e) {
      console.log('ERROR ' + sc.name + '  (page load failed: ' + e.message + ')');
      failed++;
      continue;
    }
    let out;
    try { out = await runScenario(sc, api); } catch (e) {
      console.log('FAIL  ' + sc.name + '  (harness error: ' + e.message + ')');
      failed++;
      continue;
    }
    const failures = checkScenario(sc, out);
    ran++;
    if (failures.length) {
      failed++;
      console.log('FAIL  ' + sc.name);
      failures.forEach((f) => console.log('        - ' + f));
    } else {
      passed++;
      console.log('PASS  ' + sc.name);
    }
  }

  console.log('\n---');
  console.log('ran: ' + ran + '  passed: ' + passed + '  failed: ' + failed + '  skipped: ' + skipped);
  const rate = ran ? Math.round((passed / ran) * 100) : 0;
  console.log('pass rate (over run scenarios): ' + rate + '%');
  // process.exitCode (not process.exit) so any live vm contexts/timers unwind
  // cleanly instead of a hard fail-fast on Windows.
  process.exitCode = failed ? 1 : 0;
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { loadPage, computeFigure, checkScenario, advisorGuardrail, INTERNAL_TOOLS, BASE };
