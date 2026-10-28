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

console.log(fail ? '\n' + fail + ' FAILED' : '\nall passed');
process.exit(fail ? 1 : 0);
