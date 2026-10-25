// smoke-20.js — Group 9a checks: the Retirement Income tab in the Lab (B4).
// Regex-on-file-contents style, same conventions as smoke-09..19; the tab's own input
// clamp is also run for real, in a vm, against the page's source, and the engine's
// buckets / SWP / FD / NPS functions are run for the invariants the cards rely on.
// Run with: node smoke-20.js
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
const gl = read('goalden-lab.html');
const eng = require('./goalden-engine.js');

const fnBody = (src, name) => {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) return '';
  const j = src.indexOf('\nfunction ', i + 10);
  return src.slice(i, j < 0 ? undefined : j);
};

// ---- the tab is wired in everywhere a tab has to be --------------------------------
check(/income:\{ corpus:30000000, spend:80000, years:25, inflation:6, slab:null,/.test(gl), '9a L.income holds the tab state, slab null = the default slab');
check(/swp:\['swp'\], income:\['income'\]/.test(gl), '9a Reset on the tab restores L.income');
check(/\{id:'income', short:/.test(gl) && /icon:ICON_INCOME/.test(gl), '9a the tab is in TABS with its own icon');
check(/else if\(L\.tab==='income'\) main\.innerHTML=renderIncome\(\);/.test(gl), '9a render() dispatches to renderIncome');
check(/tab==='income'\?L\.income/.test(gl) && /k==='incShockYear'/.test(gl), '9a the slider handler targets L.income and handles the crash-year slider');
check(/querySelectorAll\('\[data-inc\]'\)/.test(gl), '9a the pills and the Retirement Lab button have a click handler');
check(/const r=calcRetLab\(\);[\s\S]{0,200}s\.spend=Math\.round\(r\.expAtRet\/12\/1000\)\*1000/.test(gl), '9a "use my Retirement Lab numbers" copies the pot and the monthly spend (annual /12)');

// ---- India only: other countries get a note, never wrong numbers ------------------------
const ri = fnBody(gl, 'renderIncome');
check(/if\(L\.country!=='IN'\) return incomeIndiaOnly\(\);/.test(ri), '9a renderIncome refuses a non-India country before computing anything');
check(/data-country="IN">Switch to India/.test(fnBody(gl, 'incomeIndiaOnly')), '9a the note has a one-click switch to India');
check((gl.match(/if \(tab === 'income'\) \{\n    if \(L\.country !== 'IN'\) return \{ ok:false/g) || []).length === 2, '9a both advisor readers (chart and numbers) say so, not give wrong numbers, outside India');

// ---- inputs are brought inside the sliders' ranges --------------------------------------
check(/clampIncome\(s\);/.test(fnBody(gl, 'computeIncome')), '9a computeIncome clamps its state first');
{
  const grab = (re, what) => { const m = gl.match(re); if (!m) throw new Error('cannot find ' + what); return m[0]; };
  const defaults = grab(/income:\{ corpus:30000000[\s\S]*?annuityRate:6, retNote:null \},/, 'income defaults').replace(/,\s*$/, '');
  const src = fnBody(gl, 'incClamp') + '\n' + fnBody(gl, 'incomeSlabPct') + '\n' + fnBody(gl, 'clampIncome') + '\n' + fnBody(gl, 'incPct');
  const sandbox = {
    TAX_IN: eng.TAX_IN, console,
    cfg: () => ({ episodes: [{ id: '2008', rate: -0.52 }, { id: '2020', rate: -0.3 }] }),
  };
  vm.createContext(sandbox);
  let ok = true;
  try {
    vm.runInContext('const L_DEFAULTS = {' + defaults + '};\n' + src +
      '\nthis.clampIncome = clampIncome; this.incPct = incPct; this.incomeSlabPct = incomeSlabPct; this.D = L_DEFAULTS.income;', sandbox);
  } catch (e) { ok = false; console.log('     ' + e.message); }
  check(ok, "9a the page's own clampIncome / incPct load in a vm");
  if (ok) {
    const bad = { corpus: 'abc', spend: -5, years: 1000, inflation: NaN, slab: 7, liquidYears: 9, debtYears: 0, kind: 'x', fundRate: 99, fdRate: -1,
      ownShare: 500, equityRate: 0, npsPot: 1e12, annuityShare: 5, annuityRate: 50, shock: { epId: 'nope', year: 3 } };
    sandbox.clampIncome(bad);
    const D = sandbox.D;
    check(bad.corpus === D.corpus && bad.inflation === D.inflation, '9a a non-number falls back to the default');
    check(bad.spend === 5000 && bad.years === 50 && bad.liquidYears === 3 && bad.debtYears === 2, '9a out-of-range numbers are pulled to the nearest end of their slider');
    check(bad.kind === 'swpEquity' && bad.fundRate === 14 && bad.fdRate === 3 && bad.ownShare === 100 && bad.equityRate === 4, '9a an unknown fund type becomes equity; rates and own share are bounded');
    check(bad.npsPot === 5e7 && bad.annuityShare === 20 && bad.annuityRate === 9, '9a the NPS inputs are bounded (annuity share never under the 20% minimum)');
    check(bad.shock === null, '9a a crash that is not one of the country\'s episodes is dropped');
    const ok2 = Object.assign({}, D, { years: 25, shock: { epId: '2008', year: 99 } });
    sandbox.clampIncome(ok2);
    check(ok2.shock && ok2.shock.year === 25, '9a a crash year past the horizon is pulled back to the last year');
    const again = JSON.stringify(bad);
    sandbox.clampIncome(bad);
    check(JSON.stringify(bad) === again, '9a clamping twice changes nothing');
    check(sandbox.incomeSlabPct({ slab: 7 }) === eng.TAX_IN.defaultSlab && sandbox.incomeSlabPct({ slab: 30 }) === 30, '9a an unknown slab becomes the default slab');
    check(sandbox.incPct(0.032) === '3.2%' && sandbox.incPct(0.5) === '50%', '9a incPct drops a trailing .0');
  }
}

// ---- the engine's guarantees the cards depend on ---------------------------------------
{
  const bk = eng.incomeBuckets({ corpus: 3e7, annualSpend: 960000, inflation: 0.06, years: 25, liquidYears: 2, debtYears: 5 });
  check(Math.abs(bk.liquid + bk.debt + bk.equity - 3e7) < 1e-6 && bk.covered, '9a the three buckets add up to the pot');
  const small = eng.incomeBuckets({ corpus: 2e6, annualSpend: 960000, inflation: 0.06, years: 25, liquidYears: 2, debtYears: 5 });
  check(!small.covered && small.equity === 0 && small.shortfall > 0, '9a a pot too small for the near buckets says so, with the shortfall, and holds no equity');
  const o = { corpus: 3e7, ownShare: 0.5, netSpend: 960000, inflation: 0.06, years: 25, slab: 0.2 };
  const swp = eng.incomeDrawPlan(Object.assign({ kind: 'swpEquity', rate: 0.1 }, o));
  const fd = eng.incomeDrawPlan(Object.assign({ kind: 'fd', rate: 0.065 }, o));
  check(swp.firstTax < fd.firstTax, '9a year-1 tax: an SWP pays far less than FD interest on the same pot');
  check(Math.abs(swp.rows[0].gross - swp.rows[0].tax - 960000) < 1e-6, '9a an SWP sells enough that what is left after tax is the spend asked for');
  // The tax itself, worked out independently of the engine's sizing: the gain share of what was sold, less the Rs 1.25 L
  // exemption, at 12.5% plus cess.
  const gs = (swp.rows[0].open - 3e7 * 0.5) / swp.rows[0].open;
  check(Math.abs(swp.rows[0].tax - Math.max(0, swp.rows[0].gross * gs - 125000) * 0.125 * 1.04) < 1e-6, '9a the year-1 SWP tax is the gain share of the sale, less the exemption, at 12.5% plus cess');
  check(Math.abs(swp.finalIfSold - (swp.finalBalance - swp.finalExitTax)) < 1e-6 && swp.finalIfSold < swp.finalBalance && fd.finalExitTax === 0, '9a an SWP pot is shown net of the tax still owed on its gains; an FD pot owes nothing more');
  const sell = eng.incomeSwitchTax({ corpus: 3e7, ownShare: 0.5, from: 'swpEquity', slab: 0.2 });
  check(sell > 0 && eng.incomeSwitchTax({ corpus: 3e7, ownShare: 1, from: 'swpEquity', slab: 0.2 }) === 0, '9a moving a fund pot into an FD costs tax on its gains; money that is already cash costs none');
  const nps = eng.npsAnnuityPlan({ pot: 2e6, annuityShare: 0.05, annuityRate: 0.06, slab: 0.2 });
  check(nps.share === 0.2 && Math.abs(nps.annuityBuy - 4e5) < 1e-6, '9a the NPS annuity share is never under the 20% minimum');
  const nps2 = eng.npsAnnuityPlan({ pot: 2e6, annuityShare: 0.2, annuityRate: 0.06, slab: 0.2 });
  check(nps2.lumpTax > 0, '9a cash above the 60% limit is shown taxed (the cautious case)');
  const hit = eng.incomeStrategies({ corpus: 3e7, annualSpend: 960000, inflation: 0.06, years: 25, liquidYears: 2, debtYears: 5,
    liquidRate: 0.065, debtRate: 0.07, equityRate: 0.11, shock: { year: 1, equityReturn: -0.52 } });
  const calm = eng.incomeStrategies({ corpus: 3e7, annualSpend: 960000, inflation: 0.06, years: 25, liquidYears: 2, debtYears: 5,
    liquidRate: 0.065, debtRate: 0.07, equityRate: 0.11, shock: null });
  check(hit.mix.finalBalance < calm.mix.finalBalance && hit.buckets.finalBalance < calm.buckets.finalBalance, '9a a year-1 crash leaves both plans worse off than no crash');
}

// ---- what the tab says: honest, both sides, no verdicts ---------------------------------
check(/an SWP from \$\{kindWord\}/.test(ri) && !/a \$\{kindWord\} SWP/.test(ri), '9a the SWP caption reads "an SWP from an equity fund" (no "a equity")');
check(/does not pick|do not settle it|the cautious case/.test(ri) && /not a quote/.test(ri), '9a the NPS note says the tax above 60% is not settled and the annuity rate is the person\'s own assumption');
check(/Both lines start at \$\{c\.compact\(s\.corpus-R\.sell\)\}/.test(ri), '9a both lines start at the pot less the tax of selling the fund, and say so');
check(/values:\[Math\.max\(0,s\.corpus-R\.sell\)\]\.concat\(sw\.rows\.map\(r=>r\.ifSold\)\)/.test(ri) && /values:\[Math\.max\(0,s\.corpus-R\.sell\)\]\.concat\(fd\.rows\.map\(r=>r\.ifSold\)\)/.test(ri), '9a the chart draws what each route would keep after tax if sold (the SWP line is not the raw pot)');
check(/keptCell\(sw\)/.test(ri) && /Both lines are what you would have left after tax if everything were sold that year/.test(ri), '9a the end figures and the note say the same thing as the chart');
check(/the FD route pays \$\{c\.compact\(fd\.totalTax\)\} on its interest\$\{R\.sell>0\?`, plus \$\{c\.compact\(R\.sell\)\} to sell the fund first`/.test(ri) && !/because its pot grew larger/.test(ri), '9a the whole-period tax sentence counts the tax to sell the fund on the FD side and makes no causal claim');
check(/An FD's rate is fixed only until it matures/.test(ri) && !/rate is a promise|rate is guaranteed/.test(ri + fnBody(gl, 'incomeAdvisorResults') + fnBody(gl, 'advisorGetResults')), '9a an FD rate is described as fixed only until maturity');
check(/crash widened its lead/.test(ri) && /It was ahead with no crash too/.test(ri) && /The crash reversed the order/.test(ri), '9a the crash caption compares with the same plans in a calm run before saying what the crash did');
check(/Both pay the same spending; the buckets avoid selling equity at the bottom while the near buckets last, but that does not by itself leave more at the end/.test(ri) && !/steady cheque/.test(ri), '9a the caption stays neutral about what buckets give');
check(/government employees still need at least 40%/.test(ri) && /government employees still at least 40%/.test(gl), '9a the NPS minimum annuity share is described as the non-government rule, in the card and for the advisor');
check(/taking the pension off today's spending would understate what it needs/.test(ri) && /does on the day you retire/.test(ri) && !/lower its monthly spend by the pension|does today\./.test(ri), '9a the NPS caption says the flat pension is a growing gap, not a straight subtraction');
check(/rn\.corpus===s\.corpus && rn\.spend===s\.spend && rn\.years===s\.years/.test(ri) && /s\.retNote=\(want\.corpus!==s\.corpus/.test(gl) && /retNote:null/.test(gl), '9a "Use my Retirement Lab numbers" tells the person which values were cut to fit, only while they still match');
check(/bought on or after 1 April 2023/.test(ri), '9a the debt-fund note names the 1 April 2023 rule');
check(/role="group" aria-label="Type of fund the SWP draws from"/.test(ri) && /role="group" aria-label="Historical crash to test"/.test(ri), '9a the fund-type and crash button groups carry a group name');
check(/How is an SWP taxed compared with FD interest\?/.test(gl) && !/Why does an SWP pay less tax|Why does the FD pay more tax/.test(gl), '9a the advisor chips do not presume which side wins');
check(/The two do not carry the same risk/.test(ri), '9a the bucket-vs-pot comparison names the difference in equity share');
check(/One crash at one date is a single story, not a probability/.test(ri), '9a the crash card points at the Monte Carlo for the probability');
check(!/should (buy|sell|choose)|we recommend|best option/i.test(ri), '9a no recommendation language in the tab');

// ---- chart rules (the plan's explicit ones) ------------------------------------------------
const ch = fnBody(gl, 'renderIncomeLinesOption') + fnBody(gl, 'incomeLinesChart');
check(!/legend\s*:/.test(ch), '9a no legend: each line carries its own end label');
check(!/yAxisIndex/.test(ch) && !/type:\s*'pie'|radar/.test(ch), '9a one axis, no pie or radar');
check(/color:'#2557C7'/.test(ri) && /color:'#B8740F', dash:\[8,4\]/.test(ri), '9a the two lines differ by colour AND dash (readable in greyscale)');
check(/#9C4A2C/.test(ch) && /ran!=null\?CHART_TEXT\.bad/.test(ch), '9a red appears only on a "runs out" label and its point (a fired warning)');
check(/\.inc-liq\{background:repeating-linear-gradient/.test(gl) && /\.inc-debt\{background:repeating-linear-gradient/.test(gl), '9a the liquid and debt buckets are hatched, so the three read apart in greyscale');
check(/nearBase/.test(ch), '9a a low end point puts its label above the point, clear of the axis labels');

// ---- advisor ----------------------------------------------------------------------------------
check((gl.match(/'income\.[a-zA-Z]+': \{ path:\['income'/g) || []).length === 13, '9a the advisor can set the 13 income inputs');
check(/TAB_FOR = \{[^}]*income:'income'/.test(gl) && /income: 'income', loans: 'loans', tax: 'tax', cover: 'cover', holdings: 'holdings', fx: 'fx', joint: 'joint', mc: 'mc', health: 'health' \}\[tab\]/.test(gl), '9a TAB_FOR and the touched-selector map know the tab');
check(/enum:\['retirement','stepup','swp','income','loans','taxregime','cover','holdings','fx','joint','mc','health'\]/.test(gl) && /PREFIX = \{ retirement:'ret', stepup:'step', swp:'swp', income:'income'/.test(gl), '9a run_full_analysis accepts tab "income"');
check(/tool:'Retirement Income', pot:s\.corpus/.test(gl) && /tool:'Retirement Income', charts:\[/.test(gl), '9a the advisor can read both the numbers and the charts');
check(/incomedraw: '#inc-draw'/.test(gl) && /incomecrash: '#inc-crash'/.test(gl), '9a the two charts are highlight targets');
check(/'income': \['How is an SWP taxed compared with FD interest\?'/.test(gl), '9a the tab has its own follow-up chips');
check(/Retirement Income \(India only\)/.test(gl), '9a the advisor\'s knowledge text describes the tool and its limits');
check(!/sk-[A-Za-z0-9]{20,}|DEEPSEEK_API_KEY\s*=\s*['"][^'"]+['"]/.test(gl), '9a no API key in the page');

console.log(fail ? '\n' + fail + ' check(s) FAILED' : '\nall checks passed');
process.exit(fail ? 1 : 0);
