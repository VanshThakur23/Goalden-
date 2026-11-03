// smoke-25.js — B7 Rent or buy: the Lab tab, its wiring, and the rules it keeps (no verdict, both sides before tax).
// Regex-on-file-contents style, same conventions as smoke-09..24. The numbers themselves are tested in engine.test.js.
// Run with: node smoke-25.js
'use strict';

const fs = require('fs');
const path = require('path');

const root = __dirname;
let fail = 0;
const check = (cond, label) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + label);
  if (!cond) fail++;
};
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');
const gl = read('goalden-lab.html'), eng = read('goalden-engine.js');
const fnBody = (src, name) => {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) return '';
  const j = src.indexOf('\nfunction ', i + 10);
  return src.slice(i, j < 0 ? undefined : j);
};

// ---- engine
const run = fnBody(eng, 'rentVsBuyRun'), rvb = fnBody(eng, 'rentVsBuy');
check(/if \(buyOut > rent\) rentPot \+= buyOut - rent; else buyPot \+= rent - buyOut;/.test(run), 'whoever pays less in a month invests the difference');
check(/let bal = loan, value = price, rent = accNum\(o\.rent\), buyPot = 0, rentPot = upfront/.test(run), 'the renter starts with the money the buyer paid up front');
check(/Math\.min\(yearInterest, cap\) \* relief/.test(run) && /o\.regime === 'old' \? accNum\(o\.slab\) \* \(1 \+ TAX_IN\.cess\) : 0/.test(run), 'interest relief only in the old regime, capped at TAX_REGIME_IN.homeLoanInterest a year');
check(/value \* accNum\(o\.maintPct\) \/ 12/.test(run) && /rent \*= 1 \+ accNum\(o\.rentGrowth\)/.test(run), 'upkeep follows the home\'s value; rent rises once a year');
check(/const LO = -0\.10, HI = 0\.30, STEP = 0\.005;/.test(rvb) && /if \(prev < 0 && v >= 0\) at = x;/.test(rvb) && /beyond = 'below'/.test(rvb) && /beyond = 'above'/.test(rvb), 'break-even: the highest crossing from behind to ahead, scanned then bisected; "below"/"above" outside -10% to 30%');
check(/rentVsBuy, rentVsBuyRun,/.test(eng), 'exported for the tests');

// ---- the tab
const rr = fnBody(gl, 'renderRentBuy');
check(/\{id:'rentbuy', short:'Rent or buy a home/.test(gl) && /else if\(L\.tab==='rentbuy'\) main\.innerHTML=renderRentBuy\(\);/.test(gl), 'Rent or buy is a Lab tab');
check(/rentbuy:\{ price:10000000, down:20, stamp:7/.test(gl) && /rentbuy:\['rentbuy'\]/.test(gl), 'it has defaults and its own Reset');
check(/indiaOnlyTab\('Rent or buy'/.test(rr), 'India only (stamp duty, s.24(b), Indian slabs)');
check(/Buying comes out ahead only if the home's price grows faster than/.test(rr) && !/you should (buy|rent)|better to (buy|rent)|we recommend/i.test(rr), 'it gives the break-even beside the person\'s guess, and no verdict');
check(/Both before tax on the gains/.test(rr) && /Left out: [\s\S]{0,300}the 80C relief on the principal/.test(rr), 'it says both sides are before tax, and what is left out');
check(/RB_STAYS=\[5,10,15,20,25\]/.test(gl) && /How long you stay changes the line/.test(rr) && /id="rb-stays"><table/.test(rr) && !/barsChart\('rb-stays'/.test(rr), 'break-even for several stays, as a table (a bar from zero cannot show a negative one)');
check(/the HRA exemption a salaried renter usually gets in the old regime/.test(rr) && /security deposit/.test(rr) && /not the HRA exemption a salaried renter usually gets/.test(gl), 'the old regime\'s one-sidedness (HRA) and the deposit are said');
check(/function rbMinDown\(price\)\{ return price<=3000000 \? 10 : price<=7500000 \? 20 : 25; \}/.test(gl) && /Math\.max\(s\.down, rbMinDown\(s\.price\)\)/.test(gl), 'the down payment is at least what RBI\'s lending limits leave, and the slider says so');
check(/rbpath: '#rb-path-echart'/.test(gl) && /'rentbuy': \['What if prices grow only 4% a year\?'/.test(gl), 'the advisor can point at the chart and has its own follow-ups');
const ch = fnBody(gl, 'renderRentBuyChart');
check(/legend:\{ show:false \}/.test(ch) && /endLabel:\{ show:true, formatter:p=>'Buying'/.test(ch) && /type:\[14,5\]/.test(ch) && !/#C0392B|#E74C3C|\bred\b|green/i.test(ch), 'two lines, named at their ends, told apart in greyscale, no legend, no red or green');
check(/data-tab="rentbuy"/.test(rr) && /tab==='rentbuy'\?L\.rentbuy/.test(gl) && /querySelectorAll\('\[data-rb\]'\)/.test(gl), 'sliders and the regime/slab buttons are wired');
check(/\.stat-row\.pairs\.rb-month\{grid-template-columns:1fr\}/.test(gl), 'the monthly figures stack on a phone instead of breaking a number');

// ---- the advisor
check(/'rentbuy\.priceGrowth': \{ path:\['rentbuy','priceGrowth'\]/.test(gl) && /rentbuy:'rentbuy'/.test(gl) && /'income', 'loans', 'rentbuy'/.test(gl), 'set_value fields, TAB_FOR and India-only state');
check(/rentbuy:'rentbuy', taxregime:'tax'/.test(gl) && /'loans','rentbuy','taxregime'/.test(gl), 'run_full_analysis takes tab "rentbuy"');
check(/if \(tab === 'rentbuy'\) \{\n    const R = computeRentBuy\(\)/.test(gl) && /rentBuyAdvisorResults\(\)/.test(gl), 'get_results and the chart reader both know the tab');
check(/- Rent or buy \(India\):[^\n]*Never say which to choose/.test(gl), 'the advisor is told it gives a break-even, never a choice');

console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
