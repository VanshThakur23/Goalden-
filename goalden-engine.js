/* =====================================================================
   goalden-engine.js — the shared financial math, extracted from the three
   door files (Phase 1). Loaded as a plain <script src="goalden-engine.js">
   BEFORE each page's inline script (same pattern as advisor.js — no build
   step, no bundler, no ES modules).

   Two contexts:
     - Browser: a classic script; the functions below become globals that
       the page's inline script calls directly.
     - Node:     engine.test.js requires this file; the module.exports shim
       at the bottom exposes the functions. It is guarded by typeof module,
       so the browser <script> usage is completely unaffected.

   Every function here is pure — nothing reads a page global (S/G/L, C).
   The market helpers used to read S.country / G.country directly; they now
   take `country` as an explicit parameter so the same code drives Door 1
   and Door 2.

   Tested by engine.test.js (node --test) against solved workbooks.
   ===================================================================== */
'use strict';

/* ---------------------------------------------------------------------
   Core time-value-of-money primitives
   --------------------------------------------------------------------- */
function inflateExpense(amt, phases, factor) {
  if (factor === undefined) factor = 1;
  for (const p of phases) amt *= Math.pow(1 + p.rate, p.years);
  return amt * factor;
}

function realRate(r, i) { return (1 + r) / (1 + i) - 1; }

function corpusRequired(rate, years, withdrawal, due) {
  if (rate === 0) return withdrawal * years;
  let pv = withdrawal * (1 - Math.pow(1 + rate, -years)) / rate;
  return due ? pv * (1 + rate) : pv;
}

function solveSIP(rate, periods, fv, due) {
  if (rate === 0) return fv / periods;
  let f = (Math.pow(1 + rate, periods) - 1) / rate;
  return fv / (due ? f * (1 + rate) : f);
}

function effectiveMonthlyRate(r) { return Math.pow(1 + r, 1/12) - 1; }

/* ---------------------------------------------------------------------
   Accumulation schedule — the reconciled superset signature.

   The three pages had drifted into three signatures:
     - goalden.html:    loops opts.years, returns {period, closeBal, contributed}
     - goalden-door2:   loops o.years, returns {period, closeBal} (no contributed)
     - goalden-lab:     loops o.periods, adds step-up logic
   This superset:
     - loops `o.periods` (goalden.html + door2 used to call the key `years`;
       their callers pass months and were updated to `periods`),
     - returns `contributed` on every row,
     - supports `o.stepUp` (annual SIP step-up; 0 = flat SIP).
   Callers that don't step up pass stepUp: 0 (or omit it — defaults to 0)
   and get output identical to before the reconciliation.
   --------------------------------------------------------------------- */
function accumulationSchedule(o) {
  const rows = [];
  let bal = o.opening || 0;
  let contrib = o.sip;
  let total = 0;
  for (let i = 1; i <= o.periods; i++) {
    let close;
    if (o.due) { const b2 = bal + contrib; close = b2 * (1 + o.rate); }
    else { close = bal * (1 + o.rate) + contrib; }
    total += contrib;
    rows.push({ period: i, closeBal: close, contributed: total });
    bal = close;
    contrib *= (1 + (o.stepUp || 0));
  }
  return { rows, finalBalance: bal };
}

/* =====================================================================
   REAL HISTORICAL MARKET DATA
   Sensex: fiscal-year (April-to-April) annual returns, FY1979-80 through
   FY2022-23, 44 real data points. Source: freefincal.com's compilation of
   Sensex closing values, itself built from BSE data (values before 1992
   are BSE's own re-based figures). This is price return; Sensex dividend
   yield has historically been small (1-2%), so total return would run
   slightly higher than what is shown here, not lower.
   S&P 500: calendar-year returns, 1928-2024, 97 real data points.
   1928-2015 is price return (S&P 500 price index, no dividends), sourced
   from a compilation of Cowles Commission / S&P historical data.
   2016-2024 is total return (dividends reinvested), sourced from
   Macrotrends S&P 500 total-return series. The methodology genuinely
   differs at that seam; both halves are real, reported figures, not
   smoothed or blended to hide the join.
   Neither series is fabricated or estimated. Both stop at real, cited
   years rather than being extended with a guess for "this year so far."
   ===================================================================== */
const SENSEX_ANNUAL_RETURNS = [
  {y:1980,r:0.0350},{y:1981,r:0.3525},{y:1982,r:0.2712},{y:1983,r:-0.0376},
  {y:1984,r:0.1606},{y:1985,r:0.4239},{y:1986,r:0.5957},{y:1987,r:-0.0895},
  {y:1988,r:-0.2221},{y:1989,r:0.8226},{y:1990,r:0.0816},{y:1991,r:0.5245},
  {y:1992,r:2.6761},{y:1993,r:-0.4732},{y:1994,r:0.6357},{y:1995,r:-0.1228},
  {y:1996,r:0.0281},{y:1997,r:0.0051},{y:1998,r:0.1583},{y:1999,r:-0.0714},
  {y:2000,r:0.3707},{y:2001,r:-0.2942},{y:2002,r:-0.0185},{y:2003,r:-0.1198},
  {y:2004,r:0.8633},{y:2005,r:0.1505},{y:2006,r:0.7508},{y:2007,r:0.0770},
  {y:2008,r:0.2546},{y:2009,r:-0.3663},{y:2010,r:0.7868},{y:2011,r:0.0977},
  {y:2012,r:-0.1000},{y:2013,r:0.0793},{y:2014,r:0.1899},{y:2015,r:0.2590},
  {y:2016,r:-0.1058},{y:2017,r:0.1836},{y:2018,r:0.1118},{y:2019,r:0.1689},
  {y:2020,r:-0.2729},{y:2021,r:0.7700},{y:2022,r:0.1800},{y:2023,r:-0.0048},
];
const SP500_ANNUAL_RETURNS = [
  {y:1928,r:0.4381},{y:1929,r:-0.0830},{y:1930,r:-0.2512},{y:1931,r:-0.4384},
  {y:1932,r:-0.0864},{y:1933,r:0.4998},{y:1934,r:-0.0119},{y:1935,r:0.4674},
  {y:1936,r:0.3194},{y:1937,r:-0.3534},{y:1938,r:0.2928},{y:1939,r:-0.0110},
  {y:1940,r:-0.1067},{y:1941,r:-0.1277},{y:1942,r:0.1917},{y:1943,r:0.2506},
  {y:1944,r:0.1903},{y:1945,r:0.3582},{y:1946,r:-0.0843},{y:1947,r:0.0520},
  {y:1948,r:0.0570},{y:1949,r:0.1830},{y:1950,r:0.3081},{y:1951,r:0.2368},
  {y:1952,r:0.1815},{y:1953,r:-0.0121},{y:1954,r:0.5256},{y:1955,r:0.3260},
  {y:1956,r:0.0744},{y:1957,r:-0.1046},{y:1958,r:0.4372},{y:1959,r:0.1206},
  {y:1960,r:0.0034},{y:1961,r:0.2664},{y:1962,r:-0.0881},{y:1963,r:0.2261},
  {y:1964,r:0.1642},{y:1965,r:0.1240},{y:1966,r:-0.0997},{y:1967,r:0.2380},
  {y:1968,r:0.1081},{y:1969,r:-0.0824},{y:1970,r:0.0356},{y:1971,r:0.1422},
  {y:1972,r:0.1876},{y:1973,r:-0.1431},{y:1974,r:-0.2590},{y:1975,r:0.3700},
  {y:1976,r:0.2383},{y:1977,r:-0.0698},{y:1978,r:0.0651},{y:1979,r:0.1852},
  {y:1980,r:0.3174},{y:1981,r:-0.0470},{y:1982,r:0.2042},{y:1983,r:0.2234},
  {y:1984,r:0.0615},{y:1985,r:0.3124},{y:1986,r:0.1849},{y:1987,r:0.0581},
  {y:1988,r:0.1654},{y:1989,r:0.3148},{y:1990,r:-0.0306},{y:1991,r:0.3023},
  {y:1992,r:0.0749},{y:1993,r:0.0997},{y:1994,r:0.0133},{y:1995,r:0.3720},
  {y:1996,r:0.2268},{y:1997,r:0.3310},{y:1998,r:0.2834},{y:1999,r:0.2089},
  {y:2000,r:-0.0903},{y:2001,r:-0.1185},{y:2002,r:-0.2197},{y:2003,r:0.2836},
  {y:2004,r:0.1074},{y:2005,r:0.0483},{y:2006,r:0.1561},{y:2007,r:0.0548},
  {y:2008,r:-0.3655},{y:2009,r:0.2594},{y:2010,r:0.1482},{y:2011,r:0.0210},
  {y:2012,r:0.1589},{y:2013,r:0.3215},{y:2014,r:0.1352},{y:2015,r:0.0136},
  {y:2016,r:0.0954},{y:2017,r:0.1942},{y:2018,r:-0.0624},{y:2019,r:0.2888},
  {y:2020,r:0.1626},{y:2021,r:0.2689},{y:2022,r:-0.1944},{y:2023,r:0.2423},
  {y:2024,r:0.2331},
];

// Helper functions used across "The Case" module.
function marketSeries(country) { return country === 'US' ? SP500_ANNUAL_RETURNS : SENSEX_ANNUAL_RETURNS; }
function marketName(country) { return country === 'US' ? 'S&P 500' : 'Sensex'; }
// Growth path of a lump sum through a specific slice of the real return
// series, starting at index `startIdx` for `years` years.
// Constant-rate compounding path (for gold/FD in the race chart, which
// use a single illustrative rate rather than a year-by-year series).
function compoundPath(rate, years, startAmount, startYear){
  const path=[{y:startYear, v:startAmount}];
  let bal=startAmount;
  for(let i=1;i<=years;i++){ bal*=(1+rate); path.push({y:startYear+i, v:bal}); }
  return path;
}
function marketGrowthPath(series, startIdx, years, startAmount){
  const path=[{y:series[startIdx].y-1, v:startAmount}];
  let bal=startAmount;
  for(let i=startIdx;i<startIdx+years && i<series.length;i++){
    bal*=(1+series[i].r);
    path.push({y:series[i].y, v:bal});
  }
  return path;
}
// Every real N-year window in the series: start year, CAGR, and whether
// it ended above water. This is what "how often does N years lose money"
// and "what does the worst N-year start look like" both draw from.
function rollingWindows(series, years){
  const out=[];
  for(let i=0;i+years<=series.length;i++){
    let bal=1;
    for(let j=i;j<i+years;j++) bal*=(1+series[j].r);
    out.push({startYear:series[i].y, startIdx:i, cagr:Math.pow(bal,1/years)-1, finalMultiple:bal});
  }
  return out;
}
function worstWindow(series, years){
  const w=rollingWindows(series, years);
  return w.reduce((worst,cur)=>cur.cagr<worst.cagr?cur:worst, w[0]);
}
function bestWindow(series, years){
  const w=rollingWindows(series, years);
  return w.reduce((best,cur)=>cur.cagr>best.cagr?cur:best, w[0]);
}

/* ---------------------------------------------------------------------
   Node compatibility shim — makes this file require()-able for
   engine.test.js. In the browser `module` is undefined, so this branch is
   never taken and the plain <script> usage is unaffected.
   --------------------------------------------------------------------- */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    inflateExpense, realRate, corpusRequired, solveSIP, effectiveMonthlyRate,
    accumulationSchedule,
    marketSeries, marketName, compoundPath, marketGrowthPath,
    rollingWindows, worstWindow, bestWindow,
    SENSEX_ANNUAL_RETURNS, SP500_ANNUAL_RETURNS,
  };
}
