// smoke-18.js — Group 7 structural checks: Quick Calculate → Lab stress test (05),
// EPF/PPF/NPS counted in the retirement plan (16) and tax-gain harvesting (17).
// Regex-on-file-contents style, same conventions as smoke-09..17.
// Run with: node smoke-18.js
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
const gl = fs.readFileSync(path.join(root, 'goalden-lab.html'), 'utf8');

// the body of one top-level function, up to the next top-level "function"
const fnBody = (src, name) => {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) return '';
  const j = src.indexOf('\nfunction ', i + 10);
  return src.slice(i, j < 0 ? undefined : j);
};
// the ruleset(s) of a CSS selector prefix, so "no red in the accounts panel" can be checked
const cssRules = (src, prefix) => (src.match(new RegExp('[^{}]*' + prefix.replace(/[.#]/g, '\\$&') + '[^{}]*\\{[^}]*\\}', 'g')) || []);

// ---- 05: stress-test it in the Lab --------------------------------------
const stress = fnBody(g1, 'labStressCardHtml');
check(stress.length > 100, '05 goalden.html: labStressCardHtml found');
check(/S\.country !== 'IN'/.test(stress) && /S\.goalType !== 'retirement'/.test(stress) && /r\.alreadyMet/.test(stress), "05 the Lab card is India + retirement only, and hidden when no SIP is needed");
check(/id="labStressBtn"/.test(stress), '05 the card carries the #labStressBtn button');
check(/_goalden: 'lab-handoff'/.test(g1) && /from: 'quick'/.test(g1), '05 the hand-off is the Lab\'s own one-shot lab-handoff message');
check(/\.case-cta\.lab-cta\{animation:none/.test(g1), '05 the second call-to-action does not pulse (only "The Case" does)');
check(/data\.from==='quick' && data\.ret/.test(gl.replace(/\s+/g, ' ')), '05 goalden-lab.html: the Lab recognises a Quick Calculate hand-off');
check(/const RANGE=\{ age:\[18,65\]/.test(gl), '05 goalden-lab.html: every handed-over value is clamped to the Lab\'s slider range');
check(/if\(queryTab\)\{\s*L\.tab\s*=\s*queryTab;[^}]*?localStorage\.removeItem\('goaldenLabHandoff'\)/.test(gl),'05 goalden-lab.html: a ?tab= deep link drops a stale hand-off instead of replaying it later');
check(/Started from your Quick Calculate plan/.test(gl), '05 goalden-lab.html: the Lab says where the plan came from');

// ---- 17: tax-gain harvesting ----------------------------------------------
const hp = fnBody(engine, 'harvestPlan');
check(hp.length > 200, '17 engine: harvestPlan found');
check(/harvestPlan,/.test(engine.slice(engine.indexOf('module.exports'))), '17 engine: harvestPlan exported');
check(/TAX_IN\.equityLtcgExemption|t\.equityLtcgExemption/.test(hp) && /t\.equityLtcg \*/.test(hp), '17 engine: the allowance and the rates come from TAX_IN, not copies');
check(/y <= o\.years - 2/.test(hp), '17 engine: the last two years are never harvested (re-bought units must be long term at the sale)');
check(/T - l\.k > 12/.test(hp) && /T - l\.k < 12/.test(hp), '17 engine: long term means strictly more than 12 months; only units 12 months old or more are harvested');
const hc = fnBody(g1, 'harvestCardHtml');
check(hc.length > 200, '17 goalden.html: harvestCardHtml found');
check(/c\.code !== 'IN'/.test(hc) && /r\.alreadyMet/.test(hc) && /r\.yrs < 4/.test(hc) && /h\.harvests < 2/.test(hc), '17 the card is India only and hides when there is nothing worth saying');
check(/role="img"/.test(hc) && /aria-label=/.test(hc), '17 the chart has a text alternative with the real numbers');
check(/harvestCardHtml\(r, c\) \+/.test(g1), '17 the card is placed in the details panel');
const hr = fnBody(g1, 'renderHarvestChart');
check(hr.length > 200, '17 goalden.html: renderHarvestChart found');
check(!/legend\s*:/.test(hr), '17 chart: no legend (lines are labelled at their ends)');
check((hr.match(/yAxis:/g) || []).length === 1 && !/yAxisIndex/.test(hr), '17 chart: one value axis, no dual axis');
check(/type:\[8,4\]/.test(hr), '17 chart: the "without" line differs by dash and weight as well as colour (reads in greyscale)');
check(!/type:\s*'pie'|type:\s*'radar'/.test(g1), '17 goalden.html: no pie or radar charts');
check(!/var\(--red\)|#A03A22/.test(hc + hr), '17 no red: nothing here is a fired warning');

// ---- 16: EPF, PPF and NPS ---------------------------------------------------
check(/const RETIRE_ACCOUNTS_IN = \{/.test(engine) && /wageCeiling: 25000/.test(engine) && /epsWageCap: 15000/.test(engine), '16 engine: dated rate table, with the PF wage ceiling (25,000) and the separate EPS cap (15,000)');
check(/ppf: \{ rate: 0\.071[^}]*yearlyMax: 150000/.test(engine), '16 engine: PPF rate and the Rs 1.5 lakh yearly limit');
check(/retirementAccountsFV/.test(engine.slice(engine.indexOf('module.exports'))), '16 engine: the accounts maths is exported');
check(/const accNum = v => \{ v = Number\(v\); return isFinite\(v\) && v > 0 \? v : 0; \}/.test(engine), '16 engine: junk, negative and missing boxes count as nothing');
check(/acc: null,/.test(g1) && /function accClean\(/.test(g1), '16 goalden.html: S.acc exists and is always read through accClean');
const calc = fnBody(g1, 'calcRetirement');
check(/c\.code === 'IN' \? accClean\(S\.acc\) : null/.test(calc), '16 the accounts count only for India');
check(/gapCorpus = Math\.max\(0, corpus - existingFV - accCounted\)/.test(calc) && /sipWithoutAcc/.test(calc), '16 what the accounts will hold comes off the pot, and the SIP without them is kept for the card');
const card = fnBody(g1, 'retirementAccountsHtml');
check(card.length > 300, '16 goalden.html: retirementAccountsHtml found');
check(/if \(c\.code !== 'IN'\) return ''/.test(card), '16 the card is hidden outside India');
check(/role="button" tabindex="0" aria-expanded="false" aria-controls="accp"/.test(card), '16 the toggle is keyboard-operable and announces its state');
check(/<label for="' \+ id \+ '">/.test(card), '16 every box has a real <label>');
check(/type="submit" id="accApply"/.test(card) && /<form class="acc-card" id="accForm"/.test(card), '16 it is a form with an explicit Update button (no redrawing under the typing hand)');
check(!/var\(--red\)|#A03A22/.test(card) && cssRules(g1, '.acc-').every(r => !/--red|#A03A22/.test(r)), '16 no red in the accounts panel');
check(/function refreshResultsInPlace\(/.test(g1) && /function reopenResultPanels\(/.test(g1) && /render\(\{ quiet: true \}\)/.test(fnBody(g1, 'refreshResultsInPlace')), '16 an update re-renders in place (panels, scroll and focus kept)');
check(/if \(resultReopen\) reopenResultPanels\(\)/.test(g1), '16 attach(results) reopens the panels that were open');
check(/function fdComparisonCardHtml\(sip, years, planSipValue, d, c, hasAcc\)/.test(g1) && /card\.dataset\.acc === '1'/.test(g1), '16 the FD card says the accounts are left out of both sides, and keeps saying so after a slab tap');
check((g1.match(/S\.acc = null/g) || []).length >= 2 && /persona:null,acc:null/.test(g1) && /eduAlloc:null, acc:null/.test(g1), '16 Start over, a persona, a country change and a new goal all clear the accounts');
check(/accCounted: Math\.round\(r\.accCounted\)/.test(g1), '16 the Lab hand-off says how much EPF/PPF/NPS the quoted SIP already counts');
check(/fq\.acc\?/.test(gl) && /which the Lab does not model/.test(gl), '16 goalden-lab.html: the Lab note says it does not model those accounts');
check(/epfPpfNpsCountedAtRetirement/.test(g1) && /EPF, PPF and NPS \(India, retirement only\)/.test(g1), '16 the advisor can see and explain the accounts');
check(/\.acc-in input\{[^}]*font-size:19px/.test(g1) && /@media\(max-width:420px\)\{\.acc-grid\{grid-template-columns:1fr\}\}/.test(g1), '16 the boxes go to one column on a phone');

// ---- reviewer fixes ---------------------------------------------------------
check(/const taxIfSold = \(lots, T, exempt, strict\)/.test(hp) && /t\.equityLtcgExemption - booked/.test(hp), '17 engine: a year-end sale only gets the allowance the harvest left over, and the strict >12 months clock applies at the goal date');
check(/Already have retirement savings other than EPF, PPF and NPS\? \(optional\)/.test(g1), '16 India question 3 does not invite EPF/PPF/NPS balances');
check(/leave those balances out below, or they count twice/.test(g1), '16 the accounts panel warns when existing savings were entered (no double count)');
check(/This shows only your existing savings growing to/.test(g1), '16 a covered plan with existing savings and accounts explains what the chart shows');
check(/const STEP=\{ monthlyExpense:5000, existingSavings:50000, preRate:0\.1, postRate:0\.1, inflation:0\.1 \}/.test(gl), '05 goalden-lab.html: handed-over values snap to each slider\'s own step, and the note names what moved');

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
