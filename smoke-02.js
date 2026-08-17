// smoke-02.js — Phase 2 verification (verification layer).
// Run with: node smoke-02.js
// Asserts the figures/figure_mismatch contract strings exist in the right
// files, then runs the real advisorGuardrail scanner (extracted from
// advisor.js) against the three required test strings. Exit 0/1.
'use strict';

const fs = require('fs');
const path = require('path');

const root = __dirname;
let fail = 0;
const check = (cond, label) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + label);
  if (!cond) fail++;
};

const advisor = fs.readFileSync(path.join(root, 'advisor.js'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'src', 'worker.js'), 'utf8');
const py = fs.readFileSync(path.join(root, 'local_server.py'), 'utf8');
const g1 = fs.readFileSync(path.join(root, 'goalden.html'), 'utf8');
const g2 = fs.readFileSync(path.join(root, 'goalden-door2.html'), 'utf8');
const gl = fs.readFileSync(path.join(root, 'goalden-lab.html'), 'utf8');

// Part A contract presence.
check(/figures:\s*/.test(g1), 'goalden.html has figures map');
check(/figures:\s*/.test(g2), 'goalden-door2.html has figures map');
check(/figures:\s*/.test(gl), 'goalden-lab.html has figures map');
check(/figure_mismatch/.test(advisor), 'advisor.js has figure_mismatch');
check(/figure_mismatch/.test(worker), 'worker.js has figure_mismatch');
check(/figure_mismatch/.test(py), 'local_server.py has figure_mismatch');
check(/briefing-verified/.test(advisor), 'advisor.js has verified stamp');

// Part B contract presence.
check(/crossFieldSanity/.test(g1), 'goalden.html has crossFieldSanity');
check(/crossFieldSanity/.test(g2), 'goalden-door2.html has crossFieldSanity');
check(/crossFieldSanity/.test(gl), 'goalden-lab.html has crossFieldSanity');
check(/flags: crossFieldSanity|flags:crossFieldSanity|flags: flags|flags:flags/.test(g1) || /flags:crossFieldSanity/.test(g1), 'goalden.html wires flags');
check(/flags: crossFieldSanity|flags:crossFieldSanity/.test(g2), 'goalden-door2.html wires flags');
check(/flags:flags/.test(gl) || /flags: crossFieldSanity/.test(gl), 'goalden-lab.html wires flags');

// Part C — extract the real guardrail and run it on the 3 test strings.
const m = advisor.match(/const ADVISOR_TICKER_DENY = \[[\s\S]*?\];\s*function advisorGuardrail\(text\) \{[\s\S]*?\n\}/);
if (!m) {
  check(false, 'advisorGuardrail extractable from advisor.js');
} else {
  const consoleStub = { warn: function () {} };
  const advisorGuardrail = new Function('console', m[0] + '\nreturn advisorGuardrail;')(consoleStub);

  const s1 = 'TCS returned 8% last year, a strong performer';
  check(advisorGuardrail(s1) === s1, "descriptive mention NOT flagged (TCS returned 8%...)");

  const s2 = 'You should buy RELIANCE now, it will reach 3000 soon';
  check(advisorGuardrail(s2) !== s2 && advisorGuardrail(s2).indexOf("I can't recommend specific investments") !== -1,
    "recommendation flagged (buy RELIANCE ... will reach ...)");

  const s3 = 'Your mix is 60% equity, 40% debt';
  check(advisorGuardrail(s3) === s3, "allocation statement NOT flagged (60% equity / 40% debt)");

  // Title-case recommendation object, no price target and no ALL-CAPS ticker
  // (agent-evals/Phase 6 surfaced this gap in the ALL-CAPS-only check).
  const s4 = 'You should buy Reliance now, it is a great pick';
  check(advisorGuardrail(s4) !== s4 && advisorGuardrail(s4).indexOf("I can't recommend specific investments") !== -1,
    "title-case recommendation flagged (buy Reliance, no price target)");
}

console.log(fail ? `\n${fail} FAILURES` : '\nALL PASS');
process.exit(fail ? 1 : 0);
