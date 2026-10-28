// smoke-23.js — Group 9d checks: the yearly plan review (B5), the advisor's fixed checklist across the Lab's tools.
// Regex-on-file-contents style, same conventions as smoke-09..22. The Lab's own reviewAreasData (which decides what counts
// as the person's numbers) and advisorStartYearlyReview (which builds the checklist) are run for real, in a vm.
// Run with: node smoke-23.js
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
const wk = read('src/worker.js');
const py = read('local_server.py');
const eg = read('goalden-engine.js');
const eng = require('./goalden-engine.js');

const fnBody = (src, name) => {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) return '';
  const j = src.indexOf('\nfunction ', i + 10);
  return src.slice(i, j < 0 ? undefined : j);
};
const grab = (src, re, what) => { const m = src.match(re); if (!m) throw new Error('cannot find ' + what); return m[0]; };

// ---- the tab is wired in everywhere a tab has to be ----------------------------------------------------------------
check(/review:\{ planId:null, done:\{\}, skipped:\[\] \},/.test(gl), '9d L.review holds only what the advisor run did (done, skipped), never a stored review');
check(/review:\['review'\]/.test(gl), '9d Reset on the tab clears the run (TAB_STATE_KEYS)');
check(/\{id:'review', short:/.test(gl) && /icon:ICON_REVIEW/.test(gl) && /const ICON_REVIEW=/.test(gl), '9d the tab is in TABS with its own icon');
check(/else if\(L\.tab==='review'\) main\.innerHTML=renderReview\(\);/.test(gl), '9d render() dispatches to it');
check(/review: \{ title: '[^']+', build: briefingReview \}/.test(gl), '9d the report is a briefing section');
check(/figures:rv\.figures/.test(fnBody(gl, 'briefingReview')), '9d the report hands its amounts to the briefing audit');
check(/if \(tab === 'review'\) \{[\s\S]{0,400}computeReview\(\)[\s\S]{0,600}rv\.figures,/.test(gl), "9d get_results on the review tab recomputes the review and carries the same figure keys");
check(/getElementById\('rvReport'\)[^\n]*composeBriefing\(\{ title:'Your yearly review', sections:\['review'\] \}\)/.test(gl), '9d "Open it as a report" works without the advisor');
check(/data-advisor-ask="Do my yearly plan review"/.test(fnBody(gl, 'renderReview')), '9d "Ask the advisor" sends the request that triggers the review');
check(!/#9C4A2C|#A03A22|var\(--red\)/.test(fnBody(gl, 'reviewActionsHTML') + fnBody(gl, 'reviewChecksHTML') + grab(gl, /\/\* Yearly review\.[\s\S]*?@media\(max-width:560px\)\{\.rv-item[^\n]*\n/, 'review CSS')), '9d nothing on the review is red (the red budget)');
check(/const REVIEW_CHIP=\{ act:'To do', ok:'Fine', partial:'Part checked', missing:'Not checked', skipped:'Skipped', na:'India only' \}/.test(gl), '9d every status is a word as well as a colour (greyscale)');

// ---- the advisor's tools ------------------------------------------------------------------------------------------
check(/name:'start_yearly_review'/.test(gl) && /name:'review_check'[\s\S]{0,600}enum:REVIEW_AREAS\.map\(a => a\.id\)/.test(gl), '9d both tools are offered, review_check limited to the eight areas');
check(/if \(name === 'start_yearly_review'\) return JSON\.stringify\(advisorStartYearlyReview\(\)\);/.test(gl) && /if \(name === 'review_check'\) return advisorReviewCheck\(args && args\.area\);/.test(gl), '9d both are dispatched');
check(/case 'start_yearly_review':/.test(gl) && /case 'review_check':/.test(gl), '9d both have a narration row');
check(/Yearly review: when the user asks to review their plan[^\n]*call start_yearly_review[^\n]*never write that checklist yourself with propose_plan/.test(gl), "9d the Lab's knowledge tells the model to start the review, not write it");
check(/proposePlan\(\{ steps \}\)/.test(fnBody(gl, 'advisorStartYearlyReview')), '9d the checklist goes through the existing plan-and-approve flow');
check(/new Promise\(res=>setTimeout/.test(fnBody(gl, 'advisorReviewCheck')), '9d each check pauses after its repaint, so a running plan ticks the list off visibly');

// ---- the routing list and the nudge, mirrored --------------------------------------------------------------------
{
  const names = (src, re) => { const m = src.match(re); return m ? m[1].replace(/\s+/g, ' ').trim() : null; };
  const e = names(eg, /var TOOL_ALWAYS_KEEP = \[([\s\S]*?)\]/), w = names(wk, /const TOOL_ALWAYS_KEEP = \[([\s\S]*?)\]/), p = names(py, /_TOOL_ALWAYS_KEEP = \(([\s\S]*?)\)/);
  check(!!e && /'start_yearly_review', 'review_check'/.test(e) && e === w && w === p, '9d the review tools are never routed away (same always-keep list in engine, worker and local_server)');
}
{
  const jsSrc = grab(wk, /const YEARLY_RE = \/.*\/i;/, 'YEARLY_RE').replace(/^const YEARLY_RE = \//, '').replace(/\/i;$/, '');
  const pyParts = grab(py, /_YEARLY_RE = re\.compile\(\n[\s\S]*?, re\.I\)/, '_YEARLY_RE').match(/r'([^']*)'/g).map((s) => s.slice(2, -1)).join('');
  check(jsSrc === pyParts, '9d the yearly-review pattern is the same in worker.js and local_server.py');
  const re = new RegExp(jsSrc, 'i');
  const yes = ['Review my plan', 'do my yearly plan review', 'an annual review of my finances', 'plan check-up', 'a financial check up', 'my year-end review'];
  const no = ['review the plan first before you change anything', 'what if I retire at 55', 'check my mix', 'show me it first',
    'My annual bonus is 2 lakh, check if the old regime is better for me', 'I earn 18 lakh annual, check my tax', 'Does my health insurance cover an annual health check-up?', 'annual premium of 25000, can you check 80D'];
  check(yes.every((q) => re.test(q)) && no.every((q) => !re.test(q)), '9d the pattern catches review requests and leaves "show me first" to the existing nudge');
  check(/if \(yearly && pageTools\.has\('start_yearly_review'\)\)[\s\S]{0,300}Call start_yearly_review now/.test(wk) && /if yearly and 'start_yearly_review' in page_tools:/.test(py), '9d both runtimes tell the model to start the review on a page that has it');
  check(/\} else if \(yearly\) \{[\s\S]{0,300}runs in the Lab/.test(wk) && /elif yearly:[\s\S]{0,300}runs in the Lab/.test(py), '9d on another page the model points to the Lab instead');
}

// ---- the Full Plan's way in -------------------------------------------------------------------------------------------
check(/id="openReviewBtn"/.test(g2) && /getElementById\('openReviewBtn'\)[^\n]*openPlanInLab\('review'\)/.test(g2), '9d the Full Plan has a "yearly review in the Lab" button');
check(/L\.tab = data\.tab==='review' \? 'review'/.test(gl), '9d the hand-off opens the Lab on the review');

// ---- what counts as the person's own numbers, run for real ----------------------------------------------------------
let sb = null;
{
  const L0 = vm.runInNewContext('(' + grab(gl, /const L = \{[\s\S]*?\n\};/, 'L').replace(/^const L = /, '').replace(/;$/, '') + ')');
  // Each slice runs up to the next function, so reviewGiven's carries REVIEW_REQ and reviewLacking's carries REVIEW_TAB/NEED.
  const src = ['markGiven', 'reviewGiven', 'reviewLacking', 'reviewAreasData', 'advisorStartYearlyReview'].map((f) => fnBody(gl, f)).join('\n');
  const ctx = { console, debtAvalanche: eng.debtAvalanche, REVIEW_AREAS: eng.REVIEW_AREAS, steps: null, renders: 0,
    proposePlan(a) { ctx.steps = a.steps; return { ok: true, planId: 'p1', stepCount: a.steps.length }; }, render() { ctx.renders++; } };
  // The tabs' compute functions, as thin stand-ins: what is under test is which numbers are allowed in, not the sums.
  ctx.healthStressCheck = () => ({ survives: true, ranOutYear: null, drawYrs: 25, episode: { label: '2008 Financial Crisis' }, equity: 40 });
  ctx.computeLoans = () => ({ debts: [{ name: 'Credit card', balance: ctx.L.loans.cardBal, rate: ctx.L.loans.cardRate / 100, payment: ctx.L.loans.cardPay }, { name: 'Personal loan', balance: ctx.L.loans.plBal, rate: ctx.L.loans.plRate / 100, payment: ctx.L.loans.plPay }] });
  ctx.computeCover = () => ({ term: { gross: 1, savings: 0, existingCover: 0, gap: 1 }, health: { target: 1, gap: 0, gapOwnOnly: 0 } });
  ctx.computeTax = () => ({ r: { new: { tax: 1 }, old: { tax: 2 }, unused: { c80: 0, nps1b: 0 }, oldIfFilled: { tax: 2 }, aboveSurcharge: false } });
  ctx.computeIncome = () => ({ s: ctx.L.income, sw: { ranOutYear: null } });
  ctx.computeHoldings = () => ({ p: { name: 'Moderate' }, rev: { mixTotal: 0, mix: [], overlap: [], cost: { perYear: 0 }, unset: 0, rows: [], rebalance: { months: 12, overAfter: 0, split: [], sells: [], exemptRoom: 125000, unknownCost: 0 } } });
  vm.createContext(ctx);
  let ok = true;
  try {
    vm.runInContext('var L, L_DEFAULTS;\n' + src + '\nthis.reviewAreasData = reviewAreasData; this.advisorStartYearlyReview = advisorStartYearlyReview; this.markGiven = markGiven;', ctx);
  } catch (e) { ok = false; console.log('     ' + e.message); }
  check(ok, "9d the page's markGiven / reviewGiven / reviewAreasData / advisorStartYearlyReview load in a vm");
  if (ok) { sb = ctx; sb.fresh = () => { sb.L = JSON.parse(JSON.stringify(L0)); sb.L_DEFAULTS = JSON.parse(JSON.stringify(L0)); vm.runInContext('L = this.L; L_DEFAULTS = this.L_DEFAULTS;', sb); return sb.L; }; }
}
if (sb) {
  sb.fresh();
  check(JSON.stringify(sb.reviewAreasData()) === '{}', '9d a Lab on its starting values reviews nothing: the example person is never reviewed');

  // Plan Health: two separate answers, and both halves of the savings answer are needed
  let L = sb.fresh(); L.health.capacity = 60000;
  let A = sb.reviewAreasData();
  check(A.health && /what your goals need each month and your emergency fund\.$/.test(A.health.missing || ''),
    '9d capacity alone: the example "goals need" is not used, and the review names what is still needed');
  sb.markGiven('health.emergencyStatus'); A = sb.reviewAreasData();
  check(A.health && !A.health.missing && A.health.capacity === null && A.health.emergency === 'partial' && /what your goals need each month/.test(A.health.savingsNeed),
    '9d capacity plus the emergency answer: the fund is checked, savings is named as still needing the goals figure');
  L = sb.fresh(); L.health.capacity = 60000; sb.markGiven('health.totalSIP');   // given, even though it equals the start
  check(sb.reviewAreasData().health.totalSIP === 35000, '9d a value given that happens to equal the starting one still counts');
  L = sb.fresh(); sb.markGiven('health.emergencyStatus');
  check(sb.reviewAreasData().health.emergency === 'partial', '9d the emergency answer stands on its own');

  // Loans: each debt by its own balance; the clearing time only with every payment given; no example extra payment
  L = sb.fresh(); L.loans.cardBal = 90000;
  A = sb.reviewAreasData();
  check(A.debt && A.debt.debts.length === 1 && A.debt.debts[0].name === 'Credit card' && A.debt.notEntered.join() === 'Personal loan', '9d entering the card does not put the example personal loan on the list');
  check(A.debt.months === null && A.debt.debts[0].rateGiven === false, '9d with no payment given there is no "gone in N months", and the rate is said to be typical');
  L.loans.cardPay = 9000; A = sb.reviewAreasData();
  check(A.debt.months === eng.debtAvalanche({ debts: [{ name: 'Credit card', balance: 90000, rate: L.loans.cardRate / 100, payment: 9000 }], extra: 0 }).plan.months, '9d the clearing time uses the given payment and no example extra');
  L = sb.fresh(); L.loans.cardRate = 40;
  check(!sb.reviewAreasData().debt, '9d a rate alone is not a debt entered');

  // Cover: term needs all five of its answers; health needs both policies
  L = sb.fresh(); L.cover.existing = 1e7;
  A = sb.reviewAreasData();
  check(A.cover && A.cover.missing && /household spending/.test(A.cover.missing) && /loans outstanding/.test(A.cover.missing), '9d term cover alone: not reviewed on the example spending and loans, and says what is still needed');
  L = sb.fresh(); L.cover.ownHealth = 300000;
  check(sb.reviewAreasData().cover.missing && /employer/.test(sb.reviewAreasData().cover.missing), "9d own health policy alone: not reviewed against the example employer policy");
  L = sb.fresh(); Object.assign(L.cover, { monthly: 70000, years: 20, loans: 3e6, savings: 1.5e6, existing: 1e7 });
  A = sb.reviewAreasData();
  check(A.cover.term && A.cover.health === null && /Health cover not checked/.test(A.cover.healthNeed), '9d all of term given: term is reviewed and health is named as not checked');
  L = sb.fresh(); sb.markGiven('cover.loans', false); L.cover.loans = 4e6;
  check(!sb.reviewAreasData().cover, '9d loans copied from a Loans tab still on its examples do not count as given');

  // Tax: one deduction is not a salary
  L = sb.fresh(); L.tax.c80 = 100000;
  A = sb.reviewAreasData();
  check(A.tax && A.tax.missing && /salary/.test(A.tax.missing) && /basic pay/.test(A.tax.missing), '9d 80C alone: not reviewed on the example 18 L salary');
  L = sb.fresh(); Object.assign(L.tax, { gross: 2.4e6, basic: 9.6e5, hra: 3.84e5, rent: 4.2e5, c80: 1e5, nps1b: 0, health: 25000 }); sb.markGiven('tax.health');   // given, though equal to the start
  A = sb.reviewAreasData();
  check(A.tax && !A.tax.missing && /home-loan interest/.test(A.tax.assumedNone), '9d every deduction given: reviewed, and the ones counted as none are named');

  // Retirement and income
  L = sb.fresh(); L.ret.age = 55;
  check(sb.reviewAreasData().retirement.missing && /monthly spending/.test(sb.reviewAreasData().retirement.missing), '9d age alone: the crash check is not run on the example spending');
  L = sb.fresh(); L.income.npsPot = 5e6; L.income.kind = 'swpDebt';
  check(!sb.reviewAreasData().income, '9d an NPS pot or a fund type alone does not start a review of the example pot');
  L = sb.fresh(); L.income.corpus = 4e7;
  check(sb.reviewAreasData().income.missing, '9d a pot alone: income is named as needing spending and years');

  // Holdings: example rows are not theirs
  L = sb.fresh(); L.holdings.rows = [{ name: 'X', value: 100000 }];
  check(!sb.reviewAreasData().holdings, '9d rows not typed, picked or told (an example list) are not reviewed');
  sb.markGiven('holdings.rows'); A = sb.reviewAreasData();
  check(A.holdings && A.holdings.profileGiven === false && A.holdings.sipGiven === false && A.harvest.exemptGiven === false, '9d typed rows are reviewed; the starting profile, new money and exemption use are flagged as not given');

  L = sb.fresh(); L.country = 'US'; L.health.capacity = 60000; L.health.totalSIP = 30000; Object.assign(L.ret, { age: 40, retireAge: 60, monthlyExpense: 4000 }); L.tax.gross = 2400000; L.loans.cardBal = 1;
  A = sb.reviewAreasData();
  check(Object.keys(A).sort().join() === 'health,retirement', '9d a US Lab gathers only the two areas that are not Indian rules');

  // ---- the checklist the advisor gets is fixed ----
  L = sb.fresh(); L.health.capacity = 60000; L.health.totalSIP = 30000;
  const r = sb.advisorStartYearlyReview();
  const ids = eng.REVIEW_AREAS.map((a) => a.id);
  check(r.ok && sb.steps.length === ids.length + 1 && sb.steps.slice(0, -1).every((s, i) => s.tool === 'review_check' && s.args.area === ids[i]), '9d the plan is every area, in the fixed order, from REVIEW_AREAS');
  check(sb.steps[sb.steps.length - 1].tool === 'compose_briefing' && sb.steps[sb.steps.length - 1].args.sections.join() === 'review', '9d the last step writes the report');
  check(/no numbers yet/.test(sb.steps[1].label) && !/no numbers yet/.test(sb.steps[0].label), '9d a check with no numbers says so on the approval list');
  check(sb.L.tab === 'review' && sb.L.review.planId === 'p1' && r.noNumbersYet.includes('tax') && r.withNumbers.join() === 'health', '9d it opens the review tab and remembers its plan');
  L = sb.fresh(); L.country = 'US';
  sb.advisorStartYearlyReview();
  check(sb.steps.slice(0, -1).map((s) => s.args.area).join() === 'health,retirement', '9d a US review lists only the two checks that apply');
}

// ---- every way a value arrives marks it given --------------------------------------------------------------------
check(/else \{ target\[k\]=v; markGiven\(tab\+'\.'\+k\); \}/.test(gl), '9d a slider (or the number box beside it) marks its field given');
check(/emergencyStatus=parsedVal; markGiven\('health\.emergencyStatus'\)/.test(gl), '9d the emergency-fund toggle marks it given');
check(/if \(spec\.path\.length === 2\) markGiven\(spec\.path\.join\('\.'\)\);/.test(fnBody(gl, 'advisorSetValue')), '9d a value the advisor sets at the user\'s word is given');
check(/s\.rows=rows; markGiven\('holdings\.rows'\)/.test(gl) && /markGiven\('holdings\.rows', false\)/.test(gl) && /markGiven\('holdings\.rows'\);/.test(fnBody(gl, 'holdEdit')), '9d typed, picked or told holdings are given; "Load an example" is not');
check(/markGiven\('income\.'\+k, own\)/.test(gl) && /markGiven\('cover\.loans', \[/.test(gl), '9d buttons that copy another tab carry over only what that tab was given');
check(/markGiven\('health\.capacity'\)/.test(gl) && /markGiven\('cover\.'\+k\)/.test(gl) && /markGiven\('holdings\.profile'\)/.test(gl) && /markGiven\('ret\.'\+k\)/.test(gl), '9d the Full Plan and Quick Calculate hand-offs mark exactly what they carried');
check(/Object\.keys\(L\.given\)\.forEach\(g=>\{ if\(g\.indexOf\(k\+'\.'\)===0\) delete L\.given\[g\]; \}\)/.test(fnBody(gl, 'resetTab')), '9d Reset forgets what was given on that tab');
check(/cover:G\.country==='IN'&&G\.cover\?coverState\(\):null/.test(g2), '9d the Full Plan sends cover only when the protection check was filled');
check(/skipped:reviewPlanLive\(\) \? L\.review\.skipped : \[\]/.test(gl), '9d unticked checks read "skipped" only during their own run');
{
  const adv = read('advisor.js');
  check(/if \(!plan \|\| advisor\.busy \|\| advisor\.planRunning\) return;/.test(adv) && /e\.currentTarget\.disabled = true/.test(adv), '9d "Run plan" runs once, however often it is clicked');
  check(/if \(advisor\.pendingPlan === plan\) advisor\.pendingPlan = null;/.test(adv), '9d a finished run never clears a newer pending plan');
}

// ---- the engine and the page agree --------------------------------------------------------------------------------
check(['health', 'debt', 'cover', 'tax', 'holdings', 'harvest', 'retirement', 'income'].join() === eng.REVIEW_AREAS.map((a) => a.id).join(), '9d the eight areas, in order');
check(eng.REVIEW_AREAS.every((a) => new RegExp(a.id + ":'[a-z]+'").test(grab(gl, /const REVIEW_TAB=\{[^\n]*\};/, 'REVIEW_TAB')) && new RegExp('\\b' + a.id + ":'").test(grab(gl, /const REVIEW_NEED=\{[\s\S]*?\n\};/, 'REVIEW_NEED'))), '9d every area has a tab to open and a "what is needed" line');
check(Object.values(vm.runInNewContext('(' + grab(gl, /const REVIEW_TAB=\{[^\n]*\};/, 'REVIEW_TAB').replace(/^const REVIEW_TAB=/, '').replace(/;$/, '') + ')')).every((t) => new RegExp("\\{id:'" + t + "'").test(gl)), '9d every tab the review points to exists');
check(/function reviewToday\(\)\{ const d=new Date\(\); return d\.getFullYear\(\)/.test(gl), "9d the review is dated with the person's local date, not UTC");

console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
