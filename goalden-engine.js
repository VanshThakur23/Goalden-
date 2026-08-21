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

/* =====================================================================
   REAL-INSTRUMENT PORTFOLIO MATH — ported verbatim from goalden-lab.html
   (Phase 10) so Door 1/2 can run a 2-asset real-stock comparison without
   going to the Lab. These are page-global-free (pure) on purpose: the
   Lab's copies stay in the Lab untouched — this is additive duplication,
   a deliberate tradeoff to avoid any risk to the Lab's working code.
   ===================================================================== */

function computeDailyReturns(prices){
  const rets=[];
  for(let i=1;i<prices.length;i++){
    const p0=prices[i-1].close, p1=prices[i].close;
    if(p0>0) rets.push({date:prices[i].date, r:(p1-p0)/p0});
  }
  return rets;
}
// Audits a fetched price series for the kinds of defects that can
// silently poison mean/stdev before any of it reaches a chart or a
// Sharpe ratio — an unadjusted stock split, a NAV that's pinned/stale,
// a single bad print, too little history. Per this project's
// no-fabricated-data rule, a flagged series is never repaired, clipped
// or smoothed here: it's only labelled.
function auditPriceSeries(prices, rets, spanYears, annualReturn, annualVol, geoAnnual, hasCatastrophicLoss, isFund){
  const flags=[];
  let level='ok';
  const bump=(lvl,code,msg,detail)=>{
    flags.push({code, msg, detail});
    if(lvl==='unusable') level='unusable';
    else if(lvl==='caution' && level==='ok') level='caution';
  };

  const n=rets.length;
  if(n<60) bump('unusable','SHORT',`Only ${n} usable daily observations — too few to trust.`);

  const badPrices=prices.filter(p=>!(p.close>0)||!isFinite(p.close));
  if(badPrices.length>0){
    const frac=badPrices.length/prices.length;
    bump(frac>0.01?'unusable':'caution','BADPRICE',`${badPrices.length} price point(s) were zero, negative or missing.`);
  }

  if(spanYears<1) bump('caution','SPAN','Less than a year of history — the annualised figures are a thin extrapolation.');

  let maxGapDays=0;
  for(let i=1;i<prices.length;i++){
    const gap=(new Date(prices[i].date)-new Date(prices[i-1].date))/86400000;
    if(gap>maxGapDays) maxGapDays=gap;
  }
  if(maxGapDays>30) bump('caution','GAP',`A ${Math.round(maxGapDays)}-day gap in the price history — something didn't trade or wasn't reported for a while.`);

  // NSE circuit limits cap most single-day equity moves at 20%, so a
  // >35% one-day move is almost always a corporate action or a bad
  // print, not real trading. Funds get a tighter 10% bar: a NAV jump
  // that size usually means a segregated-portfolio side-pocket event or
  // a stale-then-corrected NAV, not a real one-day market move.
  const jumpThreshold = isFund ? 0.10 : 0.35;
  let worstJump=null;
  rets.forEach(x=>{ if(!worstJump || Math.abs(x.r)>Math.abs(worstJump.r)) worstJump=x; });
  if(worstJump && Math.abs(worstJump.r)>jumpThreshold){
    bump('caution','JUMP',`A single-day move of ${(worstJump.r*100).toFixed(0)}% on ${worstJump.date} — consistent with a corporate action, a very illiquid/thinly-traded stock, or a bad print. Worth a second look before trusting it.`,worstJump);
    // Does that jump look like an unadjusted split or bonus issue? A
    // ~(1/k - 1) or ~(k - 1) move for a small integer k is the classic
    // signature of a k:1 split/bonus the price history wasn't rebased for.
    for(const k of [2,3,4,5,10]){
      const splitDown=1/k-1, splitUp=k-1;
      if(Math.abs(worstJump.r-splitDown)<0.03*Math.abs(splitDown) || Math.abs(worstJump.r-splitUp)<0.03*splitUp){
        bump('caution','SPLITSIG',`Looks like an unadjusted ${k}:1 split or bonus issue on ${worstJump.date}, not a genuine one-day move.`);
        break;
      }
    }
  }

  const zeroDays=rets.filter(x=>x.r===0).length;
  if(rets.length>0 && zeroDays/rets.length>0.30) bump('caution','STALE',`${Math.round(zeroDays/rets.length*100)}% of days show exactly no price change — this barely moves, so its risk figure will look unrealistically low.`);

  if(hasCatastrophicLoss) bump('unusable','IMPLAUSIBLE','A single-day move to zero or below in this series — the compounded return cannot be computed.');
  else{
    if(annualReturn>1.00 || annualVol>1.50) bump('unusable','IMPLAUSIBLE',`${(annualReturn*100).toFixed(0)}% expected return / ${(annualVol*100).toFixed(0)}% risk — this fetched price history can't be independently re-verified here, so this may be a genuine (if extremely illiquid) instrument rather than a data error. Either way, at this magnitude the mean-variance math this app runs would be meaningless, so it's excluded by default.`);
    else if(annualReturn>0.60 || annualVol>0.80) bump('caution','WILD',`${(annualReturn*100).toFixed(0)}% expected return / ${(annualVol*100).toFixed(0)}% risk — unusually extreme; worth a second look before trusting it.`);
    if(geoAnnual!=null && Math.sign(annualReturn)!==Math.sign(geoAnnual) && annualReturn!==0 && geoAnnual!==0){
      bump('caution','SIGNFLIP',`The average daily move was ${annualReturn>0?'positive':'negative'}, but compounded over the full window this was ${geoAnnual>0?'a net gain':'a net loss'} — see the note below.`);
    }
  }

  return {level, flags};
}
function computeReturnStats(prices, isFund){
  const rets=computeDailyReturns(prices);
  const n=rets.length;
  const mean=rets.reduce((s,x)=>s+x.r,0)/n;
  const variance=rets.reduce((s,x)=>s+(x.r-mean)*(x.r-mean),0)/n; // population, matches STDEV.P
  const sd=Math.sqrt(variance);
  const first=new Date(prices[0].date), last=new Date(prices[prices.length-1].date);
  const spanYears=Math.max(0.05, (last-first)/(365.25*24*3600*1000));
  const tradingDaysPerYear=n/spanYears;
  // The optimiser keeps this arithmetic figure -- it's the only kind of
  // return that's linearly combinable across assets, which mean-variance
  // math requires, and it matches this project's coursework convention.
  // It is NOT what an investor who held the whole period actually earned
  // -- see geoAnnual/cagr below for that.
  const annualReturn=Math.pow(1+mean, tradingDaysPerYear)-1;
  const annualVol=sd*Math.sqrt(tradingDaysPerYear);

  // Compounded return: what holding this the entire window actually
  // turned into. A single day where price falls to (near) zero makes
  // log(1+r) = -Infinity, which would poison every downstream number
  // silently -- guarded explicitly rather than left to produce NaN/Inf.
  const hasCatastrophicLoss = rets.some(x=>x.r<=-0.999);
  let geoAnnual=null, cagr=null;
  if(!hasCatastrophicLoss){
    const logSum = rets.reduce((s,x)=>s+Math.log(1+x.r), 0);
    geoAnnual = Math.expm1(logSum * tradingDaysPerYear / n);
    cagr = Math.pow(prices[prices.length-1].close/prices[0].close, 1/spanYears) - 1;
  }

  const quality = auditPriceSeries(prices, rets, spanYears, annualReturn, annualVol, geoAnnual, hasCatastrophicLoss, !!isFund);

  return {returns:rets, n, dailyMean:mean, dailySd:sd, tradingDaysPerYear,
    annualReturn, annualVol, geoAnnual, cagr, spanYears,
    startDate:prices[0].date, endDate:prices[prices.length-1].date, quality};
}
// Aligns two return series by date (different instruments can carry
// different trading calendars/holidays) before computing covariance.
function alignReturns(retsA, retsB){
  const mapB=new Map(retsB.map(x=>[x.date,x.r]));
  const a=[], b=[];
  retsA.forEach(x=>{ if(mapB.has(x.date)){ a.push(x.r); b.push(mapB.get(x.date)); } });
  return {a, b};
}
function populationCovariance(a, b){
  const n=a.length;
  const meanA=a.reduce((s,x)=>s+x,0)/n, meanB=b.reduce((s,x)=>s+x,0)/n;
  let cov=0; for(let i=0;i<n;i++) cov+=(a[i]-meanA)*(b[i]-meanB);
  return cov/n;
}
// Pairwise annualised covariance/correlation matrices, asset-count-agnostic.
function computeCovarianceMatrix(statsList){
  const n=statsList.length;
  const covAnnual=Array.from({length:n},()=>new Array(n).fill(0));
  const corr=Array.from({length:n},()=>new Array(n).fill(0));
  for(let i=0;i<n;i++) for(let j=0;j<n;j++){
    if(i===j){ covAnnual[i][j]=statsList[i].annualVol*statsList[i].annualVol; corr[i][j]=1; continue; }
    const {a,b}=alignReturns(statsList[i].returns, statsList[j].returns);
    const dailyCov = a.length>10 ? populationCovariance(a,b) : 0;
    const days=(statsList[i].tradingDaysPerYear+statsList[j].tradingDaysPerYear)/2;
    covAnnual[i][j]=dailyCov*days;
    corr[i][j]=statsList[i].annualVol>0 && statsList[j].annualVol>0 ? covAnnual[i][j]/(statsList[i].annualVol*statsList[j].annualVol) : 0;
  }
  return {covAnnual, corr};
}
function portfolioReturn(weights, returns){ return weights.reduce((s,w,i)=>s+w*returns[i],0); }
function portfolioVariance(weights, vols, corr){
  let v=0;
  for(let i=0;i<weights.length;i++) for(let j=0;j<weights.length;j++) v+=weights[i]*weights[j]*vols[i]*vols[j]*corr[i][j];
  return v;
}
// Exactly-2-instrument closed-form frontier: sweep w across [0,1] (the
// worksheet's own approach for the two-risky-asset case). Uses the same
// portfolioReturn()/portfolioVariance() as every other frontier, called with n=2.
function twoAssetFrontier(retA, retB, sdA, sdB, corr, steps){
  if(steps===undefined) steps=101;
  const pts=[];
  for(let i=0;i<steps;i++){
    const w=i/(steps-1);
    const weights=[w,1-w];
    pts.push({ w, ret:portfolioReturn(weights,[retA,retB]), vol:Math.sqrt(portfolioVariance(weights,[sdA,sdB],[[1,corr],[corr,1]])) });
  }
  return pts;
}
// Closed-form global-minimum-variance weight for two assets, clamped to
// [0,1] since this app never offers shorting (true unconstrained min-var
// can fall outside that range at high correlation).
function minVarianceWeightTwoAsset(sdA, sdB, corr){
  const covAB=corr*sdA*sdB;
  const denom=sdA*sdA+sdB*sdB-2*covAB;
  if(Math.abs(denom)<1e-12) return 0.5;
  return Math.max(0, Math.min(1, (sdB*sdB-covAB)/denom));
}
// Closed-form tangency weight for two risky assets given a risk-free
// rate — the standard two-fund-separation result.
//
// Unlike minVarianceWeightTwoAsset above, this one CANNOT be fixed by
// simply clamping the raw formula to [0,1]. Portfolio variance is convex
// in w (always a bowl shape), so when its unconstrained minimum falls
// outside [0,1] the nearest boundary really is the constrained best —
// clamping is safe there. Sharpe ratio is not convex/concave: its one
// stationary point is a genuine interior maximum ONLY when the raw value
// already lands in [0,1]. When one asset's excess return over the
// risk-free rate is negative (this instrument underperformed cash),
// the unconstrained "optimum" wants to short that asset and lever up
// the other one — something this app never offers — and the stationary
// point found by the formula sits on the wrong side entirely: Sharpe is
// then monotonic across [0,1], and naively clamping the raw value grabs
// whichever endpoint happens to be numerically closer, not whichever
// endpoint actually has the higher Sharpe ratio. Verified against a real
// pair (RELIANCE.NS/TCS.NS, TCS deeply negative over the window): the
// raw formula gave -0.90, clamped that to 0% RELIANCE / 100% TCS —
// exactly backwards, since 100% RELIANCE alone (Sharpe 0.12) beats 100%
// TCS alone (Sharpe -0.49) and nothing between them does better than
// either pure holding once shorting is off the table.
function tangencyWeightTwoAsset(retA, retB, sdA, sdB, corr, rf){
  const covAB=corr*sdA*sdB;
  const exA=retA-rf, exB=retB-rf;
  const num=exA*sdB*sdB - exB*covAB;
  const den=exA*sdB*sdB + exB*sdA*sdA - (exA+exB)*covAB;
  const wRaw = Math.abs(den)<1e-12 ? 0.5 : num/den;
  if(wRaw>=0 && wRaw<=1) return wRaw; // genuine interior optimum -- no shorting needed to reach it
  const sharpeAt = w=>{
    const ret = w*retA + (1-w)*retB;
    const variance = w*w*sdA*sdA + (1-w)*(1-w)*sdB*sdB + 2*w*(1-w)*covAB;
    const vol = Math.sqrt(Math.max(0, variance));
    return vol>0 ? (ret-rf)/vol : -Infinity;
  };
  return sharpeAt(1) >= sharpeAt(0) ? 1 : 0;
}
// Capital Allocation Line: a straight line from (0, rf) through the
// tangency point, extended to maxLeverage x the tangency risk/return —
// mirrors the worksheet's own 0% / 100% / 200% three-point construction
// (borrowing at the risk-free rate to lever up past the tangency mix).
function capitalAllocationLine(rf, tanRet, tanVol, maxLeverage){
  if(maxLeverage===undefined) maxLeverage=2;
  if(tanVol<=0) return [{vol:0,ret:rf},{vol:0,ret:rf}];
  const sharpe=(tanRet-rf)/tanVol;
  const pts=[];
  for(let lev=0; lev<=maxLeverage+1e-9; lev+=maxLeverage/20) pts.push({vol:tanVol*lev, ret:rf+sharpe*tanVol*lev});
  return pts;
}
/* ---------------------------------------------------------------------
   N-asset comparison (2-4 instruments). The closed-form functions above
   (twoAssetFrontier, minVarianceWeightTwoAsset, tangencyWeightTwoAsset)
   are exact but strictly 2-asset -- they don't generalise. For 3-4
   instruments we sample a long-only random-weight cloud instead, same
   approach The Lab already uses for its own N-asset "Test Real
   Investments" comparison (goalden-lab.html: mulberry32, randomWeights,
   generateFrontier, bestSharpePoint) -- ported verbatim here so Door 1/2
   can reuse it. The Lab keeps its own copy too (it's declared later in
   that page and shadows this one there); this port only reaches Door 1/2.
   --------------------------------------------------------------------- */
function mulberry32(seed){
  return function(){
    seed|=0; seed=(seed+0x6D2B79F5)|0;
    let t=Math.imul(seed^(seed>>>15),1|seed);
    t=(t+Math.imul(t^(t>>>7),61|t))^t;
    return((t^(t>>>14))>>>0)/4294967296;
  };
}
function randomWeights(n, rng){
  const cuts=[0,1];
  for(let i=0;i<n-1;i++) cuts.push(rng());
  cuts.sort((a,b)=>a-b);
  const w=[];
  for(let i=0;i<n;i++) w.push(cuts[i+1]-cuts[i]);
  return w;
}
function generateFrontier(returns, vols, corr, n, seed){
  const rng=mulberry32(seed);
  const cloud=[];
  for(let i=0;i<n;i++){
    const w=randomWeights(returns.length, rng);
    cloud.push({ w, ret:portfolioReturn(w,returns), vol:Math.sqrt(portfolioVariance(w,vols,corr)) });
  }
  const minV=Math.min(...cloud.map(p=>p.vol)), maxV=Math.max(...cloud.map(p=>p.vol));
  const bins=40, binW=(maxV-minV)/bins;
  const best=new Array(bins).fill(null);
  cloud.forEach(p=>{
    let b=Math.min(bins-1,Math.floor((p.vol-minV)/(binW||1)));
    if(!best[b]||p.ret>best[b].ret) best[b]=p;
  });
  return { cloud, frontier:best.filter(Boolean).sort((a,b)=>a.vol-b.vol) };
}
function bestSharpePoint(frontier, rf){
  let best=null, bestSharpe=-Infinity;
  frontier.forEach(p=>{
    if(p.vol<=0) return;
    const s=(p.ret-rf)/p.vol;
    if(s>bestSharpe){ bestSharpe=s; best=p; }
  });
  return best ? Object.assign({}, best, {sharpe:bestSharpe}) : null;
}
// Fixed seed (not user/session-derived) so the same instruments always
// produce the same sampled weights across a chat explanation, the chart,
// and a printed report within one comparison -- and across re-runs during
// a live demo.
const MULTI_FRONTIER_SEED = 20240101;
function multiAssetFrontier(statsList, rf, opts){
  opts = opts || {};
  const samples = opts.samples || 3000;
  const seed = opts.seed != null ? opts.seed : MULTI_FRONTIER_SEED;
  const returns = statsList.map(function(s){ return s.annualReturn; });
  const vols = statsList.map(function(s){ return s.annualVol; });
  const corr = computeCovarianceMatrix(statsList).corr;
  const gen = generateFrontier(returns, vols, corr, samples, seed);
  const frontier = gen.frontier;
  let mv = frontier[0];
  for(let i=1;i<frontier.length;i++) if(frontier[i].vol<mv.vol) mv=frontier[i];
  // bestSharpePoint attaches .sharpe to tangency automatically; the
  // min-variance point found above does not get one for free, and
  // radarComparisonChartOption reads minVariance.sharpe directly -- leave
  // this off and the radar chart silently plots undefined on that axis.
  const mvSharpe = mv.vol>0 ? (mv.ret-rf)/mv.vol : 0;
  let tan = bestSharpePoint(frontier, rf);
  if(!tan) tan = Object.assign({}, mv, {sharpe:mvSharpe});
  return {
    returns: returns, vols: vols, corr: corr, cloud: gen.cloud, frontier: frontier,
    minVariance: { w:mv.w, ret:mv.ret, vol:mv.vol, sharpe:mvSharpe },
    tangency: { w:tan.w, ret:tan.ret, vol:tan.vol, sharpe:tan.sharpe },
  };
}
function liveFrontierChartOption(frontier, assetPoints, currentPoint, cal, tangencyPoint, currentMixLabel, minVarPoint){
  const pct=v=>(v*100).toFixed(2)+'%';
  // Suppress the SAFEST label when it would land on top of an asset dot
  // or the BEST BALANCE dot (common with 2 assets, where the min-variance
  // mix often sits very close to one of those) -- three overlapping
  // labels reads worse than two clear ones.
  const vols=frontier.map(p=>p.vol), rets=frontier.map(p=>p.ret);
  const volTol=(Math.max(...vols)-Math.min(...vols))*0.04 || 0.001;
  const retTol=(Math.max(...rets)-Math.min(...rets))*0.04 || 0.001;
  const near=(p,q)=>Math.abs(p.vol-q.vol)<volTol && Math.abs(p.ret-q.ret)<retTol;
  const showSafest = minVarPoint && !near(minVarPoint,tangencyPoint) && !near(minVarPoint,currentPoint) && !assetPoints.some(ap=>near(minVarPoint,{vol:ap.vol,ret:ap.ret}));
  // "Your mix" is always initialized to the min-variance mix, so it
  // routinely lands exactly on top of SAFEST or BEST BALANCE -- two
  // stacked, unreadable labels. Merge into one truthful label instead of
  // offsetting by a fixed pixel amount (the chart has dataZoom, so a pixel
  // offset that clears the overlap at default zoom collides again at
  // another zoom level).
  const tangencyIsCurrent = near(currentPoint, tangencyPoint);
  const minVarIsCurrent = minVarPoint && near(currentPoint, minVarPoint);
  const yourMixLabel = tangencyIsCurrent ? 'YOUR MIX = BEST BALANCE' : minVarIsCurrent ? 'YOUR MIX = SAFEST' : 'YOUR MIX';
  // capitalAllocationLine() always starts its sweep at leverage 0, i.e.
  // cal[0] is exactly {vol:0, ret:rf} -- reading it back out here instead
  // of threading a separate rf argument through the whole call chain.
  const rfPoint = cal[0] || {vol:0, ret:0};
  return {
    animationDurationUpdate:450, animationEasingUpdate:'cubicOut',
    grid:{left:54,right:20,top:24,bottom:52,containLabel:true},
    xAxis:{type:'value', min:0, name:'RISK (per year)', nameLocation:'middle', nameGap:30,
      nameTextStyle:{fontSize:10.5,color:'rgba(20,40,63,.5)'}, axisLabel:{formatter:v=>(v*100).toFixed(0)+'%'},
      splitLine:{lineStyle:{color:'rgba(20,40,63,.05)'}}},
    yAxis:{type:'value', name:'RETURN (per year)', nameLocation:'middle', nameGap:44,
      nameTextStyle:{fontSize:10.5,color:'rgba(20,40,63,.5)'}, axisLabel:{formatter:v=>(v*100).toFixed(0)+'%'},
      splitLine:{lineStyle:{color:'rgba(20,40,63,.05)'}}},
    dataZoom:[{type:'inside',xAxisIndex:0},{type:'inside',yAxisIndex:0}],
    tooltip:{trigger:'item', confine:true, extraCssText:'max-width:290px;white-space:normal;line-height:1.5',
      textStyle:{fontFamily:"'Figtree',sans-serif", fontSize:12},
      formatter(p){
      const [labelA,labelB] = assetPoints.map(a=>a.label);
      if(p.seriesName==='Frontier'){
        const w = frontier[p.dataIndex] ? frontier[p.dataIndex].w : null;
        const split = w!=null ? `${(w*100).toFixed(0)}% ${labelA} / ${((1-w)*100).toFixed(0)}% ${labelB}<br/>` : '';
        return `${split}Return: ${pct(p.value[1])} &nbsp; Risk: ${pct(p.value[0])}<br/><span style="color:#2557C7">Click to try this mix.</span>`;
      }
      if(p.seriesName==='CAL') return `<b>Capital Allocation Line.</b><br/>Starts at the risk-free rate (${pct(rfPoint.ret)}, 0% risk) and blends in more of the Best Balance mix as it climbs.<br/>Return: ${pct(p.value[1])} &nbsp; Risk: ${pct(p.value[0])}`;
      if(p.seriesName==='Risk-free') return `<b>The risk-free rate: ${pct(rfPoint.ret)}.</b><br/>The safe baseline this comparison uses &ndash; roughly a savings account or government bond. It sits at 0% risk because it's assumed not to move. The dashed line is what you get blending this with the Best Balance mix.`;
      if(p.seriesName==='Assets'){
        const a=assetPoints[p.dataIndex];
        if(!a) return '';
        return `<b>${a.fullLabel||a.label} on its own:</b><br/>${pct(a.ret)} for ${pct(a.vol)} risk.`;
      }
      if(p.seriesName==='Your mix') return `<b>Your current mix${currentMixLabel?': '+currentMixLabel:''}.</b><br/>Return: ${pct(p.value[1])} &nbsp; Risk: ${pct(p.value[0])}<br/>This marks where the slider below is set right now &ndash; it isn't clickable itself. Click the <b style="color:#14283F">BEST BALANCE</b> dot or the blue curve to move it.`;
      if(p.seriesName==='Safest') return `<b>The lowest-risk mix these two instruments can make.</b><br/>Return: ${pct(p.value[1])} &nbsp; Risk: ${pct(p.value[0])}`;
      if(p.seriesName==='Tangency') return `<b>Best balance of risk and reward (the tangency / best-Sharpe point).</b><br/>Return: ${pct(p.value[1])} &nbsp; Risk: ${pct(p.value[0])}<br/><span style="color:#2557C7">Click to move here.</span>`;
      return '';
    }},
    series:[
      { name:'Frontier', type:'line', data:frontier.map(p=>[p.vol,p.ret]), smooth:.2, showSymbol:false,
        itemStyle:{color:'#2557C7'}, lineStyle:{color:'#2557C7',width:2.25}, z:2 },
      { name:'CAL', type:'line', data:cal.map(p=>[p.vol,p.ret]), showSymbol:false,
        lineStyle:{color:'#14283F', width:1.5, type:'dashed'}, z:1 },
      { name:'Risk-free', type:'scatter', data:[[rfPoint.vol,rfPoint.ret]], symbolSize:8,
        itemStyle:{color:'#14283F', borderColor:'#14283F', borderWidth:1}, z:4,
        label:{show:true, formatter:`RISK-FREE ${(rfPoint.ret*100).toFixed(1)}%`, position:'right', distance:8, color:'rgba(20,40,63,.6)', fontWeight:700, fontSize:8.5, fontFamily:"'Spline Sans Mono',monospace"} },
      { name:'Assets', type:'scatter', data:assetPoints.map(p=>[p.vol,p.ret]), symbolSize:10,
        itemStyle:{color:'#8FC79E', borderColor:'#14283F', borderWidth:1},
        label:{show:true, formatter:p=>{ const ap=assetPoints[p.dataIndex]; return ap && ap.showLabel!==false ? ap.label : ''; }, position:'top', color:'rgba(20,40,63,.6)', fontSize:9, fontFamily:"'Spline Sans Mono',monospace"}, z:3 },
      { name:'Tangency', type:'scatter', data:[[tangencyPoint.vol,tangencyPoint.ret]], symbolSize:11,
        itemStyle:{color:'#14283F', borderColor:'#2557C7', borderWidth:2}, z:4,
        label:{show:!tangencyIsCurrent, formatter:'BEST BALANCE', position:'bottom', distance:9, color:'#14283F', fontWeight:700, fontSize:9.5, fontFamily:"'Spline Sans Mono',monospace"} },
      ...(showSafest ? [{ name:'Safest', type:'scatter', data:[[minVarPoint.vol,minVarPoint.ret]], symbolSize:10,
        itemStyle:{color:'#8FC79E', borderColor:'#14283F', borderWidth:1.5}, z:4,
        label:{show:true, formatter:'SAFEST', position:'top', distance:9, color:'#14283F', fontWeight:700, fontSize:9.5, fontFamily:"'Spline Sans Mono',monospace"} }] : []),
      { name:'Your mix', type:'scatter', data:[[currentPoint.vol,currentPoint.ret]], symbolSize:16,
        itemStyle:{color:'transparent', borderColor:'#D97757', borderWidth:2.5}, z:5,
        label:{show:true, formatter:yourMixLabel, position:'top', distance:10, color:'#D97757', fontWeight:700, fontSize:10, fontFamily:"'Spline Sans Mono',monospace"} },
      { name:'Your mix dot', type:'scatter', data:[[currentPoint.vol,currentPoint.ret]], symbolSize:6,
        itemStyle:{color:'#D97757'}, tooltip:{show:false}, silent:true, z:5 },
    ],
  };
}

/* ---------------------------------------------------------------------
   Phase 12 — alternate chart-option builders for the same compare_portfolio
   result. Gives the advisor a choice of visual encoding instead of always
   rendering the same efficient-frontier scatter: a grouped bar for a quick
   side-by-side, a radar for a multi-dimensional profile. Every number here
   comes from the caller's already-computed data (compare_portfolio) — these
   functions only pick how to draw it, never compute new figures.
   --------------------------------------------------------------------- */
function barComparisonChartOption(assetPoints){
  const labels = assetPoints.map(function(a){ return a.label; });
  return {
    animationDurationUpdate:450, animationEasingUpdate:'cubicOut',
    grid:{left:54,right:20,top:36,bottom:40,containLabel:true},
    legend:{top:0, textStyle:{fontSize:10.5,color:'rgba(20,40,63,.6)',fontFamily:"'Spline Sans Mono',monospace"}},
    xAxis:{type:'category', data:labels, axisLabel:{fontSize:10.5,color:'rgba(20,40,63,.6)'}},
    yAxis:{type:'value', name:'PER YEAR', nameLocation:'middle', nameGap:44,
      nameTextStyle:{fontSize:10.5,color:'rgba(20,40,63,.5)'}, axisLabel:{formatter:function(v){ return (v*100).toFixed(0)+'%'; }},
      splitLine:{lineStyle:{color:'rgba(20,40,63,.05)'}}},
    tooltip:{trigger:'axis', confine:true, textStyle:{fontFamily:"'Figtree',sans-serif", fontSize:12},
      valueFormatter:function(v){ return (v*100).toFixed(2)+'%'; }},
    series:[
      { name:'Return', type:'bar', data:assetPoints.map(function(a){ return a.ret; }), itemStyle:{color:'#2557C7'}, barGap:'20%' },
      { name:'Risk', type:'bar', data:assetPoints.map(function(a){ return a.vol; }), itemStyle:{color:'#D97757'} },
    ],
  };
}
function radarComparisonChartOption(assetPoints, minVariance, tangency, riskFreeRate){
  const rf = riskFreeRate || 0;
  const sharpeOf = function(ret, vol){ return vol > 0 ? (ret - rf) / vol : 0; };
  const assetSharpes = assetPoints.map(function(a){ return sharpeOf(a.ret, a.vol); });
  const rets = assetPoints.map(function(a){ return a.ret; }).concat([minVariance.ret, tangency.ret]);
  const vols = assetPoints.map(function(a){ return a.vol; }).concat([minVariance.vol, tangency.vol]);
  const sharpes = assetSharpes.concat([minVariance.sharpe, tangency.sharpe]).filter(function(s){ return isFinite(s); });
  const maxRet = Math.max.apply(null, rets) * 1.2 || 0.01;
  const maxVol = Math.max.apply(null, vols) * 1.2 || 0.01;
  const maxSharpe = (sharpes.length ? Math.max.apply(null, sharpes.map(Math.abs)) : 1) * 1.2 || 1;
  const indicator = [
    { name:'Return', max:maxRet },
    { name:'Risk', max:maxVol },
    { name:'Sharpe', max:maxSharpe },
  ];
  const point = function(ret, vol, sharpe){ return [ret, vol, isFinite(sharpe) ? sharpe : 0]; };
  const colors = ['#8FC79E', '#2557C7', '#14283F', '#D97757'];
  const data = assetPoints.map(function(a, i){
    return { name:a.label, value:point(a.ret, a.vol, assetSharpes[i]), itemStyle:{color:colors[i % colors.length]} };
  });
  data.push({ name:'Safest mix', value:point(minVariance.ret, minVariance.vol, minVariance.sharpe), itemStyle:{color:'#8FC79E'}, lineStyle:{type:'dashed'} });
  data.push({ name:'Best balance', value:point(tangency.ret, tangency.vol, tangency.sharpe), itemStyle:{color:'#14283F'}, lineStyle:{type:'dashed'} });
  return {
    animationDurationUpdate:450, animationEasingUpdate:'cubicOut',
    legend:{top:0, textStyle:{fontSize:9.5,color:'rgba(20,40,63,.6)',fontFamily:"'Spline Sans Mono',monospace"}},
    tooltip:{trigger:'item', confine:true, textStyle:{fontFamily:"'Figtree',sans-serif", fontSize:12},
      formatter:function(p){ const v=p.value; return `<b>${p.name}</b><br/>Return: ${(v[0]*100).toFixed(2)}% &nbsp; Risk: ${(v[1]*100).toFixed(2)}% &nbsp; Sharpe: ${v[2].toFixed(2)}`; }},
    radar:{indicator:indicator, radius:'62%', splitLine:{lineStyle:{color:'rgba(20,40,63,.08)'}}, axisName:{fontSize:10.5,color:'rgba(20,40,63,.6)'}},
    series:[{ type:'radar', data:data, symbolSize:5, lineStyle:{width:2}, areaStyle:{opacity:.08} }],
  };
}

/* ---------------------------------------------------------------------
   BM25 retrieval (Phase 11) — dependency-free keyword-relevance scoring.
   The Worker/local_server use this to route which tools / knowledge chunks
   are relevant to the user's latest message, so the model is never shown
   competing tools it shouldn't pick from. Pure arithmetic — no embeddings,
   no network, no dependencies. This copy is the tested canonical one; the
   Worker keeps a module-private duplicate (it can't import this plain-<script>).
   --------------------------------------------------------------------- */
function bm25Tokenize(text){
  return String(text == null ? '' : text).toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean);
}
function bm25Rank(query, documents, opts){
  opts = opts || {};
  const k1 = opts.k1 != null ? opts.k1 : 1.5;
  const b = opts.b != null ? opts.b : 0.75;
  const qTerms = bm25Tokenize(query);
  const docs = documents.map(function(d){ return { id: d.id, text: d.text, terms: bm25Tokenize(d.text), tf: {} }; });
  docs.forEach(function(doc){ doc.terms.forEach(function(t){ doc.tf[t] = (doc.tf[t] || 0) + 1; }); });
  const N = docs.length;
  const avgLen = N ? docs.reduce(function(s, d){ return s + d.terms.length; }, 0) / N : 0;
  const df = {};
  docs.forEach(function(doc){ const seen = {}; doc.terms.forEach(function(t){ if(!seen[t]){ seen[t] = 1; df[t] = (df[t] || 0) + 1; } }); });
  function idf(t){ const d = df[t] || 0; return Math.log((N - d + 0.5) / (d + 0.5) + 1); }
  const scores = docs.map(function(doc){
    let s = 0;
    qTerms.forEach(function(t){
      const tf = doc.tf[t] || 0;
      if(!tf) return;
      const denom = tf + k1 * (1 - b + b * (doc.terms.length / (avgLen || 1)));
      s += idf(t) * (tf * (k1 + 1)) / denom;
    });
    return { id: doc.id, text: doc.text, score: s };
  });
  scores.sort(function(a, b){ return b.score - a.score; });
  return scores;
}
// Filters an OpenAI-style tool array down to the top-K most relevant to a
// query, always keeping any already-called tools (a mid-chain tool must never
// disappear). Skips filtering entirely when the list is already <= K.
//
// Tool families: some multi-step chains use tools whose descriptions don't
// share vocabulary with the natural-language query that triggers them (e.g.
// "add_instrument"'s description talks about price history, not "risk" or
// "pair" — a user asking to minimize risk between two stocks would never
// individually rank add_instrument highly enough to survive top-K, even
// though the chain cannot complete without it). If ANY member of a family
// survives ranking, every member of that family is kept too, so a triggered
// workflow always has its full toolset available.
var TOOL_FAMILIES = [
  ['search_instruments', 'add_instrument', 'remove_instrument', 'compare_portfolio', 'render_frontier_chart'],
];
function filterToolsByQuery(tools, query, alreadyCalled, opts){
  const k = (opts && opts.k) || 8;
  if(!Array.isArray(tools) || tools.length <= k) return tools;
  const docs = tools.map(function(t){ const f = t.function || {}; return { id: f.name, text: (f.name || '') + ' ' + (f.description || '') }; });
  const ranked = bm25Rank(query, docs);
  const keep = {};
  ranked.slice(0, k).forEach(function(r){ keep[r.id] = true; });
  (alreadyCalled || []).forEach(function(n){ keep[n] = true; });
  TOOL_FAMILIES.forEach(function(family){
    if(family.some(function(name){ return keep[name]; })){
      family.forEach(function(name){ keep[name] = true; });
    }
  });
  return tools.filter(function(t){ return keep[(t.function || {}).name]; });
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
    computeDailyReturns, auditPriceSeries, computeReturnStats, alignReturns,
    populationCovariance, computeCovarianceMatrix, portfolioReturn, portfolioVariance,
    twoAssetFrontier, minVarianceWeightTwoAsset, tangencyWeightTwoAsset,
    capitalAllocationLine, liveFrontierChartOption,
    barComparisonChartOption, radarComparisonChartOption,
    mulberry32, randomWeights, generateFrontier, bestSharpePoint, multiAssetFrontier,
    bm25Tokenize, bm25Rank, filterToolsByQuery,
  };
}
