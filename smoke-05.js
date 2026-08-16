// smoke-05.js — Phase 0.5 verification (response format).
// Run with: node smoke-05.js
// Asserts the markdown renderer + MODE A/B/C pieces are wired, then runs the
// real advisorMarkdown transform (extracted from advisor.js) against known
// inputs. Exits 0 on all pass, 1 otherwise.
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

// 1. advisor.js: innerHTML present + MODE strip present.
check(/innerHTML/.test(advisor), 'advisor.js has innerHTML');
check(/MODE\s*:\s*[ABC]/.test(advisor), 'advisor.js has MODE strip');

// 2. worker.js + local_server.py: MODE A/B/C present in both.
check(worker.includes('MODE: A') && worker.includes('MODE: B') && worker.includes('MODE: C'),
  'worker.js has MODE A/B/C');
check(py.includes('MODE: A') && py.includes('MODE: B') && py.includes('MODE: C'),
  'local_server.py has MODE A/B/C');

// 3. Extract the real advisorMarkdown from advisor.js and run it against
//    known inputs (stubbing only advisorEscapeHtml, which is a separate
//    function and is exercised by the escape test below).
const m = advisor.match(/function advisorMarkdown\(text\) \{([\s\S]*?)\n\}\n\nfunction advisorAddMsg/);
if (!m) {
  check(false, 'advisorMarkdown extractable from advisor.js');
} else {
  const fnSrc = 'function advisorMarkdown(text) {' + m[1] + '\n}';
  const stubEscape = (s) => String(s == null ? '' : s)
    .replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const advisorMarkdown = new Function('advisorEscapeHtml', 'return (' + fnSrc + ')')(stubEscape);

  check(advisorMarkdown('**hello** world').includes('<strong>hello</strong>'), 'bold converts');

  const l = advisorMarkdown('intro\n- item1\n- item2');
  check(l.includes('<ul><li>item1</li><li>item2</li></ul>'), 'list converts');

  const t = advisorMarkdown('|A|B|\n|1|2|');
  check(t.includes('<th>A</th>') && t.includes('<td>1</td>'), 'table converts (th header + td cells)');

  const mo = advisorMarkdown('MODE: B\nHere is your **number**');
  check(!mo.includes('MODE') && mo.includes('<strong>number</strong>'), 'MODE line stripped');

  // Security ordering: escape BEFORE transform — a model reply containing
  // markup must come out inert, never as a live <script>.
  const esc = advisorMarkdown('<script>alert(1)</script>');
  check(esc.includes('&lt;script&gt;') && !esc.includes('<script>'), 'HTML escaped (escape before transform)');
}

// 4. user/system branches must still be textContent — the innerHTML path is
//    gated on the bot/tool role only.
check(/role === 'bot' \|\| role === 'tool'/.test(advisor), 'innerHTML gated to bot/tool role');
check(advisor.includes('div.textContent = text'), 'user/system stay on textContent');

console.log(fail ? `\n${fail} FAILURES` : '\nALL PASS');
process.exit(fail ? 1 : 0);
