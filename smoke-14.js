// smoke-14.js — D5 advisor reliability: tool routing never strips the core
// tools, worker/local_server routing + limits stay in lock-step, the Lab's
// chart follow-up chips point at real tabs, and the client-side text guards
// (stream preview, speech, guardrail, markdown) behave.
// Run with: node smoke-14.js   (needs python3 on PATH for the parity checks)
// Loads each page's real tool list through agent-evals/runner.js's vm loader,
// so it tests the tools the pages actually ship, not a hand-copied list.
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

const worker = fs.readFileSync(path.join(root, 'src', 'worker.js'), 'utf8');
const py = fs.readFileSync(path.join(root, 'local_server.py'), 'utf8');
const advisor = fs.readFileSync(path.join(root, 'advisor.js'), 'utf8');
const lab = fs.readFileSync(path.join(root, 'goalden-lab.html'), 'utf8');

// ---------------------------------------------------------------------------
// 1. Routing: every core tool a page offers survives, for ~10 standard asks.
// ---------------------------------------------------------------------------
const a = worker.indexOf('function bm25Tokenize');
const b = worker.indexOf('// Returns knowledge as a plain string');
const { filterTools, CORE_TOOLS } = new Function(worker.slice(a, b) + '\nreturn { filterTools, CORE_TOOLS };')();

const quiet = console.log;
console.log = function () {}; // page scripts log [skill-metric] lines on load
const runner = require(path.join(root, 'agent-evals', 'runner.js'));
const pages = {};
let labTabs = [];
for (const p of ['index.html', 'goalden.html', 'goalden-door2.html', 'goalden-lab.html']) {
  const api = runner.loadPage(p);
  pages[p] = api.getTools().concat(runner.INTERNAL_TOOLS);
  if (p === 'goalden-lab.html') labTabs = api.getScreens(); // ADVISOR_TABS, built at runtime
}
console.log = quiet;

const PROMPTS = [
  'help me plan my retirement', 'A', 'yes do it all',
  'I am 30, want to retire at 60, spend 50000 a month, India',
  'explain this graph', 'what does this chart show?',
  'show me what happens if I retire at 55 instead of 60',
  'make me a report', 'what is a SIP?', 'compare TCS and Reliance', 'run a monte carlo for me',
];
// Context-specific tools the Lab must still route to (BM25 half of routing).
const TARGETED = {
  'run a monte carlo for me': ['run_monte_carlo'],
  'pin debtor days to the bench': ['pin_row'],
  'open HDFC Bank in read the company': ['set_company'],
  'compare TCS and Reliance': ['search_instruments', 'add_instrument'],
};

const cases = [];
for (const p in pages) {
  for (const q of PROMPTS.concat(Object.keys(TARGETED))) cases.push({ page: p, q, body: { tools: pages[p], messages: [{ role: 'user', content: q }] } });
}
// A tool the model already called must survive even when the new message
// shares no vocabulary with it (mid-chain safety, pre-existing behaviour).
cases.push({ page: 'goalden-lab.html', q: '(mid-chain) and now?', mustKeep: ['stress_test'], body: { tools: pages['goalden-lab.html'], messages: [
  { role: 'user', content: 'stress test my mix' },
  { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'stress_test', arguments: '{}' } }] },
  { role: 'tool', tool_call_id: 'c1', name: 'stress_test', content: '{}' },
  { role: 'user', content: 'and now?' },
] } });

const pyOut = JSON.parse(cp.execFileSync('python3', ['-B', '-c',
  'import sys, json; sys.path.insert(0, sys.argv[1]); import local_server as ls\n' +
  'cases = json.load(sys.stdin)\n' +
  'print(json.dumps([[t["function"]["name"] for t in ls._filter_tools(c)] for c in cases]))',
  root], { input: JSON.stringify(cases.map((c) => c.body)), maxBuffer: 16 * 1024 * 1024 }).toString());

let coreMisses = [], parityMisses = [], targetMisses = [];
cases.forEach((c, i) => {
  const kept = filterTools(c.body).map((t) => t.function.name);
  const offered = c.body.tools.map((t) => t.function.name);
  CORE_TOOLS.filter((n) => offered.includes(n)).forEach((n) => { if (!kept.includes(n)) coreMisses.push(c.page + ' "' + c.q + '" lost ' + n); });
  if (JSON.stringify(kept) !== JSON.stringify(pyOut[i])) parityMisses.push(c.page + ' "' + c.q + '"');
  const want = c.mustKeep || (c.page === 'goalden-lab.html' ? TARGETED[c.q] : null) || [];
  want.filter((n) => offered.includes(n)).forEach((n) => { if (!kept.includes(n)) targetMisses.push(c.page + ' "' + c.q + '" lost ' + n); });
});
check(coreMisses.length === 0, 'routing keeps every core tool on every page (' + cases.length + ' prompts)' + (coreMisses.length ? ': ' + coreMisses.slice(0, 5).join('; ') : ''));
check(parityMisses.length === 0, 'worker.js filterTools == local_server.py _filter_tools on every case' + (parityMisses.length ? ': ' + parityMisses.slice(0, 5).join('; ') : ''));
check(targetMisses.length === 0, 'Lab still routes context-specific tools (monte carlo, pin_row, set_company, instrument chain, mid-chain)' + (targetMisses.length ? ': ' + targetMisses.join('; ') : ''));
check(pages['goalden-lab.html'].length > 25 && filterTools({ tools: pages['goalden-lab.html'], messages: [{ role: 'user', content: 'hi' }] }).length < pages['goalden-lab.html'].length,
  'the Lab is still actually routed (not silently sending all tools)');

// Same core list, same order, in both servers.
const jsCore = (worker.match(/const CORE_TOOLS = \[([^\]]*)\]/) || [])[1];
const pyCore = (py.match(/_CORE_TOOLS = \(([^)]*)\)/) || [])[1];
const jsSkill = (worker.match(/const SKILL_TOOLS = \[([^\]]*)\]/) || [])[1];
const pySkill = (py.match(/_SKILL_TOOLS = \(([^)]*)\)/) || [])[1];
const names = (s) => (s || '').match(/[a-z_]+/g) || [];
check(jsCore && JSON.stringify(names(jsCore)) === JSON.stringify(names(pyCore)), 'CORE_TOOLS identical in worker.js and local_server.py');
check(jsSkill && JSON.stringify(names(jsSkill)) === JSON.stringify(names(pySkill)), 'SKILL_TOOLS identical in worker.js and local_server.py');

// ---------------------------------------------------------------------------
// 2. Limits in lock-step: message cap + per-turn rate limits.
// ---------------------------------------------------------------------------
const jsMax = +((worker.match(/const MAX_CHAT_MESSAGES = (\d+)/) || [])[1]);
const pyMax = +((py.match(/_MAX_CHAT_MESSAGES = (\d+)/) || [])[1]);
const clientMax = +((advisor.match(/const ADVISOR_MAX_SEND_MESSAGES = (\d+)/) || [])[1]);
const clientRetry = +((advisor.match(/const ADVISOR_RETRY_SEND_MESSAGES = (\d+)/) || [])[1]);
check(jsMax > 0 && jsMax === pyMax, `message cap matches (worker ${jsMax}, local_server ${pyMax})`);
check(clientMax > 0 && clientMax < jsMax && clientRetry < clientMax, `advisor.js sends fewer than the cap (${clientMax}, retry ${clientRetry} < ${jsMax})`);
const lim = (src, re) => { const m = src.match(re); return m ? m[1].replace(/['\s]/g, '').replace(/:/g, '=') : null; };
check(lim(worker, /const RATE_LIMITS = \{([^}]*)\}/) === lim(py, /_RATE_LIMITS = \{([^}]*)\}/), 'per-turn rate limits identical in worker.js and local_server.py');
check(/'X-Goalden-Turn': advisor\.turnId/.test(advisor) && /X-Goalden-Turn/.test(py) && /X-Goalden-Turn/.test(worker), 'turn id sent by advisor.js and read by both servers');

// ---------------------------------------------------------------------------
// 3. Lab chart follow-up chips are keyed by real tab ids (D5-14).
// ---------------------------------------------------------------------------
const fu = lab.match(/chartFollowUps:\s*function\s*\(\)\s*\{[\s\S]*?var followUps = \{([\s\S]*?)\};/);
const chipKeys = fu ? (fu[1].match(/'([a-z-]+)'\s*:/g) || []).map((s) => s.replace(/['\s:]/g, '')) : [];
const badKeys = chipKeys.filter((k) => labTabs.indexOf(k) === -1);
check(chipKeys.length > 0 && labTabs.length > 0, 'found the Lab chartFollowUps keys and its tab ids');
check(badKeys.length === 0, 'every chartFollowUps key is a real Lab tab id' + (badKeys.length ? ' — not tabs: ' + badKeys.join(', ') : ''));

// ---------------------------------------------------------------------------
// 4. Plan steps go through the one shared dispatcher (replaces smoke-07's
//    literal "advExecuteTool(step.tool" check, which the D5-10 fix retired).
// ---------------------------------------------------------------------------
check(/advisorDispatchTool\(step\.tool, step\.args/.test(advisor), 'executePlan dispatches steps through advisorDispatchTool');
check(/let result = advisorDispatchTool\(name, args\)/.test(advisor), 'advisorLoop uses the same advisorDispatchTool');
check(/function advisorDispatchTool[\s\S]*?return advExecuteTool\(name, args\);/.test(advisor), 'advisorDispatchTool falls back to the page dispatcher');

// ---------------------------------------------------------------------------
// 5. Client text guards, extracted from advisor.js and run for real.
// ---------------------------------------------------------------------------
const grab = (re, label) => { const m = advisor.match(re); check(!!m, label + ' extractable'); return m ? m[0] : ''; };
const guardSrc = grab(/const ADVISOR_TICKER_DENY = \[[\s\S]*?\];[\s\S]*?function advisorGuardrail\(text\) \{[\s\S]*?\n\}/, 'advisorGuardrail');
const modeSrc = grab(/function advisorStripModeLine\(text\) \{[\s\S]*?\n\}/, 'advisorStripModeLine');
const speakSrc = grab(/function advisorSpeakText\(text\) \{[\s\S]*?\n\}/, 'advisorSpeakText');
const speechSrc = grab(/function advisorSpeechFor\(content\) \{[\s\S]*?\n\}/, 'advisorSpeechFor');
const previewSrc = grab(/function advisorStreamPreview\(text\) \{[\s\S]*?\n\}/, 'advisorStreamPreview');
const mdMatch = advisor.match(/function advisorMarkdown\(text\) \{([\s\S]*?)\n\}\n\nfunction advisorAddMsg/);
if (guardSrc && modeSrc && speakSrc && speechSrc && previewSrc && mdMatch) {
  const fns = new Function('console', guardSrc + modeSrc + speakSrc + speechSrc + previewSrc +
    '\nreturn { advisorGuardrail, advisorSpeechFor, advisorStreamPreview };')({ warn() {} });
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const md = new Function('advisorEscapeHtml', 'return (function advisorMarkdown(text) {' + mdMatch[1] + '\n})')(esc);

  const g = fns.advisorGuardrail('Here is the gist. You should buy RELIANCE now. Sell TCS today. Stay diversified.');
  check((g.match(/I can't give a view/g) || []).length === 1 && !/RELIANCE|TCS/.test(g) && /gist\. I can't/.test(g), 'guardrail: canned text once, spaced, both calls removed');
  check(!/<td>-{3}/.test(md('| a | b |\n|---|:---:|\n| 1 | 2 |')) && /<td>1<\/td>/.test(md('| a | b |\n|---|:---:|\n| 1 | 2 |')), 'markdown: |---| separator is not rendered as a data row');
  const spoken = fns.advisorSpeechFor('MODE: A\n\nYou should buy RELIANCE now. **Stay** diversified.\n| Mix | Return |\n|---|---|\n| A | 9% |');
  check(!/MODE|RELIANCE|\*|\||---/.test(spoken) && /Stay diversified/.test(spoken), 'speech: no MODE line, guardrailed, no markup ("' + spoken.slice(0, 60) + '…")');
  const partials = ['M', 'MODE', 'MODE: A', 'MODE: A\n\nHere is the', 'MODE: A\n\nHere is the gist. You should buy REL', 'MODE: A\n\nHere is the gist. You should buy RELIANCE now.'];
  const shown = partials.map(fns.advisorStreamPreview);
  check(shown.every((s) => !/MODE|REL/.test(s)), 'stream preview never shows the MODE line or an unguarded recommendation');
  check(shown[3] === '' && shown[4] === 'Here is the gist.' && /I can't give a view/.test(shown[5]), 'stream preview shows only complete, guarded sentences');
}

console.log(fail ? `\n${fail} FAILURES` : '\nALL PASS');
process.exit(fail ? 1 : 0);
