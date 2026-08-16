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
