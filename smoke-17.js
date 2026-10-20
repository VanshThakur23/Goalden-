// smoke-17.js — Group 6 structural checks: the Quick Calculate "keep my place"
// fix and the Lab's "At a glance" verdicts, period pills, overlap nudges and
// scrub readouts. Regex-on-file-contents style, same conventions as smoke-09..13.
// Run with: node smoke-17.js
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

// 1. Engine: rolling returns and the bumpiness figure live in the shared engine
check(/function rollingReturns\(/.test(engine), 'engine: rollingReturns defined');
check(/function annualisedVol\(/.test(engine), 'engine: annualisedVol defined');
check(/rollingReturns, annualisedVol/.test(engine), 'engine: both exported');
check(/separate:Math\.floor\(spanYears\/years/.test(engine), 'engine: rolling stretches report how many do not overlap');

// 2. Quick Calculate: switching a retirement what-if keeps the reader in place
check(/function retireWhatIf\(/.test(g1) && /function restoreResultPlace\(/.test(g1), 'goalden.html: what-if place-keeping helpers defined');
check(/role="button"[^>]*tabindex="0"|tabindex="0"[^>]*role="button"/.test(g1), 'goalden.html: what-if rows are keyboard-reachable buttons');

// 3. Lab: every piece exists and is wired into the live screen
for (const fn of ['liveNudgesHTML', 'liveRangePillsHTML', 'liveVerdictHTML', 'renderLiveRollingChart', 'wireLabScrub', 'liveKindOf', 'liveRegularGap', 'liveFullWindowMixRet']) {
  check(new RegExp('function ' + fn + '\\(').test(gl), `goalden-lab.html: ${fn} defined`);
}
check(/const LIVE_RANGES=\[\{id:'1'[^\]]*\{id:'max'/.test(gl), 'goalden-lab.html: period pills run 1Y, 3Y, 5Y, 10Y, Max');
check(/liveRangePillsHTML\(ready\) \+ liveVerdictHTML\(/.test(gl.replace(/\s+/g, ' ')) || /liveRangePillsHTML\(ready\)\s*\+\s*liveVerdictHTML\(/.test(gl), 'goalden-lab.html: the verdict card sits directly under the pills');
check(/data-live-range/.test(gl), 'goalden-lab.html: pills carry a data-live-range handler hook');
check(/live\.verdicts = L\.live\._verdict && L\.live\._verdict\.sig === nowSig/.test(gl), 'goalden-lab.html: the advisor sees the verdicts, and only when they match the mix on screen');

// 4. The rolling-stretches chart follows the chart rules
const roll = fnBody(gl, 'renderLiveRollingChart');
check(roll.length > 200, 'goalden-lab.html: renderLiveRollingChart body found');
check(!/legend\s*:/.test(roll), 'rolling chart: no legend (lines are labelled at their ends)');
check(!/type:\s*'pie'|type:\s*'radar'/.test(gl), 'goalden-lab.html: no pie or radar charts');
check(/yAxis:\{type:'value'/.test(roll) && !/yAxisIndex/.test(roll), 'rolling chart: one value axis, no dual axis');
check(/k===lowAt \|\| k===highAt/.test(roll), 'rolling chart: the lowest and highest stretches are always plotted (the tags quote their true values)');
check(/dashed|type:\[6,4\]/.test(roll), 'rolling chart: the index line differs by dash as well as colour (reads in greyscale)');

// 5. Nudges: pair-only, no note for tickers the lists do not know
const nud = fnBody(gl, 'liveKindOf');
check(/'unknown'/.test(nud), "goalden-lab.html: liveKindOf has an 'unknown' answer, which draws no note");

// 6. Review fixes: the verdict words must not claim more than the data shows
const ver = fnBody(gl, 'liveVerdictHTML');
check(!/Never lost money|Rarely lost money|Often lost money/.test(ver), 'verdict: no absolute "never lost money" wording (a stretch can end up and still have fallen on the way)');
check(/Up in every \$\{Y\}-year stretch/.test(ver) && /'Too short to call'/.test(ver), 'verdict: the consistency word names its horizon and admits a thin history');
check(/shown\.separate<3 \? 'Too short to call'/.test(ver), 'verdict: fewer than three separate stretches is "Too short to call"');
check(/liveWeeklyIdx\(g\.dates\)/.test(ver) && /twoMarkets/.test(ver), 'verdict: a mix across two markets is measured on weekly moves');
check(!/Shares carry no fund fee/.test(ver.replace(/\}else\{\s*cost=\{word:'No fund fee'[^;]*;\s*\}/, '')), 'verdict: "no fund fee" is only the last fallback');
check(/unknownItems\.length\)\{/.test(ver) && /indexItems\.length\)\{/.test(ver), 'verdict: unknown tickers and indices never get "no fund fee"');
check(/advisorAttr\(liveShortName\(it\)\)/.test(ver), 'verdict: fund names are escaped before they reach markup');
// closed accordion panels are out of the tab order
check(/\.explain-panel\{max-height:0;overflow:hidden;visibility:hidden/.test(gl), 'goalden-lab.html: a closed panel is visibility:hidden (not tabbable)');
check(/\.assump-panel\{max-height:0;overflow:hidden;visibility:hidden/.test(g1), 'goalden.html: a closed detail panel is visibility:hidden (not tabbable)');

process.exit(fail ? 1 : 0);
