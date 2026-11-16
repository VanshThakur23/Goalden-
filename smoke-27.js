// smoke-27.js -- the landing advisor can open one Lab tool directly (open_door with tab), and its list of Lab
// tools stays in step with the Lab's own tabs. Runs index.html in the eval runner's sandbox.
// Run with: node smoke-27.js
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = __dirname;
let fail = 0;
const check = (cond, label) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + label);
  if (!cond) fail++;
};
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');
const gl = read('goalden-lab.html'), g1 = read('goalden.html');
const labTabs = (gl.slice(gl.indexOf('const TABS=['), gl.indexOf('\n];', gl.indexOf('const TABS=['))).match(/\{id:'([a-z]+)'/g) || []).map(x => x.slice(5, -1));

const quiet = console.log; console.log = () => {};
let api = null;
try { api = require(path.join(root, 'agent-evals', 'runner.js')).loadPage('index.html'); } catch (e) { api = null; }
console.log = quiet;
check(!!api, 'the landing page loads in the sandbox');
if (api) {
  const run = (code) => vm.runInContext(code, api.ctx);
  const listed = run('Object.keys(ADVISOR_LAB_TABS)');
  check(JSON.stringify([...listed].sort()) === JSON.stringify([...labTabs].sort()), 'the advisor\'s Lab tools are exactly the Lab\'s tabs (' + labTabs.length + ')');
  const tool = api.getTools().find(t => t.function.name === 'open_door');
  check(tool && JSON.stringify(tool.function.parameters.properties.tab.enum) === JSON.stringify(listed), 'open_door offers tab, limited to those tools');
  const go = (args) => { run('location.href=""'); const r = JSON.parse(api.executeTool('open_door', args)); return { r, href: run('location.href') }; };
  const a = go({ door: 'lab', tab: 'rentbuy', auto_continue: true });
  check(a.r.ok && a.href === 'goalden-lab.html?tab=rentbuy' && /Rent or buy/.test(a.r.opened), 'door lab + tab opens that tool');
  const b = go({ door: 'lab', tab: 'nonsense' });
  check(!b.r.ok && b.href === '', 'an unknown tool is refused and nothing opens');
  const c = go({ door: 'full', tab: 'loans' });
  check(!c.r.ok && c.href === '', 'a tab with any other door is refused');
  const d = go({ door: 'quick' });
  check(d.r.ok && d.href === 'goalden.html', 'a plain door still opens as before');
  check(JSON.stringify(api.getTools().find(t => t.function.name === 'highlight').function.parameters.properties.element.enum) === '["questions","doors"]', 'the advisor can point at the question tiles');
}
check(/\.lc-bar,\.lc-body\{padding-left:max\(20px,var\(--col-gut\)\)/.test(g1), 'Quick Calculate\'s bottom summary bar lines up with the column');

// ---- every screen Quick Calculate's flow() can reach has a renderer (the "Cost of waiting" card led to two
// screens that never had one, so it showed a blank page)
{
  const fl = g1.slice(g1.indexOf('function flow() {'), g1.indexOf('\n}', g1.indexOf('function flow() {')));
  const inFlow = [...new Set((fl.match(/'([a-z_0-9]+)'/g) || []).map(x => x.slice(1, -1)).filter(x => !['retirement', 'education', 'generic', 'delay'].includes(x)))];
  const rd = g1.slice(g1.indexOf('function render(opts) {'), g1.indexOf('function render(opts) {') + 3000);
  const rendered = (rd.match(/screen===\s*'([a-z_0-9]+)'/g) || []).map(x => x.match(/'([a-z_0-9]+)'/)[1]);
  const missing = inFlow.filter(x => !rendered.includes(x));
  check(inFlow.length >= 10 && !missing.length, 'every Quick Calculate screen in flow() has a renderer' + (missing.length ? ' (missing: ' + missing.join(', ') + ')' : ''));
  check(!/id:'delay'/.test(g1) && /GOALS\.some\(g=>g\.id===S\.goalType\)\?'':' disabled'/.test(g1), 'no goal card leads to a blank screen; an old "delay" state cannot continue');
}

console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
