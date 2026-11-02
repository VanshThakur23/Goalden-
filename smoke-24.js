// smoke-24.js — Group 9e checks: "you against the index", starting with the Test Real Investments growth chart.
// Regex-on-file-contents style, same conventions as smoke-09..23.
// Run with: node smoke-24.js
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
const gl = read('goalden-lab.html');

const fnBody = (src, name) => {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) return '';
  const j = src.indexOf('\nfunction ', i + 10);
  return src.slice(i, j < 0 ? undefined : j);
};

// ---- the growth chart says, in money, what the plain index fund would have given --------------------------------
const card = fnBody(gl, 'liveGrowthCardHTML'), chart = fnBody(gl, 'renderLiveGrowthChart');
check(/benchHead=`<p class="lg-head">/.test(card) && /\$\{benchHead\}\s*<div class="scrub-readout" id="live-growth-echart-ro"/.test(card), '9e the mix-vs-index sentence sits above the chart');
check(/missed out on \$\{c\.compact\(Math\.abs\(diff\)\)\}/.test(card) && /ahead<\/b> of the index fund/.test(card), '9e it says "ahead" or "missed out on", in words');
check(/id="live-growth-echart" class="echart" style="height:500px"/.test(card), '9e the chart is taller (500px, was 380px)');
check(/\.lg-head\{[^}]*font-size:16px/.test(gl), '9e the sentence is set larger than the captions');
check(/name:'__gapBase'[\s\S]{0,200}stack:'gap'/.test(chart) && /name:'__gap'[\s\S]{0,300}areaStyle:\{color:'rgba\(37,87,199,\.13\)'\}/.test(chart), '9e the gap between mix and index is a shaded band (one light blue, never red/green)');
check(/arr\.filter\(p=>p\.seriesName\.indexOf\('__'\)!==0\)/.test(chart), '9e the band series stay out of the tooltip');
check(/lineStyle:\{width:3\.2, color:'#2557C7'\}/.test(chart) && /lineStyle:\{width:2\.4, color:CHART_TEXT\.ink, type:\[14,5\]\}/.test(chart), '9e mix (solid) and index (long dash) are the two heavy lines, told apart in greyscale');
check(/opacity:\.6\}/.test(chart) && /formatter:\(\)=>liveShortName\(it\), color:CHART_TEXT\.muted/.test(chart), '9e the instruments are faded context, labelled by name only');
check(/if\(isBench\(it\)\) return;/.test(chart), '9e an index fund that is in the mix is drawn once, as the index');
check(/\['Mix vs index', /.test(chart), '9e the readout gives the gap at every week');
check(/legend:\{show:false\}/.test(chart) && !/#C0392B|#E74C3C|\bred\b/i.test(chart), '9e no legend (direct labels) and no red');
check(/const tiny=!!dom && dom\.clientWidth<360;/.test(chart) && /\(tiny\?'Index':name\)/.test(chart), '9e on a phone the index label shortens so the plot keeps its width');
check(/showMinLabel:false/.test(chart), '9e the y-axis floor (not a round number) has no label');

// ---- the statement (CAS) reader in My holdings -------------------------------------------------------------------
const fs2 = require('fs');
check(fs2.existsSync(path.join(root, 'vendor/pdfjs/pdf.min.js')) && fs2.existsSync(path.join(root, 'vendor/pdfjs/pdf.worker.min.js')) && fs2.existsSync(path.join(root, 'vendor/pdfjs/LICENSE')), '9e pdf.js is vendored with its licence (no CDN)');
check(!/<script[^>]+pdf\.min\.js/.test(gl) && /sc\.src='vendor\/pdfjs\/pdf\.min\.js'/.test(fnBody(gl, 'holdLoadPdfJs')), '9e pdf.js loads only when a statement is read, not with the page');
const rd = fnBody(gl, 'holdReadStatement');
check(/isEvalSupported:false/.test(rd), '9e pdf.js never compiles code from a font in the file (CVE-2024-4367)');
check(/PasswordException/.test(rd) && /e\.code===2/.test(rd), '9e a locked file and a wrong password each say what to do');
// The one fetch in the reader loads the made-up sample from this site; nothing sends the chosen file or what is read from it.
check((rd.match(/fetch\(/g) || []).length === 1 && /fetch\(HOLD_STMT_SAMPLE\.path\)/.test(rd) && !/XMLHttpRequest|localStorage|sessionStorage|FormData/.test(rd + fnBody(gl, 'holdStmtApply')), '9e the file and what is read from it are not sent or stored');
check(/<input type="password" id="stmtPw" autocomplete="off"/.test(fnBody(gl, 'holdStmtPanelHTML')) && !/stmtPw[^>]*value=/.test(fnBody(gl, 'holdStmtPanelHTML')), '9e the password box is always drawn empty');
check(/markGiven\('holdings\.rows', !sample\)/.test(fnBody(gl, 'holdStmtApply')), '9e holdings read from a statement are the person\'s own (the yearly review uses them); the made-up sample\'s are not');
check(/HOLD_MAX-1/.test(fnBody(gl, 'holdStmtApply')), '9e more holdings than the list holds are pooled into one row, and said');
check(/matchesStated/.test(fnBody(gl, 'holdStmtPanelHTML')), '9e the reader says whether its total matches the one printed on the statement');
check(/return holdVsIndexHTML\(R\)\+stats/.test(fnBody(gl, 'holdingsOutputHTML')), '9e "You against the index" leads the results');
const vs = fnBody(gl, 'holdVsIndexHTML');
check(/behind<\/b> it: that is what these funds have cost you against it so far/.test(vs) && /ahead<\/b> of it/.test(vs), '9e the gap is said in rupees and in words');
check(/You took out \$\{K\(v\.invested\)\} more than you put in/.test(vs) && /net of what you took out/.test(vs), '9e more taken out than put in is said that way round');
check(/before tax and exit loads/.test(vs) && /d\.eq\.incomplete/.test(vs), '9e it says both sides are before tax, and names funds left out for an incomplete history');
check(/under a year/.test(vs) && /const yr=f=>/.test(vs), '9e no yearly rate is shown for under a year');
check(/Small- and mid-cap funds are set against the Nifty 50 as well/.test(vs) && /Left out: /.test(vs), '9e it says what it compares against and what it leaves out');
check(/againstIndex:holdVsIndexForAdvisor\(\)/.test(gl) && /you cannot open files/.test(gl), '9e the advisor can read the comparison and knows the user reads the statement themselves');
check(fs2.existsSync(path.join(root, 'test-statements/synthetic-cams-detailed.pdf')) && fs2.existsSync(path.join(root, 'test-statements/synthetic-nsdl.pdf')), '9e synthetic test statements are in the repo');

// ---- risk against the index, and the hand-off to the efficient frontier ----------------------------------------------
const wk = read('src/worker.js'), py = read('local_server.py');
check(/risk:statementRisk\(s\.navs, b\.prices\)/.test(fnBody(gl, 'holdVsIndexData')), '9e risk is measured from the statement\'s own prices against the index on the same days');
const rk = fnBody(gl, 'holdRiskHTML');
check(/more ups and downs for less return/.test(rk) && /Up and to the left is better/.test(rk) && /Not measured/.test(rk), '9e the risk section leads with a sentence and says what was not measured');
const rc = fnBody(gl, 'renderVsRiskChart');
check(/legend:\{ show:false \}/.test(rc) && /formatter:'Index'/.test(rc) && /formatter:'Fund'/.test(rc) && !/#C0392B|#E74C3C|\bred\b/i.test(rc), '9e risk panels: direct labels, no legend, no red');
check(/one small panel per fund/i.test(gl) && /interval:5/.test(rc), '9e one panel per fund on shared, round scales');
check(/if \(url\.pathname === '\/api\/isin'\)/.test(wk) && /parsed\.path == '\/api\/isin'/.test(py), '9e /api/isin exists in the Worker and the local server');
check(/portal\.amfiindia\.com\/spages\/NAVAll\.txt/.test(wk) && /portal\.amfiindia\.com\/spages\/NAVAll\.txt/.test(py), '9e both read AMFI\'s own scheme list');
check(/\.split\(\/\\r\?\\n\/\)/.test(wk), '9e the Worker splits the list on line breaks (a real regex, not a stray character)');
check(/\.slice\(0, 40\)/.test(wk) && /\[:40\]/.test(py), '9e at most 40 ISINs per lookup');
const lv = fnBody(gl, 'holdOpenInLive');
check(/\/api\/isin\?codes='\+rows\.map\(x=>x\.isin\)\.join\(','\)/.test(lv) && !/value|name/.test((lv.match(/liveApiGet\([^)]*\)/) || [''])[0]), '9e only ISIN codes are sent for the lookup, never amounts or names');
check(/L\.live\.selectedWeights=w/.test(lv) && /L\.live\.weight=Math\.round\(w\[0\]\*100\)/.test(lv) && /L\.tab='livefrontier'/.test(lv), '9e the funds open at the weights they are held in');
check(/found\.length<2/.test(lv), '9e fewer than two funds found says so instead of opening a one-fund mix');

// ---- the path from a statement to the frontier is explained where people are -------------------------------------
check(/<ol class="stmt-steps">/.test(fnBody(gl, 'holdStmtPanelHTML')) && (fnBody(gl, 'holdStmtPanelHTML').match(/<li><b>/g) || []).length === 4, '9e the side panel explains the statement in four numbered steps');
check(/class="stmt-flow"/.test(fnBody(gl, 'holdingsOutputHTML')) && /data-hd="stmtSample"/.test(fnBody(gl, 'holdingsOutputHTML')), '9e an empty My holdings shows the path from statement to frontier, with the sample to try');
check(/read from your CAS statement/.test(gl) && /Read your CAS statement in My holdings/.test(read('index.html')), '9e the tools list and the landing page say the statement can be read');
const fs3 = fnBody(gl, 'liveFromStatementHTML');
check(/From your statement\./.test(fs3) && /data-tab-switch="holdings"/.test(fs3) && /L\.live\.fromStatement=null/.test(fs3), '9e Test Real Investments says the funds came from the statement, links back, and drops the note once the mix is changed');
check(/L\.live\.fromStatement=\{ keys:/.test(fnBody(gl, 'holdOpenInLive')), '9e the hand-off records which funds came from the statement');

console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
