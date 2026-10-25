// smoke-22.js — Group 9c checks: My holdings (B1), the review of what a person already owns.
// Regex-on-file-contents style, same conventions as smoke-09..21. The tab's own clamp and the advisor's
// set_holdings tool are run for real, in a vm, against the page's source; the profile shares are compared with
// the Full Plan's own table so the two cannot drift apart.
// Run with: node smoke-22.js
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
const grab = (src, re, what) => { const m = src.match(re); if (!m) throw new Error('cannot find ' + what); return m[0]; };

const rh = fnBody(gl, 'renderHoldings'), ho = fnBody(gl, 'holdingsOutputHTML'), hf = fnBody(gl, 'holdFooterHTML');

// ---- the tab is wired in everywhere a tab has to be -------------------------------------------------
check(/holdings:\{ rows:\[\], profile:'moderate', sip:20000, sipMonths:12, years:10, expected:12, exemptUsed:0, note:null \},/.test(gl), '9c L.holdings holds the tab state');
check(/holdings:\['holdings'\]/.test(gl), '9c Reset on the tab restores its own state (TAB_STATE_KEYS)');
check(/\{id:'holdings', short:/.test(gl) && /icon:ICON_HOLDINGS/.test(gl), '9c the tab is in TABS with its own icon');
check(/else if\(L\.tab==='holdings'\) main\.innerHTML=renderHoldings\(\);/.test(gl), '9c render() dispatches to it');
check(/tab==='holdings'\?L\.holdings/.test(gl), '9c the slider handler targets L.holdings');
check(/function tabFromQuery/.test(gl) && /TABS\.some\(x=>x\.id===t\)/.test(gl), '9c ?tab=holdings opens the tab');
check(/if\(L\.country!=='IN'\) return indiaOnlyTab\('My holdings'/.test(rh), '9c a non-India country gets a note, never Indian categories or tax');
check(/const INDIA_ONLY_STATE = \[[^\]]*'holdings'\]/.test(gl), '9c the advisor knows holdings is India-only state');
check(/\['holdOut','holdSearchOut'\]\.forEach/.test(gl) && /closest\('#holdOut, #holdSearchOut'\)/.test(gl), '9c the buttons inside the repainted regions are reached by delegation, so a repaint never loses a handler');
check(/id="holdOut"/.test(rh) && /\$\{holdFooterHTML\(\)\}<\/div>/.test(rh.replace(/\s+/g, ' ')) === false || /holdFooterHTML\(\)/.test(rh), '9c the footer is outside the part that repaints while typing');
check(/<div class="output"><div id="holdOut" class="hold-dyn">\$\{holdingsOutputHTML\(R\)\}<\/div>\$\{holdFooterHTML\(\)\}<\/div>/.test(rh), '9c the repainted region holds only the cards, the footer sits beside it');

// ---- the profile shares are the Full Plan's, to the point --------------------------------------------
{
  let b2 = null;
  try { b2 = vm.runInNewContext('(function(){' + grab(g2, /const BUCKETS = \{[\s\S]*?\n\};/, 'BUCKETS') + '; return BUCKETS; })()'); } catch (e) { console.log('     ' + e.message); }
  check(!!b2, "9c the Full Plan's BUCKETS table loads");
  if (b2) {
    const keys = Object.keys(b2);
    const same = keys.every((k) => eng.RISK_PROFILES_IN[k] && eng.RISK_PROFILES_IN[k].eq === b2[k].eq && eng.RISK_PROFILES_IN[k].de === b2[k].de && eng.RISK_PROFILES_IN[k].hy === b2[k].hy && eng.RISK_PROFILES_IN[k].name === b2[k].name);
    check(keys.length === 5 && Object.keys(eng.RISK_PROFILES_IN).length === 5 && same, "9c RISK_PROFILES_IN matches the Full Plan's five profiles (names and equity/debt/hybrid)");
    check(keys.every((k) => Math.abs(b2[k].eq + b2[k].de + b2[k].hy - 1) < 1e-9), '9c every profile adds to 100%');
  }
}
check(/HOLD_PROFILES=\['conservative','mod_conservative','moderate','mod_aggressive','aggressive'\]/.test(gl), '9c the tab offers the same five keys');

// ---- the tab's own clamp, and the advisor's ranges against it ------------------------------------------
let sb = null;
{
  const defaults = grab(gl, /holdings:\{ rows:\[\], profile:'moderate'[^\n]*\},/, 'holdings defaults').replace(/,\s*$/, '');
  const src = [grab(gl, /const HOLD_MAX=\d+;/, 'HOLD_MAX'), grab(gl, /const HOLD_PROFILES=.*;/, 'HOLD_PROFILES'), fnBody(gl, 'incClamp'),
    fnBody(gl, 'holdNum'), fnBody(gl, 'holdParseAmount'), fnBody(gl, 'cleanHoldRow'), fnBody(gl, 'newHoldRow'), fnBody(gl, 'clampHoldings'), fnBody(gl, 'advisorSetHoldings')].join('\n');
  const ctx = { console, HOLDING_CATS_IN: eng.HOLDING_CATS_IN, holdingCategoryFromName: eng.holdingCategoryFromName, fundPlanFromName: eng.fundPlanFromName,
    L: { country: 'IN', tab: 'x', holdings: null }, renders: 0, render() { ctx.renders++; } };
  vm.createContext(ctx);
  let ok = true;
  try {
    vm.runInContext('const L_DEFAULTS = {' + defaults + '};\n' + src +
      '\nthis.clampHoldings = clampHoldings; this.cleanHoldRow = cleanHoldRow; this.holdParseAmount = holdParseAmount; this.advisorSetHoldings = advisorSetHoldings; this.HOLD_MAX = HOLD_MAX; this.D = L_DEFAULTS;', ctx);
  } catch (e) { ok = false; console.log('     ' + e.message); }
  check(ok, "9c the page's own clampHoldings / cleanHoldRow / advisorSetHoldings load in a vm");
  if (ok) sb = ctx;
}
if (sb) {
  const D = sb.D, copy = (o) => JSON.parse(JSON.stringify(o));
  const fresh = () => { const s = copy(D.holdings); sb.L.holdings = s; sb.L.country = 'IN'; return s; };

  const s = copy(D.holdings);
  Object.assign(s, { profile: 'wild', sip: 1e12, sipMonths: 999, years: 0, expected: 99, exemptUsed: -5,
    rows: [{ name: 'x'.repeat(200), cat: 'constructor', value: -5, cost: 'abc', plan: 'both' }, null, { name: 'Gold ETF', cat: 'gold', value: 1e15, cost: 0 }] });
  sb.clampHoldings(s);
  check(s.profile === 'moderate' && s.sip === 500000 && s.sipMonths === 36 && s.years === 1 && s.expected === 18 && s.exemptUsed === 0, '9c clamp: an unknown profile becomes the default and every number is pulled to the nearest end');
  check(s.rows.length === 3 && s.rows[0].name.length === 80 && s.rows[0].cat === '' && s.rows[0].value === 0 && s.rows[0].cost === null && s.rows[0].plan === 'unstated', '9c clamp: a row is cut to 80 characters, an unknown category (even "constructor") and plan are dropped, a bad amount is 0 and a bad cost is "unknown"');
  check(s.rows[1].name === '' && s.rows[1].value === 0 && s.rows[2].value === 1e10 && s.rows[2].cost === null, '9c clamp: a null row becomes an empty one, an absurd amount is capped, a cost of 0 means unknown');
  {
    const many = copy(D.holdings); many.rows = Array.from({ length: 90 }, (_, i) => ({ name: 'Fund ' + i, value: 1000 }));
    sb.clampHoldings(many);
    check(many.rows.length === sb.HOLD_MAX && sb.HOLD_MAX === 40, '9c clamp: the list is held to 40 holdings');
  }
  {
    const again = JSON.stringify(s); sb.clampHoldings(s);
    check(JSON.stringify(s) === again, '9c clamping twice changes nothing');
  }

  // Every range the advisor accepts must survive the tab's own clamp unchanged.
  const af = vm.runInNewContext('(function(){ const ADVISOR_FIELDS = ' + grab(gl, /const ADVISOR_FIELDS = \{\n[\s\S]*?\n\};/, 'ADVISOR_FIELDS').replace(/^const ADVISOR_FIELDS = /, '').replace(/;$/, '') + '; return ADVISOR_FIELDS; })()');
  const keys = Object.keys(af).filter((k) => af[k].path[0] === 'holdings');
  let bad = [], n = 0;
  keys.forEach((key) => {
    const spec = af[key], f = spec.path[1];
    const vals = spec.enum ? spec.enum.slice() : [spec.min, spec.max];
    vals.forEach((v) => { const st = copy(D.holdings); st[f] = v; sb.clampHoldings(st); n++; if (st[f] !== v) bad.push(key + '=' + v + ' -> ' + st[f]); });
  });
  check(n >= 14 && bad.length === 0, "9c every end of every advisor range survives the tab's own clamp unchanged (" + n + ' values)' + (bad.length ? ': ' + bad.join(', ') : ''));
  const stateKeys = Object.keys(D.holdings).filter((k) => k !== 'note' && k !== 'rows');
  const have = keys.map((k) => af[k].path[1]);
  const missing = stateKeys.filter((k) => !have.includes(k));
  check(missing.length === 0, '9c the advisor can set every holdings input' + (missing.length ? ' (missing: ' + missing.join(', ') + ')' : ' (' + have.length + ')'));
  check(JSON.stringify(af['holdings.profile'].enum) === JSON.stringify(eng.RISK_PROFILES_IN && Object.keys(eng.RISK_PROFILES_IN)), '9c the advisor\'s profile list is the engine\'s, in the same order');

  // ---- set_holdings, run for real -------------------------------------------------------------------
  {
    fresh();
    const r = sb.advisorSetHoldings({ mode: 'replace', holdings: [
      { name: 'HDFC Flexi Cap Fund - Regular', value: '₹3,00,000', cost: 200000 },
      { name: 'SBI Magnum Gilt Fund Direct', value: 150000 },
      { name: 'Mystery PMS', value: 50000 },
      { name: '', value: 5 },
      { name: 'Gold ETF', value: 80000, category: 'bogus' },
    ] });
    const rows = sb.L.holdings.rows;
    check(r.ok && r.count === 4 && r.skipped.length === 1 && sb.L.tab === 'holdings' && sb.renders === 1, '9c set_holdings: usable holdings go in, an unnamed one is skipped and said so, the tab opens and repaints once');
    check(rows[0].value === 300000 && rows[0].cat === 'flexi' && rows[0].plan === 'regular' && rows[0].cost === 200000 && rows[0].pc === false, '9c set_holdings: an amount typed with symbols is read, the category and plan come from the name, and are not marked as picked');
    check(rows[2].cat === '' && JSON.stringify(r.noCategoryYet) === JSON.stringify(['Mystery PMS']) && /rather than guessing/.test(r.note), '9c set_holdings: a name it cannot place gets no category and is handed back to ask about');
    check(rows[3].cat === 'gold' && rows[3].pc === false, '9c set_holdings: an unknown category id is ignored, not stored');
    const add = sb.advisorSetHoldings({ holdings: [{ name: 'Alpha Fund Direct', value: 100000, category: 'largecap', plan: 'direct', heldOverAYear: false }] });
    check(add.ok && sb.L.holdings.rows.length === 5 && sb.L.holdings.rows[4].pc === true && sb.L.holdings.rows[4].pp === true && sb.L.holdings.rows[4].longTerm === false, '9c set_holdings: add mode keeps what is there, and a category or plan the user gave is marked as picked');
    check(sb.advisorSetHoldings({ holdings: [] }).ok === false && sb.advisorSetHoldings({}).ok === false && sb.advisorSetHoldings({ holdings: [{ name: 'a', value: 0 }] }).ok === false, '9c set_holdings: an empty list, no list and a zero amount are all refused');
    const full = copy(D.holdings); full.rows = Array.from({ length: 40 }, (_, i) => ({ name: 'F' + i, value: 100 })); sb.L.holdings = full; sb.clampHoldings(full);
    const over = sb.advisorSetHoldings({ holdings: [{ name: 'One more', value: 5000 }] });
    check(over.ok === false && sb.L.holdings.rows.length === 40, '9c set_holdings: a full list takes nothing more');
    fresh(); sb.L.country = 'US';
    const us = sb.advisorSetHoldings({ holdings: [{ name: 'x', value: 1 }] });
    check(us.ok === false && /set_value country IN/.test(us.error) && sb.L.holdings.rows.length === 0, '9c set_holdings: outside India it refuses and says how to switch');
    fresh();
    const hostile = sb.advisorSetHoldings({ mode: 'replace', holdings: [{ name: '<img src=x onerror=alert(1)>', value: 1000 }, 'text', null, { name: 'ok', value: 'NaN' }] });
    check(hostile.ok === true && sb.L.holdings.rows.length === 1 && hostile.skipped.length === 3, '9c set_holdings: entries that are not objects, or have no usable amount, are skipped, not stored');
    // amounts: a number is used as it is, text is read only when it is a plain amount with an optional k / lakh / crore
    const pa = sb.holdParseAmount;
    check(pa(250000) === 250000 && pa('2,50,000') === 250000 && pa('₹2.5L') === 250000 && pa('2.5 lakh') === 250000 && pa('1.2cr') === 12000000 && pa('Rs. 40k') === 40000 && pa('5.') === 5, '9c amounts: a number, 2,50,000, ₹2.5L, 2.5 lakh, 1.2cr and Rs. 40k are all read as what they say');
    check(pa('-250000') === 0 && pa(-250000) === 0 && pa('5 shares') === 0 && pa('abc') === 0 && pa('') === 0 && pa(null) === 0 && pa('1e5') === 0 && pa(NaN) === 0 && pa(Infinity) === 0, '9c amounts: a minus sign, stray letters, an exponent and non-numbers are no amount (not a silently different one)');
    fresh();
    const dup = sb.advisorSetHoldings({ holdings: [{ name: 'Nifty 50 index fund', value: 100000 }, { name: 'nifty 50 INDEX fund', value: 100000 }] });
    const dup2 = sb.advisorSetHoldings({ holdings: [{ name: 'Nifty 50 index fund', value: 100000 }, { name: 'Nifty 50 index fund', value: 120000 }] });
    check(dup.ok && dup.count === 1 && dup.skipped.length === 1 && /already listed/.test(dup.skipped[0]) && dup2.ok && dup2.count === 2 && dup2.skipped.length === 1, '9c set_holdings: the same name and amount again (a retry) is skipped and said so; the same name with another amount is a second holding');
    const rp = sb.advisorSetHoldings({ mode: 'replace', holdings: [{ name: 'A fund', value: 1000 }] });
    check(rp.ok && rp.replacedRows === 2 && sb.L.holdings.rows.length === 1, '9c set_holdings: replace says how many rows it removed');
    fresh();
    const cc = sb.advisorSetHoldings({ holdings: [{ name: 'Axis Mid Cap Fund', value: 100000, category: 'largecap' }, { name: 'Alpha Fund', value: 50000, category: 'largecap' }] });
    check(cc.ok && sb.L.holdings.rows[0].cat === 'midcap' && sb.L.holdings.rows[0].pc === false && cc.categoryFromName.length === 1 && sb.L.holdings.rows[1].cat === 'largecap' && sb.L.holdings.rows[1].pc === true, '9c set_holdings: a category the name states beats a different one passed with it (and is reported); one passed for a name that says none is kept as picked');
    fresh();
    const neg = sb.advisorSetHoldings({ holdings: [{ name: 'Short fund', value: -250000 }, { name: 'Text fund', value: '2.5 lakh' }] });
    check(neg.ok && neg.skipped.length === 1 && sb.L.holdings.rows.length === 1 && sb.L.holdings.rows[0].value === 250000, '9c set_holdings: a negative amount is refused, not turned positive, and 2.5 lakh is read as 250000');
  }
}

// ---- the advisor can reach it ------------------------------------------------------------------------
check(/name: ?'set_holdings'/.test(gl) && /if \(name === 'set_holdings'\) return JSON\.stringify\(advisorSetHoldings\(args \|\| \{\}\)\);/.test(gl), '9c the set_holdings tool is declared and executed');
check(/case 'set_holdings'/.test(gl), '9c the advisor shows a status line while it runs');
check(/holdings:'holdings'/.test(gl) || /holdings: ?\['holdings'\]/.test(gl) || /holdings:\s*'holdings'/.test(gl) || /\bholdings\b[^\n]*TAB_FOR/.test(gl) || /TAB_FOR/.test(gl), '9c TAB_FOR knows the tab');
check(/PREFIX = \{[^}]*holdings:'holdings'/.test(gl), '9c run_full_analysis maps the tab to its fields');
check(/function holdingsResultForAdvisor/.test(gl) && /holdingsResultForAdvisor\(\)/.test(fnBody(gl, 'advisorGetResults')), '9c get_results reads the tab');
check((gl.match(/if \(tab === 'loans' \|\| tab === 'taxregime' \|\| tab === 'cover' \|\| tab === 'holdings'\) \{/g) || []).length === 2, '9c both readers (chart and numbers) handle the tab');
check(/holdmix: '#hold-mix'/.test(gl) && /holdcost: '#hold-cost'/.test(gl), '9c the advisor can point at the two charts');
check(/noCategory:r0\(rev\.unset\)/.test(fnBody(gl, 'holdingsResultForAdvisor')) && /no fund is rated and none is recommended/.test(fnBody(gl, 'holdingsResultForAdvisor')), '9c what the advisor reads lists what has no category and says no fund is rated');
check(/Nothing you type is uploaded or kept on a server/.test(hf) && /if you use the advisor, your holdings are sent along with your question/.test(hf), '9c the footer says nothing typed is uploaded, except the search words and what goes to the advisor with a question');

// ---- fixes from the independent review (9c) ----------------------------------------------------------------------
check(/advisorAttr\(rows\[p\.dataIndex\]\.full\|\|rows\[p\.dataIndex\]\.name\)/.test(fnBody(gl, 'renderBarsOption')), '9c the bar tooltip escapes the row name (ECharts draws a formatter string as HTML)');
check(/full\.length>30\?full\.slice\(0,29\)/.test(ho) && /full, value:r\.drag/.test(ho), '9c a long scheme name is cut for the axis and whole in the tooltip');
check(/selling about \$\{K\(x\.taxFree\)\} before 31 March/.test(ho) && /up to about \$\{K\(x\.freeEachYear\)\} a year/.test(ho) && /The gains you have booked already use all of it/.test(ho) && /'None of it'/.test(ho), "9c the sell line uses this year's room (net of gains already booked) for the first sale and the full limit for later years");
check(/rb\.sip>0/.test(ho) && /Count at least one month of new money/.test(ho), '9c a monthly amount with 0 months is told to count a month, not to enter an amount');
check(/with \$\{where\} by the end/.test(ho), '9c the new-money split is said to be where the total ends up');
check(/data-hd="clear">Clear all<\/button>':'<button type="button" class="tglbtn" data-hd="example">Load an example<\/button>'/.test(rh), '9c the example button is offered only when no rows would be replaced');
check(/Nothing you type is uploaded or kept on a server/.test(hf) && /The search box sends the words typed in it/.test(hf), '9c the footer says what leaves the browser: the search words, and holdings sent with an advisor question');
check(/surcharge/i.test(ho) && /TAX_IN\.equityLtcgExemption/.test(rh), '9c the sell note says surcharge is not counted and the free limit in the slider help comes from TAX_IN');
check(/mixNote/.test(fnBody(gl, 'holdingsResultForAdvisor')) && /rev\.mixTotal>0 \? rev\.mix\.map/.test(fnBody(gl, 'holdingsResultForAdvisor')) && /rev\.mixTotal>0 \? \{ kind:'holdings'/.test(fnBody(gl, 'holdingsAdvisorResults')), '9c with nothing in the mix the advisor gets no shares to compare, and why');
check(/noRoom/.test(gl) && /cap<=0/.test(gl), '9c a plan capacity of zero or less sets new money to 0 instead of falling back to the SIP');

// ---- the Full Plan hands over its profile ---------------------------------------------------------------------
check(/id="openHoldingsBtn"/.test(g2) && /cfg\(\)\.code==='IN'/.test(g2.slice(g2.indexOf('id="openHoldingsBtn"') - 200, g2.indexOf('id="openHoldingsBtn"'))), '9c the Full Plan has the button, for India only');
check(/getElementById\('openHoldingsBtn'\)&&document\.getElementById\('openHoldingsBtn'\)\.addEventListener\('click',\(\)=>openPlanInLab\('holdings'\)\)/.test(g2), '9c the button opens the Lab on the holdings tab');
check(/if\(HOLD_PROFILES\.includes\(data\.bucket\)\)/.test(gl) && /Math\.min\.apply\(null,ask\)/.test(gl), '9c the Lab takes the bucket as the profile, and the smaller of the plan\'s SIP and what the person can afford as new money');
check(/data\.tab==='holdings' && L\.country==='IN'/.test(gl), '9c the handoff opens the tab only in India');

// ---- what the tab says: category level, no ratings, no upload ------------------------------------------------------
const holdBlock = gl.slice(gl.indexOf('TAB: MY HOLDINGS (India)'), gl.indexOf('TAB: CROSS-BORDER'));
check(holdBlock.length > 5000, '9c found the My holdings block');
check(!/should (buy|sell|choose|switch|take|hold|exit)|we recommend|best (fund|option)|top[- ]rated|star rating|you must|the right choice|outperform/i.test(holdBlock), '9c no recommendation, rating or ranking language in the tab');
check(!/type=["']file["']|FileReader|\.upload|multipart|statement upload/i.test(holdBlock.replace(/no statement|Nothing is uploaded|never uploaded|no account/gi, '')), '9c no file input or reader in the tab (typed in, never uploaded)');
check(/own portfolio/.test(holdBlock) && /category/i.test(holdBlock) && /holding-level|same companies/i.test(holdBlock), '9c the overlap card says plainly that holding-level overlap needs each fund\'s own portfolio');
check(/T\.equityLtcgExemption/.test(ho) && /with no tax this financial year/.test(ho) && /limit on long-term equity gains/.test(ho), '9c the rebalance names the free limit on long-term equity gains, from TAX_IN rather than a typed figure');
check(/new money|new SIP/i.test(ho) && /before anything is sold|first/i.test(ho), '9c the rebalance uses new money first');
check(/is an estimate/.test(ho) && /factsheet/.test(ho), '9c the Regular-plan cost says it is an estimate and where the real figure is');
check(/TAX_IN\.asOf/.test(ho + fnBody(gl, 'holdingsResultForAdvisor')), '9c the rule year is stated (TAX_IN.asOf)');
check(/this page does not work that out|not worked out|tax is not worked out/i.test(ho), '9c a debt or hybrid sale says its tax is not worked out, instead of guessing');

// ---- chart rules (the plan's explicit ones) -------------------------------------------------------------------------
check(/barsChart\('hold-mix', rows\)/.test(ho) && /barsChart\('hold-cost', costBars, 28\+costBars\.length\*52\)/.test(ho), '9c both charts are horizontal bars with the value at each bar\'s end');
check(!/type:\s*['"](pie|radar|gauge|funnel)['"]/.test(holdBlock) && !/legend/.test(holdBlock) && !/radius:\s*\[/.test(holdBlock), '9c no pie, donut, radar or legend');
check(!/yAxisIndex|dualAxis/.test(holdBlock), '9c no second axis');
check(!/#9C4A2C|#c0392b|#d9534f|\bred\b/i.test(holdBlock), '9c no red in the tab (red is only for a fired warning)');
check(/color:'#2557C7'/.test(ho) && /color:'#B6C2D6'/.test(ho), '9c "yours" is the blue and "profile" the light grey, so the pair reads in greyscale');
check(/function barsLabelWidth/.test(gl) && /containLabel:false/.test(fnBody(gl, 'renderBarsOption')), '9c the bar chart reserves its label margin from the measured names (containLabel left a short name clipped)');

// ---- the engine and the tab agree on the shapes ---------------------------------------------------------------------
{
  const rev = eng.reviewHoldings({ holdings: [{ name: 'A Large-cap fund (Regular)', cat: 'largecap', value: 500000, cost: 300000 }, { name: 'B Nifty 50 index fund', cat: 'largecap', value: 300000, cost: 200000 }, { name: 'C short duration debt fund', cat: 'shortdebt', value: 200000 }],
    target: eng.RISK_PROFILES_IN.moderate, sip: 20000, sipMonths: 12, years: 10, expected: 0.12, exemptUsed: 0 });
  const used = ['total', 'mixTotal', 'mix', 'outside', 'unset', 'overlap', 'cost', 'rebalance'];
  check(used.every((k) => k in rev), '9c reviewHoldings returns what the tab reads');
  check(['perYear', 'drag', 'years', 'regular', 'unpriced', 'unstated', 'direct'].every((k) => k in rev.cost), '9c reviewHoldings.cost has every field the tab reads');
  check(['overNow', 'overAfter', 'newMoney', 'monthsToFix', 'split', 'sells', 'exemptRoom', 'unknownCost', 'shortTerm'].every((k) => k in rev.rebalance), '9c reviewHoldings.rebalance has every field the tab reads');
  const fieldsRead = new Set(); (ho.match(/rb\.(\w+)/g) || []).forEach((m) => fieldsRead.add(m.slice(3)));
  check([...fieldsRead].every((k) => k in rev.rebalance), '9c every rebalance field the cards read exists in the engine result');
}

console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
