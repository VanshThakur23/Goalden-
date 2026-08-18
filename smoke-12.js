// smoke-12.js — Phase 12 (AI-chosen chart type for portfolio comparisons)
// structural checks. Run with: node smoke-12.js · zero deps, regex-on-file-
// contents style, same conventions as smoke-09/10/11.
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

// 1. Both new chart-option builders exist in the canonical engine file and
// are exported.
check(/function barComparisonChartOption\b/.test(engine), 'engine: barComparisonChartOption defined');
check(/function radarComparisonChartOption\b/.test(engine), 'engine: radarComparisonChartOption defined');
check(/barComparisonChartOption, radarComparisonChartOption/.test(engine), 'engine: Phase 12 builders exported in shim');

// 2. Both pages accept an optional chartType on render_frontier_chart —
// schema declares the enum, dispatch forwards args.chartType, the render
// function branches on it, and the two new builders are actually called.
for (const [name, src] of [['goalden.html', g1], ['goalden-door2.html', g2]]) {
  check(/enum:\['frontier','bar','radar'\]/.test(src), `${name}: chartType enum declared on render_frontier_chart schema`);
  check(/renderFrontierChart\(args && args\.chartType\)/.test(src), `${name}: dispatch forwards args.chartType`);
  check(/function renderFrontierChart\(chartType\)/.test(src), `${name}: renderFrontierChart accepts a chartType param`);
  check(/barComparisonChartOption\(d\.assetPoints\)/.test(src), `${name}: bar branch calls barComparisonChartOption`);
  check(/radarComparisonChartOption\(d\.assetPoints, d\.minVariance, d\.tangency, d\.riskFree\)/.test(src), `${name}: radar branch calls radarComparisonChartOption`);
  check(/minVariance: \{ ret: mv\.ret, vol: mv\.vol, sharpe: sharpeAt\(wMinVar\) \}/.test(src), `${name}: comparePortfolio stashes minVariance for the radar builder`);
}

// 3. Lab is untouched — Phase 12 only touches Door 1/2 and the shared engine.
check(!/barComparisonChartOption|radarComparisonChartOption/.test(gl), 'lab: no Phase 12 chart builders referenced (untouched)');

// 4. System prompt mentions the chartType choice (mirrored, mention-count parity).
check(/chartType — pick whichever actually fits/.test(worker) || /chartType.{0,40}pick whichever/.test(worker), 'worker.js: chartType guidance present');
check(/chartType.{0,60}pick whichever/s.test(py), 'local_server.py: chartType guidance present (mirrored)');

console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
process.exit(fail ? 1 : 0);
