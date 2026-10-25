// smoke-21.js — Group 9b checks: loans (B6), old vs new tax regime (B3) and insurance cover (B2).
// Regex-on-file-contents style, same conventions as smoke-09..20. The three tabs' own input clamps are run for
// real, in a vm, against the page's source, and every range the advisor accepts is checked against them: a value
// the advisor is allowed to set must come out of the tab's clamp unchanged, or the number on screen would differ
// from the one the person was told.
// Run with: node smoke-21.js
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
const g2 = read('goalden-door2.html');
const eng = require('./goalden-engine.js');

const fnBody = (src, name) => {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) return '';
  const j = src.indexOf('\nfunction ', i + 10);
  return src.slice(i, j < 0 ? undefined : j);
};

const rl = fnBody(gl, 'renderLoans'), rt = fnBody(gl, 'renderTaxRegime'), rc = fnBody(gl, 'renderCover');

// ---- the three tabs are wired in everywhere a tab has to be --------------------------------------
check(/loans:\{ balance:2500000, rate:8\.75, years:15, regime:'old', slab:null,/.test(gl), '9b L.loans holds the tab state, slab null = the default slab');
check(/tax:\{ gross:1800000, basic:720000, hra:288000, rent:360000, metro:true, ageBand:'under60',/.test(gl), '9b L.tax holds the tab state');
check(/cover:\{ monthly:60000, years:15, inflation:6, returnRate:7, loans:2500000, goalExtra:0, goals:\[\]/.test(gl), '9b L.cover holds the tab state');
check(/income:\['income'\], loans:\['loans'\], taxregime:\['tax'\], cover:\['cover'\]/.test(gl), '9b Reset on each tab restores its own state (TAB_STATE_KEYS)');
check(/\{id:'loans', short:/.test(gl) && /\{id:'taxregime', short:/.test(gl) && /\{id:'cover', short:/.test(gl) && /icon:ICON_LOANS/.test(gl) && /icon:ICON_TAXREGIME/.test(gl) && /icon:ICON_COVER/.test(gl), '9b the three tabs are in TABS, each with its own icon');
check(/else if\(L\.tab==='loans'\) main\.innerHTML=renderLoans\(\);/.test(gl) && /else if\(L\.tab==='taxregime'\) main\.innerHTML=renderTaxRegime\(\);/.test(gl) && /else if\(L\.tab==='cover'\) main\.innerHTML=renderCover\(\);/.test(gl), '9b render() dispatches to all three');
check(/tab==='loans'\?L\.loans : tab==='tax'\?L\.tax : tab==='cover'\?L\.cover/.test(gl), '9b the slider handler targets L.loans, L.tax and L.cover');
check(/querySelectorAll\('\[data-ln\]'\)/.test(gl) && /querySelectorAll\('\[data-tx\]'\)/.test(gl) && /querySelectorAll\('\[data-cv\]'\)/.test(gl), '9b the pills and the fill buttons have click handlers');
check(/function tabFromQuery/.test(gl) && /TABS\.some\(x=>x\.id===t\)/.test(gl), '9b ?tab=taxregime opens the tab (Door 2 links to it)');

// ---- India only: another country gets a note, never wrong numbers ----------------------------------
check(/if\(L\.country!=='IN'\) return indiaOnlyTab\('Loans'/.test(rl) && /if\(L\.country!=='IN'\) return indiaOnlyTab\('Tax regime'/.test(rt) && /if\(L\.country!=='IN'\) return indiaOnlyTab\('Cover'/.test(rc), '9b all three refuse a non-India country before computing anything');
check(/data-country="IN">Switch to India/.test(fnBody(gl, 'indiaOnlyTab')), '9b the note has a one-click switch to India');
check(/const INDIA_ONLY_STATE = \['income', 'loans', 'tax', 'cover'\];/.test(gl), '9b the advisor knows which state keys are India-only');
check((gl.match(/INDIA_ONLY_STATE\.includes\(/g) || []).length === 2, '9b set_value and run_full_analysis both refuse an India-only value outside India');
check(/if \(tab === 'loans' \|\| tab === 'taxregime' \|\| tab === 'cover'\) \{\n    if \(L\.country !== 'IN'\) return \{ ok:false/.test(gl), '9b the chart and numbers readers say so outside India');
check((gl.match(/if \(tab === 'loans' \|\| tab === 'taxregime' \|\| tab === 'cover'\) \{/g) || []).length === 2, '9b both readers (chart and numbers) handle the three tabs');

// ---- clamps: the page's own, against the engine's and the advisor's ranges ---------------------------
const grab = (re, what) => { const m = gl.match(re); if (!m) throw new Error('cannot find ' + what); return m[0]; };
let sb = null;
{
  const defaults = [
    grab(/loans:\{ balance:2500000[\s\S]*?extra:5000 \},/, 'loans defaults'),
    grab(/tax:\{ gross:1800000[\s\S]*?note:null \},/, 'tax defaults'),
    grab(/cover:\{ monthly:60000[\s\S]*?premium:0, note:null \},/, 'cover defaults'),
  ].join('\n').replace(/,\s*$/, '');
  const src = [grab(/const TAX_AGE_BANDS=.*;/, 'TAX_AGE_BANDS'), grab(/const COVER_TIERS=.*;/, 'COVER_TIERS'),
    fnBody(gl, 'incClamp'), fnBody(gl, 'clampLoans'), fnBody(gl, 'clampTax'), fnBody(gl, 'clampCover'), fnBody(gl, 'cleanCoverGoals'), fnBody(gl, 'loanPct'), grab(/const LOAN_SLABS=.*;/, 'LOAN_SLABS'), fnBody(gl, 'loanSlabPct')].join('\n');
  const ctx = { TAX_IN: eng.TAX_IN, console };
  vm.createContext(ctx);
  let ok = true;
  try {
    vm.runInContext('const L_DEFAULTS = {' + defaults + '};\n' + src +
      '\nthis.clampLoans = clampLoans; this.clampTax = clampTax; this.clampCover = clampCover; this.cleanCoverGoals = cleanCoverGoals; this.loanPct = loanPct; this.loanSlabPct = loanSlabPct; this.D = L_DEFAULTS;', ctx);
  } catch (e) { ok = false; console.log('     ' + e.message); }
  check(ok, "9b the page's own clampLoans / clampTax / clampCover load in a vm");
  if (ok) sb = ctx;
}
if (sb) {
  const D = sb.D, copy = (o) => JSON.parse(JSON.stringify(o));
  const wild = { loans: { balance: 'abc', rate: 99, years: 1000, regime: 'x', amount: -5, expected: 99, kind: 'x', cardBal: 1e12, cardRate: 1, cardPay: -1, plBal: 1e12, plRate: 99, plPay: 1e12, extra: -9 },
    tax: { gross: 1, basic: 1e12, hra: -1, rent: 1e12, metro: 'yes', ageBand: 'x', c80: 1e12, nps1b: 1e12, employerNps: -1, health: 1e12, healthParents: 1e12, parentsSenior: 'yes', homeLoan: 1e12 },
    cover: { monthly: 1, years: 1000, inflation: 99, returnRate: 99, loans: 1e12, goalExtra: -1, savings: 1e12, existing: 1e13, tier: 'x', healthTarget: 1, baseCover: 1e12, medInflation: 1, healthYears: 1000, ownHealth: 1e12, employerHealth: -1, premium: 1e12, goals: [{ label: 'x', corpus: 'a', years: 5 }, { label: 'Ed', corpus: 5e6, years: 99 }] } };
  const lo = copy(D.loans); Object.assign(lo, wild.loans); sb.clampLoans(lo);
  check(lo.balance === D.loans.balance && lo.rate === 14 && lo.years === 30 && lo.regime === 'old' && lo.amount === 50000 && lo.expected === 18 && lo.kind === 'equity', '9b loans: a non-number falls back to its default, out-of-range numbers are pulled to the nearest end, an unknown regime or kind becomes the default');
  check(lo.cardBal === 1000000 && lo.cardRate === 10 && lo.cardPay === 0 && lo.plBal === 2500000 && lo.plRate === 30 && lo.plPay === 150000 && lo.extra === 0, '9b loans: the debt inputs are bounded');
  const tx = copy(D.tax); Object.assign(tx, wild.tax); sb.clampTax(tx);
  check(tx.gross === 300000 && tx.basic === tx.gross && tx.hra === 0 && tx.rent === 3000000 && tx.metro === true && tx.ageBand === 'under60' && tx.parentsSenior === false, '9b tax: basic can never be above gross, an unknown age band or a non-boolean becomes the default');
  check(tx.c80 === 300000 && tx.nps1b === 100000 && tx.employerNps === 0 && tx.health === 100000 && tx.healthParents === 100000 && tx.homeLoan === 500000, '9b tax: the deduction inputs are bounded');
  const cv = copy(D.cover); Object.assign(cv, wild.cover); sb.clampCover(cv);
  check(cv.monthly === 5000 && cv.years === 40 && cv.inflation === 12 && cv.returnRate === 12 && cv.loans === 50000000 && cv.goalExtra === 0 && cv.savings === 50000000 && cv.existing === 100000000 && cv.tier === 'metro', '9b cover: out-of-range numbers are pulled to the nearest end, an unknown tier becomes the default');
  check(cv.healthTarget === 300000 && cv.baseCover === 300000 && cv.medInflation === 4 && cv.healthYears === 40 && cv.ownHealth === 10000000 && cv.employerHealth === 0 && cv.premium === 100000, '9b cover: the health inputs are bounded, and the floater is held to the target');
  {
    const f = copy(D.cover); f.healthTarget = 500000; f.baseCover = 2000000; sb.clampCover(f);
    check(f.baseCover === 500000, '9b cover: a floater above the health target is brought down to it');
    const g = copy(D.cover); g.healthTarget = 3000000; g.baseCover = 2000000; sb.clampCover(g);
    check(g.baseCover === 2000000, '9b cover: a floater inside the target is left alone');
    const goals = sb.cleanCoverGoals([{ label: 'Edu', corpus: 9e6, need: 4e6, years: 8 }, { label: 'Home', corpus: 3e6, years: 5 }, { label: 'Done', corpus: 5e6, need: 0, years: 3 }]);
    check(goals.length === 2 && goals[0].corpus === 4e6 && goals[1].corpus === 3e6, '9b cover goals: the part still to be saved (need) is used when sent, corpus otherwise, a fully funded goal drops out');
  }
  check(cv.goals.length === 1 && cv.goals[0].label === 'Ed' && cv.goals[0].years === 60, '9b cover: a goal pot with no money is dropped and a stored goal is cleaned the same way it was when it came in');
  const again = JSON.stringify([lo, tx, cv]);
  sb.clampLoans(lo); sb.clampTax(tx); sb.clampCover(cv);
  check(JSON.stringify([lo, tx, cv]) === again, '9b clamping twice changes nothing');
  check(sb.loanPct(0.0875) === '8.75%' && sb.loanPct(0.095) === '9.5%' && sb.loanPct(0.09) === '9%' && sb.loanPct(0.1) === '10%' && sb.loanPct(1) === '100%' && sb.loanPct(0) === '0%', '9b loanPct keeps a quarter-point rate whole (8.75%, 9.5%, not 8.8%) and drops only trailing zeros (10%, 100%)');
  check(sb.loanSlabPct({ slab: 7 }) === eng.TAX_IN.defaultSlab && sb.loanSlabPct({ slab: 30 }) === 30, '9b an unknown slab becomes the default slab');

  // Every range the advisor accepts must survive the tab's own clamp unchanged.
  const af = vm.runInNewContext('(function(){ const ADVISOR_FIELDS = ' + grab(/const ADVISOR_FIELDS = \{\n[\s\S]*?\n\};/, 'ADVISOR_FIELDS').replace(/^const ADVISOR_FIELDS = /, '').replace(/;$/, '') + '; return ADVISOR_FIELDS; })()');
  const clampOf = { loans: sb.clampLoans, tax: sb.clampTax, cover: sb.clampCover };
  let bad = [], n = 0;
  Object.keys(af).forEach((key) => {
    const spec = af[key], tab = spec.path[0];
    if (!clampOf[tab]) return;
    const f = spec.path[1];
    const vals = spec.enum ? spec.enum.slice() : spec.type === 'boolean' ? [true, false] : [spec.min, spec.max];
    vals.forEach((v) => {
      const s = copy(D[tab]);
      if (key === 'tax.basic') s.gross = 10000000;
      if (key === 'cover.baseCover') s.healthTarget = 10000000;
      s[f] = v; clampOf[tab](s); n++;
      if (s[f] !== v) bad.push(key + '=' + v + ' -> ' + s[f]);
    });
  });
  check(n > 80 && bad.length === 0, '9b every end of every advisor range survives the tab\'s own clamp unchanged (' + n + ' values)' + (bad.length ? ': ' + bad.join(', ') : ''));
  const fields = (tab) => Object.keys(af).filter((k) => af[k].path[0] === tab).map((k) => af[k].path[1]);
  const stateKeys = (tab) => Object.keys(D[tab]).filter((k) => k !== 'note' && k !== 'goals' && k !== 'tier');
  ['loans', 'tax', 'cover'].forEach((tab) => {
    const missing = stateKeys(tab).filter((k) => !fields(tab).includes(k));
    check(missing.length === 0, '9b the advisor can set every ' + tab + ' input' + (missing.length ? ' (missing: ' + missing.join(', ') + ')' : ' (' + fields(tab).length + ')'));
  });
}

// ---- what the tabs say: both sides, a break-even and no verdict -----------------------------------------
const allText = rl + rt + rc + fnBody(gl, 'loansAdvisorResults') + fnBody(gl, 'taxAdvisorResults') + fnBody(gl, 'coverAdvisorResults');
check(!/should (buy|sell|choose|prepay|switch|take)|we recommend|best option|you must|the right choice/i.test(allText), '9b no recommendation language in the three tabs or what the advisor reads from them');
check(/no verdict/.test(fnBody(gl, 'loansAdvisorResults')) && /break-even/i.test(rl), '9b the loan comparison is a break-even, and says so to the advisor');
check(/guaranteed/i.test(rl) && /expected/i.test(rl), '9b the loan card sets a guaranteed saving against an expected return');
check(/₹2 lakh|₹2 L|2 lakh/.test(rl) && /new regime/.test(rl), '9b the loan card names the ₹2 lakh interest limit and the regime difference');
check(/cannot cover a month|does not cover a month|never clears|never pays off|never be cleared/i.test(rl), '9b a payment that does not cover a month of interest is said never to clear the debt');
check(/\$\{T\.asOf\}/.test(rt) && /TAX_REGIME_IN\.asOf/.test(fnBody(gl, 'taxAdvisorResults')), '9b the tax tab and the advisor both state the rule year');
check(/surcharge/i.test(rt) && /aboveSurcharge/.test(rt), '9b the tax tab says surcharge is not modelled and warns when income is above the line');
check(/Rule 279|HRA/.test(rt) && /re-check|check/i.test(rt), '9b the tax tab asks to re-check the rules');
check(/ELSS, PPF/.test(rt) && /give no tax benefit/.test(rt) && /chosen for their returns and lock-ins alone/.test(rt), '9b the tax tab says what the new regime means for ELSS and PPF');
check(/No premium is shown/.test(rc) && !/premium\s*[*×]|estimatePremium|premiumFor/i.test(rc + fnBody(gl, 'computeCover')), '9b the cover tab shows no premium and computes none');
check(/rule of thumb/.test(rc) && /not a market figure or a quote/.test(rc), '9b the health starting sizes are labelled as rules of thumb, not quotes');
check(/Cover through an employer ends|ends with the job|employer cover ends/i.test(rc), '9b the cover tab says employer cover ends with the job');
check(/function healthCoverCard/.test(gl) && /\$\{healthCoverCard\(\)\}/.test(fnBody(gl, 'renderHealth')), '9b Plan Health carries the health-cover card');
{
  const hc = fnBody(gl, 'healthCoverCard');
  check(/L\.country!=='IN'|c\.code!=='IN'|country!=='IN'/.test(hc) && /not part of the score|does not change the score|not in the score/i.test(hc), '9b the Plan Health cover card is India only and is outside the 0-100 score');
}

// ---- chart rules (the plan's explicit ones) ------------------------------------------------------------------
const ch = fnBody(gl, 'renderBarsOption') + fnBody(gl, 'barsChart');
check(!/legend\s*:/.test(ch), '9b no legend: each bar carries its own label');
check(!/yAxisIndex/.test(ch) && !/type:\s*'pie'|radar/.test(ch), '9b one axis, no pie or radar');
check((rl + rt + rc).match(/#9C4A2C|CHART_TEXT\.bad/g).length === 1 && /const surNote=r\.aboveSurcharge\?`[^`]*#9C4A2C/.test(rt), '9b red appears once in the three tabs, on the surcharge warning that fires only above the line');

// ---- the Full Plan (Door 2) ----------------------------------------------------------------------------------
check(!/old-regime taxpayers/.test(g2) && /80C deduction exists only on the old tax regime/.test(g2), '9b the Full Plan no longer says ELSS is for "old-regime taxpayers" without knowing the regime');
check(/goalden-lab\.html\?tab=taxregime/.test(g2), '9b the ELSS card links to the Lab\'s Tax regime tab');
check(/cover:null,/.test(g2) && /cover:null,addingGoal/.test(g2) && /cover:data\.cover&&typeof data\.cover==='object'\?data\.cover:null/.test(g2), '9b G.cover is saved, reset on Start over and restored from a plan file');
check(/g\.type!=='retirement' && coverGoalNeed\(g\)>0/.test(g2), '9b the Full Plan leaves the retirement goal out of the term-cover goal pots');
check(/function coverGoalNeed\(g\)\{ return g\.gapCorpus!==undefined \? g\.gapCorpus : g\.corpus; \}/.test(g2) && /need:coverGoalNeed\(g\)/.test(g2), '9b the Full Plan counts only what each goal still needs after money already set aside, here and in the Lab hand-off');
check(/Leave out money you have already set aside for the goals above/.test(g2) && /Leave out money already set aside for goals brought in from the Full Plan/.test(gl), '9b both pages tell people not to count goal money again under savings');
check(/const COVER_DEFAULT=/.test(g2) && /termCoverNeed\(\{annualExpense:exp\*12/.test(g2) && /if\(c\.code!=='IN'\) return '';/.test(fnBody(g2, 'coverCardHtml')), '9b the Protection check uses the shared termCoverNeed and is India only');
check(/No premium|nothing on this page quotes a price/.test(g2) || /nothing on this page quotes a price/.test(fnBody(g2, 'coverCardHtml')), '9b the Protection check shows no premium');
check(/tab:tab, cover:G\.country==='IN'\?coverState\(\):null/.test(g2) && /openPlanInLab\('cover'\)/.test(g2), '9b "Size health cover too, in the Lab" hands the four answers and the monthly spend to the Lab');
{
  const hand = gl.slice(gl.indexOf('function consumeDoor2Handoff'));
  check(/cleanCoverGoals\(/.test(hand.slice(0, 6000)) && /g\.type!=='retirement'|type!=='retirement'/.test(hand.slice(0, 6000)) && /data\.tab==='cover' && L\.country==='IN'/.test(hand.slice(0, 6000)), '9b the Lab takes the hand-off: goal pots cleaned, retirement left out, the Cover tab opened only for India');
}

// ---- advisor --------------------------------------------------------------------------------------------------------
check(/TAB_FOR = \{[^}]*loans:'loans', tax:'taxregime', cover:'cover'/.test(gl) && /loans: 'loans', tax: 'tax', cover: 'cover'/.test(gl), '9b TAB_FOR and the touched-selector map know the three tabs');
check(/enum:\['retirement','stepup','swp','income','loans','taxregime','cover','fx','joint','mc','health'\]/.test(gl) && /loans:'loans', taxregime:'tax', cover:'cover'/.test(gl), '9b run_full_analysis accepts loans, taxregime and cover (the tax tab\'s state key is "tax")');
check(/type === 'boolean'/.test(fnBody(gl, 'advisorSetValue')) && /must be true or false/.test(fnBody(gl, 'advisorSetValue')), '9b set_value takes true/false for the two yes-or-no inputs');
check(/tool:'Loans', charts:\[/.test(gl) && /tool:'Tax regime', charts:\[/.test(gl) && /tool:'Cover', charts:\[/.test(gl), '9b the advisor can read the charts of all three');
check(/tool:'Loans', note:/.test(gl) && /tool:'Tax regime', rulesAsOf:TAX_REGIME_IN\.asOf/.test(gl) && /tool:'Cover', note:'sizes only; no premiums are shown or known'/.test(gl), '9b the advisor can read the numbers of all three, with the rule year and the no-premium note');
check(/interestRelieved:s\.regime === 'old'/.test(gl), '9b the advisor is not told about interest relief on the new regime');
check(/loancompare: '#loan-compare'/.test(gl) && /taxcompare: '#tax-compare'/.test(gl) && /termcover: '#cover-term'/.test(gl) && /healthcover: '#cover-health'/.test(gl), '9b the charts are highlight targets');
check(/'loans': \['Why is the break-even higher on the new regime\?'/.test(gl) && /'taxregime': \[/.test(gl) && /'cover': \[/.test(gl), '9b each tab has its own follow-up chips');
check(/else if \(tab === 'loans'\)/.test(gl) && /else if \(tab === 'taxregime'\)/.test(gl) && /else if \(tab === 'cover'\)/.test(gl), '9b each tab has its own suggestion chips');
check(/Fifteen tools sharing one underlying engine/.test(gl) && /- Loans \(India only\)/.test(gl) && /- Tax regime \(India only\)/.test(gl) && /- Cover \(India only\)/.test(gl), '9b the advisor\'s knowledge text describes the three tools and their limits');
check(!/sk-[A-Za-z0-9]{20,}|DEEPSEEK_API_KEY\s*=\s*['"][^'"]+['"]/.test(gl + g2), '9b no API key in the pages');

// ---- review fixes: limits the advisor must not silently clamp, plain-pay tax text, lump-sum loan rate ------
check(/const ADVISOR_CAPPED_BY = \{ 'tax\.basic':'tax\.gross', 'cover\.baseCover':'cover\.healthTarget' \};/.test(gl) && /cannot be more than '\+capField/.test(fnBody(gl, 'advisorSetValue')), '9b set_value refuses basic pay above salary and a floater above the target instead of clamping quietly');
check(/alsoChanged/.test(fnBody(gl, 'advisorSetValue')), '9b set_value says when lowering a limit pulled the other field down');
check(/limits\.includes\(fieldOf\(a\)\)/.test(gl), '9b run_full_analysis sets salary before basic pay and the target before the floater');
check(/nilBoth/.test(rt) && /Neither regime costs you any tax/.test(rt) && /Both regimes come to nil tax at this pay/.test(rt), '9b the tax tab does not call the old regime cheaper when both come to nil tax');
check(/r\.saveOn10k/.test(rt) && !/marginalOld/.test(gl), '9b the old-regime saving is a rupee figure on 10,000 (cess and rebate in it), not a slab percentage');
check(/cmp\.afterPrepay/.test(rl) && /reliefLost<1/.test(rl), "9b the loan card describes the lump sum's own year-1 effect on the relief");
{
  const lump = eng.homeLoanCompare({ balance: 2500000, rate: 0.0875, years: 15, slab: 0.2, regime: 'old', amount: 500000, expected: 0.12, kind: 'equity' });
  check(lump.loanRate > 0.0875 * (1 - 0.2 * 1.04) && lump.loanRate < 0.0875 && lump.afterPrepay.reliefLost > 0, '9b the default loan case sits between the full-relief and no-relief rates');
}
check(!/blurb:'A quick score[^']*protection/i.test(gl) && !/Plan Health: a quick 0-100 score[^\n]*protection/i.test(gl), '9b the Plan Health descriptions do not claim protection is in the score');

// ---- engine exports the cards rely on ------------------------------------------------------------------------
check(['TAX_REGIME_IN', 'slabTax', 'slabRate', 'regimeTax', 'hraExemption', 'epfEmployeeYearly', 'compareRegimes', 'loanSchedule', 'loanPrepay', 'homeLoanCompare', 'debtAvalanche', 'termCoverNeed', 'healthCoverPlan'].every((k) => eng[k] !== undefined), '9b the engine exports the thirteen 9b names');
check(/asOf:\s*'FY 2026-27'/.test(read('goalden-engine.js')) && /Rule 279/.test(read('goalden-engine.js')), '9b the regime rules are dated and the HRA source is named');

console.log(fail ? '\n' + fail + ' check(s) FAILED' : '\nall checks passed');
process.exit(fail ? 1 : 0);
