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

