// smoke-19.js — Group 8 checks: keyboard and slider names (10), the one palette (03 A),
// sticky summary and jump bar (20), shareable plan link (21), live result canvas (14),
// accessible term tips (07) and the explorable growth chart (08).
// Regex-on-file-contents style, same conventions as smoke-09..18; the share link's
// read/write pair is also run for real, in a vm, against the page's own source.
// Run with: node smoke-19.js
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

// CRLF files are read as LF, so the multi-line patterns below match in all four pages.
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');
const g1 = read('goalden.html');
const g2 = read('goalden-door2.html');
const gl = read('goalden-lab.html');
const ix = read('index.html');
const tip = read('gtip.js');

// the body of one top-level function, up to the next top-level "function"
const fnBody = (src, name) => {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) return '';
  const j = src.indexOf('\nfunction ', i + 10);
  return src.slice(i, j < 0 ? undefined : j);
};
const flat = (s) => s.replace(/\s+/g, ' ');

// ---- 10: keyboard and slider names -----------------------------------------
for (const [name, src] of [['goalden.html', g1], ['goalden-door2.html', g2]]) {
  const fk = fnBody(src, 'focusKeyOf');
  check(fk.length > 100, '10 ' + name + ': focusKeyOf found');
  check(/filter\(a => a\.name\.startsWith\('data-'\) && a\.name !== 'data-gtip'\)/.test(fk) && /attrs\.map\(/.test(fk),
    '10 ' + name + ': the focus key joins ALL data-* attributes (an option is told apart by score+section+index, not by one)');
  check(/querySelectorAll\(sel\)\.length === 1/.test(fk), '10 ' + name + ': a key that matches more than one element is refused');
  check(/function nameFields\(/.test(src) && /function fieldLabelOf\(/.test(src), '10 ' + name + ': sliders and number boxes get names from their label');
}
check(/function labFocusKey\(/.test(gl) && /function labRestoreFocus\(/.test(gl) && /closest\('#main, #tabbar'\)/.test(fnBody(gl, 'labFocusKey')) && /labRestoreFocus\(keepFocus/.test(gl),
  "10 goalden-lab.html: render() keeps keyboard focus (keyed within #main / #tabbar) across the 130ms re-render");
check(/\.q-title\[tabindex="-1"\]:focus[^{]*\{outline:none\}/.test(g1), '10 goalden.html: a heading focused on a screen change shows no ring');
check(/keepScroll = !screenChanged && oldBody \? oldBody\.scrollTop : 0/.test(g1) && /nb\.scrollTop = keepScroll/.test(g1), '10 goalden.html: a same-screen re-render puts the question scroller back (focus would otherwise be restored off-screen)');
check(/keepScroll=!screenChanged && oldBody \? oldBody\.scrollTop : 0/.test(g2) && /nb\.scrollTop=keepScroll/.test(g2), '10 goalden-door2.html: a same-screen re-render puts .qbody\'s scroll back (a batched question screen)');
for (const [name, src] of [['goalden.html', g1], ['goalden-door2.html', g2]]) {
  check(/a\.name !== 'data-gtip'/.test(fnBody(src, 'focusKeyOf')), '10 ' + name + ': the focus key leaves out data-gtip (gtip.js adds it after the element exists, so the key would never match)');
  check(/window\.gtipEnhance\) gtipEnhance\(stage\)/.test(src.replace(/\s+/g, ' ')), '10 ' + name + ': tips are made focusable before focus is given back');
}
check(/a\.name!=='data-gtip'/.test(fnBody(gl, 'labDataSel')) && /window\.gtipEnhance\) gtipEnhance\(main\)/.test(gl), '10 goalden-lab.html: same for the Lab (focus key and enhancing before restore)');

// ---- 03 A: the old terracotta/sage palette is gone ---------------------------
for (const [name, src] of [['goalden.html', g1], ['goalden-door2.html', g2], ['goalden-lab.html', gl], ['index.html', ix]]) {
  for (const old of ['#D97757', '#8FC79E', '#E8977A', '#5FA875']) {
    const left = (src.match(new RegExp(old, 'gi')) || []).length;
    check(left === 0, '03 ' + name + ': ' + old + ' no longer appears' + (left ? ' (' + left + ' left)' : ''));
  }
}

check(!/step-up pot \$\{c\.compact\(gap\)\} behind`, CHART_TEXT\.bad/.test(gl) && !/itemStyle:\{color:'#9C4A2C'\}, silent:true,\s*\n\s*data:\[\{coord:\[gapIdx/.test(gl), '03 goalden-lab.html: the step-up "behind" marker is not red (a gap is the normal case, not a fired warning)');
check(!/Red dots on the chart/.test(gl) && !/orange marker/.test(gl), '03 goalden-lab.html: no caption names a colour the chart no longer uses');

// ---- 20: sticky summary and jump bar -----------------------------------------
const sb = fnBody(g1, 'sumBarHtml');
check(sb.length > 100 && /id="sumBar" hidden/.test(sb) && /data-sum="top"/.test(sb) && /data-sum="adjust"/.test(sb), '20 goalden.html: the summary bar renders hidden, with Adjust and Back to top');
check(/aria-hidden="true">' \+ txt/.test(sb), '20 the summary text is hidden from a screen reader (the hero number already says it)');
check(/\.sum-bar\{[^}]*left:0;right:0/.test(g1) && !/\.sum-bar\{[^}]*(left|right):-\d/.test(g1), '20 the bar spans left:0;right:0 (a -4px overhang flickers a horizontal scrollbar on Windows)');
const wn = fnBody(g1, 'wireResultNav');
check(wn.length > 200 && /resultNavObserver\.disconnect\(\)/.test(wn), '20 wireResultNav disconnects the old observer before re-observing (every what-if tap re-renders)');
check(/'IntersectionObserver' in window/.test(wn), '20 wireResultNav is guarded for a DOM without IntersectionObserver');
check(/aria-label', 'Jump to a section'/.test(wn) && /setAttribute\('aria-label', 'Jump to: ' \+ text\)/.test(wn), '20 the jump bar is a named nav and each button says where it goes');
check(/const JUMP_LABELS = \[/.test(g1), '20 JUMP_LABELS maps card titles to short labels');
check(/behavior: still \? 'auto' : 'smooth'/.test(wn), '20 reduced motion jumps instead of scrolling smoothly');

// ---- 21: shareable plan link, run for real --------------------------------------
{
  const grab = (re, what) => { const m = g1.match(re); if (!m) throw new Error('cannot find ' + what); return m[0]; };
  const fieldsSrc = grab(/const ADVISOR_FIELDS = \[[\s\S]*?\n\];/, 'ADVISOR_FIELDS');
  const planSrc = g1.slice(g1.indexOf("const PLAN_VERSION"), g1.indexOf('// Start from a clean slate'));
  const accSrc = grab(/const ACC_KEYS = [\s\S]*?\nfunction accClean[\s\S]*?\n\}\n/, 'accClean');
  const eng = require('./goalden-engine.js');
  const sandbox = {
    TAX_IN: eng.TAX_IN, RETIRE_ACCOUNTS_IN: { ppf: { yearlyMax: 150000 } },
    URLSearchParams, location: { href: 'https://goalden.example/goalden.html?x=1#old' },
    S: {}, console,
  };
  vm.createContext(sandbox);
  let ok = true;
  try {
    vm.runInContext(fieldsSrc + '\n' + accSrc + '\n' + planSrc +
      '\nthis.readPlanLink = readPlanLink; this.planLink = planLink; this.PLAN_VERSION = PLAN_VERSION;', sandbox);
  } catch (e) { ok = false; console.log('     ' + e.message); }
  check(ok, '21 the page\'s own planLink / readPlanLink load in a vm');
  if (ok) {
    const { readPlanLink, planLink } = sandbox;
    const hashOf = (u) => u.slice(u.indexOf('#'));
    const base = { country: 'IN', goalType: 'retirement', age: 30, retireAge: 60, monthlyExpense: 50000, existingSavings: 250000, risk: 'balanced' };

    sandbox.S = Object.assign({}, base);
    const link = planLink();
    check(/#plan:v=1&/.test(link), '21 a link starts #plan:v=1 (a format key, so a later format can refuse old links)');
    check(link.indexOf('goalden.html#plan:') > 0 && link.indexOf('?x=1') < 0, '21 the link is the page URL with the fragment replaced, query dropped');
    const back = readPlanLink(hashOf(link));
    check(back && back.age === 30 && back.retireAge === 60 && back.monthlyExpense === 50000 && back.existingSavings === 250000 && back.risk === 'balanced' && back.country === 'IN',
      '21 a link reads back to exactly the answers that made it');

    // the refinements ride along and come back
    sandbox.S = Object.assign({}, base, { postRetAlloc: { eq: 0.4, de: 0.5, hy: 0.1 }, taxSlab: 20,
      acc: { epfBal: 500000, epfBasic: 40000, epfWage: 'ceiling', ppfBal: 100000, ppfYearly: 150000, npsBal: 0, npsMonthly: 0 } });
    const link2 = planLink();
    const back2 = readPlanLink(hashOf(link2));
    check(back2 && back2.alloc.ret === 40 && back2.taxSlab === 20 && back2.acc && back2.acc.epfBal === 500000 && back2.acc.epfWage === 'ceiling' && back2.acc.ppfYearly === 150000,
      '21 the post-retirement mix, tax slab and EPF/PPF/NPS balances round-trip');

    // The wizard has no upper bound on some answers (a goal 35 years away); the share button runs this very
    // read on the link it just made, so a sender is told instead of handing over a link that opens on a blank start.
    sandbox.S = { country: 'IN', goalType: 'generic', genType: 'house', genAmount: 5000000, genYears: 35, existingSavings: 0, risk: 'balanced' };
    check(readPlanLink(hashOf(planLink())) === null, '21 a goal 35 years away makes a link the reader refuses (which the share button catches before copying)');
    sandbox.S = { country: 'IN', goalType: 'generic', genType: 'house', genAmount: 5000000, genYears: 12, existingSavings: 0, risk: 'balanced' };
    const gen = readPlanLink(hashOf(planLink()));
    check(gen && gen.genYears === 12 && gen.genAmount === 5000000 && gen.genType === 'house', '21 a generic goal round-trips');

    // refused, never guessed at
    const bad = {
      'no version':              '#plan:c=IN&g=retirement&a=30&r=60&e=50000&k=balanced',
      'another version':         '#plan:v=2&c=IN&g=retirement&a=30&r=60&e=50000&k=balanced',
      'not a plan':              '#results',
      'hex in a number':         '#plan:v=1&c=IN&g=retirement&a=0x20&r=60&e=50000&k=balanced',
      'exponent in a number':    '#plan:v=1&c=IN&g=retirement&a=30&r=60&e=5e4&k=balanced',
      'age over the limit':      '#plan:v=1&c=IN&g=retirement&a=99&r=100&e=50000&k=balanced',
      'retire before now':       '#plan:v=1&c=IN&g=retirement&a=50&r=45&e=50000&k=balanced',
      'unknown country':         '#plan:v=1&c=XX&g=retirement&a=30&r=60&e=50000&k=balanced',
      'script in the risk':      '#plan:v=1&c=IN&g=retirement&a=30&r=60&e=50000&k=%3Cscript%3E',
      'a missing required answer': '#plan:v=1&c=IN&g=retirement&a=30&r=60&k=balanced',
      'tax slab not in the table': '#plan:v=1&c=IN&g=retirement&a=30&r=60&e=50000&k=balanced&x=17',
      'equity share over 100':   '#plan:v=1&c=IN&g=retirement&a=30&r=60&e=50000&k=balanced&pe=140',
      'a negative balance':      '#plan:v=1&c=IN&g=retirement&a=30&r=60&e=50000&k=balanced&ab=-5',
      'a huge amount':           '#plan:v=1&c=IN&g=retirement&a=30&r=60&e=99999999999&k=balanced',
    };
    for (const [why, h] of Object.entries(bad)) check(readPlanLink(h) === null, '21 refused: ' + why);
  }
}
check(/planGhost = null;\s*\n\s*lcStart = null;[^\n]*\n\s*S\.si = flow\(\)\.indexOf\('results'\)/.test(g1), '21 opening a link drops a stale "before" line and the live canvas\'s starting point (its Undo would otherwise write the OLD plan over the linked one)');
const sbtn = g1.slice(g1.indexOf("const shareBtn = document.getElementById('shareBtn')"), g1.indexOf("const caseBtn = document.getElementById('caseBtn')"));
check(/readPlanLink\(url\.slice\(url\.indexOf\('#'\)\)\)/.test(sbtn) && sbtn.indexOf('readPlanLink') < sbtn.indexOf('writeText'), '21 the share button reads its own link back BEFORE copying, and says so when it cannot be opened');
check((g1.match(/planLinkRefusedNotice\(\)/g) || []).length === 3, '21 a refused incoming link (on load and on a hash change) tells the person, instead of opening on a blank start');
check(/which browsers never send to a server, so Goalden's server never sees the link itself/.test(g1) && /Wherever you paste it keeps a copy, and anyone who has it can read them/.test(g1) && /If you chat with the advisor, your plan is sent to it/.test(g1),
  '21 the privacy note: the link never reaches Goalden\'s server, whoever holds it can read it, and the advisor does send the plan: no "nothing leaves your device" overclaim');

// ---- 14: live result canvas -------------------------------------------------------
const lcs = fnBody(g1, 'liveCanvasSync');
check(/typeof stage\.after !== 'function'\) return/.test(lcs), "14 liveCanvasSync is guarded for the agent-evals DOM stub (no Element.after)");
check(/screen === 'results' && S\.goalType === 'retirement'/.test(lcs), '14 the canvas exists only on a retirement result');
check(/body\.lc-on #advisorPanel|body\.lc-on #advisorFab/.test(g1) && /@media ?\(min-width:481px\)\{[^}]*body\.lc-on/.test(flat(g1)), '14 the chat panel is lifted only above 480px (on a phone it would go off-screen)');
check(/addEventListener\('resize', lcLift\)/.test(g1), '14 the lift is recomputed on resize');
check(/let chartQuiet = false;/.test(g1) && /Object\.assign\(\{ animation: false \}, option\)/.test(g1), '14 a quiet render draws charts without the grow-in');
check(/setTimeout\(\(\) => \{ chartQuiet = false; \}, 0\)/.test(g1), '14 chartQuiet is reset after the deferred chart inits have run');
check(/ADVISOR_FIELDS\.find\(f => f\.name === k\)/.test(g1), '14 the canvas takes its limits from ADVISOR_FIELDS (one source of truth)');
check(!/LC_LIMITS/.test(g1), '14 no second table of limits (LC_LIMITS) to drift from the advisor\'s');

// ---- 07: accessible term tips ---------------------------------------------------------
check(tip.length > 2000 && /window\.gtipEnhance = enhance/.test(tip), '07 gtip.js exists and exports gtipEnhance');
for (const [name, src, want] of [['goalden.html', g1, true], ['goalden-door2.html', g2, true], ['goalden-lab.html', gl, true], ['index.html', ix, false]]) {
  check(/<script src="gtip\.js"><\/script>/.test(src) === want, '07 ' + name + ': gtip.js is ' + (want ? '' : 'not ') + 'loaded');
}
check(/<script src="gtip\.js"><\/script>\s*\r?\n<script src="advisor\.js">/.test(g1), '07 gtip.js loads before advisor.js');
for (const [name, src] of [['goalden.html', g1], ['goalden-door2.html', g2], ['goalden-lab.html', gl]]) {
  check(!/\.term-i-tip|\.term-tip|\.term::after|\.term:hover::after|\.info-icon:hover \.ii-tip/.test(src), '07 ' + name + ': the old hover/tap tooltip CSS and handlers are gone');
}
check(/MutationObserver/.test(tip) && /getElementById\('stage'\) \|\| document\.getElementById\('main'\)/.test(tip), '07 the observer watches #stage / #main, not body (body runs on every ECharts frame)');
check(/position:\s*fixed/.test(tip) || /'fixed'/.test(tip), '07 the tip is position:fixed, so no overflow:hidden parent can clip it');
check(/'Escape'/.test(tip) && /close\(at === owner \|\| pop\.contains\(at\) \|\| at === document\.body\)/.test(tip), '07 Esc closes a tip, and gives focus back only if it was on the word or in the tip');
check(/aria-describedby/.test(tip), '07 an open tip is tied to its trigger with aria-describedby');
check(!/<button[^>]*>(?:(?!<\/button>)[\s\S])*infoIcon\(/.test(gl), '07 goalden-lab.html: no infoIcon() inside a <button> (a button in a button)');
check(/function infoIcon\(text, you, name\)/.test(gl), '07 goalden-lab.html: infoIcon(text, you, name) takes the personalised line and an explicit name');
check(!/currentSharpe/.test(fnBody(gl, 'frontierTakeawayHTML')), '07 goalden-lab.html: frontierTakeawayHTML uses its own sharpe parameter, not the undefined currentSharpe');
check(/g\.mix\[w\.peakK\]/.test(gl) && /g\.mix\[w\.k\]/.test(gl), '07 goalden-lab.html: the worst-fall sentence runs from the PEAK to the bottom');
check(/data-you="\$\{advisorAttr\(/.test(gl) && /dataset\.you/.test(tip), '07 the personalised line travels in data-you and is read by gtip.js');

// ---- 08: explorable growth chart ----------------------------------------------------------
const ws = fnBody(g1, 'wireChartScrub');
check(ws.length > 400, '08 goalden.html: wireChartScrub found');
check(/setAttribute\('role', 'slider'\)/.test(ws) && !/role['", ]+img/.test(ws), '08 the keyed chart element is role="slider", not "img"');
check(/aria-valuetext/.test(ws) && /aria-valuenow/.test(ws), '08 a screen reader hears the value text');
check(/dom\.onkeydown = /.test(ws) && /dom\.onblur = /.test(ws), '08 handlers are set as properties, so a re-render cannot stack a second one');
check(/ArrowRight/.test(ws) && /PageUp/.test(ws) && /Home/.test(ws) && /End/.test(ws), '08 arrows, Page Up/Down, Home and End all move');
check(/inst\.off\('updateAxisPointer'\)/.test(ws), '08 the pointer listener is replaced, not added to, on every render');
check(/\.scrub-readout\{/.test(g1) && /max-width:520px\)\{\.scrub-readout\{flex-direction:column/.test(g1), '08 the readout stacks one value per line on a phone, so its height never changes under a finger');
check(/\.echart\[tabindex\]:focus-visible/.test(g1), '08 the chart shows a focus ring for the keyboard');
check(/function activeGhost\(\)/.test(g1) && /planGhost\.sig === ghostSig\(\)/.test(g1) && /planGhost\.retireAge !== S\.retireAge/.test(g1) && /S\.goalType === 'retirement'/.test(fnBody(g1, 'activeGhost') + g1.slice(g1.indexOf('function activeGhost'), g1.indexOf('function activeGhost') + 260)),
  '08 the ghost shows only for retirement, only while every other answer is unchanged, and only for a different age');
check(/ghostSig\(\) \{ return JSON\.stringify\(\[S\.country, S\.age, S\.monthlyExpense, S\.risk, S\.existingSavings, S\.postRetAlloc, S\.acc\]\)/.test(g1), '08 the ghost signature covers every answer the retirement result depends on');
check(/rememberGhost\(\);\s*\n\s*S\.retireAge = parseInt\(el\.dataset\.retirePreview, 10\);\s*\n\s*if \(planGhost\) planGhost\.to = S\.retireAge;/.test(g1), '08 a what-if tap remembers the plan before it changes the age, and the age it moved to');
check(/planGhost\.to === S\.retireAge/.test(g1.slice(g1.indexOf('function activeGhost'), g1.indexOf('function activeGhost') + 300)), '08 the ghost is dropped when the live canvas or the advisor moves the age again (55 to 58 is not "a moment ago")');
check((g1.match(/planGhost = null;/g) || []).length >= 4, '08 the ghost is dropped on edit, start-over, link-open and non-retirement');
check(/mountainChart\(yearlyMountainRows\(r\.accRows\), 'chart-mountain', \{ghost:true\}\)/.test(g1), '08 only the retirement result asks for a ghost');
check((g1.match(/mountainChart\(/g) || []).length >= 3 && (g1.match(/\{ghost:true\}/g) || []).length === 1, '08 no other chart is given a ghost');
check(/#56698A/.test(fnBody(g1, 'renderMountainChartOption')) && /type:\[2,3\]/.test(fnBody(g1, 'renderMountainChartOption')), '08 the ghost is slate and dotted: reads as "the other plan" in greyscale');
check(!/legend\s*:/.test(fnBody(g1, 'renderMountainChartOption')), '08 no legend: the ghost line carries its own end label');
check(/if\(!grown && !before\) return ''/.test(fnBody(g1, 'renderMountainChartOption')), '08 the tooltip copes with a year only the earlier plan reaches');
check(/ghostCaption\(c\)/.test(g1), '08 the caption says what the dotted line is, from the same numbers');

console.log(fail ? '\n' + fail + ' check(s) FAILED' : '\nall checks passed');
process.exit(fail ? 1 : 0);
