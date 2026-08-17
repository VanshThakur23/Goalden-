// smoke-07.js — Phase 4 (plan objects + human-in-the-loop approval) verification.
// Run with: node smoke-07.js
// Structural assertions on advisor.js + worker.js/local_server.py sync. Zero deps.
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

// 1. Tool defs + dispatch present.
check(/name:'propose_plan'/.test(advisor), 'advisor.js: propose_plan tool defined');
check(/name:'execute_plan'/.test(advisor), 'advisor.js: execute_plan tool defined');
check(/name === 'propose_plan'/.test(advisor), 'advisor.js: propose_plan dispatch branch');
check(/name === 'execute_plan'/.test(advisor), 'advisor.js: execute_plan dispatch branch');
check(/advTools\(\)\.concat\(ADVISOR_INTERNAL_TOOLS\)/.test(advisor), 'advisor.js: internal tools appended to page tools');

// 2. pendingPlan is a field on the advisor object, not inside messages.
check(/const advisor = \{[^}]*\bpendingPlan:\s*null\b[^}]*\}/.test(advisor),
  'advisor.js: pendingPlan is a top-level advisor field');
check(/advisor\.pendingPlan\s*=\s*plan\b/.test(advisor), 'advisor.js: proposePlan stores pendingPlan');
check(/advisor\.pendingPlan\s*=\s*null/.test(advisor), 'advisor.js: pendingPlan cleared (execute + new message)');

// 3. advisorTrim does not touch pendingPlan (it only slices messages).
const trimMatch = advisor.match(/function advisorTrim\(\) \{[\s\S]*?\n\}/);
check(!!trimMatch && !/pendingPlan/.test(trimMatch[0]), 'advisor.js: advisorTrim does not touch pendingPlan');

// 4. execute_plan routes through advExecuteTool (no parallel dispatch).
check(/advExecuteTool\(step\.tool, step\.args/.test(advisor), 'advisor.js: executePlan uses advExecuteTool');

// 5. checkbox gating writes backing state and gates execution.
check(/advisor\.pendingPlan\.approved\[i\] = cb\.checked/.test(advisor), 'advisor.js: checkbox change updates approved[i]');
check(/!plan\.approved\[i\]/.test(advisor), 'advisor.js: executePlan skips unchecked steps');

// 6. worker.js / local_server.py mirror (both mention propose_plan once).
const w = (worker.match(/propose_plan/g) || []).length;
const p = (py.match(/propose_plan/g) || []).length;
check(w === 1 && p === 1, `worker/local_server propose_plan mention match (${w} vs ${p})`);

console.log(fail ? `\n${fail} FAILURES` : '\nALL PASS');
process.exit(fail ? 1 : 0);
