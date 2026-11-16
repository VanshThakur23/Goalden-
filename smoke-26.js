// smoke-26.js -- The Full Plan's "Make it fit" panel, and the UI passes of 2026-11-16 (column, type, surfaces,
// landing questions, Lab tool groups). Regex-on-file-contents style, same conventions as smoke-09..25.
// Run with: node smoke-26.js
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
const g1 = read('goalden.html'), g2 = read('goalden-door2.html'), gl = read('goalden-lab.html'), ix = read('index.html');
const fnBody = (src, name) => {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) return '';
  const j = src.indexOf('\nfunction ', i + 10);
  return src.slice(i, j < 0 ? undefined : j);
};

// ---- Make it fit
const cg = fnBody(g2, 'calcGoal'), ce = fnBody(g2, 'calcEmergency');
check(/\*\(goal\.spendShare\|\|1\)/.test(cg) && /\*\(goal\.feeShare\|\|1\)/.test(cg), 'the goal sums take the spending and fee shares, defaulting to all of it');
check(/const build=buildOverride\|\|G\.emergencyBuild\|\|12;/.test(ce) && /Build over \$\{plan\.emg\.build\} months/.test(g2), 'the emergency fund can be built over longer, and the plan says how long');
check(/const gapCard=\(plan\.status!=='ok' \|\| fitInForce\(\)\) && \(G\.goals\.length \|\| plan\.emg\.needed\) \? fitCardHTML\(plan,c\) : '';/.test(g2) && !/One way to close the gap/.test(g2), 'over budget (or while a change from it is in force), the panel replaces the one fixed tip');
check(/if\(f\.spend<100\) x\.spendShare=f\.spend\/100;/.test(g2) && /if\(f\.share<100\) x\.feeShare=f\.share\/100;/.test(g2), 'shares are set directly, never compounded below the slider floor');
check((g2.match(/carryFitShares\(goal, prev(Goal)?\);/g) || []).length === 2 && /spendShare:prev\.spendShare, feeShare:prev\.feeShare \};/.test(g2), 'a share survives editing the goal, on the screens and through update_goal');
check(/si:0,emergencyBuild:null,planSavedAt:null,planSavedKey:null\}\);/.test(g2) && /emergencyBuild:G\.emergencyBuild\|\|null,/.test(g2) && /emergencyBuild:\[18,24,30,36\]\.includes\(data\.emergencyBuild\)/.test(g2) && /First priority · build over \$\{emg\.build\} months/.test(g2), 'the build period is reset, saved, loaded and shown');
check(/calcGoal\(\{ \.\.\.g, feeShare:1 \}\)/.test(fnBody(g2, 'coverGoalNeed')), 'life cover is sized on the whole fee');
const fu = fnBody(g2, 'fitUpdate');
check(/calcGoal\(x\)/.test(fu) && /stepUpOffer\(after\.sip, x\.years, after\.rate\)/.test(fu), 'every figure in the panel comes from calcGoal and the same step-up sums as the plan');
check(/G\.goals=G\.goals\.map\(\(g,i\)=>fitGoal\(g, F\.goals\[i\]\)\);/.test(fnBody(g2, 'bindFitCard')) && /apply\.disabled=!fitChanged\(F\)/.test(fu), 'nothing changes until "Use these", which is off until something moved');
check(/spending '\+Math\.round\(g\.spendShare\*100\)/.test(fnBody(g2, 'fitNote')) && /yr horizon\$\{fitNote\(g\)\}/.test(g2), 'a goal changed there says so in its row');
check(/bindFitCard\(\);/.test(g2) && /"Make it fit" panel/.test(g2), 'bound with the plan screen, and the advisor knows the panel');

// ---- Since you saved this plan: run for real in the eval runner's sandbox (regexes alone passed with bugs in)
check(/planSavedAt:\(t=>isFinite\(t\)&&t<Date\.now\(\)\?t:null\)\(Date\.parse\(data\.savedAt\)\)/.test(g2) && /planSavedAt:null,planSavedKey:null\}\);/.test(g2), 'a loaded plan remembers when it was saved; Start over forgets it');
{
  const vm = require('vm');
  const quiet = console.log; console.log = () => {};
  let api = null;
  try { api = require(path.join(root, 'agent-evals', 'runner.js')).loadPage('goalden-door2.html'); } catch (e) { api = null; }
  console.log = quiet;
  const run = (code) => vm.runInContext(code, api.ctx);
  check(!!api, 'the Full Plan loads in the sandbox');
  if (api) {
    const amts = run(`["15,00,000","Rs 15 lakh","15L","1.5 cr","2 crore","800k","1.2 million","-5000","15 thousand rupees","abc",""].map(trackParseAmount)`);
    check(JSON.stringify(amts) === JSON.stringify([1500000, 1500000, 1500000, 15000000, 20000000, 800000, 1200000, null, null, null, null]), 'amounts read the way people type them here; a minus sign or an unknown word is refused, not guessed');
    run(`G.country='IN'; G.capA=[3,3,3,3]; G.tolA=[3,3,3,3,3]; G.emergencyStatus='full'; G.monthlyExpense=50000; G.monthlyCapacity=300000; G.bucket=scoreBuckets().bucket;
      G.goals=[]; advisorAddGoal({type:'retirement',currentAge:30,retireAge:58,monthlyExpense:50000}); advisorAddGoal({type:'education',annualFee:400000,years:12,existingSavings:300000});`);
    // Someone exactly on track needs what the saved plan asked for, whatever the months (no whole-year rounding).
    const drift = run(`[5,6,11,17,18].map(m=>{ const plan=buildPlan(), exp=trackExpected(plan,m), have=exp.reduce((a,e)=>a+e.expected,0);
      const now=plan.goals.reduce((a,g)=>a+g.sip,0), next=trackUpdatedGoals(have,plan,m).reduce((a,g)=>a+calcGoal(g).sip,0); return Math.abs(next-now)/now; })`);
    check(drift.every(x => x < 0.005), 'on track at 5, 6, 11, 17 and 18 months, the monthly need stays as saved (largest drift ' + (Math.max(...drift) * 100).toFixed(2) + '%)');
    const tgt = run(`(()=>{ const plan=buildPlan(), m=17, have=trackExpected(plan,m).reduce((a,e)=>a+e.expected,0), up=trackUpdatedGoals(have,plan,m);
      return plan.goals.map((g,i)=>[g.corpus, calcGoal(up[i]).corpus]); })()`);
    check(tgt.every(([a, b]) => Math.abs(a - b) / a < 0.005), 'bringing it up to date keeps each goal\'s target at its date');
    const passed = run(`(()=>{ advisorAddGoal({type:'generic',label:'Car',amount:800000,years:2}); const plan=buildPlan(), exp=trackExpected(plan,30);
      const up=trackUpdatedGoals(5000000,plan,30); return { carLeftOut: exp[2].passed && exp[2].expected===0, kept: up.map(g=>g.label), shared: up.reduce((a,g)=>a+g.existingSavings,0) }; })()`);
    check(passed.carLeftOut && JSON.stringify(passed.kept) === '["Retirement","Education"]' && Math.abs(passed.shared - 5000000) <= 2, 'a goal whose date has passed is left out of the yardstick and dropped on update; today\'s savings all go to the goals still ahead');
    const gate = run(`(()=>{ G.planSavedAt=Date.now()-14*30.44*864e5; G.planSavedKey=trackKey(); const on=trackActive(); G.goals[0].retireAge=60; const off=!trackActive(); return on&&off; })()`);
    check(gate, 'the card shows a month or more after saving, and not once the goals have changed since loading');
  }
}

// ---- the desktop column
for (const [n, s] of [['goalden.html', g1], ['goalden-door2.html', g2]]) {
  check(/:root\{--col:800px;--col-gut:calc\(\(100vw - var\(--col\)\) \/ 2\)\}/.test(s) && /body\.advisor-docked\{--col-gut:calc\(\(100vw - 400px - var\(--col\)\) \/ 2\)\}/.test(s), n + ': an 800px column, which leaves the docked advisor out of its gutters');
  check(/margin-left:calc\(-1 \* var\(--gut\)\)/.test(s) && /\.screen \.cta-zone\{padding-right:62px\}/.test(s), n + ': scroll areas keep their scrollbar at the edge; Continue stops short of the advisor button');
}

// ---- type and surfaces
check(/\.field label\{font-family:'Figtree'[^}]*text-transform:none/.test(gl) && /\.field label b\{font-family:'Spline Sans Mono'/.test(gl), 'Lab field labels in the body face, values still mono');
check(/\.stat:not\(\.fc-money-in\):not\(\.fc-money-out\)\{background:var\(--card/.test(gl), 'white tiles, except the money-in / money-out tints');
check(/<div class="plan-total neutral">\s*<span class="pt-label">Total needed\/month/.test(g2), 'the plan total is not coloured like the shortfall');

// ---- landing and Lab groups
const asks = (ix.match(/<a class="ask" href="([^"]+)"/g) || []).map(a => a.match(/href="([^"]+)"/)[1]);
const tabIds = (gl.slice(gl.indexOf('const TABS=['), gl.indexOf('\n];', gl.indexOf('const TABS=['))).match(/\{id:'([a-z]+)'/g) || []).map(x => x.slice(5, -1));
check(asks.length === 9 && asks.every(h => !/\?tab=/.test(h) || tabIds.includes(h.split('?tab=')[1])), 'nine question tiles, each Lab link names a real tab');
check(/<h3>Quick Calculate<\/h3>/.test(ix) && !/Start here/.test(ix) && /Read your CAS statement in My holdings/.test(ix), 'three levels, Quick Calculate a door again, no "Start here"');
check(!/riseIn[^;}]*\bboth\b/.test(ix), 'no entrance animation holds transform (hover and tilt work)');
const grouped = (gl.match(/ids:\[([^\]]+)\]/g) || []).join(',').match(/'([a-z]+)'/g).map(x => x.slice(1, -1));
const secondary = tabIds.filter(id => !['livefrontier', 'retirement', 'portfolio'].includes(id));
check(secondary.every(id => grouped.includes(id)) && /if\(rest\.length\) groups\.push\(\{ label:'More tools'/.test(gl), 'every further Lab tool is in a group, and an ungrouped one still shows');
check(/if\(localStorage\.getItem\('goaldenLabHandoff'\) && !tabFromQuery\(\)\) return false;/.test(gl), 'a tab link brings saved Lab numbers back');

console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
