'use strict';
// engine.test.js — solved-workbook tests for goalden-engine.js.
// Run with: node --test engine.test.js
// Zero dependencies beyond node's built-in test runner.
const test = require('node:test');
const assert = require('node:assert');
const engine = require('./goalden-engine.js');

// Relative tolerance for float comparisons — the values below are computed
// from closed-form finance identities, so a 1e-9 relative error is far more
// than floating point should ever produce.
const approx = (actual, expected, rel = 1e-9) => {
  assert.ok(
    Math.abs(actual - expected) <= Math.abs(expected) * rel,
    `expected ~${expected}, got ${actual}`
  );
};

test('inflateExpense compounds each phase and applies the factor', () => {
  approx(engine.inflateExpense(100000, [{ rate: 0.06, years: 10 }], 1), 179084.7696);
  // 0% inflation over any number of years is a no-op (factor defaults to 1)
  approx(engine.inflateExpense(50000, [{ rate: 0, years: 20 }]), 50000);
});

test('realRate strips inflation', () => {
  approx(engine.realRate(0.12, 0.06), 0.0566037736);
  // zero inflation -> real rate equals the nominal rate
  approx(engine.realRate(0.08, 0), 0.08);
});

test('corpusRequired', () => {
  approx(engine.corpusRequired(0.05, 30, 100000, false), 1537245.1026882841);
  approx(engine.corpusRequired(0.05, 30, 100000, true), 1614107.3578226983);
  // due-mode is exactly (1+rate) x end-mode — an identity the formula must hold
  approx(engine.corpusRequired(0.05, 30, 100000, true), engine.corpusRequired(0.05, 30, 100000, false) * 1.05);
  // rate 0 collapses to withdrawal * years (no compounding)
  approx(engine.corpusRequired(0, 20, 50000, true), 1000000);
});

test('solveSIP', () => {
  approx(engine.solveSIP(0.01, 120, 1000000, false), 4347.094840258731);
  // rate 0 -> fv / periods
  approx(engine.solveSIP(0, 12, 120000, false), 10000);
});

test('effectiveMonthlyRate', () => {
  approx(engine.effectiveMonthlyRate(0.12), 0.009488792934583046);
  assert.strictEqual(engine.effectiveMonthlyRate(0), 0);
});

test('accumulationSchedule flat (no step-up) returns contributed on every row', () => {
  const r = engine.accumulationSchedule({ sip: 1000, rate: 0.01, periods: 12, due: false, opening: 0, stepUp: 0 });
  assert.strictEqual(r.rows.length, 12);
  approx(r.rows[0].closeBal, 1000);
  approx(r.rows[1].closeBal, 2010);
  assert.strictEqual(r.rows[0].contributed, 1000);
  assert.strictEqual(r.rows[11].contributed, 12000);
  approx(r.finalBalance, 12682.50301319697);
});

test('accumulationSchedule step-up grows contributions and still reports contributed', () => {
  const r = engine.accumulationSchedule({ sip: 1000, rate: 0.01, periods: 12, due: false, opening: 0, stepUp: 0.01 });
  assert.strictEqual(r.rows[0].contributed, 1000);
  approx(r.rows[1].contributed, 2010);
  approx(r.rows[1].closeBal, 2020);
  // a stepped plan must put strictly more in than the flat plan
  const flat = engine.accumulationSchedule({ sip: 1000, rate: 0.01, periods: 12, due: false, opening: 0, stepUp: 0 });
  assert.ok(r.finalBalance > flat.finalBalance);
  assert.ok(r.rows[11].contributed > flat.rows[11].contributed);
});

test('market helpers take country as an explicit parameter', () => {
  assert.strictEqual(engine.marketSeries('US'), engine.SP500_ANNUAL_RETURNS);
  assert.strictEqual(engine.marketSeries('IN'), engine.SENSEX_ANNUAL_RETURNS);
  assert.strictEqual(engine.marketName('US'), 'S&P 500');
  assert.strictEqual(engine.marketName('IN'), 'Sensex');
  assert.strictEqual(engine.SENSEX_ANNUAL_RETURNS.length, 44);
  assert.strictEqual(engine.SP500_ANNUAL_RETURNS.length, 97);
  const w = engine.rollingWindows(engine.SENSEX_ANNUAL_RETURNS, 10);
  assert.strictEqual(w.length, 44 - 10 + 1);
});

// ---- Phase 10: real-instrument portfolio math (ported from the Lab) ----

test('computeReturnStats daily mean/sd + annualization consistency', () => {
  const prices = [
    { date: '2023-01-01', close: 100 },
    { date: '2023-01-02', close: 110 },
    { date: '2023-01-03', close: 99 },
    { date: '2023-01-04', close: 108.9 },
  ];
  const stats = engine.computeReturnStats(prices, false);
  // daily returns: +0.10, -0.10, +0.10 -> mean = 0.10/3
  approx(stats.dailyMean, 0.1 / 3, 1e-9);
  // population sd of [0.10, -0.10, 0.10] around 0.03333…
  approx(stats.dailySd, 0.0942809, 1e-5);
  // annualization is applied to the (independently-checked) daily figures
  approx(stats.annualReturn, Math.pow(1 + stats.dailyMean, stats.tradingDaysPerYear) - 1, 1e-9);
  approx(stats.annualVol, stats.dailySd * Math.sqrt(stats.tradingDaysPerYear), 1e-9);
  approx(stats.tradingDaysPerYear, stats.n / stats.spanYears, 1e-9);
  assert.strictEqual(stats.n, 3);
});

test('computeCovarianceMatrix: perfectly correlated / anti / mixed', () => {
  const vals = [0.01, -0.02, 0.03, 0.01, -0.01, 0.02, -0.03, 0.015, -0.025, 0.02, -0.01, 0.03];
  const sd = (a) => { const m = a.reduce((s, x) => s + x, 0) / a.length; return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / a.length); };
  // annualVol is set CONSISTENT with the daily series so the matrix's corr
  // equals the daily correlation (covAnnual[i][j] / (vol_i * vol_j)).
  const mk = (arr) => ({ returns: arr.map((r, i) => ({ date: 'd' + i, r })), annualVol: sd(arr) * Math.sqrt(252), tradingDaysPerYear: 252 });
  const A = mk(vals);
  const B = mk(vals.map((v) => v * 2));   // 2x A -> corr +1
  const C = mk(vals.map((v) => -v));      // -A   -> corr -1
  const D = mk(vals.map((v, i) => (i < 6 ? v : -v))); // half-flipped -> mixed
  const cAB = engine.computeCovarianceMatrix([A, B]).corr;
  const cAC = engine.computeCovarianceMatrix([A, C]).corr;
  const cAD = engine.computeCovarianceMatrix([A, D]).corr;
  approx(cAB[0][1], 1, 1e-6);
  approx(cAC[0][1], -1, 1e-6);
  assert.ok(cAD[0][1] > -1 && cAD[0][1] < 1, `mixed correlation strictly between -1 and 1 (got ${cAD[0][1]})`);
  // diagonal is identity
  approx(cAB[0][0], 1);
  approx(cAB[1][1], 1);
});

test('twoAssetFrontier endpoints and interior minimum', () => {
  const retA = 0.12, retB = 0.08, sdA = 0.20, sdB = 0.10, corr = 0.3;
  const pts = engine.twoAssetFrontier(retA, retB, sdA, sdB, corr, 101);
  approx(pts[0].w, 0);
  approx(pts[0].ret, retB);
  approx(pts[0].vol, sdB);
  approx(pts[pts.length - 1].w, 1);
  approx(pts[pts.length - 1].ret, retA);
  approx(pts[pts.length - 1].vol, sdA);
  const minVol = Math.min(...pts.map((p) => p.vol));
  assert.ok(minVol <= pts[0].vol + 1e-12 && minVol <= pts[pts.length - 1].vol + 1e-12, 'interior min vol is not above either endpoint');
});

test('minVarianceWeightTwoAsset: interior value and high-correlation clamp', () => {
  approx(engine.minVarianceWeightTwoAsset(0.2, 0.1, 0), 0.2, 1e-9); // sdB^2 / (sdA^2 + sdB^2)
  approx(engine.minVarianceWeightTwoAsset(0.2, 0.1, 0.9), 0, 1e-9); // negative raw -> clamp to 0
});

test('tangencyWeightTwoAsset picks the higher-Sharpe pure holding (RELIANCE/TCS-style)', () => {
  // B underperforms cash (negative excess return). The raw two-fund formula
  // wants to SHORT B (wRaw < 0) — a naive clamp would grab 0 (100% B), which is
  // backwards. The correct constrained answer is 100% A (the higher Sharpe).
  const retA = 0.15, retB = -0.10, sdA = 0.25, sdB = 0.20, corr = 0.3, rf = 0.065;
  const w = engine.tangencyWeightTwoAsset(retA, retB, sdA, sdB, corr, rf);
  assert.strictEqual(w, 1);
  // interior case: both positive excess returns -> a genuine interior weight
  const w2 = engine.tangencyWeightTwoAsset(0.12, 0.08, 0.20, 0.10, 0.3, 0.065);
  assert.ok(w2 > 0 && w2 < 1, `interior tangency weight (got ${w2})`);
});

test('capitalAllocationLine starts at (0, rf)', () => {
  const cal = engine.capitalAllocationLine(0.065, 0.12, 0.20);
  approx(cal[0].vol, 0);
  approx(cal[0].ret, 0.065);
  // extends beyond the tangency point toward maxLeverage x tangency vol
  const last = cal[cal.length - 1];
  assert.ok(last.vol > 0.20 - 1e-9, 'CAL extends past the tangency risk level');
});

// ---- Phase 11: BM25 retrieval (tool routing + knowledge grounding) ----

test('bm25Rank: exact keyword match beats no match', () => {
  const docs = [
    { id: 'a', text: 'compare two stocks for risk and return' },
    { id: 'b', text: 'build a retirement savings plan' },
  ];
  const ranked = engine.bm25Rank('compare stocks risk', docs);
  assert.strictEqual(ranked[0].id, 'a');
  assert.ok(ranked[0].score > ranked[1].score, 'matched doc scores higher');
  assert.strictEqual(ranked[1].score, 0, 'unmatched doc scores zero');
});

test('bm25Rank: matching 2 of 2 terms outranks 1 of 2', () => {
  const docs = [
    { id: 'one', text: 'correlation of two assets' },
    { id: 'two', text: 'correlation and risk of two assets' },
  ];
  const ranked = engine.bm25Rank('correlation risk', docs);
  assert.strictEqual(ranked[0].id, 'two');
});

test('bm25Rank: empty query / empty docs do not throw', () => {
  assert.ok(Array.isArray(engine.bm25Rank('', [{ id: 'x', text: 'anything' }])));
  assert.ok(Array.isArray(engine.bm25Rank('query', [])));
  assert.strictEqual(engine.bm25Rank('query', []).length, 0);
});

test('bm25Rank: length normalization — a long doc does not auto-win', () => {
  const short = { id: 'short', text: 'risk return correlation' };
  const long = { id: 'long', text: ('the quick brown fox jumps over the lazy dog and does many unrelated financial things that are not about the query terms at all ').repeat(20) };
  const ranked = engine.bm25Rank('risk return correlation', [long, short]);
  // The short doc contains all 3 query terms; the long doc contains none.
  assert.strictEqual(ranked[0].id, 'short');
});

test('filterToolsByQuery: relevant tool survives, unrelated dropped', () => {
  const tools = [
    { type: 'function', function: { name: 'compare_portfolio', description: 'pair stocks to minimize risk and compare their return and correlation' } },
    { type: 'function', function: { name: 'add_instrument', description: 'add a stock' } },
    { type: 'function', function: { name: 'search_instruments', description: 'search a stock' } },
    { type: 'function', function: { name: 'remove_instrument', description: 'remove a stock' } },
    { type: 'function', function: { name: 'render_frontier_chart', description: 'render a stock chart' } },
  ];
  // 8 more tools, each matching only one query term ("stock"), so
  // compare_portfolio (matching 5+ terms) is clearly top and build_goal_plan
  // (matching none) is clearly dropped.
  for (let i = 0; i < 8; i++) tools.push({ type: 'function', function: { name: 'filler_' + i, description: 'a stock metric ' + i } });
  tools.push({ type: 'function', function: { name: 'build_goal_plan', description: 'build a retirement or education savings plan' } });
  const filtered = engine.filterToolsByQuery(tools, 'which stocks should i pair to minimize risk', []);
  const names = filtered.map((t) => t.function.name);
  assert.ok(names.includes('compare_portfolio'), 'compare_portfolio survives');
  assert.ok(!names.includes('build_goal_plan'), 'goal-planning tool dropped');
  assert.strictEqual(filtered.length, 8, 'filters down to K=8');
});

test('filterToolsByQuery: already-called tools are never dropped', () => {
  const tools = [];
  for (let i = 0; i < 12; i++) tools.push({ type: 'function', function: { name: 'tool_' + i, description: 'tool number ' + i } });
  // add a tool whose description is irrelevant to the query but was already called
  tools.push({ type: 'function', function: { name: 'mid_chain_tool', description: 'zzz irrelevant' } });
  const filtered = engine.filterToolsByQuery(tools, 'apple orange banana', ['mid_chain_tool']);
  const names = filtered.map((t) => t.function.name);
  assert.ok(names.includes('mid_chain_tool'), 'already-called tool kept regardless of score');
});

test('filterToolsByQuery: skips filtering when <= K tools', () => {
  const tools = [{ type: 'function', function: { name: 'a', description: 'x' } }, { type: 'function', function: { name: 'b', description: 'y' } }];
  assert.strictEqual(engine.filterToolsByQuery(tools, 'whatever', []), tools);
});

test('filterToolsByQuery: tool family survives whole when one member is triggered', () => {
  // Real bug found in Phase 11 live verification: add_instrument's
  // description ("fetch price history, pass a ticker") shares no vocabulary
  // with a natural query like "pair stocks to minimize risk", so it would
  // individually score 0 and drop out of top-K — even though
  // compare_portfolio cannot function without it having been called first.
  const tools = [
    { type: 'function', function: { name: 'search_instruments', description: 'search real stocks and ETFs by name or ticker' } },
    { type: 'function', function: { name: 'add_instrument', description: 'fetch a real instrument price history, pass a ticker or fund code' } },
    { type: 'function', function: { name: 'remove_instrument', description: 'remove an instrument from the comparison' } },
    { type: 'function', function: { name: 'compare_portfolio', description: 'compare two stocks for risk minimizing split and best sharpe tangency split' } },
    { type: 'function', function: { name: 'render_frontier_chart', description: 'render the efficient frontier chart panel' } },
  ];
  for (let i = 0; i < 8; i++) tools.push({ type: 'function', function: { name: 'noise_' + i, description: 'unrelated utility tool ' + i } });
  const filtered = engine.filterToolsByQuery(tools, 'which stocks should i pair to minimize risk', []);
  const names = filtered.map((t) => t.function.name);
  for (const n of ['search_instruments', 'add_instrument', 'remove_instrument', 'compare_portfolio', 'render_frontier_chart']) {
    assert.ok(names.includes(n), `${n} survives because a family member triggered`);
  }
});

// ---- Phase 12: alternate chart-option builders (bar / radar) ----

test('barComparisonChartOption: one series per metric, one bar per asset', () => {
  const assetPoints = [{ label: 'RELIANCE.NS', ret: 0.24, vol: 0.27 }, { label: 'TCS.NS', ret: 0.11, vol: 0.24 }];
  const opt = engine.barComparisonChartOption(assetPoints);
  assert.strictEqual(opt.series.length, 2, 'return and risk series');
  assert.strictEqual(opt.xAxis.data.length, 2, 'one category per asset');
  assert.deepStrictEqual(opt.series[0].data, [0.24, 0.11]);
  assert.deepStrictEqual(opt.series[1].data, [0.27, 0.24]);
});

test('radarComparisonChartOption: 3 indicators, 4 data points (2 assets + 2 mixes)', () => {
  const assetPoints = [{ label: 'A', ret: 0.20, vol: 0.25 }, { label: 'B', ret: 0.12, vol: 0.18 }];
  const minVariance = { ret: 0.15, vol: 0.16, sharpe: 0.6 };
  const tangency = { ret: 0.19, vol: 0.22, sharpe: 0.65 };
  const opt = engine.radarComparisonChartOption(assetPoints, minVariance, tangency, 0.065);
  assert.strictEqual(opt.radar.indicator.length, 3);
  assert.deepStrictEqual(opt.radar.indicator.map((i) => i.name), ['Return', 'Risk', 'Sharpe']);
  assert.strictEqual(opt.series[0].data.length, 4, 'asset A, asset B, safest mix, best balance');
  assert.strictEqual(opt.series[0].data[0].name, 'A');
  assert.strictEqual(opt.series[0].data[2].name, 'Safest mix');
});

test('radarComparisonChartOption: every axis max is >= the values it bounds', () => {
  const assetPoints = [{ label: 'A', ret: 0.30, vol: 0.05 }, { label: 'B', ret: 0.05, vol: 0.30 }];
  const minVariance = { ret: 0.10, vol: 0.10, sharpe: 0.4 };
  const tangency = { ret: 0.28, vol: 0.20, sharpe: 1.1 };
  const opt = engine.radarComparisonChartOption(assetPoints, minVariance, tangency, 0.065);
  const [retInd, riskInd] = opt.radar.indicator;
  const rets = opt.series[0].data.map((d) => d.value[0]);
  const vols = opt.series[0].data.map((d) => d.value[1]);
  assert.ok(retInd.max >= Math.max(...rets), 'return axis bounds every plotted return');
  assert.ok(riskInd.max >= Math.max(...vols), 'risk axis bounds every plotted vol');
});


