// smoke-13.js — Phase 2 raw-close price plumbing, worker/local_server parity.
// Run with: node smoke-13.js  · zero deps, regex-on-file-contents style.
'use strict';

const fs = require('fs');
const path = require('path');

const root = __dirname;
let fail = 0;
const check = (cond, label) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + label);
  if (!cond) fail++;
};

const worker = fs.readFileSync(path.join(root, 'src', 'worker.js'), 'utf8');
const py = fs.readFileSync(path.join(root, 'local_server.py'), 'utf8');
const stmt = fs.readFileSync(path.join(root, 'statements-engine.js'), 'utf8');

// 1. Both backends emit rawClose alongside the existing adjclose-preferred
// `close`, additive rather than a breaking rename.
check(/rawClose:/.test(worker), 'worker.js: emits rawClose field');
check(/'rawClose':/.test(py), "local_server.py: emits rawClose field");

// 2. The existing adjclose preference for `close` is untouched -- this is
// a strict addition, not a swap, so Test Real Investments' total-return
// CAGR must not regress.
check(/Prefer adjclose; fall back to raw close only if Yahoo omits/.test(worker), 'worker.js: adjclose-preferred `close` comment still present');
check(/Prefer adjclose; fall back to/.test(py), 'local_server.py: adjclose-preferred `close` comment still present (mirrored)');
// Variable-naming conventions differ (JS camelCase `rawCloses` vs Python
// snake_case `raw_closes`), so a raw substring count isn't a meaningful
// parity signal here -- what matters is that the actual field key each
// response emits is 1-to-1.
check((worker.match(/rawClose:/g) || []).length === (py.match(/'rawClose':/g) || []).length, 'worker/local_server rawClose field-key count matches');

// 3. statements-engine.js's fyEndPriceSeries is documented to require raw
// close specifically, never adjclose, matching the plan's explicit P/E-
// history instruction.
check(/P\/E history must use Yahoo's raw `close`, never/.test(stmt), 'statements-engine.js: fyEndPriceSeries documents raw-close-only requirement');

console.log(fail ? `\n${fail} FAILURES` : '\nALL PASS');
process.exit(fail ? 1 : 0);
