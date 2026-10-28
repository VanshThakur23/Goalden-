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
     - supports `o.stepUp`, a PER-PERIOD growth factor applied every month
       (the pages all pass 0; only a test uses it). For a real SIP step-up -- flat within a year,
       raised once a year -- use stepUpAnnualPlan below.
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

// Step-up SIP the way real SIP mandates work: the monthly amount is FLAT
// within each year and rises by the step-up % once a year. (Moved here from
// the Lab so Quick Calculate and the Full Plan can offer the same thing.)
// The older model (a monthly-equivalent growth rate) raised it a little
// every month, understating the starting SIP by ~3.4% at the Lab defaults.
// Future value is linear in the starting SIP, so solve with S=1 and scale --
// exact, no iteration. Contributions at the start of each month (annuity
// due), matching the flat SIP it is compared with.
function stepUpAnnualPlan(target, years, annualRate, stepPct){
  const m=effectiveMonthlyRate(annualRate), g=stepPct;
  const simulate=S=>{ let bal=0, paid=0; const rows=[], yearly=[];
    for(let y=0;y<years;y++){ const sip=S*Math.pow(1+g,y); yearly.push(sip);
      for(let k=0;k<12;k++){ bal=(bal+sip)*(1+m); paid+=sip; rows.push({closeBal:bal, sip}); } }
    return {bal, paid, rows, yearly}; };
  const unit=simulate(1).bal;
  const S=target/unit, run=simulate(S);
  return {startSip:S, rows:run.rows, yearlySip:run.yearly, totalPaid:run.paid, finalBal:run.bal};
}

/* ---------------------------------------------------------------------
   XIRR: the annualised return of dated cash flows (money in negative,
   money out positive) -- the figure fund statements report for a SIP.
   365-day years, like Excel's XIRR. Bisection rather than Newton: a few
   more iterations, but it cannot diverge or jump to a second root.
   Returns null when no rate between -99.99% and +1000% fits.
   --------------------------------------------------------------------- */
function xirr(flows) {
  if (!flows || flows.length < 2) return null;
  const t0 = Date.parse(flows[0].date);
  const yrs = flows.map(f => (Date.parse(f.date) - t0) / 864e5 / 365);
  const npv = r => flows.reduce((s, f, i) => s + f.amount / Math.pow(1 + r, yrs[i]), 0);
  let lo = -0.9999, hi = 10, fLo = npv(lo);
  if (fLo * npv(hi) > 0) return null;
  for (let i = 0; i < 200 && hi - lo > 1e-10; i++) {
    const mid = (lo + hi) / 2, f = npv(mid);
    if (f * fLo > 0) { lo = mid; fLo = f; } else hi = mid;
  }
  return (lo + hi) / 2;
}

/* ---------------------------------------------------------------------
   A monthly SIP run through real prices.
   dates: sorted ISO dates every instrument traded on.
   px[k][i]: price of instrument i on dates[k].  weights: fractions, sum 1.
   Buys on the first shared trading day of each calendar month. Each
   month's money is split by the weights; the pot already built is not
   rebalanced, which is how separate SIPs into two funds really behave.
   `lots` keeps every buy (date, price, units per instrument) so a caller
   can work out tax lot by lot -- each instalment has its own holding clock.
   --------------------------------------------------------------------- */
function sipBacktest(dates, px, weights, monthly) {
  const units = weights.map(() => 0), paid = [], value = [], flows = [], lots = [];
  let total = 0, month = '';
  for (let k = 0; k < dates.length; k++) {
    if (dates[k].slice(0, 7) !== month) {
      month = dates[k].slice(0, 7);
      const bought = weights.map((w, i) => monthly * w / px[k][i]);
      bought.forEach((u, i) => { units[i] += u; });
      lots.push({ k, date: dates[k], units: bought, price: px[k].slice() });
      total += monthly;
      flows.push({ date: dates[k], amount: -monthly });
    }
    paid.push(total);
    value.push(units.reduce((s, u, i) => s + u * px[k][i], 0));
  }
  const last = dates.length - 1;
  // The worst moment, in the terms a SIP investor feels it: the biggest
  // gap below the money they had put in so far.
  let worst = { k: 0, gap: 0, pct: 0 };
  value.forEach((v, k) => { if (v - paid[k] < worst.gap) worst = { k, gap: v - paid[k], pct: v / paid[k] - 1 }; });
  return {
    paid, value, lots, months: flows.length, paidIn: total, final: value[last],
    absReturn: value[last] / total - 1,
    xirr: xirr(flows.concat([{ date: dates[last], amount: value[last] }])),
    worst,
  };
}

/* ---------------------------------------------------------------------
   Bad prints that revert: a price nobody could have traded at. A day is
   flagged only when BOTH hold:
     1. the price sits at least `big` times away from the last good price
        (default 5x up or down: GOLDBEES.NS printed Rs 0.34 for Rs 33.6 on
        19-20 Dec 2019), or within 3% of a whole-number split ratio
        (1/2 ... 1/10 or 2x ... 10x: a split booked on the wrong day); and
     2. it comes back to within 5% of that good price within `within`
        trading days (default 3).
   A real crash never passes both: Yes Bank fell from ~Rs 37 to ~Rs 5.6 on
   6 Mar 2020 and rallied to ~Rs 58 within two weeks -- huge moves, but it
   never snapped back to Rs 37 within 3 days, so those days stay in. An
   earlier rule (any >35% move that reverts within a week) dropped them and
   called them data errors, which hid a real low.
   `cols` limits the check to the instruments the data-quality audit
   already flagged (omit it to check every column). Returns the row
   indices to leave out. Nothing is repaired; callers leave the days out
   and say so, in line with the no-fabricated-data rule.
   --------------------------------------------------------------------- */
function findRevertingSpikes(px, cols, opts) {
  opts = opts || {};
  const big = opts.big || 5, within = opts.within || 3, backTol = 0.05, splitTol = 0.03;
  const bad = new Set();
  const n = px.length ? px[0].length : 0;
  const check = cols || Array.from({ length: n }, (_, i) => i);
  const looksBroken = r => {
    if (!(r > 0)) return true;
    if (r >= big || r <= 1 / big) return true;
    for (let m = 2; m <= 10; m++) {
      if (Math.abs(r * m - 1) <= splitTol || Math.abs(r / m - 1) <= splitTol) return true;
    }
    return false;
  };
  check.forEach(i => {
    if (i < 0 || i >= n) return;
    let good = px[0][i];
    for (let k = 1; k < px.length; k++) {
      const r = px[k][i] / good;
      if (!looksBroken(r)) { good = px[k][i]; continue; }
      let back = -1;
      for (let j = k + 1; j <= Math.min(k + within, px.length - 1); j++) {
        if (Math.abs(px[j][i] / good - 1) <= backTol) { back = j; break; }
      }
      if (back < 0) { good = px[k][i]; continue; }   // it stayed there: a real move
      for (let j = k; j < back; j++) bad.add(j);
      k = back - 1;
    }
  });
  return bad;
}

/* ---------------------------------------------------------------------
   India tax rules, in one dated place. FY 2026-27: Budget 2026 left the
   capital-gains rates and the exemption as Budget 2024 set them (for sales
   on or after 23 Jul 2024). Re-check after every Budget.
   - Listed shares, equity funds/ETFs, REIT and InvIT units (s.111A/112A):
     long term after 12 months, 12.5% on gains above Rs 1.25 lakh a year;
     short term 20%.
   - Other listed units (gold ETFs, international ETFs listed in India):
     12.5% after 12 months, the investor's slab before.
   - Unlisted holdings (gold and international funds of funds, foreign
     shares): 12.5% after 24 months, the slab before.
   - Debt funds and debt ETFs bought on/after 1 Apr 2023: the slab however
     long they are held (s.50AA). Bought earlier: as the two lines above.
   - FD interest: the slab, every year.
   A 4% health and education cess applies on top of every rate. Surcharge
   is not modelled (it starts above Rs 50 lakh of income). Section numbers
   here are the 1961 Act's; the Income-tax Act 2025, in force from 1 Apr
   2026, renumbered them without changing these rates.
   Slab chips offer 0/15/20/25/30 only: under the new regime the s.87A
   rebate makes slab-taxed income nil up to Rs 12 lakh of total income, so
   nobody's FD interest is really taxed at the 5% or 10% band rates.
   (The rebate does not cover 112A gains, and is not applied to them.)
   --------------------------------------------------------------------- */
const TAX_IN = {
  asOf: 'FY 2026-27', cess: 0.04,
  equityLtcg: 0.125, equityLtcgExemption: 125000, equityStcg: 0.20,
  otherLtcg: 0.125,
  grandfatherDate: '2018-01-31',   // s.112A: cost is stepped up to this day's price
  debtSlabFrom: '2023-04-01',
  newRegimeSlabs: [0, 15, 20, 25, 30],   // marginal rates that actually apply; see above
  defaultSlab: 20,
};

// "More than N months": bought 19 Oct 2025, sold 19 Oct 2026 is still short
// term; sold a day later it is long term.
function holdsLongTerm(buyDate, sellDate, months) {
  const b = new Date(buyDate + 'T00:00:00Z');
  b.setUTCMonth(b.getUTCMonth() + months);
  return Date.parse(sellDate + 'T00:00:00Z') > b.getTime();
}

/* ---------------------------------------------------------------------
   Tax on selling every lot of a SIP on one day, lot by lot: each monthly
   buy has its own holding clock, so a 10-year SIP sold today is mostly
   long term with the last 12 (or 24) months short term.
   lots: sipBacktest's [{date, units[], price[]}]; sellPx[i]: price on
   sellDate; classes[i]: 'equity' | 'listed' | 'unlisted' | 'debtFund' |
   'debtListed'; slab: the investor's slab as a fraction; gfPx[i]: the price
   on 31 Jan 2018 (or null), for grandfathering equity lots bought by then.
   Losses are set off the way the Act allows: a short-term loss against any
   gain, a long-term loss only against long-term gains, highest rate first.
   The Rs 1.25 lakh exemption is used once, i.e. nothing else is sold that
   year. Returns gross value, tax, what is kept and the netted buckets.
   --------------------------------------------------------------------- */
function saleTaxIndia(lots, sellDate, sellPx, classes, slab, gfPx) {
  const g = { stEq: 0, ltEq: 0, ltOther: 0, stSlab: 0 };
  let gross = 0, grandfathered = false;
  sellPx.forEach((p, i) => { gross += p * lots.reduce((u, l) => u + (l.units[i] || 0), 0); });
  lots.forEach(lot => lot.units.forEach((u, i) => {
    if (!(u > 0)) return;
    let cls = classes[i];
    if (cls === 'debtFund' || cls === 'debtListed') {
      cls = lot.date >= TAX_IN.debtSlabFrom ? 'slab' : (cls === 'debtFund' ? 'unlisted' : 'listed');
    }
    let cost = lot.price[i];
    if (cls === 'equity' && lot.date <= TAX_IN.grandfatherDate && gfPx && gfPx[i] > 0) {
      const stepped = Math.max(cost, Math.min(gfPx[i], sellPx[i]));
      if (stepped > cost) grandfathered = true;
      cost = stepped;
    }
    const gain = u * (sellPx[i] - cost);
    if (cls === 'slab') g.stSlab += gain;
    else if (cls === 'equity') g[holdsLongTerm(lot.date, sellDate, 12) ? 'ltEq' : 'stEq'] += gain;
    else g[holdsLongTerm(lot.date, sellDate, cls === 'listed' ? 12 : 24) ? 'ltOther' : 'stSlab'] += gain;
  }));
  const net = Object.assign({}, g);
  const rate = { stSlab: slab, stEq: TAX_IN.equityStcg, ltOther: TAX_IN.otherLtcg, ltEq: TAX_IN.equityLtcg };
  // Highest rate first. Long-term equity counts only its part above the
  // Rs 1.25 lakh exemption at 12.5%; the exempt part is worth 0%, so it is
  // offset last -- but it IS offset if a loss remains, because the Act
  // requires set-off against the year's gains before anything carries
  // forward. Equal rates keep the listed order (sort is stable).
  const X = TAX_IN.equityLtcgExemption;
  const room = t => t === 'ltEq' ? Math.max(0, net.ltEq - X) : Math.max(0, net[t]);
  const absorb = (from, into) => {
    into.slice().sort((a, b) => rate[b] - rate[a]).forEach(t => {
      if (net[from] < 0 && room(t) > 0) { const m = Math.min(-net[from], room(t)); net[t] -= m; net[from] += m; }
    });
    into.forEach(t => {
      if (net[from] < 0 && net[t] > 0) { const m = Math.min(-net[from], net[t]); net[t] -= m; net[from] += m; }
    });
  };
  absorb('ltOther', ['ltEq']); absorb('ltEq', ['ltOther']);
  absorb('stSlab', ['stEq', 'ltOther', 'ltEq']); absorb('stEq', ['stSlab', 'ltOther', 'ltEq']);
  const exemptUsed = Math.min(Math.max(0, net.ltEq), TAX_IN.equityLtcgExemption);
  const taxes = {
    stEq: Math.max(0, net.stEq) * rate.stEq,
    ltEq: Math.max(0, net.ltEq - TAX_IN.equityLtcgExemption) * rate.ltEq,
    ltOther: Math.max(0, net.ltOther) * rate.ltOther,
    stSlab: Math.max(0, net.stSlab) * slab,
  };
  Object.keys(taxes).forEach(k => { taxes[k] *= 1 + TAX_IN.cess; });
  const tax = taxes.stEq + taxes.ltEq + taxes.ltOther + taxes.stSlab;
  const lossLeft = -['stEq', 'ltEq', 'ltOther', 'stSlab'].reduce((a, k) => a + Math.min(0, net[k]), 0);
  return { gross, tax, keep: gross - tax, gains: g, net, taxes, exemptUsed, grandfathered, lossLeft };
}

// The plan's value after tax if the whole pot is withdrawn in one year, the
// handoff-06 model. The equity and hybrid share pays 12.5% above the
// exemption (hybrid treated like equity: the plan's hybrid return assumes an
// equity-oriented fund); the debt share pays the slab. One year and no
// surcharge: a real one-year withdrawal this big would also pay surcharge,
// while spreading it over years would use the exemption every year.
function postTaxPlanValue(finalValue, paidIn, mix, slab) {
  const gain = Math.max(0, finalValue - paidIn);
  const eqGain = gain * ((mix.eq || 0) + (mix.hy || 0));
  const debtGain = gain * (mix.de || 0);
  const eqTax = Math.max(0, eqGain - TAX_IN.equityLtcgExemption) * TAX_IN.equityLtcg * (1 + TAX_IN.cess);
  const debtTax = debtGain * slab * (1 + TAX_IN.cess);
  return { value: finalValue - eqTax - debtTax, tax: eqTax + debtTax };
}

// FD interest is taxed every year at the slab, so the deposit compounds at
// the after-tax rate. Same timing as the pre-tax comparison (monthly, due).
function postTaxFdFinal(sip, years, fdRate, slab) {
  const net = fdRate * (1 - slab * (1 + TAX_IN.cess));
  return accumulationSchedule({ sip: sip, rate: effectiveMonthlyRate(net), periods: years * 12, due: true, stepUp: 0 }).finalBalance;
}

/* ---------------------------------------------------------------------
   EPF, PPF and NPS: money a salaried Indian is already putting away for
   retirement. Rates are DATED constants: re-check them once a year.
     EPF 8.25%: FY 2025-26, recommended by the EPFO's Central Board of
                Trustees in March 2026 and ratified by the government.
     PPF 7.1%:  October-December 2026 quarter (unchanged since April 2020).
     NPS:       market-linked, so there is no declared rate; the plan's own
                growth rate is used. Only the tax-free part is counted: 60%
                of the pot at 60 (non-government subscribers can take up to
                80% as cash since PFRDA's December 2025 amendment, but cash
                beyond 60% is taxable and at least 20% must buy an annuity),
                and 20% when exiting before 60.
   PF wage ceiling: Rs 25,000 since 17 September 2026 (S.O. 5109(E); it was
   Rs 15,000 from September 2014). The pension scheme's own cap on EPS
   (paragraph 11(3), Rs 15,000) was not amended by that notification, so the
   employer's 8.33% for EPS is still worked out on at most Rs 15,000.
   --------------------------------------------------------------------- */
const RETIRE_ACCOUNTS_IN = {
  asOf: 'October 2026',
  epf: { rate: 0.0825, rateFor: 'FY 2025-26', employee: 0.12, employer: 0.12, epsShare: 0.0833,
         epsWageCap: 15000, wageCeiling: 25000, ceilingFrom: '17 September 2026' },
  ppf: { rate: 0.071, rateFor: 'Oct-Dec 2026', yearlyMax: 150000 },
  nps: { shareAt60: 0.6, shareBefore60: 0.2, minAnnuityShare: 0.2 },
};
// A negative, missing or non-numeric box counts as nothing (values can come
// back from saved browser state, so they are never trusted as numbers).
const accNum = v => { v = Number(v); return isFinite(v) && v > 0 ? v : 0; };

// EPF, per month: 12% of the PF wage from the employee, plus the employer's
// 12% minus the part that goes to the pension scheme (EPS: 8.33% of the wage,
// on at most Rs 15,000). wageMode 'ceiling' means the employer pays PF only on
// pay up to the PF wage ceiling; anything else means on the full basic pay.
function epfMonthlyContribution(basic, wageMode) {
  const r = RETIRE_ACCOUNTS_IN.epf, b = accNum(basic);
  const wage = wageMode === 'ceiling' ? Math.min(b, r.wageCeiling) : b;
  const eps = Math.min(wage, r.epsWageCap) * r.epsShare;
  return wage * r.employee + Math.max(0, wage * r.employer - eps);
}
// Interest is worked out monthly on the running balance and credited once a
// year, which is how the EPFO does it. Pay rises once a year by payRise.
function epfFutureValue(o) {
  const r = RETIRE_ACCOUNTS_IN.epf, rate = o.rate == null ? r.rate : o.rate;
  let bal = accNum(o.balance), basic = accNum(o.basic);
  for (let y = 0; y < o.years; y++) {
    let interest = 0;
    const monthly = epfMonthlyContribution(basic, o.wageMode);
    for (let m = 0; m < 12; m++) { bal += monthly; interest += bal * rate / 12; }
    bal += interest;
    basic *= 1 + (o.payRise || 0);
  }
  return bal;
}

// PPF: one deposit a year, made before 5 April so it earns the whole year's
// interest; interest compounds yearly. Deposits are capped at Rs 1.5 lakh.
function ppfFutureValue(o) {
  const r = RETIRE_ACCOUNTS_IN.ppf, rate = o.rate == null ? r.rate : o.rate;
  const yearly = Math.min(accNum(o.yearly), r.yearlyMax);
  let bal = accNum(o.balance);
  for (let y = 0; y < o.years; y++) bal = (bal + yearly) * (1 + rate);
  return bal;
}

// NPS: monthly contributions at the plan's own rate (start of month).
function npsFutureValue(o) {
  const m = Math.pow(1 + o.rate, 1 / 12) - 1;
  let bal = accNum(o.balance);
  for (let k = 0; k < o.years * 12; k++) bal = (bal + accNum(o.monthly)) * (1 + m);
  return bal;
}
function npsCountedShare(retireAge) {
  const r = RETIRE_ACCOUNTS_IN.nps;
  return retireAge != null && retireAge < 60 ? r.shareBefore60 : r.shareAt60;
}

// All three at the retirement date, and how much of them the plan can count.
// acc = { epfBal, epfBasic, epfWage, ppfBal, ppfYearly, npsBal, npsMonthly };
// opts.retireAge sets how much of NPS can be taken as tax-free cash.
function retirementAccountsFV(acc, years, planRate, payRise, opts) {
  const a = acc || {}, o = opts || {};
  const epf = epfFutureValue({ balance: a.epfBal, basic: a.epfBasic, years, payRise, wageMode: a.epfWage });
  const ppf = ppfFutureValue({ balance: a.ppfBal, yearly: a.ppfYearly, years });
  const nps = npsFutureValue({ balance: a.npsBal, monthly: a.npsMonthly, years, rate: planRate });
  const npsShare = npsCountedShare(o.retireAge);
  const npsCounted = nps * npsShare;
  return { epf, ppf, nps, npsShare, npsCounted, counted: epf + ppf + npsCounted };
}

/* ---------------------------------------------------------------------
   Tax-GAIN harvesting (not tax-loss harvesting). Each financial year the
   first Rs 1.25 lakh of long-term equity gains is tax-free. Selling units
   that hold that much gain and buying them straight back "books" the gain
   tax-free and raises what those units cost, so less gain is taxed when
   everything is finally sold. A monthly SIP is modelled lot by lot:
     - units are sold first-in, first-out (how fund houses count a redemption);
     - only units more than 12 months old are harvested. The model's clock is
       whole months, so a harvest "at month 12" stands for a few days after
       the anniversary, which is what the investor has to do for the units to
       be over a year old;
     - re-bought units start a new 12-month clock;
     - the last two years are not harvested. A re-bought unit must be more
       than 12 months old on the day of the final sale to be taxed as
       long-term, and the final sale is on the goal date, not a few days
       after it, so a harvest in the year before the goal would leave short-
       term (20%) units behind.
   The final sale uses the Act's "more than 12 months" strictly: a lot
   bought exactly 12 months before the goal date is still short term.
   Surcharge is not modelled (see TAX_IN). Returns the tax if everything is
   sold at the goal with and without harvesting, and both figures at the end
   of every year (for a chart).
   o = { monthly, years, rate (yearly, e.g. 0.12) }.
   --------------------------------------------------------------------- */
function harvestPlan(o) {
  const t = TAX_IN, ltRate = t.equityLtcg * (1 + t.cess), stRate = t.equityStcg * (1 + t.cess);
  const m = Math.pow(1 + o.rate, 1 / 12) - 1, nav = k => Math.pow(1 + m, k);
  // exempt: what is left of this year's allowance. A harvest uses part of it, and
  // a sale in the same financial year only gets the rest, so the year-end figure
  // for the harvested pot passes exemption - booked (selling everything in the
  // very year you harvested saves nothing extra: the allowance is spent once).
  // strict: the final sale on the goal date needs MORE than 12 months. The other
  // year-end figures (the chart's earlier points) use the harvest's own clock, a
  // few days after the anniversary, so a lot is long term from month 12; with the
  // strict clock they would tax a lot the harvest has just treated as long term.
  const taxIfSold = (lots, T, exempt, strict) => {
    let lt = 0, st = 0;
    lots.forEach(l => { const g = l.units * nav(T) - l.cost; if (strict ? T - l.k > 12 : T - l.k >= 12) lt += g; else st += g; });
    return Math.max(0, lt - exempt) * ltRate + Math.max(0, st) * stRate;
  };
  let plain = [], harvested = [];
  const years = [];
  let bookedTotal = 0, harvests = 0;
  for (let y = 1; y <= o.years; y++) {
    for (let k = (y - 1) * 12; k < y * 12; k++) {   // 12 monthly buys, at the start of each month
      const lot = { units: o.monthly / nav(k), cost: o.monthly, k };
      plain.push(lot); harvested.push(Object.assign({}, lot));
    }
    const T = y * 12;
    let booked = 0;
    if (y <= o.years - 2) {
      let room = t.equityLtcgExemption;
      const next = [], rebought = [];
      for (const l of harvested) {
        const g = l.units * nav(T) - l.cost;
        if (room <= 0 || T - l.k < 12 || g <= 0) { next.push(l); continue; }
        const f = Math.min(1, room / g);
        room -= f * g; booked += f * g;
        rebought.push({ units: l.units * f, cost: l.units * f * nav(T), k: T });
        if (f < 1) next.push({ units: l.units * (1 - f), cost: l.cost * (1 - f), k: l.k });
      }
      harvested = next.concat(rebought);   // re-bought units are the newest, so they sell last
      if (booked > 0) harvests++;
    }
    bookedTotal += booked;
    const last = y === o.years;
    years.push({ year: y, booked, taxPlain: taxIfSold(plain, T, t.equityLtcgExemption, last), taxHarvested: taxIfSold(harvested, T, t.equityLtcgExemption - booked, last) });
  }
  const end = years[years.length - 1];
  const value = plain.reduce((s, l) => s + l.units * nav(o.years * 12), 0);
  return { years, value, paidIn: o.monthly * 12 * o.years, booked: bookedTotal, harvests,
    taxPlain: end.taxPlain, taxHarvested: end.taxHarvested, saved: end.taxPlain - end.taxHarvested };
}

/* ---------------------------------------------------------------------
   Retirement income: how to DRAW the money, not only how much. Five pieces,
   each returning both sides of a comparison and never a recommendation:
     incomeBuckets    the pot split by when each part is needed
     incomeStrategies the bucket plan and one rebalanced pot, year by year,
                      through the SAME returns (so the same crash)
     incomeDrawPlan   the same pot drawn as an SWP from a fund, or as FD
                      interest, with the tax on each
     incomeSwitchTax  the tax to sell a fund pot so it can go into an FD
     npsAnnuityPlan   the part of NPS that has to buy a pension
   All withdrawals are at the start of the year (the Lab's "due" timing) and
   all steps are yearly. No surcharge (see TAX_IN).
   --------------------------------------------------------------------- */
function incomeBuckets(o) {
  const years = Math.max(1, Math.round(o.years) || 1);
  const L = Math.min(years, Math.max(1, Math.round(o.liquidYears == null ? 2 : o.liquidYears)));
  const D = Math.min(years - L, Math.max(0, Math.round(o.debtYears == null ? 5 : o.debtYears)));
  const infl = Number(o.inflation) || 0, spend = accNum(o.annualSpend), corpus = accNum(o.corpus);
  // The year-k spend is spend x (1+infl)^(k-1); a bucket holds the sum of the years it covers. What it
  // earns in the meantime is not counted, which errs on the side of holding enough.
  const need = (from, n) => { let t = 0; for (let k = from; k < from + n; k++) t += spend * Math.pow(1 + infl, k); return t; };
  const liquidNeed = need(0, L), debtNeed = need(L, D);
  const liquid = Math.min(corpus, liquidNeed);
  const debt = Math.min(corpus - liquid, debtNeed);
  const equity = corpus - liquid - debt;
  return { corpus, liquid, debt, equity, liquidYears: L, debtYears: D, liquidNeed, debtNeed,
    shortfall: Math.max(0, liquidNeed + debtNeed - corpus), covered: liquidNeed + debtNeed <= corpus + 1e-6,
    equityShare: corpus > 0 ? equity / corpus : 0 };
}

/* The bucket plan against one pot that is rebalanced to the same starting mix every year. Both
   spend the same inflation-raised amount through the same returns; only equity's return changes
   year to year (every year earns o.equityRate, except o.shock.year which earns o.shock.equityReturn).
   Buckets: spend from liquid, then debt, then equity. At each year end: top liquid up to the
   next liquidYears of spending from debt; then, if equity had a non-negative year, top debt
   back up to the next debtYears from equity (and liquid again, if debt had run too short to fill
   it the first time). A down year takes nothing out of equity.
   o = { corpus, annualSpend, inflation, years, liquidYears, debtYears,
         liquidRate, debtRate, equityRate, shock: { year, equityReturn } | null } */
function incomeStrategies(o) {
  const years = Math.max(1, Math.round(o.years) || 1), infl = Number(o.inflation) || 0, spend = accNum(o.annualSpend);
  const sizes = incomeBuckets(o);
  const shock = o.shock && o.shock.year >= 1 && o.shock.year <= years ? o.shock : null;
  const rl = Number(o.liquidRate) || 0, rd = Number(o.debtRate) || 0, re = Number(o.equityRate) || 0;
  const eqRet = y => (shock && y === shock.year) ? shock.equityReturn : re;
  const spendIn = y => spend * Math.pow(1 + infl, y - 1);
  const need = (fromYear, n) => { let t = 0; for (let y = fromYear; y < fromYear + n && y <= years; y++) t += spendIn(y); return t; };

  const bucketRows = []; let b = { liquid: sizes.liquid, debt: sizes.debt, equity: sizes.equity }, bRan = null;
  for (let y = 1; y <= years; y++) {
    const pay = spendIn(y), total = b.liquid + b.debt + b.equity;
    if (bRan === null && total - pay < -1) bRan = y;
    if (bRan !== null) { bucketRows.push({ year: y, spend: 0, close: 0 }); continue; }
    let left = pay;
    ['liquid', 'debt', 'equity'].forEach(k => { const t = Math.min(b[k], left); b[k] -= t; left -= t; });
    const e = eqRet(y);
    b.liquid *= 1 + rl; b.debt *= 1 + rd; b.equity *= 1 + e;
    if (y < years) {
      const t1 = need(y + 1, sizes.liquidYears), t2 = need(y + 1 + sizes.liquidYears, sizes.debtYears);
      const fillLiquid = () => { if (b.liquid < t1) { const m = Math.min(t1 - b.liquid, b.debt); b.liquid += m; b.debt -= m; } };
      fillLiquid();
      if (e >= 0 && b.debt < t2) { const m = Math.min(t2 - b.debt, b.equity); b.debt += m; b.equity -= m; fillLiquid(); }
    }
    bucketRows.push({ year: y, spend: pay, close: b.liquid + b.debt + b.equity, liquid: b.liquid, debt: b.debt, equity: b.equity });
  }

  const wl = sizes.corpus > 0 ? sizes.liquid / sizes.corpus : 0, wd = sizes.corpus > 0 ? sizes.debt / sizes.corpus : 0, we = 1 - wl - wd;
  const mixRows = []; let tot = sizes.corpus, mRan = null;
  for (let y = 1; y <= years; y++) {
    const pay = spendIn(y);
    if (mRan === null && tot - pay < -1) mRan = y;
    if (mRan !== null) { mixRows.push({ year: y, spend: 0, close: 0 }); continue; }
    tot = (tot - pay) * (1 + wl * rl + wd * rd + we * eqRet(y));
    mixRows.push({ year: y, spend: pay, close: tot });
  }
  const last = rows => rows.length ? rows[rows.length - 1].close : 0;
  return { sizes, shockYear: shock ? shock.year : null,
    buckets: { rows: bucketRows, ranOutYear: bRan, finalBalance: bRan === null ? last(bucketRows) : 0 },
    mix: { rows: mixRows, ranOutYear: mRan, finalBalance: mRan === null ? last(mixRows) : 0, weights: { liquid: wl, debt: wd, equity: we } } };
}

/* One pot, drawn two ways. kind 'fd': interest is taxed every year at the slab on whatever is left
   after the withdrawal, so the pot compounds at the after-tax rate. kind 'swpEquity' / 'swpDebt':
   a withdrawal is part cost and part gain, and only the gain is taxed -- 12.5% above the Rs 1.25
   lakh a year for an equity fund, the slab for a debt fund. The part that is gain is the pot's gain
   share (value minus cost, over value), and each withdrawal removes cost in the same proportion
   (average cost; a real redemption sells specific units, so this is an approximation). The
   withdrawal is sized so that what is LEFT AFTER TAX equals the spend wanted that year.
   Each row also carries the pot's cost basis (cost) and what the pot would be worth after the tax
   still owed on its gains if it were sold that year (ifSold), so an SWP pot and an FD pot can be
   compared as what a person could actually keep.
   o = { kind, corpus, ownShare (0-1: the part of the pot that is your own money), netSpend (year 1,
         after tax), inflation, years, rate, slab }. */
function incomeDrawPlan(o) {
  const t = TAX_IN, cess = 1 + t.cess, years = Math.max(1, Math.round(o.years) || 1);
  const infl = Number(o.inflation) || 0, rate = Number(o.rate) || 0, slab = Number(o.slab) || 0;
  const kind = o.kind === 'fd' || o.kind === 'swpDebt' ? o.kind : 'swpEquity';
  let V = accNum(o.corpus), B = V * Math.min(1, Math.max(0, o.ownShare == null ? 1 : o.ownShare));
  // What the whole pot would owe if sold now. An SWP leaves its unsold gains untaxed, so its pot is bigger than
  // what the person could keep; an FD's interest was taxed every year and owes nothing more. ifSold puts the two on
  // one footing. The Rs 1.25 lakh exemption is counted once, as if nothing else were sold that year.
  const exitTax = (v, cost) => {
    if (kind === 'fd') return 0;
    const gain = Math.max(0, v - cost);
    return (kind === 'swpEquity' ? Math.max(0, gain - t.equityLtcgExemption) * t.equityLtcg : gain * slab) * cess;
  };
  const rows = []; let ranOut = null, totalTax = 0;
  for (let y = 1; y <= years; y++) {
    const net = accNum(o.netSpend) * Math.pow(1 + infl, y - 1);
    if (ranOut !== null) { rows.push({ year: y, open: 0, gross: 0, net: 0, tax: 0, close: 0, cost: 0, ifSold: 0 }); continue; }
    let gross, tax, close;
    if (kind === 'fd') {
      gross = net;
      if (V - gross < -1) { ranOut = y; rows.push({ year: y, open: V, gross: V, net: V, tax: 0, close: 0, cost: 0, ifSold: 0 }); V = 0; continue; }
      const rem = Math.max(0, V - gross);
      tax = rem * rate * slab * cess;
      close = rem * (1 + rate) - tax;
    } else {
      const gs = V > 0 ? Math.max(0, (V - B) / V) : 0;
      const tau = (kind === 'swpEquity' ? t.equityLtcg : slab) * cess, ex = kind === 'swpEquity' ? t.equityLtcgExemption : 0;
      gross = net * gs <= ex ? net : (net - ex * tau) / (1 - gs * tau);
      if (V - gross < -1) { ranOut = y; rows.push({ year: y, open: V, gross: V, net: V, tax: 0, close: 0, cost: 0, ifSold: 0 }); V = 0; continue; }
      gross = Math.min(gross, V);
      tax = gross - net;
      B *= V > 0 ? 1 - gross / V : 0;
      close = (V - gross) * (1 + rate);
    }
    totalTax += tax;
    rows.push({ year: y, open: V, gross, net, tax, close, cost: B, ifSold: close - exitTax(close, B) });
    V = close;
  }
  return { rows, ranOutYear: ranOut, totalTax, firstTax: rows.length ? rows[0].tax : 0, finalBalance: ranOut === null ? V : 0,
    finalExitTax: ranOut === null ? exitTax(V, B) : 0, finalIfSold: ranOut === null ? V - exitTax(V, B) : 0 };
}

/* Moving a fund pot into an FD means selling the fund first, and the gains are taxed on the way
   out. Without this the FD route would start the comparison with no tax owed on a pot the SWP route
   still owes tax on. from 'swpEquity': 12.5% on the gain above the Rs 1.25 lakh; 'swpDebt': the slab.
   o = { corpus, ownShare (0-1), from, slab } */
function incomeSwitchTax(o) {
  const t = TAX_IN, cess = 1 + t.cess, corpus = accNum(o.corpus);
  const own = Math.min(1, Math.max(0, o.ownShare == null ? 1 : Number(o.ownShare) || 0));
  const gain = corpus * (1 - own);
  return o.from === 'swpDebt' ? gain * (Number(o.slab) || 0) * cess
    : Math.max(0, gain - t.equityLtcgExemption) * t.equityLtcg * cess;
}

/* The NPS pot at retirement: at least minAnnuityShare of it must buy an annuity (the income is
   taxed at the slab, and a standard annuity pays the same amount every year); the rest is cash.
   Cash up to shareAt60 of the pot is tax-free (s.10(12A)); whether cash above that is taxed at the
   slab has not been settled by an amendment, so the cautious case is shown.
   annuityRate is an ASSUMPTION the person overwrites with a real quote, never a market figure.
   o = { pot, annuityShare, annuityRate (yearly, on the amount used to buy the annuity), slab }. */
function npsAnnuityPlan(o) {
  const n = RETIRE_ACCOUNTS_IN.nps, cess = 1 + TAX_IN.cess, pot = accNum(o.pot), slab = Number(o.slab) || 0;
  const share = Math.min(1, Math.max(n.minAnnuityShare, Number(o.annuityShare) || n.minAnnuityShare));
  const buy = pot * share, lump = pot - buy;
  const lumpTaxable = Math.max(0, lump - pot * n.shareAt60), lumpTax = lumpTaxable * slab * cess;
  const annual = buy * accNum(o.annuityRate), annualTax = annual * slab * cess;
  return { share, annuityBuy: buy, lump, lumpTaxFree: lump - lumpTaxable, lumpTaxable, lumpTax, lumpKept: lump - lumpTax,
    monthlyBefore: annual / 12, monthlyAfter: (annual - annualTax) / 12 };
}

/* ---------------------------------------------------------------------
   Old vs new income-tax regime, FY 2026-27 (1 Apr 2026 to 31 Mar 2027). DATED
   rules: re-check after every Budget and whenever the Income-tax Rules are
   amended. Checked in October 2026 against the Income Tax Department's slab
   page and the Union Budget 2026-27 papers on indiabudget.gov.in, which left
   the slabs, the Rs 12 lakh rebate and the deduction limits as Budget 2025 set
   them. HRA is Rule 279 of the Income-tax Rules 2026; that page was down for
   maintenance when fetched, so the rule was read from the Department's own
   search excerpt, and later amendments to the Rules were not checked.
   - New regime (the default; s.202 of the Income-tax Act 2025): nil to Rs 4
     lakh, then 5/10/15/20/25/30% in Rs 4 lakh steps. s.87A rebate up to Rs
     60,000 for income up to Rs 12 lakh, with marginal relief just above it.
     Standard deduction Rs 75,000. Only the employer's NPS gift (80CCD(2), up
     to 14% of basic) and the standard deduction come off.
   - Old regime: by age band, nil to Rs 2.5 lakh (3 lakh from 60, 5 lakh from
     80), 5% to Rs 5 lakh, 20% to Rs 10 lakh, 30% above. s.87A rebate Rs
     12,500 up to Rs 5 lakh. Standard deduction Rs 50,000. Then 80C (Rs 1.5
     lakh), 80CCD(1B) (Rs 50,000 more), employer NPS (10% of basic), 80D (Rs
     25,000 self and family, Rs 50,000 if senior; the same again for parents),
     home-loan interest on a self-occupied house (Rs 2 lakh), and HRA.
   - HRA (old regime only): the least of the HRA received, rent paid minus
     10% of basic, and 50% of basic in Mumbai, Kolkata, Delhi, Chennai,
     Hyderabad, Pune, Ahmedabad or Bengaluru (40% elsewhere). "Basic" here is
     basic plus dearness allowance.
   4% cess on top of the tax. Surcharge starts above Rs 50 lakh of income and
   is NOT modelled; compareRegimes flags it. Section numbers are the 1961 Act's
   except where the line above says otherwise.
   --------------------------------------------------------------------- */
const TAX_REGIME_IN = {
  asOf: 'FY 2026-27', cess: 0.04,
  newSlabs: [[400000, 0], [800000, 0.05], [1200000, 0.10], [1600000, 0.15], [2000000, 0.20], [2400000, 0.25], [Infinity, 0.30]],
  oldSlabs: {
    under60:     [[250000, 0], [500000, 0.05], [1000000, 0.20], [Infinity, 0.30]],
    senior:      [[300000, 0], [500000, 0.05], [1000000, 0.20], [Infinity, 0.30]],   // 60 to 79
    superSenior: [[500000, 0], [1000000, 0.20], [Infinity, 0.30]],                    // 80 and over
  },
  rebate: { new: { limit: 1200000, max: 60000 }, old: { limit: 500000, max: 12500 } },
  standardDeduction: { new: 75000, old: 50000 },
  c80: 150000, nps1b: 50000, homeLoanInterest: 200000,
  employerNps: { new: 0.14, old: 0.10 },
  d80: { self: 25000, selfSenior: 50000, parents: 25000, parentsSenior: 50000 },
  hra: { metroShare: 0.5, otherShare: 0.4, rentOver: 0.10,
         metros: ['Mumbai', 'Kolkata', 'Delhi', 'Chennai', 'Hyderabad', 'Pune', 'Ahmedabad', 'Bengaluru'] },
  surchargeFrom: 5000000,
};

// Tax on `income` through a list of [upTo, rate] bands.
function slabTax(income, slabs) {
  const inc = accNum(income);
  let tax = 0, prev = 0;
  for (const band of slabs) {
    if (inc > prev) tax += (Math.min(inc, band[0]) - prev) * band[1];
    if (inc <= band[0]) break;
    prev = band[0];
  }
  return tax;
}
// The rate of the band `income` falls in (what one more rupee of income would be taxed at).
function slabRate(income, slabs) {
  const inc = accNum(income);
  for (const band of slabs) if (inc <= band[0]) return band[1];
  return slabs[slabs.length - 1][1];
}

// Tax on a total income under one regime: the slabs, the s.87A rebate (with
// marginal relief just above the new regime's limit, so a rupee more of income
// never costs more than a rupee more of tax), then cess.
function regimeTax(income, regime, ageBand) {
  const R = TAX_REGIME_IN, inc = accNum(income), isNew = regime === 'new';
  const slabs = isNew ? R.newSlabs : (R.oldSlabs[ageBand] || R.oldSlabs.under60);
  let tax = slabTax(inc, slabs);
  const rb = isNew ? R.rebate.new : R.rebate.old;
  if (inc <= rb.limit) tax = Math.max(0, tax - rb.max);
  else if (isNew) tax = Math.min(tax, inc - rb.limit);
  return tax * (1 + R.cess);
}

// HRA exempt from tax (old regime). o = { basic, hraReceived, rent, metro } with yearly figures.
function hraExemption(o) {
  const h = TAX_REGIME_IN.hra, basic = accNum(o.basic), got = accNum(o.hraReceived), rent = accNum(o.rent);
  if (!(got > 0) || !(rent > 0)) return 0;
  return Math.max(0, Math.min(got, rent - h.rentOver * basic, (o.metro ? h.metroShare : h.otherShare) * basic));
}

// The employee's own EPF for a year (12% of the PF wage). It counts under 80C in the old regime.
// basicMonthly and wageMode are the same as epfMonthlyContribution's.
function epfEmployeeYearly(basicMonthly, wageMode) {
  const r = RETIRE_ACCOUNTS_IN.epf, b = accNum(basicMonthly);
  return 12 * (wageMode === 'ceiling' ? Math.min(b, r.wageCeiling) : b) * r.employee;
}

/* Both regimes on the same pay. Every figure is yearly.
   o = { gross (salary before any deduction), basic (basic + DA), hraReceived, rent, metro (bool),
         ageBand ('under60' | 'senior' | 'superSenior'), c80 (EPF + PPF + ELSS + whatever else the person puts
         under 80C), nps1b, employerNps, health (self and family premium), healthParents, parentsSenior (bool),
         homeLoanInterest (self-occupied house) }.
   Returns what each regime taxes, which is cheaper and by how much, and the break-even: the total of the
   old-regime deductions (HRA exemption, 80C, 80CCD(1B), 80D, home-loan interest) at which the old regime
   costs exactly what the new one does. oldIfFilled says what filling the unused 80C and 80CCD(1B) room
   would do, which is the question a new-regime winner asks next. saveOn10k is what Rs 10,000 more of old-regime
   deduction would cut the old tax by (a rupee figure, not a slab rate, so the 87A rebate and cess are in it). */
function compareRegimes(o) {
  const R = TAX_REGIME_IN, gross = accNum(o.gross), basic = Math.min(accNum(o.basic), gross);
  const age = R.oldSlabs[o.ageBand] ? o.ageBand : 'under60', senior = age !== 'under60';
  const hraReceived = Math.min(accNum(o.hraReceived), gross - basic);
  const empNps = { new: Math.min(accNum(o.employerNps), R.employerNps.new * basic),
                   old: Math.min(accNum(o.employerNps), R.employerNps.old * basic) };

  const newTaxable = Math.max(0, gross - R.standardDeduction.new - empNps.new);
  const newTax = regimeTax(newTaxable, 'new');

  const parts = {
    hra: hraExemption({ basic, hraReceived, rent: o.rent, metro: o.metro }),
    c80: Math.min(accNum(o.c80), R.c80),
    nps1b: Math.min(accNum(o.nps1b), R.nps1b),
    health: Math.min(accNum(o.health), senior ? R.d80.selfSenior : R.d80.self)
          + Math.min(accNum(o.healthParents), o.parentsSenior ? R.d80.parentsSenior : R.d80.parents),
    homeLoan: Math.min(accNum(o.homeLoanInterest), R.homeLoanInterest),
  };
  const deductions = parts.hra + parts.c80 + parts.nps1b + parts.health + parts.homeLoan;
  const oldBase = Math.max(0, gross - R.standardDeduction.old - empNps.old);
  const oldTaxable = Math.max(0, oldBase - deductions);
  const oldTax = regimeTax(oldTaxable, 'old', age);

  const oldAt = D => regimeTax(Math.max(0, oldBase - D), 'old', age);
  let breakEven = 0;
  if (oldAt(0) > newTax + 1e-6) {
    let lo = 0, hi = oldBase;
    for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (oldAt(mid) <= newTax + 1e-6) hi = mid; else lo = mid; }
    breakEven = hi;
  }

  const unused = { c80: R.c80 - parts.c80, nps1b: R.nps1b - parts.nps1b };
  const afterC80 = regimeTax(Math.max(0, oldTaxable - unused.c80), 'old', age);
  const afterBoth = regimeTax(Math.max(0, oldTaxable - unused.c80 - unused.nps1b), 'old', age);
  const winnerOf = (a, b) => Math.abs(a - b) < 1 ? 'tie' : (a > b ? 'new' : 'old');   // the dearer one loses

  return {
    ageBand: age, gross,
    new: { taxable: newTaxable, tax: newTax, employerNps: empNps.new, standardDeduction: R.standardDeduction.new },
    old: { taxable: oldTaxable, tax: oldTax, deductions, parts, employerNps: empNps.old, standardDeduction: R.standardDeduction.old },
    winner: winnerOf(oldTax, newTax), diff: oldTax - newTax, saving: Math.abs(oldTax - newTax),
    breakEven, headroom: deductions - breakEven, unused,
    oldIfFilled: { tax: afterBoth, winner: winnerOf(afterBoth, newTax), c80Saves: oldTax - afterC80, nps1bSaves: afterC80 - afterBoth },
    saveOn10k: oldTax - regimeTax(Math.max(0, oldTaxable - 10000), 'old', age),   // in rupees, cess and rebate included
    aboveSurcharge: Math.max(newTaxable, oldTaxable) > R.surchargeFrom,
  };
}

/* ---------------------------------------------------------------------
   Loans. Two questions, each answered with both sides and no verdict:
     homeLoanCompare  what a rupee put into the home loan saves after tax (a
                      guaranteed number) against what the same rupee is
                      expected to earn after tax (an expectation), and the
                      pre-tax return the investment would need to match
     debtAvalanche    several costly debts paid highest rate first, against
                      paying each one on its own
   Interest is monthly at rate/12, the way Indian lenders quote it.
   --------------------------------------------------------------------- */
// Equal monthly instalments on what is owed now. o = { balance, rate (yearly), years (left) }.
function loanSchedule(o) {
  const P = accNum(o.balance), r = accNum(o.rate) / 12, n = Math.max(1, Math.round(accNum(o.years) * 12));
  const emi = P === 0 ? 0 : (r === 0 ? P / n : P * r / (1 - Math.pow(1 + r, -n)));
  let bal = P, firstYearInterest = 0, firstYearPrincipal = 0, totalInterest = 0;
  for (let m = 1; m <= n && bal > 0.005; m++) {
    const i = bal * r, p = Math.min(bal, emi - i);
    bal -= p; totalInterest += i;
    if (m <= 12) { firstYearInterest += i; firstYearPrincipal += p; }
  }
  return { emi, months: n, firstYearInterest, firstYearPrincipal, totalInterest };
}

// A lump sum paid in now with the instalment left unchanged: the loan ends sooner. o as loanSchedule plus prepay.
function loanPrepay(o) {
  const base = loanSchedule(o), r = accNum(o.rate) / 12;
  let bal = Math.max(0, accNum(o.balance) - Math.min(accNum(o.prepay), accNum(o.balance))), months = 0, interest = 0;
  while (bal > 0.005 && months < base.months) {
    const i = bal * r;
    bal -= Math.min(bal, base.emi - i); interest += i; months++;
  }
  return { months, monthsSaved: base.months - months, totalInterest: interest, interestSaved: base.totalInterest - interest };
}

/* The home loan's after-tax cost against what the same money is expected to earn.
   Old regime: interest on a self-occupied house is deductible up to Rs 2 lakh a year (s.24(b)), so the loan's
   cost falls by the slab, but only on the part of the interest inside that limit. If the first year's interest
   is already above it, the NEXT rupee prepaid removes interest that gets no relief, so it saves the full rate
   (marginal); avg is the relief spread over the whole loan; lump is the rate for the amount actually being
   weighed, from its year-1 effect (loanRate is lump). New regime: no relief on a self-occupied house.
   o = { balance, rate, years, slab (fraction), regime ('old' | 'new'), amount (the lump sum being weighed),
         expected (pre-tax yearly return), kind ('equity' | 'debt' | 'fd') }.
   kind 'fd': interest is taxed every year at the slab. 'debt': the gain is taxed at the slab when sold. 'equity':
   12.5% on the gain above the Rs 1.25 lakh exemption when sold, which the amount is held to for `years`. Returns
   are annualised so they compare with the loan's yearly rate. breakEven is the pre-tax return that matches the
   loan (null if it is beyond 100% a year). */
function homeLoanCompare(o) {
  const R = TAX_REGIME_IN, cess = 1 + TAX_IN.cess, slab = Number(o.slab) || 0, r = accNum(o.rate), tax = slab * cess;
  const sched = loanSchedule(o), first = sched.firstYearInterest;
  const claim = Math.min(first, R.homeLoanInterest), capped = first > R.homeLoanInterest;
  const amt = accNum(o.amount);
  // The lump sum is a block, not "the next rupee": paid in with the instalment left alone, it lowers the first
  // year's interest from `first` to `firstAfter`. Relief is lost only on the part of that drop that was inside
  // the Rs 2 lakh limit, so a loan just above the limit loses some relief and one far above it loses none.
  // With no amount to weigh, fall back to the next rupee (marginal).
  let bal = Math.max(0, accNum(o.balance) - Math.min(amt, accNum(o.balance))), firstAfter = 0;
  for (let m = 1; m <= 12 && bal > 0.005; m++) { const i = bal * r / 12; firstAfter += i; bal -= Math.min(bal, sched.emi - i); }
  const removed = first - firstAfter, reliefLost = (claim - Math.min(firstAfter, R.homeLoanInterest)) * tax;
  const marginal = capped ? r : r * (1 - tax);
  const oldReg = { avg: r * (1 - (first > 0 ? claim / first : 0) * tax), marginal, taxSaved: claim * tax, claim, capped,
                   lump: amt > 0 && removed > 1e-9 ? r * (1 - reliefLost / removed) : marginal };
  const newReg = { avg: r, marginal: r, lump: r, taxSaved: 0, claim: 0, capped: false };
  const loan = o.regime === 'new' ? newReg : oldReg;

  const n = Math.max(1, Math.round(accNum(o.years)) || 1);
  const kind = o.kind === 'fd' || o.kind === 'debt' ? o.kind : 'equity';
  const afterTax = ret => {
    ret = Math.max(0, Number(ret) || 0);
    if (kind === 'fd') return ret * (1 - tax);
    if (kind === 'equity' && !(amt > 0)) return ret;
    const A = amt > 0 ? amt : 1, fv = A * Math.pow(1 + ret, n), gain = fv - A;
    const t = kind === 'debt' ? gain * tax : Math.max(0, gain - TAX_IN.equityLtcgExemption) * TAX_IN.equityLtcg * cess;
    return Math.pow((fv - t) / A, 1 / n) - 1;
  };
  const target = loan.lump;
  let breakEven = 0;
  if (afterTax(0) < target) {
    if (afterTax(1) < target) breakEven = null;
    else { let lo = 0, hi = 1; for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (afterTax(mid) >= target) hi = mid; else lo = mid; } breakEven = hi; }
  }
  const expectedAfterTax = afterTax(o.expected);
  return { schedule: sched, old: oldReg, new: newReg, loanRate: target, expectedAfterTax, breakEven,
    afterPrepay: { firstYearInterest: firstAfter, removed, reliefLost },
    gapPerYear: amt * (expectedAfterTax - target) };
}

/* Costly debts paid highest interest first. A debt that is paid off hands its whole payment to the next one
   (the snowball), and `extra` is on top. The baseline is what happens if each debt just keeps its own payment.
   Fifty years is the cutoff: a payment that does not even cover a month's interest never clears the debt.
   o = { debts: [{ name, balance, rate (yearly), payment (monthly) }], extra (monthly) }. */
function debtAvalanche(o) {
  const debts = (o.debts || []).map(d => ({ name: String(d.name || ''), balance: accNum(d.balance), rate: accNum(d.rate), payment: accNum(d.payment) }))
    .filter(d => d.balance > 0);
  const extra = accNum(o.extra), CAP = 600;
  const run = (avalanche) => {
    const ds = debts.map(d => ({ name: d.name, rate: d.rate, payment: d.payment, bal: d.balance, month: null }));
    let month = 0, interest = 0, paid = 0;
    while (ds.some(d => d.bal > 0.005) && month < CAP) {
      month++;
      ds.forEach(d => { if (d.bal > 0.005) { const i = d.bal * d.rate / 12; d.bal += i; interest += i; } });
      let pool = avalanche ? extra + ds.reduce((s, d) => s + d.payment, 0) : 0;
      ds.forEach(d => {
        if (d.bal <= 0.005) return;
        const p = Math.min(d.bal, d.payment);
        d.bal -= p; paid += p;
        if (avalanche) pool -= p;
      });
      if (avalanche) {
        ds.filter(d => d.bal > 0.005).sort((a, b) => b.rate - a.rate).forEach(d => {
          if (pool <= 0) return;
          const p = Math.min(d.bal, pool);
          d.bal -= p; paid += p; pool -= p;
        });
      }
      ds.forEach(d => { if (d.bal <= 0.005 && d.month === null) { d.bal = 0; d.month = month; } });
    }
    return { months: month, totalInterest: interest, totalPaid: paid, neverPaysOff: ds.some(d => d.bal > 0.005),
      payoffs: ds.map(d => ({ name: d.name, rate: d.rate, month: d.month })) };
  };
  const plan = run(true), baseline = run(false);
  return { order: debts.slice().sort((a, b) => b.rate - a.rate).map(d => d.name), plan, baseline,
    monthlyOutlay: debts.reduce((s, d) => s + d.payment, 0) + extra, total: debts.reduce((s, d) => s + d.balance, 0),
    interestSaved: plan.neverPaysOff || baseline.neverPaysOff ? null : baseline.totalInterest - plan.totalInterest,
    monthsSaved: plan.neverPaysOff || baseline.neverPaysOff ? null : baseline.months - plan.months };
}

/* ---------------------------------------------------------------------
   Protection check: how much cover, not what it costs (there is no honest
   premium source, so none is shown).
   termCoverNeed: the lump sum a family would need if the earner were gone =
     the household's yearly spending for as long as the dependants rely on the
     income (today's money, raised by inflation, paid out of a pot that earns
     `returnRate`), plus loans outstanding, plus the goal pots (each worth its
     target discounted back to today at returnRate, because the SIP that was to
     build it stops), minus savings and cover already held.
   o = { annualExpense, years, inflation, returnRate, loans, goalPots: [{ label, corpus, years }],
         savings, existingCover }
   --------------------------------------------------------------------- */
function termCoverNeed(o) {
  const years = Math.min(60, Math.max(0, Math.round(Number(o.years) || 0)));
  const infl = Number(o.inflation) || 0, ret = Number(o.returnRate) || 0;
  const expense = years > 0 ? accNum(o.annualExpense) * corpusRequired(realRate(ret, infl), years, 1, true) : 0;
  const goals = (Array.isArray(o.goalPots) ? o.goalPots : []).map(g => {
    const corpus = accNum(g && g.corpus), gy = Math.max(0, Number(g && g.years) || 0);
    return { label: String((g && g.label) || ''), corpus, years: gy, today: corpus / Math.pow(1 + ret, gy) };
  });
  const goalPV = goals.reduce((s, g) => s + g.today, 0), loans = accNum(o.loans);
  const gross = expense + loans + goalPV, offsets = accNum(o.savings) + accNum(o.existingCover);
  return { expense, loans, goalPV, goals, gross, savings: accNum(o.savings), existingCover: accNum(o.existingCover),
    gap: Math.max(0, gross - offsets), surplus: Math.max(0, offsets - gross) };
}

/* Health cover, with the idea of a super top-up. `target` is the total the person wants in today's money; a
   family floater of `baseCover` takes the first part and a super top-up with that same deductible covers the
   rest. Medical costs rise, so the same total bought `years` from now has to be `medInflation` larger. Cover from
   an employer ends with the job, so the gap is shown with and without it.
   o = { target, baseCover, medInflation, years, own, employer } */
function healthCoverPlan(o) {
  const target = accNum(o.target), base = Math.min(target, accNum(o.baseCover));
  const years = Math.min(60, Math.max(0, Math.round(Number(o.years) || 0))), infl = Number(o.medInflation) || 0;
  const own = accNum(o.own), employer = accNum(o.employer);
  return { target, base, topUp: target - base, deductible: base, years,
    inflatedTarget: target * Math.pow(1 + infl, years),
    gap: Math.max(0, target - own - employer), gapOwnOnly: Math.max(0, target - own), own, employer };
}

/* ---------------------------------------------------------------------
   Holdings review (India): what a person already owns, against the mix their
   risk profile asks for. Category level only, which is all a typed list can
   support: whether two funds hold the same companies needs each fund's own
   portfolio file (AMFI publishes them), which nothing here reads.

   Nothing is guessed. A holding is put in a category only when its name says
   which (holdingCategoryFromName returns null otherwise) or the person picks
   one; a holding with no category is left out of the mix and reported as such.
   A plan is called Direct or Regular only when the name says so.
   --------------------------------------------------------------------- */

// The Full Plan's five risk profiles as equity / debt / hybrid shares. goalden-door2.html's BUCKETS says the same;
// smoke-22 compares the two, so they cannot drift apart.
const RISK_PROFILES_IN = {
  conservative:     { name: 'Conservative',            eq: 0.20, de: 0.60, hy: 0.20 },
  mod_conservative: { name: 'Moderately Conservative', eq: 0.35, de: 0.50, hy: 0.15 },
  moderate:         { name: 'Moderate',                eq: 0.50, de: 0.35, hy: 0.15 },
  mod_aggressive:   { name: 'Growth-Oriented',         eq: 0.70, de: 0.20, hy: 0.10 },
  aggressive:       { name: 'Aggressive',              eq: 0.85, de: 0.10, hy: 0.05 },
};

// cls: equity / debt / hybrid are the three parts of a risk profile; gold and other sit outside it.
// job: categories with the same job are the ones the duplicate note groups (a Nifty 50 index fund and a large-cap fund
// hold largely the same companies); null means no claim is made about overlap.
const HOLDING_CATS_IN = [
  { id: 'largecap',   label: 'Large-cap fund',                                 cls: 'equity', job: 'large',      jobLabel: 'large-cap shares' },
  { id: 'index',      label: 'Index fund or ETF on the Nifty 50 or Sensex',    cls: 'equity', job: 'large',      jobLabel: 'large-cap shares' },
  { id: 'largemid',   label: 'Large and mid-cap fund',                         cls: 'equity', job: 'largemid',   jobLabel: 'large and mid-cap shares' },
  { id: 'midcap',     label: 'Mid-cap fund',                                   cls: 'equity', job: 'mid',        jobLabel: 'mid-cap shares' },
  { id: 'smallcap',   label: 'Small-cap fund',                                 cls: 'equity', job: 'small',      jobLabel: 'small-cap shares' },
  { id: 'flexi',      label: 'Flexi-cap or multi-cap fund',                    cls: 'equity', job: 'allcap',     jobLabel: 'shares of companies of every size' },
  { id: 'elss',       label: 'ELSS (tax-saving) fund',                         cls: 'equity', job: 'allcap',     jobLabel: 'shares of companies of every size' },
  { id: 'sectoral',   label: 'Sector or theme fund',                           cls: 'equity', job: null },
  { id: 'intl',       label: 'International fund or ETF',                      cls: 'equity', job: null },
  { id: 'otherequity', label: 'Other equity fund',                             cls: 'equity', job: null },
  { id: 'shares',     label: 'Shares of single companies',                     cls: 'equity', job: null },
  { id: 'liquid',     label: 'Liquid, overnight or money-market fund',         cls: 'debt',   job: 'liquid',     jobLabel: 'short-term parking' },
  { id: 'shortdebt',  label: 'Ultra-short or short-duration debt fund',        cls: 'debt',   job: 'shortdebt',  jobLabel: 'short-duration debt' },
  { id: 'bonddebt',   label: 'Corporate bond, banking and PSU or credit fund', cls: 'debt',   job: 'bonddebt',   jobLabel: 'corporate and PSU bonds' },
  { id: 'gilt',       label: 'Gilt or long-duration fund',                     cls: 'debt',   job: 'gilt',       jobLabel: 'government bonds' },
  { id: 'fd',         label: 'Fixed deposit or savings account',               cls: 'debt',   job: null },
  { id: 'baf',        label: 'Balanced advantage fund',                        cls: 'hybrid', job: 'baf',        jobLabel: 'balanced advantage' },
  { id: 'aggrhybrid', label: 'Aggressive hybrid fund',                         cls: 'hybrid', job: 'aggrhybrid', jobLabel: 'aggressive hybrid' },
  { id: 'multiasset', label: 'Multi-asset fund',                               cls: 'hybrid', job: 'multiasset', jobLabel: 'multi-asset' },
  { id: 'arbitrage',  label: 'Arbitrage fund',                                 cls: 'hybrid', job: 'arbitrage',  jobLabel: 'arbitrage' },
  { id: 'otherhybrid', label: 'Other hybrid fund',                             cls: 'hybrid', job: null },
  { id: 'gold',       label: 'Gold or silver fund, ETF or bond',               cls: 'gold',   job: 'gold',       jobLabel: 'gold' },
  { id: 'other',      label: 'Something else (property, crypto, ...)',         cls: 'other',  job: null },
];

// The category a fund's own name settles, or null. Order matters: the more specific words come first ("dynamic asset
// allocation" before "dynamic bond", "Equity & Debt" before "debt", "Banking & PSU" before "banking").
function holdingCategoryFromName(name) {
  // Hyphens and slashes read as spaces: "Large-cap", "Flexi-cap", "Short-duration" and "Large/Mid" are written both ways.
  const n = String(name || '').toLowerCase().replace(/income distribution cum capital withdrawal|\bidcw\b/g, ' ').replace(/[-_/]+/g, ' ');
  if (!n.trim()) return null;
  if (/nasdaq|fang|nyse|\b(us|u\.s\.|international|global|overseas|world|emerging markets?|feeder|china|japan|hang seng|taiwan|europe|asia)\b|s&p ?500/.test(n)) return 'intl';
  if (/\bgold\b|\bsilver\b/.test(n)) return 'gold';
  if (/arbitrage/.test(n)) return 'arbitrage';
  if (/balanced advantage|dynamic asset|asset allocat/.test(n)) return 'baf';
  if (/aggressive hybrid|equity\s*(&|and)\s*debt/.test(n)) return 'aggrhybrid';
  if (/multi.?asset/.test(n)) return 'multiasset';
  if (/equity savings|conservative hybrid|balanced|hybrid/.test(n)) return 'otherhybrid';
  if (/liquid|overnight|money market/.test(n)) return 'liquid';
  if (/gilt|g ?sec|constant maturity|long duration|dynamic bond/.test(n)) return 'gilt';
  if (/ultra short|short (term|duration)|low duration|floater|floating/.test(n)) return 'shortdebt';
  if (/corporate bond|banking\s*(&|and)\s*psu|credit risk|\bbond\b|\bdebt\b|income fund|medium duration|medium to long|target maturity|\bsdl\b/.test(n)) return 'bonddebt';
  if (/elss|tax saver|tax saving|tax ?shield/.test(n)) return 'elss';
  if (/small ?cap/.test(n)) return 'smallcap';
  if (/large\s*(&|and)?\s*mid/.test(n)) return 'largemid';
  if (/mid ?cap/.test(n)) return 'midcap';
  if (/nifty ?50\b|nifty ?bees|sensex|nifty ?100\b/.test(n)) return 'index';
  if (/\bindex\b|\betf\b|nifty/.test(n)) return null;   // an index of what? the name does not say here
  if (/large ?cap|blue ?chip|top 100|frontline/.test(n)) return 'largecap';
  if (/flexi ?cap|multi ?cap/.test(n)) return 'flexi';
  if (/pharma|healthcare|banking|financial services|technology|\bit\b|infrastructure|consumption|\bpsu\b|energy|manufacturing|thematic|sector|\bauto\b|fmcg|digital|innovation/.test(n)) return 'sectoral';
  return null;
}

// What a fund's own name says about its plan. Direct is claimed only on a positive match; a name that says neither is
// "unstated", never assumed.
function fundPlanFromName(name) {
  const n = String(name || '');
  return /direct/i.test(n) ? 'direct' : /regular/i.test(n) ? 'regular' : 'unstated';
}
// Typical extra yearly cost of a Regular plan over the Direct plan of the same fund (distributor commission): estimates,
// to be said to be estimates wherever shown. Roughly 1% for an actively managed equity fund, much less for an index fund.
const REGULAR_EXTRA = { active: 0.01, passive: 0.004 };
// The yearly extra cost of a Regular plan, or null when none is claimed (not named Regular) or when the figure is too
// wide to put one number on (debt funds range from about 0.1% for liquid funds to 0.6% or more for credit funds) or
// when the category is not one this estimate was made for (gold).
function regularExtra(name, plan, catId) {
  if ((plan || fundPlanFromName(name)) !== 'regular') return null;
  const cat = HOLDING_CATS_IN.find(c => c.id === catId);
  // With a category the category decides (so "Equity & Debt" in a hybrid fund's name does not switch the estimate off);
  // with none, as for a fund found by name in Test Real Investments, the words in the name have to.
  if (cat ? (cat.cls === 'debt' || cat.cls === 'gold' || cat.id === 'arbitrage')
          : /liquid|overnight|money market|debt|bond|gilt|duration|credit|arbitrage|floater|floating|treasury|banking\s*(&|and)\s*psu|corporate/i.test(String(name || ''))) return null;
  return catId === 'index' || /index|nifty|sensex|etf/i.test(String(name || '')) ? REGULAR_EXTRA.passive : REGULAR_EXTRA.active;
}

/* The review itself.
   o = { holdings: [{ name, cat (a HOLDING_CATS_IN id or ''), value (what it is worth now), cost (what was put in, or
         null/'' when not known), plan ('direct' | 'regular' | 'unstated'; read from the name when absent),
         longTerm (false when held under a year; equity only) }],
         target { eq, de, hy } (a RISK_PROFILES_IN entry),
         sip (monthly new money), sipMonths (how many months of it to count; default 12),
         years (horizon for the Regular-plan cost, default 10), expected (yearly return, fraction, default 0.12),
         exemptUsed (equity gains already booked this year against the Rs 1.25 lakh) }.
   mix: the three parts of the profile, as shares of what is in the profile (gold, other and uncategorised holdings are
   reported beside it, not in it). rebalance: new money goes to the parts under their share first; what is still over
   after that is what would have to be sold, and for equity the tax on selling it is worked out from the cost the person
   gave (long-term units only: the Rs 1.25 lakh a year is free of tax, the rest at 12.5% on the gain). Debt and hybrid
   funds are taxed by when they were bought and what they hold, so for those the amount is shown and the tax is not. */
function reviewHoldings(o) {
  const CLS = ['equity', 'debt', 'hybrid'], T = TAX_IN, cess = 1 + T.cess;
  const catOf = {}; HOLDING_CATS_IN.forEach(c => { catOf[c.id] = c; });
  const clampN = (v, lo, hi, d) => { v = Number(v); return isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
  const rows = (Array.isArray(o && o.holdings) ? o.holdings : []).slice(0, 60).map(h => {
    const name = String((h && h.name) || '').slice(0, 80), cat = h && Object.prototype.hasOwnProperty.call(catOf, h.cat) ? h.cat : '';
    const isFund = !!cat && !['shares', 'fd', 'other'].includes(cat);
    return { name, cat, cls: cat ? catOf[cat].cls : null, job: cat ? catOf[cat].job : null, value: accNum(h && h.value),
      cost: h && accNum(h.cost) > 0 ? accNum(h.cost) : null,   // a cost of 0, blank or garbled means "not known", not "a free gift"
      plan: isFund || !cat ? (['direct', 'regular', 'unstated'].includes(h && h.plan) ? h.plan : fundPlanFromName(name)) : null,
      longTerm: !(h && h.longTerm === false), isFund };
  }).filter(r => r.value > 0);

  const total = rows.reduce((s, r) => s + r.value, 0);
  const by = { equity: 0, debt: 0, hybrid: 0 };
  let gold = 0, other = 0, unset = 0;
  rows.forEach(r => { if (!r.cat) unset += r.value; else if (by[r.cls] !== undefined) by[r.cls] += r.value; else if (r.cls === 'gold') gold += r.value; else other += r.value; });
  const mixTotal = by.equity + by.debt + by.hybrid;
  const tg = o && o.target ? { equity: accNum(o.target.eq), debt: accNum(o.target.de), hybrid: accNum(o.target.hy) } : null;
  const tgSum = tg ? tg.equity + tg.debt + tg.hybrid : 0;
  const tgt = tgSum > 0 ? { equity: tg.equity / tgSum, debt: tg.debt / tgSum, hybrid: tg.hybrid / tgSum }
                        : { equity: RISK_PROFILES_IN.moderate.eq, debt: RISK_PROFILES_IN.moderate.de, hybrid: RISK_PROFILES_IN.moderate.hy };
  const mix = CLS.map(c => { const share = mixTotal > 0 ? by[c] / mixTotal : 0; return { cls: c, value: by[c], share, target: tgt[c], drift: share - tgt[c] }; });

  // funds doing the same job, by category only
  const jobs = {};
  rows.forEach(r => { if (r.job) (jobs[r.job] = jobs[r.job] || []).push(r); });
  const overlap = Object.keys(jobs).filter(j => jobs[j].length >= 2).map(j => {
    const g = jobs[j], v = g.reduce((s, r) => s + r.value, 0);
    return { job: j, label: catOf[g[0].cat].jobLabel, count: g.length, value: v, share: total > 0 ? v / total : 0,
      names: g.map(r => r.name || catOf[r.cat].label), cats: Array.from(new Set(g.map(r => r.cat))) };
  }).sort((a, b) => b.value - a.value);

  // what Regular plans cost, an estimate
  const years = Math.round(clampN(o && o.years, 1, 40, 10)), er = clampN(o && o.expected, 0, 0.3, 0.12);
  // Direct and Regular exist only for mutual funds, so a name that says one is a fund even when no category was set for it.
  const planned = rows.filter(r => r.isFund || (!r.cat && r.plan !== 'unstated'));
  const regular = planned.filter(r => r.plan === 'regular').map(r => {
    const x = regularExtra(r.name, r.plan, r.cat);
    return { name: r.name, value: r.value, extra: x, perYear: x === null ? null : r.value * x,
      drag: x === null ? null : r.value * (Math.pow(1 + er, years) - Math.pow(Math.max(0, 1 + er - x), years)) };
  });
  const priced = regular.filter(r => r.extra !== null);
  const cost = { regular, unpriced: regular.length - priced.length, perYear: priced.reduce((s, r) => s + r.perYear, 0),
    drag: priced.reduce((s, r) => s + r.drag, 0), years, expected: er, unstated: rows.filter(r => r.isFund && r.plan === 'unstated' && !/\betf\b|\bbees\b|exchange traded/i.test(r.name)).length,   // an ETF has one plan, so naming none is not a gap
    direct: planned.filter(r => r.plan === 'direct').length };

  // getting back to the profile: new money first, then sales
  const sip = accNum(o && o.sip), months = Math.round(clampN(o && o.sipMonths, 0, 60, 12)), N = sip * months, W = mixTotal + N;
  const overNow = CLS.reduce((s, c) => s + Math.max(0, by[c] - tgt[c] * mixTotal), 0);
  const excess = {}, shortBy = {}; let over = 0, short = 0;
  CLS.forEach(c => { const d = by[c] - tgt[c] * W; if (d > 0) { excess[c] = d; over += d; } else { shortBy[c] = -d; short += -d; } });
  const split = CLS.filter(c => shortBy[c] > 0).map(c => ({ cls: c, amount: short > 0 ? N * shortBy[c] / short : 0 }));
  let monthsToFix = null;
  if (overNow <= 1) monthsToFix = 0;
  else if (sip > 0) {
    let need = 0, never = false;
    CLS.forEach(c => { if (by[c] > tgt[c] * mixTotal) { if (tgt[c] > 0) need = Math.max(need, by[c] / tgt[c] - mixTotal); else never = true; } });
    const m = never ? null : Math.ceil(need / sip);
    monthsToFix = m !== null && m <= 600 ? m : null;
  }
  const eqRows = rows.filter(r => r.cls === 'equity');
  const ltKnown = eqRows.filter(r => r.longTerm && r.cost !== null);
  const ltValue = ltKnown.reduce((s, r) => s + r.value, 0);
  const gainRatio = ltValue > 0 ? ltKnown.reduce((s, r) => s + (r.value - r.cost), 0) / ltValue : null;
  const room = Math.max(0, T.equityLtcgExemption - accNum(o && o.exemptUsed));
  const sells = Object.keys(excess).filter(c => excess[c] > 1).map(c => {
    const amount = excess[c];
    if (c !== 'equity') return { cls: c, amount, worked: false };
    const fromLt = Math.min(amount, ltValue), rest = amount - fromLt;
    const g = gainRatio === null ? 0 : gainRatio;
    const taxFree = g > 0 ? Math.min(fromLt, room / g) : fromLt;
    const taxable = fromLt - taxFree;
    return { cls: c, amount, worked: fromLt > 0, fromLongTerm: fromLt, notWorkedOut: rest, gainRatio: gainRatio, taxFree, taxable,
      tax: g > 0 ? taxable * g * T.equityLtcg * cess : 0,
      freeEachYear: g > 0 ? T.equityLtcgExemption / g : null };
  });
  const rebalance = { sip, months, newMoney: N, overNow, overAfter: over, monthsToFix, split, sells, exemptRoom: room,
    unknownCost: eqRows.filter(r => r.longTerm && r.cost === null).reduce((s, r) => s + r.value, 0),
    shortTerm: eqRows.filter(r => !r.longTerm).reduce((s, r) => s + r.value, 0) };

  return { total, rows, mixTotal, mix, outside: { gold, other }, unset, overlap, cost, rebalance, target: tgt };
}

/* ---------------------------------------------------------------------
   The yearly plan review (B5): one fixed checklist across the Lab's tools,
   turned into a dated to-do list. Pure: the page works out each area's
   numbers with the same functions its tabs draw from and passes them in;
   this decides what needs doing, by when and in what order. The advisor can
   start the review and read it back, but it cannot skip a check or add an
   action of its own.
   Rules, so a reviewer can check them:
   - Only numbers the person gave are reviewed. The page decides that field by
     field and passes { missing: 'what is still needed' } for an area it cannot
     review, or leaves a part out (and says so) when only that part is missing.
     Nothing is ever reviewed on the app's starting values, which describe an
     example person.
   - When: the emergency fund, costly debt, cover gaps and a monthly shortfall
     are this month. Anything that spends this financial year's tax room
     (80C/NPS, the tax-free equity gains, a sale to rebalance, a Regular-to-
     Direct move) is before 31 March. The regime choice is made in the return,
     due 31 July for most salaried people. Tidying up waits for the next
     review, a year on. The list runs in date order.
   - Within one date, the usual Indian planning order: emergency fund, costly
     debt, term cover, health cover, then the savings gap and the mix.
   - A mix within 5 percentage points of the profile on every part is left
     alone (a common rebalancing band). Regimes under Rs 1,000 apart are a tie.
   o = { today:'YYYY-MM-DD', country, fmt, areas:{ id: object | null }, skipped:[ids] }
   --------------------------------------------------------------------- */
const REVIEW_AREAS = [
  { id: 'health', label: 'Savings against your goals, and the emergency fund' },
  { id: 'debt', label: 'Costly debt', india: true },
  { id: 'cover', label: 'Term and health cover', india: true },
  { id: 'tax', label: 'Old or new tax regime', india: true },
  { id: 'holdings', label: 'What you own against your profile', india: true },
  { id: 'harvest', label: 'Tax-free equity gains this year', india: true },
  { id: 'retirement', label: 'Retirement through a crash' },
  { id: 'income', label: 'Drawing a retirement income', india: true },
];
const REVIEW_DRIFT_BAND = 0.05, REVIEW_TAX_TIE = 1000;
const REVIEW_WHEN = ['month', 'fyEnd', 'filing', 'next'];

// today -> the due dates. India's financial year ends 31 March. A return is due 31 July for most salaried people, and
// the next one due is this year's from April to July (the year just ended), next year's from August on.
function reviewDates(today) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(today || ''));
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const days = (Y, M) => new Date(Date.UTC(Y, M, 0)).getUTCDate();
  if (mo < 1 || mo > 12 || d < 1 || d > days(y, mo)) return null;
  const iso = (Y, M, D) => Y + '-' + String(M).padStart(2, '0') + '-' + String(D).padStart(2, '0');
  const fy = mo >= 4 ? y + 1 : y;   // the year the current financial year ends in
  return { today: iso(y, mo, d), month: iso(y, mo, days(y, mo)), fyEnd: iso(fy, 3, 31), filing: iso(mo <= 7 ? y : y + 1, 7, 31),
    next: iso(y + 1, mo, Math.min(d, days(y + 1, mo))) };
}
// The four "when"s in the order their dates fall.
function reviewWhenOrder(dates) { return REVIEW_WHEN.slice().sort((a, b) => (dates[a] < dates[b] ? -1 : dates[a] > dates[b] ? 1 : 0)); }

function yearlyReview(o) {
  o = o || {};
  const dates = reviewDates(o.today);
  if (!dates) return { ok: false, error: 'today must be a real date, YYYY-MM-DD' };
  const order = reviewWhenOrder(dates);
  const fmt = typeof o.fmt === 'function' ? o.fmt : (v => String(Math.round(v)));
  const us = o.country === 'US';
  const A = o.areas && typeof o.areas === 'object' ? o.areas : {};
  const skipped = Array.isArray(o.skipped) ? o.skipped : [];
  const n = v => { v = Number(v); return isFinite(v) ? v : 0; };
  const pct = v => Math.round(n(v) * 100) + '%';
  const arr = v => Array.isArray(v) ? v.filter(x => x && typeof x === 'object') : [];
  const str = v => typeof v === 'string' ? v : '';
  const checks = [], actions = [];
  REVIEW_AREAS.forEach((a, ai) => {
    const row = { area: a.id, label: a.label, status: 'ok', finding: '' };
    checks.push(row);
    if (a.india && us) { row.status = 'na'; row.finding = 'Uses Indian rules, so it is not part of a US review.'; return; }
    if (skipped.indexOf(a.id) !== -1) { row.status = 'skipped'; row.finding = 'Left out of this review.'; return; }
    const d = A[a.id];
    if (!d || typeof d !== 'object' || d.missing) { row.status = 'missing'; row.finding = d && typeof d === 'object' ? str(d.missing) : ''; return; }
    const notes = [], start = actions.length;
    let partial = false;
    const act = (when, rank, text, amount) => actions.push({ area: a.id, when, due: dates[when], rank, order: ai,
      text: text.trim(), amount: amount == null ? null : Math.round(n(amount)) });
    const gap = text => { partial = true; notes.push(text); };
    switch (a.id) {
      case 'health': {
        // The two parts are separate answers: one given does not make the other the person's own.
        const cap = n(d.capacity), need = n(d.totalSIP);
        if (d.emergency === 'no') act('month', 1, 'Build an emergency fund before adding to investments: a few months of spending, somewhere you can reach within a day.');
        else if (d.emergency === 'partial') act('month', 1, 'Finish the emergency fund before raising investments.');
        else if (d.emergency === 'full') notes.push('The emergency fund is in place.');
        else gap(str(d.emergencyNeed) || 'Emergency fund not checked.');
        if (d.capacity == null || d.totalSIP == null) gap(str(d.savingsNeed) || 'Savings against goals not checked.');
        else if (need > cap) act('month', 5, 'Your goals need ' + fmt(need) + ' a month and you can save ' + fmt(cap) + ', so ' + fmt(need - cap) + ' is missing each month. Move a goal later, make one smaller or save more; the Full Plan shows which goal makes the gap.', need - cap);
        else notes.push('You can save ' + fmt(cap) + ' a month and your goals need ' + fmt(need) + (cap > need ? ', leaving ' + fmt(cap - need) + ' spare.' : '.'));
        break;
      }
      case 'debt': {
        const debts = arr(d.debts).filter(x => n(x.balance) > 0).sort((p, q) => n(q.rate) - n(p.rate));
        const total = debts.reduce((s, x) => s + n(x.balance), 0);
        (Array.isArray(d.notEntered) ? d.notEntered : []).forEach(x => gap('No ' + String(x).toLowerCase() + ' balance entered, so it is left out.'));
        if (total <= 0) { notes.push('No costly debt in what was entered.'); break; }
        const list = debts.map(x => String(x.name || 'debt').toLowerCase() + ' at ' + Math.round(n(x.rate) * 1000) / 10 + '%' + (x.rateGiven === false ? ' (a typical rate)' : ''));
        // How long it takes depends on the payments, so it is only said when every payment was given.
        const when = d.months == null ? (d.neverClears ? 'At the payments entered it never clears, so the payments have to go up.' : 'Enter what you pay each month in Loans to see how long it takes.')
          : d.neverClears ? 'At the payments entered it never clears, so the payments have to go up.' : 'At the payments entered it is gone in ' + Math.round(n(d.months)) + ' months.';
        act('month', 2, 'Clear ' + fmt(total) + ' of costly debt before investing more, highest rate first (' + list.join(', then ') + '). ' + when, total);
        break;
      }
      case 'cover': {
        const t = d.term && typeof d.term === 'object' ? d.term : null, h = d.health && typeof d.health === 'object' ? d.health : null;
        if (!t) gap(str(d.termNeed) || 'Term cover not checked.');
        else if (n(t.gap) > 0) act('month', 3, 'Raise term life cover by ' + fmt(n(t.gap)) + ': your family would need ' + fmt(n(t.need)) + ', and savings of ' + fmt(n(t.savings)) + ' plus cover of ' + fmt(n(t.existing)) + ' leave that much uncovered.', n(t.gap));
        else notes.push('Term cover of ' + fmt(n(t.existing)) + ' plus savings of ' + fmt(n(t.savings)) + ' meets the ' + fmt(n(t.need)) + ' your family would need.');
        const tgt = (h && h.targetGiven === false) ? ' (the starting target for your city size; set your own in Cover)' : '';
        if (!h) gap(str(d.healthNeed) || 'Health cover not checked.');
        else if (n(h.short) > 0) act('month', 4, 'Add ' + fmt(n(h.short)) + ' of health cover to reach ' + fmt(n(h.target)) + tgt + '. The Cover tab splits it into a family floater and a super top-up.', n(h.short));
        else if (n(h.shortOwn) > 0) notes.push('Health cover reaches ' + fmt(n(h.target)) + tgt + ' only with your employer\'s policy, which ends with the job; on your own policy you would be ' + fmt(n(h.shortOwn)) + ' short.');
        else notes.push('Health cover reaches ' + fmt(n(h.target)) + tgt + ' on your own policy.');
        break;
      }
      case 'tax': {
        const nw = n(d.newTax), od = n(d.oldTax), best = Math.min(nw, od), saving = Math.abs(nw - od);
        const room = n(d.room), filled = n(d.filledTax);
        // Filling the old regime's room can turn it from the dearer option into the cheaper one. Then the two lines
        // must agree: the investment comes first, and the filing line says which regime follows from it.
        const fill = room > 0 && d.filledTax != null && filled < best - REVIEW_TAX_TIE;
        const keepOld = 'File by the due date to keep it: a late return is taxed under the new regime.';
        if (fill) act('fyEnd', 2, 'Putting ' + fmt(room) + ' more into 80C and NPS (80CCD(1B)) before 31 March would bring the old-regime tax to ' + fmt(filled) + ', ' + fmt(best - filled) + ' below the cheaper option today. Only worth it with money you would invest anyway.', best - filled);
        if (fill && nw <= od) act('filing', 1, 'On these numbers the new regime costs ' + fmt(od - nw) + ' less (' + fmt(nw) + ' new, ' + fmt(od) + ' old). If you make the 80C and NPS investments above, the old regime comes out ' + fmt(nw - filled) + ' cheaper instead; choose the one that matches what you did when you file. ' + keepOld);
        else if (saving < REVIEW_TAX_TIE) notes.push('The two regimes cost about the same on these numbers: ' + fmt(nw) + ' new, ' + fmt(od) + ' old.');
        else act('filing', 1, 'The ' + (nw < od ? 'new' : 'old') + ' regime costs ' + fmt(saving) + ' less on these numbers (' + fmt(nw) + ' new, ' + fmt(od) + ' old). Choose it when you file your return, and tell your employer at the start of each financial year so the tax held back from your pay matches.' + (nw < od ? '' : ' ' + keepOld), saving);
        if (d.assumedNone) notes.push('Counted as none: ' + String(d.assumedNone) + '.');
        if (d.aboveSurcharge) notes.push('Income is above the surcharge line, which is not counted, so both figures are too low.');
        break;
      }
      case 'holdings': {
        const mix = arr(d.mix);
        if (d.profileGiven === false || !mix.length) {
          gap(d.profileGiven === false ? 'Mix not checked: pick your risk profile in My holdings, or open it from your Full Plan.' : 'Mix not checked: nothing listed has a category in the mix (equity, debt or hybrid) yet.');
        } else {
          const prof = String(d.profile || 'your'), months = Math.round(n(d.months));
          const desc = mix.map(m => String(m.cls) + ' ' + pct(m.share) + ' (profile ' + pct(m.target) + ')').join(', ');
          if (!mix.some(m => Math.abs(n(m.drift)) > REVIEW_DRIFT_BAND + 1e-9)) notes.push('Every part is within 5 points of the ' + prof + ' profile: ' + desc + '. No change.');
          else if (d.sipGiven === false) act('month', 6, 'Your mix is off the ' + prof + ' profile: ' + desc + '. Enter how much you add each month in My holdings to see how new money closes the gap before selling anything.');
          else {
            const toNew = arr(d.split).filter(s => n(s.amount) >= 1), sells = arr(d.sells).filter(s => n(s.amount) >= 1);
            const sell = n(d.overAfter) >= 1 && sells.length;
            if (toNew.length) act('month', 6, 'Your mix is off the ' + prof + ' profile: ' + desc + '. Put new money into ' + toNew.map(s => String(s.cls) + ' (' + fmt(n(s.amount)) + ')').join(' and ') + ' over the next ' + months + ' month' + (months === 1 ? '' : 's') + ' before selling anything.', toNew.reduce((s, x) => s + n(x.amount), 0));
            if (sell) act('fyEnd', 3, (toNew.length ? 'New money alone does not close the gap: ' : 'Your mix is off the ' + prof + ' profile (' + desc + ') and there is no new money to add: ') +
              'selling ' + sells.map(s => fmt(n(s.amount)) + ' of ' + String(s.cls)).join(' and ') + ' does. Time an equity sale with this year\'s tax-free room.', sells.reduce((s, x) => s + n(x.amount), 0));
            if (!toNew.length && !sell) notes.push('Your mix is off the ' + prof + ' profile (' + desc + '), but My holdings found nothing to move.');
          }
        }
        arr(d.sameJob).forEach(j => act('next', 1, Math.round(n(j.count)) + ' of your funds do the same job (' + String(j.label || '') + '). Fewer funds would be easier to follow; nothing here says which one to keep.'));
        if (n(d.regularPerYear) >= 1) act('fyEnd', 4, 'Regular plans cost about ' + fmt(n(d.regularPerYear)) + ' a year more than Direct ones (an estimate). Moving is a sale, so time it with this year\'s tax-free room.', n(d.regularPerYear));
        break;
      }
      case 'harvest': {
        const room = n(d.room), lt = n(d.ltValue), g = d.gainRatio == null ? null : n(d.gainRatio);
        if (!(n(d.equity) > 0)) {
          if (n(d.uncategorised) > 0) { row.status = 'missing'; notes.push('Give your holdings a category in My holdings to see which are equity.'); }
          else notes.push('No equity listed, so there are no gains to book.');
          break;
        }
        if (room <= 0) { notes.push('This year\'s ' + fmt(TAX_IN.equityLtcgExemption) + ' of tax-free long-term equity gains is already used.'); break; }
        if (g === null || lt <= 0) {
          if (n(d.unknownCost) > 0) { row.status = 'missing'; notes.push('Add what you paid for your long-term equity holdings in My holdings to work out how much to book.'); }
          else notes.push('None of your equity has been held for more than a year yet, so there is nothing to book.');
          break;
        }
        if (g <= 0) { notes.push('Your long-term equity shows no gain to book.'); break; }
        const sell = Math.min(lt, room / g), gain = sell * g;
        // Stated, not hidden: the holdings list says "held over a year" unless a row is marked otherwise, and the gain
        // is the average across those funds.
        act('fyEnd', 1, 'Before 31 March, book up to ' + fmt(gain) + ' of long-term equity gains tax-free: at the average gain across your funds that is selling and buying back about ' + fmt(sell) +
          ', but a fund with a bigger gain books more per rupee sold, so add up each fund\'s gain in My holdings. That lowers the tax on a later sale by up to ' + fmt(gain * TAX_IN.equityLtcg * (1 + TAX_IN.cess)) +
          '; the bought-back units start a new one-year clock. This counts only units held more than a year' + (d.exemptGiven === false ? ', and assumes none of this year\'s ' + fmt(TAX_IN.equityLtcgExemption) + ' is used yet (set it in My holdings).' : '.'), gain);
        if (n(d.unknownCost) > 0) gap(fmt(n(d.unknownCost)) + ' of long-term equity has no purchase cost entered, so it is left out.');
        break;
      }
      case 'retirement': {
        const ep = String(d.episode || 'a historical crash');
        if (d.survives) notes.push('The plan lasts even if ' + ep + ' hits in your first year of retirement (pot ' + Math.round(n(d.equity)) + '% in equities).');
        else act(n(d.yearsToRetire) <= 5 ? 'month' : 'next', 7, 'If ' + ep + ' hit in your first year of retirement, the pot would run out in year ' + Math.round(n(d.ranOutYear)) + ' of ' + Math.round(n(d.drawYears)) + '. The Retirement Lab shows what a smaller equity share near retirement, or a larger pot, does.');
        if (d.savingsGiven === false) notes.push('Existing savings were not entered, so they count as none.');
        break;
      }
      case 'income': {
        const sp = fmt(n(d.spend)), yrs = Math.round(n(d.years)), how = String(d.how || '');
        if (n(d.ranOutYear) > 0) act('month', 8, 'Drawing ' + sp + ' a month after tax ' + how + ' runs the pot out in year ' + Math.round(n(d.ranOutYear)) + ' of ' + yrs + '. Spend less or plan a larger pot; Retirement Income shows both.');
        else notes.push('Drawing ' + sp + ' a month after tax ' + how + ' lasts all ' + yrs + ' years.');
        break;
      }
    }
    row.finding = notes.join(' ');
    if (row.status !== 'missing') row.status = actions.length > start ? 'act' : partial ? 'partial' : 'ok';
  });
  actions.sort((p, q) => order.indexOf(p.when) - order.indexOf(q.when) || p.rank - q.rank || p.order - q.order);
  // The year's tax-free room is one amount. A sale to rebalance or to move to Direct plans books gains too, so when
  // either is on the list the harvest says so, rather than three items each spending the same room.
  const hv = actions.find(x => x.area === 'harvest');
  if (hv && actions.some(x => x.area === 'holdings' && x.when === 'fyEnd'))
    hv.text += ' The sales on this list to rebalance or move to Direct plans use this same room, so book the gains through them first.';
  // Every amount on the list, keyed by area and position, so a report can be re-checked against a fresh run.
  const figures = {}, per = {};
  actions.forEach(x => { if (x.amount == null) return; per[x.area] = (per[x.area] || 0) + 1; figures[x.area + per[x.area]] = x.amount; });
  const counts = { act: 0, ok: 0, partial: 0, missing: 0, skipped: 0, na: 0 };
  checks.forEach(c => { counts[c.status]++; });
  return { ok: true, dates, order, checks, actions, counts, figures };
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
// "Is a 12% equity assumption realistic?" -- the assumption against every
// real N-year stretch of an index's history. The stretches overlap and share
// most of their years, so `separate` (how many non-overlapping N-year periods
// the history holds) is reported with them: 18 overlapping 27-year windows
// are less than two separate ones. A horizon longer than the history is
// capped at the history's length, and says so.
function returnReality(series, years, assumed){
  const n = Math.min(Math.max(1, Math.round(years)), series.length);
  const w = rollingWindows(series, n);
  const sorted = w.slice().sort((a, b) => a.cagr - b.cagr);
  return {
    years: n, capped: n < years, count: w.length, windows: w,
    worst: sorted[0], best: sorted[sorted.length - 1],
    beat: w.filter(x => x.cagr >= assumed - 1e-9).length,
    separate: Math.floor(series.length / n),
    first: series[0].y, last: series[series.length - 1].y,
  };
}
function worstWindow(series, years){
  const w=rollingWindows(series, years);
  return w.reduce((worst,cur)=>cur.cagr<worst.cagr?cur:worst, w[0]);
}
function bestWindow(series, years){
  const w=rollingWindows(series, years);
  return w.reduce((best,cur)=>cur.cagr>best.cagr?cur:best, w[0]);
}
// Every rolling stretch of `years` in a daily series: the yearly rate (CAGR)
// from each day back to the day `years` earlier. It answers "was that just a
// lucky start date?". dates are 'YYYY-MM-DD', values are prices or an index.
// `other` (optional, same dates) is a benchmark: beatShare is the share of
// stretches where `values` grew faster than `other`. The stretches overlap and
// share most of their days, so `separate` (how many non-overlapping stretches
// the history holds) is reported with them: 2,658 daily stretches in 13.8 years
// are about four separate 3-year periods, not 2,658 independent tests.
function rollingReturns(dates, values, years, other){
  const t=dates.map(d=>Date.parse(d)), span=years*365.25*864e5;
  const out=[];
  let j=0;
  for(let k=0;k<dates.length;k++){
    if(t[k]-t[0]<span) continue;
    while(t[k]-t[j+1]>=span) j++;
    const yrs=(t[k]-t[j])/(365.25*864e5);
    const w={start:dates[j], end:dates[k], cagr:Math.pow(values[k]/values[j], 1/yrs)-1};
    if(other) w.other=Math.pow(other[k]/other[j], 1/yrs)-1;
    out.push(w);
  }
  if(!out.length) return null;
  const sorted=out.map(w=>w.cagr).sort((a,b)=>a-b);
  const pick=q=>sorted[Math.min(sorted.length-1, Math.floor(q*sorted.length))];
  const minW=out.reduce((a,b)=>b.cagr<a.cagr?b:a), maxW=out.reduce((a,b)=>b.cagr>a.cagr?b:a);
  const spanYears=(t[t.length-1]-t[0])/(365.25*864e5);
  return {
    years, windows:out, count:out.length,
    separate:Math.floor(spanYears/years+1e-9),
    min:minW, max:maxW, median:pick(0.5),
    positiveShare:out.filter(w=>w.cagr>0).length/out.length,
    beatShare:other ? out.filter(w=>w.cagr>w.other).length/out.length : null,
  };
}
// Day-to-day bumpiness of a series as a yearly figure, annualised exactly the
// way computeReturnStats does it for every other risk number in the app
// (population stdev of the daily moves x sqrt(trading days per year, counted
// from the series itself)), so "the mix swung 11% a year" and a stat card's
// risk figure are the same kind of number. null when there are too few days.
function annualisedVol(dates, values){
  const r=[];
  for(let k=1;k<values.length;k++) if(values[k-1]>0) r.push(values[k]/values[k-1]-1);
  if(r.length<20) return null;
  const mean=r.reduce((s,x)=>s+x,0)/r.length;
  const variance=r.reduce((s,x)=>s+(x-mean)*(x-mean),0)/r.length;
  const spanYears=Math.max(0.05, (Date.parse(dates[dates.length-1])-Date.parse(dates[0]))/(365.25*864e5));
  return Math.sqrt(variance)*Math.sqrt(r.length/spanYears);
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
  // print, not real trading. Funds get a tighter 15% bar: a NAV jump
  // that size usually means a segregated-portfolio side-pocket event or
  // a stale-then-corrected NAV, not a real one-day market move. It was
  // 10%, which flagged the Nifty's real -12.98% day (23 Mar 2020) in
  // every Nifty index fund; 15% still flagged the real +17.7% election
  // day (18 May 2009) in older regular plans. 20% is the NSE market-wide
  // circuit breaker, so a diversified fund can't really move more in a day.
  const jumpThreshold = isFund ? 0.20 : 0.35;
  let worstJump=null;
  rets.forEach(x=>{ if(!worstJump || Math.abs(x.r)>Math.abs(worstJump.r)) worstJump=x; });
  if(worstJump && Math.abs(worstJump.r)>jumpThreshold){
    bump('caution','JUMP',`A single-day move of ${(worstJump.r*100).toFixed(0)}% on ${worstJump.date} — ${isFund ? 'a NAV discontinuity (a side-pocket, a stale price later corrected, or a data error)' : 'consistent with a corporate action, a very illiquid/thinly-traded stock, or a bad print'}. Worth a second look before trusting it.`,worstJump);
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
/* ---------------------------------------------------------------------
   Exact long-only efficient frontier.
   The random cloud alone CANNOT be used as the frontier: uniform weights
   over N assets concentrate near an equal split as N grows, so with the
   Lab's 24 building blocks the best-of-3000-samples "frontier" spanned
   only 5.4-15.5% risk and topped out at 12.0% return, while the true
   long-only frontier runs 1.7-28% risk up to 15.5%. Single assets plotted
   ABOVE the line labelled "the best return possible", and frontierGap()
   told Conservative/Aggressive presets they were already on it when they
   were ~0.5 points below. The cloud stays (it's the visual "every mix you
   could pick"); the line is now solved, not sampled.
   Method: for a sweep of risk-aversion trade-offs lambda, minimise
   w'Sigma w - lambda*mu'w over {w >= 0, sum w = 1} with accelerated
   projected gradient (FISTA) and the sort-based simplex projection.
   lambda=0 is exactly the minimum-variance mix; lambda -> inf is the
   highest-return asset alone. Warm-started along the sweep, then gaps in
   risk are bisected so points are evenly spread along the curve.
   --------------------------------------------------------------------- */
function projectToSimplex(v){
  const u=v.slice().sort((a,b)=>b-a);
  let css=0, theta=0;
  for(let i=0;i<u.length;i++){ css+=u[i]; const t=(css-1)/(i+1); if(u[i]-t>0) theta=t; }
  return v.map(x=>Math.max(0,x-theta));
}
function efficientFrontierExact(returns, vols, corr, targetPoints){
  const n=returns.length;
  if(n===0) return [];
  targetPoints=targetPoints||40;
  const S=[];
  for(let i=0;i<n;i++){ S.push([]); for(let j=0;j<n;j++) S[i].push(vols[i]*vols[j]*corr[i][j]); }
  // Lipschitz constant of the gradient 2*Sigma w, bounded by the max
  // absolute row sum (>= largest eigenvalue).
  let Lc=0; for(let i=0;i<n;i++){ let r=0; for(let j=0;j<n;j++) r+=Math.abs(S[i][j]); Lc=Math.max(Lc,r); }
  Lc=Math.max(2*Lc,1e-12);
  const pointOf=w=>({ w, ret:portfolioReturn(w,returns), vol:Math.sqrt(Math.max(0,portfolioVariance(w,vols,corr))) });
  // Flat typed arrays + a reused sort buffer: this inner loop runs tens of
  // thousands of times on a cold solve, and per-iteration array
  // allocation was most of the cost.
  const Sf=new Float64Array(n*n); for(let i=0;i<n;i++) for(let j=0;j<n;j++) Sf[i*n+j]=S[i][j];
  const g=new Float64Array(n), z=new Float64Array(n), u=new Float64Array(n);
  function projInPlace(v, out){
    u.set(v); u.sort(); // ascending
    let css=0, theta=0;
    for(let k=n-1, i=0; k>=0; k--, i++){ css+=u[k]; const t=(css-1)/(i+1); if(u[k]-t>0) theta=t; }
    for(let i=0;i<n;i++){ const r=v[i]-theta; out[i]=r>0?r:0; }
  }
  function solve(lambda, w0){
    let x=Float64Array.from(w0), y=Float64Array.from(w0), xn=new Float64Array(n), t=1;
    for(let k=0;k<1500;k++){
      for(let i=0;i<n;i++){ let s=0; const row=i*n; for(let j=0;j<n;j++) s+=Sf[row+j]*y[j]; z[i]=y[i]-(2*s-lambda*returns[i])/Lc; }
      projInPlace(z, xn);
      const tn=(1+Math.sqrt(1+4*t*t))/2, mom=(t-1)/tn;
      let diff=0;
      for(let i=0;i<n;i++){ const d=xn[i]-x[i]; if(Math.abs(d)>diff) diff=Math.abs(d); y[i]=xn[i]+mom*d; }
      const tmp=x; x=xn; xn=tmp; t=tn;
      if(diff<1e-9) break;
    }
    return Array.from(x);
  }
  const eq=new Array(n).fill(1/n);
  // Sweep: lambda=0 (min variance) plus a geometric grid wide enough to
  // reach the max-return corner for any realistic return/variance scale.
  const pts=[];
  let prevW=solve(0,eq);
  pts.push(Object.assign(pointOf(prevW),{lambda:0}));
  for(let e=-4;e<=3;e+=0.25){
    const lambda=Math.pow(10,e);
    prevW=solve(lambda,prevW);
    pts.push(Object.assign(pointOf(prevW),{lambda}));
  }
  // The highest-return asset alone is always the frontier's top end (ties
  // broken toward lower risk).
  let top=0;
  for(let i=1;i<n;i++) if(returns[i]>returns[top]+1e-12 || (Math.abs(returns[i]-returns[top])<=1e-12 && vols[i]<vols[top])) top=i;
  const corner=new Array(n).fill(0); corner[top]=1;
  pts.push(Object.assign(pointOf(corner),{lambda:Infinity}));
  // Bisect risk gaps wider than range/targetPoints so the line is evenly
  // sampled along its length instead of bunching where lambda is dense.
  const span=pts[pts.length-1].vol-pts[0].vol;
  if(span>1e-9){
    const maxGap=span/targetPoints;
    for(let guard=0; guard<400; guard++){
      pts.sort((a,b)=>a.vol-b.vol);
      let gi=-1;
      for(let i=0;i<pts.length-1;i++){
        if(pts[i+1].vol-pts[i].vol>maxGap && isFinite(pts[i+1].lambda) && pts[i+1].lambda>pts[i].lambda*1.0001){ gi=i; break; }
        if(pts[i+1].vol-pts[i].vol>maxGap && !isFinite(pts[i+1].lambda)){ gi=i; break; }
      }
      if(gi<0) break;
      const a=pts[gi], b=pts[gi+1];
      const lo=a.lambda>0?a.lambda:1e-6, hi=isFinite(b.lambda)?b.lambda:Math.max(lo*100,1e4);
      const lambda=Math.sqrt(lo*hi);
      if(!(lambda>a.lambda && lambda<hi)) break;
      const w=solve(lambda,a.w);
      const p=Object.assign(pointOf(w),{lambda});
      if(Math.abs(p.vol-a.vol)<1e-9 && Math.abs(p.vol-b.vol)<1e-9) break;
      pts.push(p);
    }
  }
  pts.sort((a,b)=>a.vol-b.vol);
  // Keep only strictly efficient points (return rises with risk) and drop
  // near-duplicates; strip the internal lambda tag.
  const out=[];
  pts.forEach(p=>{
    const last=out[out.length-1];
    if(last && (p.vol-last.vol<1e-7 || p.ret<=last.ret+1e-10)) return;
    out.push({w:p.w, ret:p.ret, vol:p.vol});
  });
  return out;
}
// Memoised: renderPortfolio() rebuilds on every slider tick, and the
// assumptions (returns/vols/corr) almost never change between ticks --
// only the user's own weights do, which the frontier doesn't depend on.
const FRONTIER_CACHE = new Map();
function generateFrontier(returns, vols, corr, n, seed){
  const key=JSON.stringify([returns,vols,corr,n,seed]);
  if(FRONTIER_CACHE.has(key)) return FRONTIER_CACHE.get(key);
  const rng=mulberry32(seed);
  const cloud=[];
  for(let i=0;i<n;i++){
    const w=randomWeights(returns.length, rng);
    cloud.push({ w, ret:portfolioReturn(w,returns), vol:Math.sqrt(portfolioVariance(w,vols,corr)) });
  }
  let frontier=efficientFrontierExact(returns, vols, corr, 40);
  if(frontier.length<2){
    // Degenerate input (e.g. every asset has the same expected return):
    // there's no rising curve to solve for, so fall back to the old
    // best-return-per-risk-bin envelope of the cloud, which downstream
    // chart and gap code already handles.
    const minV=Math.min(...cloud.map(p=>p.vol)), maxV=Math.max(...cloud.map(p=>p.vol));
    const bins=40, binW=(maxV-minV)/bins;
    const best=new Array(bins).fill(null);
    cloud.forEach(p=>{
      let b=Math.min(bins-1,Math.floor((p.vol-minV)/(binW||1)));
      if(!best[b]||p.ret>best[b].ret) best[b]=p;
    });
    frontier=best.filter(Boolean).sort((a,b)=>a.vol-b.vol);
  }
  const result={ cloud, frontier };
  if(FRONTIER_CACHE.size>50) FRONTIER_CACHE.clear();
  FRONTIER_CACHE.set(key,result);
  return result;
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
  // profileComparisonChartOption reads minVariance.sharpe directly -- leave
  // this off and the Sharpe column silently drops the Safest mix row.
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
        label:{show:true, formatter:`RISK-FREE ${(rfPoint.ret*100).toFixed(1)}%`, position:'right', distance:8, color:'rgba(20,40,63,.6)', fontWeight:700, fontSize:11, fontFamily:"'Spline Sans Mono',monospace"} },
      { name:'Assets', type:'scatter', data:assetPoints.map(p=>[p.vol,p.ret]), symbolSize:10,
        itemStyle:{color:'#1F8A70', borderColor:'#14283F', borderWidth:1},
        label:{show:true, formatter:p=>{ const ap=assetPoints[p.dataIndex]; return ap && ap.showLabel!==false ? ap.label : ''; }, position:'top', color:'rgba(20,40,63,.6)', fontSize:10, fontFamily:"'Spline Sans Mono',monospace"}, z:3 },
      { name:'Tangency', type:'scatter', data:[[tangencyPoint.vol,tangencyPoint.ret]], symbolSize:11,
        itemStyle:{color:'#14283F', borderColor:'#2557C7', borderWidth:2}, z:4,
        label:{show:!tangencyIsCurrent, formatter:'BEST BALANCE', position:'bottom', distance:9, color:'#14283F', fontWeight:700, fontSize:11, fontFamily:"'Spline Sans Mono',monospace"}, labelLayout:{moveOverlap:'shiftY'} },
      ...(showSafest ? [{ name:'Safest', type:'scatter', data:[[minVarPoint.vol,minVarPoint.ret]], symbolSize:10,
        symbol:'diamond', itemStyle:{color:'#8A4FBF', borderColor:'#14283F', borderWidth:1.5}, z:4,
        label:{show:true, formatter:'SAFEST', position:'top', distance:9, color:'#14283F', fontWeight:700, fontSize:11, fontFamily:"'Spline Sans Mono',monospace"}, labelLayout:{moveOverlap:'shiftY'} }] : []),
      { name:'Your mix', type:'scatter', data:[[currentPoint.vol,currentPoint.ret]], symbolSize:16,
        itemStyle:{color:'transparent', borderColor:'#B8740F', borderWidth:2.5}, z:5,
        label:{show:true, formatter:yourMixLabel, position:'top', distance:10, color:'#14283F', fontWeight:700, fontSize:10, fontFamily:"'Spline Sans Mono',monospace"} },
      { name:'Your mix dot', type:'scatter', data:[[currentPoint.vol,currentPoint.ret]], symbolSize:6,
        itemStyle:{color:'#B8740F'}, tooltip:{show:false}, silent:true, z:5 },
    ],
  };
}

/* ---------------------------------------------------------------------
   Phase 12 — alternate chart-option builders for the same compare_portfolio
   result. Gives the advisor a choice of visual encoding instead of always
   rendering the same efficient-frontier scatter: a grouped bar for a quick
   side-by-side, three dot plots for a multi-dimensional profile. Every number here
   comes from the caller's already-computed data (compare_portfolio) — these
   functions only pick how to draw it, never compute new figures.
   --------------------------------------------------------------------- */
function barComparisonChartOption(assetPoints){
  const labels = assetPoints.map(function(a){ return a.label; });
  // No legend: every bar prints its value, and the first pair also prints the
  // series name above it (name over value). Left to centre on their own bars the
  // Return and Risk labels, side by side, print on top of each other, so the first
  // pair's labels are pinned to the pair's outer edges: Return's ends at the right
  // edge of its bar and Risk's starts at the left edge of its bar, which leaves
  // exactly the gap between the bars between them. A crowded chart (4+ assets)
  // drops the decimal so neighbouring values still fit; the tooltip keeps two.
  // The text is ink: the bar colours are fills, and ochre is under 4.5:1 for small text.
  const dp = assetPoints.length > 3 ? 0 : 1;
  const barLabel = function(name){ return { show:true, position:'top', fontSize:10, lineHeight:12, color:'#14283F', fontFamily:"'Spline Sans Mono',monospace",
    formatter:function(p){ return (p.dataIndex === 0 ? name + '\n' : '') + (p.value*100).toFixed(dp) + '%'; } }; };
  const pinFirstPair = function(side){ return function(p){
    if (p.dataIndex !== 0) return {};
    return { x: side === 'right' ? p.rect.x + p.rect.width : p.rect.x, y: p.rect.y - 4, align: side, verticalAlign:'bottom' };
  }; };
  return {
    animationDurationUpdate:450, animationEasingUpdate:'cubicOut',
    grid:{left:54,right:20,top:44,bottom:40,containLabel:true},
    xAxis:{type:'category', data:labels, axisLabel:{fontSize:10.5,color:'rgba(20,40,63,.6)'}},
    yAxis:{type:'value', name:'PER YEAR', nameLocation:'middle', nameGap:44,
      nameTextStyle:{fontSize:10.5,color:'rgba(20,40,63,.5)'}, axisLabel:{formatter:function(v){ return (v*100).toFixed(0)+'%'; }},
      splitLine:{lineStyle:{color:'rgba(20,40,63,.05)'}}},
    tooltip:{trigger:'axis', confine:true, textStyle:{fontFamily:"'Figtree',sans-serif", fontSize:12},
      valueFormatter:function(v){ return (v*100).toFixed(2)+'%'; }},
    series:[
      { name:'Return', type:'bar', data:assetPoints.map(function(a){ return a.ret; }), itemStyle:{color:'#2557C7'}, barGap:'20%', label:barLabel('Return'), labelLayout:pinFirstPair('right') },
      { name:'Risk', type:'bar', data:assetPoints.map(function(a){ return a.vol; }), itemStyle:{color:'#B8740F'}, label:barLabel('Risk'), labelLayout:pinFirstPair('left') },
    ],
  };
}
// Three small dot plots side by side (Return, Risk, Sharpe): one row per
// instrument plus the two blends. Replaces the radar, which the chart rules
// ban. Every column is a plain number line, so "better" never depends on
// reading a shape; the column titles carry an arrow and the caption says what
// it means. Dots are labelled with their value (centred above the dot, so a
// label can never run into the next column), the best value in each column is
// bold, and blends are ink diamonds so shape, not only colour, tells them
// from the instruments. No legend: the row names are the key.
function profileRows(assetPoints, minVariance, tangency, riskFreeRate){
  const rf = riskFreeRate || 0;
  const finiteOrNull = function(v){ return v != null && isFinite(v) ? v : null; };
  const sharpeOf = function(ret, vol){ return vol > 0 ? (ret - rf) / vol : null; };
  return assetPoints.map(function(a){ return { name:a.label, ret:a.ret, vol:a.vol, sharpe:sharpeOf(a.ret, a.vol), mix:false }; })
    .concat([
      { name:'Safest mix',   ret:minVariance.ret, vol:minVariance.vol, sharpe:finiteOrNull(minVariance.sharpe), mix:true },
      { name:'Best balance', ret:tangency.ret,    vol:tangency.vol,    sharpe:finiteOrNull(tangency.sharpe),    mix:true },
    ]);
}
const PROFILE_METRICS = [
  { key:'ret',    title:'Return ↑', fmt:function(v){ return (v*100).toFixed(1)+'%'; }, best:'max' },
  { key:'vol',    title:'Risk ↓', fmt:function(v){ return (v*100).toFixed(1)+'%'; }, best:'min' },
  { key:'sharpe', title:'Sharpe ↑', fmt:function(v){ return v.toFixed(2); },           best:'max' },
];
function profileComparisonChartOption(assetPoints, minVariance, tangency, riskFreeRate){
  const rows = profileRows(assetPoints, minVariance, tangency, riskFreeRate);
  const names = rows.map(function(r){ return r.name; });
  const mono = "'Spline Sans Mono',monospace";
  const nameW = 29, gridW = 20, gap = 4;                      // % of the chart width
  const grids = [], xAxes = [], yAxes = [], titles = [], series = [];
  PROFILE_METRICS.forEach(function(m, i){
    const vals = rows.map(function(r){ return r[m.key]; }).filter(function(v){ return v != null && isFinite(v); });
    // A column with no usable value (every Sharpe is n/a) stays an empty,
    // titled column instead of a NaN axis.
    const lo = vals.length ? Math.min(0, Math.min.apply(null, vals)) : 0, hi = vals.length ? Math.max.apply(null, vals) : 1;
    const span = (hi - lo) || Math.abs(hi) || 1;
    const bestVal = vals.length ? (m.best === 'max' ? Math.max.apply(null, vals) : Math.min.apply(null, vals)) : null;
    // Bold only when something actually stands out; a column of identical values has no best.
    const hasBest = vals.length > 1 && Math.max.apply(null, vals) !== Math.min.apply(null, vals);
    const left = nameW + i * (gridW + gap);
    grids.push({ left:left+'%', width:gridW+'%', top:34, bottom:14, containLabel:false });
    titles.push({ text:m.title, left:(left + gridW / 2)+'%', top:4, textAlign:'center', textStyle:{ fontSize:11, fontWeight:600, color:'#14283F', fontFamily:mono } });
    xAxes.push({ type:'value', gridIndex:i, min:lo - span * 0.2, max:hi + span * 0.2, show:false });
    yAxes.push({ type:'category', gridIndex:i, data:names, inverse:true, axisTick:{ show:false },
      axisLine:{ lineStyle:{ color:'rgba(20,40,63,.12)' } },
      axisLabel:{ show:i === 0, width:Math.round(nameW * 2.9), overflow:'truncate', fontSize:10.5, color:'#14283F', fontFamily:mono },
      splitLine:{ show:true, lineStyle:{ color:'rgba(20,40,63,.07)' } } });
    series.push({ name:m.title, type:'scatter', xAxisIndex:i, yAxisIndex:i,
      // A faint zero line, only where the column crosses zero (a negative return or Sharpe).
      markLine: lo < 0 ? { silent:true, symbol:'none', label:{ show:false }, lineStyle:{ color:'rgba(20,40,63,.35)', type:'dotted', width:1 }, data:[{ xAxis:0 }] } : undefined,
      data:rows.map(function(r, k){
        const v = r[m.key];
        return v == null || !isFinite(v) ? null : {
          value:[v, k], symbol:r.mix ? 'diamond' : 'circle', symbolSize:r.mix ? 11 : 9,
          itemStyle:{ color:r.mix ? '#14283F' : '#2557C7', borderColor:'#FFFFFF', borderWidth:2 },
          label:{ show:true, position:'top', distance:3, formatter:m.fmt(v), fontFamily:mono, fontSize:10.5,
            color:'#14283F', fontWeight:hasBest && v === bestVal ? 700 : 400 } };
      }) });
  });
  return {
    animationDurationUpdate:450, animationEasingUpdate:'cubicOut',
    title:titles, grid:grids, xAxis:xAxes, yAxis:yAxes, series:series,
    tooltip:{ trigger:'item', confine:true, textStyle:{ fontFamily:"'Figtree',sans-serif", fontSize:12 },
      formatter:function(p){ const r = rows[p.value[1]];
        return '<b>' + r.name + '</b><br/>Return ' + (r.ret*100).toFixed(2) + '% · Risk ' + (r.vol*100).toFixed(2) + '% · Sharpe ' + (r.sharpe == null ? 'n/a' : r.sharpe.toFixed(2)); } },
  };
}
// The chart's caption, from the same rows (every chart gets one). The Sharpe
// sentence names whichever row really has the highest Sharpe; it is not
// assumed to be the "best balance" blend, which on a sampled frontier or a
// short history can sit below another row. When even the top Sharpe is not
// positive, nothing earned more than the risk-free rate, so the usual "most
// return above the risk-free rate" gloss would be false; it says so instead.
function profileComparisonCaption(assetPoints, minVariance, tangency, riskFreeRate){
  const rows = profileRows(assetPoints, minVariance, tangency, riskFreeRate);
  const assets = rows.filter(function(r){ return !r.mix; });
  const pct = function(v){ return (v*100).toFixed(1) + '%'; };
  if(!assets.length) return '';
  const topRet = assets.reduce(function(a, b){ return b.ret > a.ret ? b : a; });
  const withSharpe = rows.filter(function(r){ return r.sharpe != null; });
  const topSharpe = withSharpe.length ? withSharpe.reduce(function(a, b){ return b.sharpe > a.sharpe ? b : a; }) : null;
  return topRet.name + ' alone had the highest return (' + pct(topRet.ret) + ', with ' + pct(topRet.vol) + ' risk). ' +
    (!topSharpe ? '' : topSharpe.sharpe > 0
      ? topSharpe.name + ' had the highest Sharpe ratio (' + topSharpe.sharpe.toFixed(2) + '): the most return above the risk-free rate for each unit of risk. '
      : 'No row beat the ' + pct(riskFreeRate || 0) + ' risk-free rate, so no Sharpe ratio is positive. ' + topSharpe.name + ' came closest (' + topSharpe.sharpe.toFixed(2) + '). ') +
    '↑ means higher is better, ↓ means lower is better. Diamonds are the two blends.';
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
// Planning tools are never routed away: an everyday follow-up like "drop the
// flat and add a trip" shares almost no words with build_goal_plan's
// description, so ranking alone left the model with nothing that could edit a
// plan. Only names already in `tools` survive the final filter, so a page never
// gains a tool it doesn't define. Same list in src/worker.js and
// local_server.py (smoke-11 checks they match).
var TOOL_ALWAYS_KEEP = [
  'navigate', 'set_value', 'get_state', 'get_results', 'build_goal_plan',
  'add_goal', 'update_goal', 'remove_goal', 'run_full_analysis',
  'compose_briefing', 'propose_plan', 'execute_plan', 'open_door',
  'start_yearly_review', 'review_check',
];
function filterToolsByQuery(tools, query, alreadyCalled, opts){
  const k = (opts && opts.k) || 8;
  if(!Array.isArray(tools) || tools.length <= k) return tools;
  const docs = tools.map(function(t){ const f = t.function || {}; return { id: f.name, text: (f.name || '') + ' ' + (f.description || '') }; });
  const ranked = bm25Rank(query, docs);
  const keep = {};
  ranked.slice(0, k).forEach(function(r){ keep[r.id] = true; });
  TOOL_ALWAYS_KEEP.forEach(function(n){ keep[n] = true; });
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
    accumulationSchedule, xirr, sipBacktest, findRevertingSpikes,
    TAX_IN, holdsLongTerm, saleTaxIndia, postTaxPlanValue, postTaxFdFinal, harvestPlan,
    RETIRE_ACCOUNTS_IN, epfMonthlyContribution, epfFutureValue, ppfFutureValue, npsFutureValue, npsCountedShare, retirementAccountsFV,
    incomeBuckets, incomeStrategies, incomeDrawPlan, incomeSwitchTax, npsAnnuityPlan,
    TAX_REGIME_IN, slabTax, slabRate, regimeTax, hraExemption, epfEmployeeYearly, compareRegimes,
    loanSchedule, loanPrepay, homeLoanCompare, debtAvalanche, termCoverNeed, healthCoverPlan,
    RISK_PROFILES_IN, HOLDING_CATS_IN, holdingCategoryFromName, fundPlanFromName, REGULAR_EXTRA, regularExtra, reviewHoldings,
    REVIEW_AREAS, REVIEW_DRIFT_BAND, REVIEW_TAX_TIE, REVIEW_WHEN, reviewDates, reviewWhenOrder, yearlyReview,
    marketSeries, marketName, compoundPath, marketGrowthPath,
    rollingWindows, worstWindow, bestWindow, rollingReturns, annualisedVol, returnReality, stepUpAnnualPlan,
    SENSEX_ANNUAL_RETURNS, SP500_ANNUAL_RETURNS,
    computeDailyReturns, auditPriceSeries, computeReturnStats, alignReturns,
    populationCovariance, computeCovarianceMatrix, portfolioReturn, portfolioVariance,
    twoAssetFrontier, minVarianceWeightTwoAsset, tangencyWeightTwoAsset,
    capitalAllocationLine, liveFrontierChartOption,
    barComparisonChartOption, profileComparisonChartOption, profileComparisonCaption,
    mulberry32, randomWeights, generateFrontier, bestSharpePoint, multiAssetFrontier,
    projectToSimplex, efficientFrontierExact,
    bm25Tokenize, bm25Rank, filterToolsByQuery, TOOL_ALWAYS_KEEP,
  };
}
