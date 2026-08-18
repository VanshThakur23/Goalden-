// smoke-10.js — Phase 10 (real portfolio tools on Door 1/2) structural checks.
// Run with: node smoke-10.js · zero deps, regex-on-file-contents style.
'use strict';

const fs = require('fs');
const path = require('path');

const root = __dirname;
let fail = 0;
const check = (cond, label) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + label);
  if (!cond) fail++;
};

const engine = fs.readFileSync(path.join(root, 'goalden-engine.js'), 'utf8');
const g1 = fs.readFileSync(path.join(root, 'goalden.html'), 'utf8');
const g2 = fs.readFileSync(path.join(root, 'goalden-door2.html'), 'utf8');
const gl = fs.readFileSync(path.join(root, 'goalden-lab.html'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'src', 'worker.js'), 'utf8');
const py = fs.readFileSync(path.join(root, 'local_server.py'), 'utf8');

// 1. Each of the ported functions exists in goalden-engine.js.
const PORTED = [
  'computeDailyReturns', 'auditPriceSeries', 'computeReturnStats', 'alignReturns',
  'populationCovariance', 'computeCovarianceMatrix', 'portfolioReturn', 'portfolioVariance',
  'twoAssetFrontier', 'minVarianceWeightTwoAsset', 'tangencyWeightTwoAsset',
  'capitalAllocationLine', 'liveFrontierChartOption',
];
for (const fn of PORTED) {
  check(new RegExp('function ' + fn + '\\b').test(engine), `engine: ${fn} defined`);
}
check(/tangencyWeightTwoAsset/.test(engine) && /computeDailyReturns, auditPriceSeries/.test(engine), 'engine: ported functions exported in shim');

// 2. Both pages define + dispatch + describe the 5 new tools.
const TOOLS = ['search_instruments', 'add_instrument', 'remove_instrument', 'compare_portfolio', 'render_frontier_chart'];
for (const [name, src] of [['goalden.html', g1], ['goalden-door2.html', g2]]) {
  for (const t of TOOLS) {
    check(new RegExp("name:'" + t + "'").test(src), `${name}: ${t} tool defined`);
    check(new RegExp("name === '" + t + "'").test(src), `${name}: ${t} dispatch`);
    check(new RegExp("case '" + t + "'").test(src), `${name}: ${t} describeTool case`);
  }
  check(/instruments:\s*\[\]/.test(src), `${name}: instruments state added`);
}

// 3. Both pages load goalden-engine.js.
check(/<script src="goalden-engine\.js"><\/script>/.test(g1), 'goalden.html: loads goalden-engine.js');
check(/<script src="goalden-engine\.js"><\/script>/.test(g2), 'goalden-door2.html: loads goalden-engine.js');

// 4. worker.js + local_server.py both contain the new paragraph (mention parity).
check(/Real-stock portfolio comparison/.test(worker), 'worker.js: Real-stock portfolio comparison paragraph');
check(/Real-stock portfolio comparison/.test(py), 'local_server.py: Real-stock portfolio comparison paragraph');
check((worker.match(/search_instruments/g) || []).length === (py.match(/search_instruments/g) || []).length, 'worker/local_server search_instruments mention parity');

// 5. Lab's own copies of the ported functions are unchanged (still present).
for (const fn of PORTED) {
  check(new RegExp('function ' + fn + '\\b').test(gl), `lab: ${fn} still present (untouched)`);
}

console.log(fail ? `\n${fail} FAILURES` : '\nALL PASS');
process.exit(fail ? 1 : 0);
