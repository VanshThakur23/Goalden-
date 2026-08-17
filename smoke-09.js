// smoke-09.js — Phase 9 (federated read-across) structural verification.
// Run with: node smoke-09.js  · zero deps, regex-on-file-contents style.
'use strict';

const fs = require('fs');
const path = require('path');

const root = __dirname;
let fail = 0;
const check = (cond, label) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + label);
  if (!cond) fail++;
};

const g1 = fs.readFileSync(path.join(root, 'goalden.html'), 'utf8');
const g2 = fs.readFileSync(path.join(root, 'goalden-door2.html'), 'utf8');
const gl = fs.readFileSync(path.join(root, 'goalden-lab.html'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'src', 'worker.js'), 'utf8');
const py = fs.readFileSync(path.join(root, 'local_server.py'), 'utf8');

// 1. Tool defined + wired on all three pages.
for (const [name, src] of [['goalden.html', g1], ['goalden-door2.html', g2], ['goalden-lab.html', gl]]) {
  check(/name:'read_other_page'/.test(src), `${name}: read_other_page tool defined`);
  check(/function readOtherPage/.test(src), `${name}: readOtherPage function defined`);
  check(/name === 'read_other_page'\) return JSON\.stringify\(readOtherPage/.test(src), `${name}: read_other_page dispatch`);
  check(/case 'read_other_page'/.test(src), `${name}: read_other_page describeTool case`);
}

// 2. Read-only: readOtherPage body must not mutate state or call set_value.
for (const [name, src] of [['goalden.html', g1], ['goalden-door2.html', g2], ['goalden-lab.html', gl]]) {
  const m = src.match(/function readOtherPage\(page\)[\s\S]*?\n\}/);
  const body = m ? m[0] : '';
  check(!!body, `${name}: readOtherPage body extracted`);
  check(body.includes('localStorage.getItem'), `${name}: readOtherPage reads localStorage`);
  check(!body.includes('localStorage.setItem'), `${name}: readOtherPage never writes localStorage`);
  check(!/advisorSetValue|set_value\s*\(/.test(body), `${name}: readOtherPage never calls set_value`);
  check(!/\b(S|G|L)\[/.test(body) && !/\b(S|G|L)\.\w+\s*=/.test(body), `${name}: readOtherPage never assigns into S/G/L`);
  check(!body.includes('render()'), `${name}: readOtherPage never re-renders`);
}

// 3. read_other_page uses the OTHER page's keys (no self-reference).
check(/OTHER_PAGE_KEYS = \{ door2: 'goaldenD2State', lab: 'goaldenLabState' \}/.test(g1), 'goalden.html: reads door2+lab keys');
check(/OTHER_PAGE_KEYS = \{ door1: 'goaldenD1State', lab: 'goaldenLabState' \}/.test(g2), 'door2: reads door1+lab keys');
check(/OTHER_PAGE_KEYS = \{ door1: 'goaldenD1State', door2: 'goaldenD2State' \}/.test(gl), 'lab: reads door1+door2 keys');

// 4. Lab persists its own compact snapshot for the other pages to read.
check(/LAB_STATE_KEY = 'goaldenLabState'/.test(gl), 'lab: persists goaldenLabState');
check(/persistLabState\(\);/.test(gl), 'lab: persistLabState called in render()');

// 5. System-prompt addition in both servers.
check(/read_other_page\(page\) returns a READ-ONLY snapshot/.test(worker), 'worker.js: read_other_page prompt addition');
check(/read_other_page\(page\) returns a READ-ONLY snapshot/.test(py), 'local_server.py: read_other_page prompt addition (mirrored)');
check((worker.match(/read_other_page/g) || []).length === (py.match(/read_other_page/g) || []).length, 'worker/local_server read_other_page mention count matches');

console.log(fail ? `\n${fail} FAILURES` : '\nALL PASS');
process.exit(fail ? 1 : 0);
