/**
 * credit-engine.js — pure credit-risk logic for the Lab's "Read the Company" tab.
 *
 * Same contract as goalden-engine.js and statements-engine.js: no DOM, no
 * fetch, no ECharts calls, no clock reads. Data in, structured judgments out,
 * so every rule here is unit-testable by `node --test engine.test.js`.
 *
 * The one rule that governs this whole file: a number is either computed from
 * an input the caller actually supplied, or it is refused with a reason. There
 * is no third path. Every function that can fail returns either a plain `null`
 * (atomic ratios, matching statements-engine.js's existing style) or an
 * `{ ok:false, reason }` object (composite models, where the reason is shown
 * to the user verbatim). Nothing here substitutes a plausible-looking figure
 * for a missing one.
 *
 * Consumes the shape /api/financials returns (see screener-parser.js) plus a
 * daily price series from /api/history. Dual-format shim at the bottom
 * mirrors the other two engines.
 */

'use strict';

// ---------------------------------------------------------------------------
// Section 4 — deterministic ratio engine
//
// Screener's `Operating Profit` row IS EBITDA: the parsed statements satisfy
// `Sales - Expenses = Operating Profit` and `Operating Profit + Other Income
// - Interest - Depreciation = Profit before tax` exactly, so Operating Profit
// sits above both interest and depreciation. Verified against the parser's
// own output before this module was written; asserted in engine.test.js so a
// future screener layout change that breaks the identity fails loudly here
// rather than quietly re-defining every leverage multiple downstream.
// ---------------------------------------------------------------------------

// A leverage multiple is only meaningful against positive earnings. A company
// with -100 EBITDA and 500 of debt would otherwise compute to -5.0x, which
// reads on a chart as *less* levered than a debt-free company -- the sign flip
// turns the worst case into the best-looking number. Loss-makers refuse.
function grossLeverage(totalDebt, ebitda) {
  if (totalDebt == null || ebitda == null) return null;
  if (!isFinite(totalDebt) || !isFinite(ebitda)) return null;
  if (ebitda <= 0) return null;
  if (totalDebt < 0) return null;
  return totalDebt / ebitda;
}

// Net of cash. Cash is NOT derivable from screener's condensed balance sheet
// (its rows are Equity Capital / Reserves / Borrowings / Other Liabilities /
// Fixed Assets / CWIP / Investments / Other Assets -- no cash line), so the
// caller must supply it explicitly. `Investments` is not a substitute: it
// carries strategic and subsidiary stakes that cannot be applied against debt.
// A null cash input refuses rather than silently computing gross leverage
// under a "net" label.
function netLeverage(totalDebt, cash, ebitda) {
  if (cash == null || !isFinite(cash) || cash < 0) return null;
  if (totalDebt == null || !isFinite(totalDebt) || totalDebt < 0) return null;
  if (ebitda == null || !isFinite(ebitda) || ebitda <= 0) return null;
  return (totalDebt - cash) / ebitda;
}

// Times EBITDA covers the interest bill. Zero interest expense is a real
// state (a debt-free company), not an error -- but it is division by zero, so
// it refuses here and the caller states "no interest expense reported"
// instead of rendering Infinity.
function interestCoverage(ebitda, interestExpense) {
  if (ebitda == null || interestExpense == null) return null;
  if (!isFinite(ebitda) || !isFinite(interestExpense)) return null;
  if (interestExpense <= 0) return null;
  if (ebitda <= 0) return null;
  return ebitda / interestExpense;
}

// Shocks are signed fractions: -0.20 means EBITDA falls 20%, +0.10 means debt
// rises 10%. Kept as arbitrary parameters (not fixed scenario constants) so a
// slider can recompute this live without the LLM in the loop.
function stressedRatios(base, shocks) {
  base = base || {};
  shocks = shocks || {};
  const s = {
    ebitda: shocks.ebitda == null ? 0 : shocks.ebitda,
    debt: shocks.debt == null ? 0 : shocks.debt,
    interest: shocks.interest == null ? 0 : shocks.interest,
  };
  const shocked = {
    ebitda: base.ebitda == null ? null : base.ebitda * (1 + s.ebitda),
    debt: base.debt == null ? null : base.debt * (1 + s.debt),
    interest: base.interest == null ? null : base.interest * (1 + s.interest),
    // Cash is not shocked: a cash balance is a point-in-time stock, and the
    // scenario here is an earnings/funding shock, not a liquidity raid. Held
    // flat and labelled rather than moved by an invented rule.
    cash: base.cash == null ? null : base.cash,
  };
  const ratiosFor = (b) => ({
    grossLeverage: grossLeverage(b.debt, b.ebitda),
    netLeverage: netLeverage(b.debt, b.cash, b.ebitda),
    interestCoverage: interestCoverage(b.ebitda, b.interest),
  });
  return {
    shocks: s,
    baseInputs: { ebitda: base.ebitda, debt: base.debt, interest: base.interest, cash: base.cash == null ? null : base.cash },
    stressedInputs: shocked,
    base: ratiosFor({ ebitda: base.ebitda, debt: base.debt, interest: base.interest, cash: base.cash }),
    stressed: ratiosFor(shocked),
  };
}

// ---------------------------------------------------------------------------
// Section 3 — sector archetypes
//
// The same leverage multiple means different things in different businesses,
// so nothing here is judged against an absolute threshold. Bands are the
// spec's starting defaults and are deliberately data, not code -- edit the
// table, not the logic.
//
// Matching runs against screener's own sector breadcrumb
// ({broadSector, sector, broadIndustry, industry}) rather than a new taxonomy.
// Matching is keyword-based and ordered most-specific-first; an unrecognised
// sector returns archetype 'unknown' and every leverage judgement downstream
// then refuses rather than defaulting to the middle band, which would quietly
// apply industrial norms to a business nobody classified.
// ---------------------------------------------------------------------------

const SECTOR_ARCHETYPES = {
  // Not a band -- a refusal with the right reason. For a lender, borrowing is
  // the raw material of the business, and screener's condensed balance sheet
  // buries customer deposits outside `Borrowings`, so a debt/EBITDA multiple
  // here is wrong by an order of magnitude in the reassuring direction. This
  // has to be its own archetype rather than falling through to 'unknown',
  // because "we couldn't classify this sector" is a different and much less
  // useful statement than "this is a bank, and the multiple would be wrong".
  lender: {
    id: 'lender',
    label: 'Lender',
    comfortable: null,
    why: null,
    refusal: 'This company is a lender. Borrowing money is the raw material of its business rather than a claim against it, and the condensed balance sheet this page reads does not separate customer deposits from borrowings — so a debt-to-EBITDA multiple would understate its real leverage by a wide margin. It is not shown.',
  },
  utility: {
    id: 'utility',
    label: 'Regulated utility',
    comfortable: { min: 4.0, max: 6.0 },
    why: 'Fixed-price, contracted revenue means earnings barely move year to year, so a larger debt load stays serviceable.',
  },
  stable: {
    id: 'stable',
    label: 'Stable industrial or consumer',
    comfortable: { min: 2.5, max: 4.0 },
    why: 'Demand is steady but not guaranteed, so the debt load has to leave room for an ordinary bad year.',
  },
  cyclical: {
    id: 'cyclical',
    label: 'Cyclical or commodity',
    comfortable: { min: 1.0, max: 2.5 },
    why: 'Earnings can halve in a downturn, so the same debt load that looks modest at the top of the cycle becomes heavy at the bottom.',
  },
};

// Ordered rules. `test` sees the lowercased concatenation of every level of
// the breadcrumb, so a match on the narrow industry beats a broad-sector one
// purely by sitting earlier in this list.
// Lenders are tested first and deliberately win over every other rule: a
// housing-finance company's breadcrumb also contains "financial services",
// and getting it into the stable band rather than the refusal would be the
// order-of-magnitude error above. Short words that occur inside longer
// unrelated ones (\biron\b, \bcoal\b, \bpaper\b, \bsugar\b, \bbank\b) carry
// word boundaries.
const SECTOR_ARCHETYPE_RULES = [
  { archetype: 'lender', match: /\bbanks?\b|financial servic|\bnbfc\b|non banking financ|housing financ|consumer financ|\blending\b|insuranc|capital market|asset management|holding compan|\bfinancials\b/ },
  { archetype: 'utility', match: /power generation|power transmission|power distribution|electric utilit|gas distribution|water suppl|renewable energy|\butilities\b/ },
  { archetype: 'cyclical', match: /aluminium|copper|\bzinc\b|steel|\biron\b|mining|minerals|non - ferrous|ferrous metal|cement|\bcoal\b|crude oil|natural gas|petroleum|refiner|commodit|\bsugar\b|\bpaper\b|shipping|fertili[sz]er|metals & mining|\bchemicals?\b|\btyres?\b/ },
  { archetype: 'stable', match: /pharmaceutical|healthcare|hospital|\bfmcg\b|fast moving consumer goods|personal product|household product|packaged food|beverage|auto component|automobile|consumer durable|retail|telecom|software|information technology|it services|media|textile|industrial products|capital goods|logistic|transport|realty|construction|engineering|consumer discretionary|consumer staples|industrials|\bservices\b|diversified/ },
];

function classifySectorArchetype(sector) {
  const parts = [];
  // The scraped breadcrumb is an object, but a caller with only a sector name
  // will naturally pass the string. Accepting both matters because the failure
  // mode of rejecting a string is silent: it classifies as ‘unknown’, which
  // then reads as “no benchmark for this sector” rather than “you passed the
  // wrong shape” -- and for a bank that would quietly re-enable every ratio
  // the lender rule exists to suppress.
  if (typeof sector === 'string') {
    if (sector.trim()) parts.push(sector.trim());
  } else if (sector) {
    ['industry', 'broadIndustry', 'sector', 'broadSector'].forEach((k) => {
      if (sector[k]) parts.push(String(sector[k]));
    });
  }
  const hay = parts.join(' | ').toLowerCase();
  if (!hay) {
    return { archetype: 'unknown', label: 'Not classified', comfortable: null, why: null, refusal: null, matchedOn: null, breadcrumb: null };
  }
  for (const rule of SECTOR_ARCHETYPE_RULES) {
    const m = hay.match(rule.match);
    if (m) {
      const a = SECTOR_ARCHETYPES[rule.archetype];
      return {
        archetype: a.id,
        label: a.label,
        comfortable: a.comfortable ? { min: a.comfortable.min, max: a.comfortable.max } : null,
        why: a.why || null,
        refusal: a.refusal || null,
        matchedOn: m[0],
        breadcrumb: parts.join(' · '),
      };
    }
  }
  return { archetype: 'unknown', label: 'Not classified', comfortable: null, why: null, refusal: null, matchedOn: null, breadcrumb: parts.join(' · ') };
}

// Position of a leverage multiple against its own sector's band. Never an
// absolute verdict: the returned sentence always names the sector and the
// band, because "4.5x" alone is stretched for a steel producer and
// comfortable for a power utility, and a reader who sees only the multiple
// cannot tell which.
function assessLeverageVsSector(netLev, archetypeInfo) {
  // The sector check runs BEFORE the value check on purpose: for a lender the
  // multiple is meaningless whether or not it computed, and the reader is
  // owed the real reason rather than "no figure available".
  if (archetypeInfo && archetypeInfo.refusal) {
    return { status: 'not_assessable', reason: archetypeInfo.refusal, sentence: null, archetype: archetypeInfo.archetype };
  }
  if (netLev == null || !isFinite(netLev)) {
    return { status: 'not_assessable', reason: 'No net leverage figure to place against a sector band.', sentence: null };
  }
  if (!archetypeInfo || archetypeInfo.archetype === 'unknown' || !archetypeInfo.comfortable) {
    return {
      status: 'not_assessable',
      reason: 'This company’s sector did not match any of the benchmark archetypes, so its leverage has no band to be read against. The multiple itself is shown above; what is missing is a defensible range to read it against.',
      sentence: null,
    };
  }
  const band = archetypeInfo.comfortable;
  const x = (v) => v.toFixed(2) + 'x';
  let status;
  if (netLev <= band.max) status = netLev <= band.min ? 'comfortable' : 'adequate';
  else status = 'stretched';
  // Below the band's floor is the least-levered case, so it reads as
  // comfortable -- but a negative net figure means cash exceeds debt, which
  // is worth saying in words rather than leaving as a minus sign.
  const netCashNote = netLev < 0 ? ' Cash on hand exceeds total borrowings, so net debt is negative.' : '';
  const phrase = status === 'comfortable'
    ? 'at or below the comfortable range'
    : status === 'adequate'
      ? 'inside the comfortable range'
      : 'above the comfortable range';
  const sentence = 'Net debt is ' + x(netLev) + ' of EBITDA, ' + phrase + ' of ' + x(band.min) + '–' + x(band.max) +
    ' used here for a ' + archetypeInfo.label.toLowerCase() + '. ' + archetypeInfo.why + netCashNote;
  return { status, sentence, band: { min: band.min, max: band.max }, archetype: archetypeInfo.archetype, value: netLev };
}

// Interest cover has no sector band in this module -- the spec defines bands
// for leverage only, and inventing coverage bands per sector would be exactly
// the kind of unsourced table this engine refuses to carry. These thresholds
// are stated as the module's own stated convention, not as a sector norm, and
// the returned sentence says so.
const COVERAGE_THRESHOLDS = { comfortable: 6.0, adequate: 3.0 };

function assessCoverage(coverage) {
  if (coverage == null || !isFinite(coverage)) {
    return { status: 'not_assessable', reason: 'No interest coverage figure available.', sentence: null };
  }
  const status = coverage >= COVERAGE_THRESHOLDS.comfortable
    ? 'comfortable'
    : coverage >= COVERAGE_THRESHOLDS.adequate ? 'adequate' : 'stretched';
  const sentence = 'EBITDA covers the interest bill ' + coverage.toFixed(2) + ' times over. This module reads ' +
    COVERAGE_THRESHOLDS.comfortable.toFixed(0) + 'x and above as comfortable and below ' +
    COVERAGE_THRESHOLDS.adequate.toFixed(0) + 'x as stretched — a stated convention of this page, not a sector benchmark.';
  return { status, sentence, value: coverage, thresholds: COVERAGE_THRESHOLDS };
}

// ---------------------------------------------------------------------------
// Section 6 — Merton structural default model
// ---------------------------------------------------------------------------

// Chebyshev fit for the complementary error function (Numerical Recipes
// `erfcc`), fractional error < 1.2e-7 across the whole range. A polynomial
// CDF approximation of the Abramowitz-Stegun kind collapses to exactly 0 in
// the far tail, which matters here: a healthy company lands at d2 near 9-10,
// where the true probability is ~1e-22. Returning a hard 0 there would be
// indistinguishable from a solver failure.
function erfc(x) {
  const z = Math.abs(x);
  const t = 2 / (2 + z);
  const ty = 4 * t - 2;
  const cof = [
    -1.3026537197817094, 6.4196979235649026e-1, 1.9476473204185836e-2,
    -9.561514786808631e-3, -9.46595344482036e-4, 3.66839497852761e-4,
    4.2523324806907e-5, -2.0278578112534e-5, -1.624290004647e-6,
    1.303655835580e-6, 1.5626441722e-8, -8.5238095915e-8,
    6.529054439e-9, 5.059343495e-9, -9.91364156e-10,
    -2.27365122e-10, 9.6467911e-11, 2.394038e-12,
    -6.886027e-12, 8.94487e-13, 3.13092e-13,
    -1.12708e-13, 3.81e-16, 7.106e-15,
  ];
  let d = 0, dd = 0;
  for (let j = cof.length - 1; j > 0; j--) {
    const tmp = d;
    d = ty * d - dd + cof[j];
    dd = tmp;
  }
  const ans = t * Math.exp(-z * z + 0.5 * (cof[0] + ty * d) - dd);
  return x >= 0 ? ans : 2 - ans;
}

function normCdf(x) {
  if (!isFinite(x)) return x > 0 ? 1 : 0;
  return 0.5 * erfc(-x / Math.SQRT2);
}

function normPdf(x) {
  if (!isFinite(x)) return 0;
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

// Annualised equity volatility from an actual daily close series -- never
// from a third-party beta or a published volatility figure. Those disagree
// with each other by multiples depending on window and method, which is
// precisely the failure this function exists to avoid.
//
// `prices` is [{date, close}] oldest-first, matching /api/history's shape.
// Yahoo's raw `close` is already split-back-adjusted, so a split does not
// appear here as a one-day -50% return; dividends are not adjusted out, which
// leaves a sub-1% drop on ex-dates that is immaterial to a volatility estimate
// and is not silently smoothed away.
function annualisedVolFromPrices(prices, opts) {
  opts = opts || {};
  const minObs = opts.minObservations == null ? 200 : opts.minObservations;
  if (!Array.isArray(prices) || prices.length < 2) {
    return { ok: false, reason: 'No price history was supplied, so equity volatility cannot be computed.' };
  }
  const clean = prices.filter((p) => p && p.close != null && isFinite(p.close) && p.close > 0);
  if (clean.length < minObs + 1) {
    return {
      ok: false,
      reason: 'Only ' + clean.length + ' usable daily closes are available. This model needs at least ' + (minObs + 1) +
        ' (about a year of trading) before an annualised volatility means anything, so it is not computed.',
      observations: clean.length,
    };
  }
  const logReturns = [];
  let extremeMoves = 0;
  for (let i = 1; i < clean.length; i++) {
    const lr = Math.log(clean[i].close / clean[i - 1].close);
    if (!isFinite(lr)) continue;
    // A single day beyond +-50% in log terms is far more likely to be an
    // unhandled corporate action than a real move. Counted and reported, never
    // dropped: silently trimming the tail of a volatility estimate is how a
    // model ends up understating risk.
    if (Math.abs(lr) > 0.5) extremeMoves++;
    logReturns.push(lr);
  }
  const n = logReturns.length;
  if (n < minObs) {
    return { ok: false, reason: 'Only ' + n + ' usable daily returns after cleaning; at least ' + minObs + ' are needed.', observations: n };
  }
  const mean = logReturns.reduce((a, b) => a + b, 0) / n;
  // Sample standard deviation (n-1). The population form would understate
  // volatility, and on ~250 observations the difference is real.
  const variance = logReturns.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (n - 1);
  const daily = Math.sqrt(variance);
  const TRADING_DAYS = 252;
  return {
    ok: true,
    vol: daily * Math.sqrt(TRADING_DAYS),
    dailyVol: daily,
    observations: n,
    tradingDaysPerYear: TRADING_DAYS,
    startDate: clean[0].date || null,
    endDate: clean[clean.length - 1].date || null,
    extremeMoves,
  };
}

// Solves the two Black-Scholes-Merton equations simultaneously for the
// unobservable asset value V and asset volatility sigma_V:
//
//   f1:  V*N(d1) - D*e^(-rT)*N(d2) - E            = 0
//   f2:  N(d1)*sigma_V*V - sigma_E*E              = 0
//
// Newton-Raphson with an analytic Jacobian. The Jacobian simplifies sharply
// because V*phi(d1) = D*e^(-rT)*phi(d2) is an identity of the Black-Scholes
// form, which collapses df1/dV to exactly N(d1) and df1/dsigma_V to vega.
// Backtracking line search keeps the iterate inside the domain (V > 0,
// sigma_V > 0) rather than letting a full Newton step overshoot into a region
// where the logs are undefined.
function mertonSolve(input) {
  input = input || {};
  const E = input.E, sigmaE = input.sigmaE, D = input.D, r = input.r;
  const T = input.T == null ? 1 : input.T;
  const tol = input.tol == null ? 1e-8 : input.tol;
  const maxIter = input.maxIter == null ? 200 : input.maxIter;

  if (E == null || !isFinite(E) || E <= 0) return { ok: false, reason: 'Market value of equity must be a positive number.' };
  if (sigmaE == null || !isFinite(sigmaE) || sigmaE <= 0) return { ok: false, reason: 'Equity volatility must be a positive number.' };
  if (r == null || !isFinite(r)) return { ok: false, reason: 'A risk-free rate is required.' };
  if (T == null || !isFinite(T) || T <= 0) return { ok: false, reason: 'The horizon T must be a positive number of years.' };
  if (D == null || !isFinite(D) || D <= 0) {
    // Genuinely common among Indian large caps and not an error: with no
    // borrowings there is no default point, so distance-to-default is
    // undefined rather than infinite.
    return {
      ok: false,
      reason: 'This company reports no borrowings, so there is no default point for a structural model to measure distance to. Distance-to-default is undefined, not infinite.',
      noDebt: true,
    };
  }

  const sqrtT = Math.sqrt(T);
  const discD = D * Math.exp(-r * T);

  const dvals = (V, sV) => {
    const d1 = (Math.log(V / D) + (r + 0.5 * sV * sV) * T) / (sV * sqrtT);
    return { d1, d2: d1 - sV * sqrtT };
  };
  const residuals = (V, sV) => {
    const { d1, d2 } = dvals(V, sV);
    return [
      V * normCdf(d1) - discD * normCdf(d2) - E,
      normCdf(d1) * sV * V - sigmaE * E,
    ];
  };

  // Spec's initial guesses: total capital at book-ish scale, and equity
  // volatility de-levered by the equity share of that capital.
  let V = E + D;
  let sV = sigmaE * (E / (E + D));
  if (!(sV > 0)) sV = Math.max(sigmaE, 1e-4);

  let iterations = 0;
  let converged = false;
  for (let i = 0; i < maxIter; i++) {
    iterations = i + 1;
    const [f1, f2] = residuals(V, sV);
    // Scale-relative convergence: an absolute 1e-8 on a residual measured in
    // crore would be unreachable at E ~ 1e5, and meaninglessly strict at
    // E ~ 1e1. Both equations are in the same units as E, so E is the scale.
    const scale = Math.max(Math.abs(E), 1);
    if (Math.abs(f1) / scale < tol && Math.abs(f2) / scale < tol) { converged = true; break; }

    const { d1 } = dvals(V, sV);
    const Nd1 = normCdf(d1);
    const phid1 = normPdf(d1);
    // df1/dV = N(d1)              (the phi terms cancel by the BS identity)
    // df1/dsV = V*phi(d1)*sqrt(T) (vega)
    // df2/dV = N(d1)*sV + phi(d1)/sqrt(T)
    // df2/dsV = N(d1)*V + sV*V*phi(d1)*dd1/dsV
    const dd1_dsV = -(Math.log(V / D) + r * T) / (sV * sV * sqrtT) + sqrtT / 2;
    const j11 = Nd1;
    const j12 = V * phid1 * sqrtT;
    const j21 = Nd1 * sV + phid1 / sqrtT;
    const j22 = Nd1 * V + sV * V * phid1 * dd1_dsV;

    const det = j11 * j22 - j12 * j21;
    if (!isFinite(det) || Math.abs(det) < 1e-14) {
      return { ok: false, reason: 'The solver hit a singular Jacobian and could not proceed. No distance-to-default is reported.', iterations, converged: false };
    }
    const stepV = (-f1 * j22 + f2 * j12) / det;
    const stepS = (-f2 * j11 + f1 * j21) / det;

    // Backtracking: halve the step until it lands in the valid domain and
    // does not increase the residual norm.
    const norm0 = Math.abs(f1) + Math.abs(f2);
    let lambda = 1;
    let nextV = V, nextS = sV, accepted = false;
    for (let k = 0; k < 40; k++) {
      nextV = V + lambda * stepV;
      nextS = sV + lambda * stepS;
      if (nextV > 0 && nextS > 1e-9 && isFinite(nextV) && isFinite(nextS)) {
        const [g1, g2] = residuals(nextV, nextS);
        if (isFinite(g1) && isFinite(g2) && Math.abs(g1) + Math.abs(g2) <= norm0 * (1 - 1e-4 * lambda) + 1e-12) { accepted = true; break; }
      }
      lambda /= 2;
    }
    if (!accepted) {
      // Could not make progress -- report it rather than returning the last
      // iterate dressed up as a solution.
      const [h1, h2] = residuals(V, sV);
      const sc = Math.max(Math.abs(E), 1);
      if (Math.abs(h1) / sc < tol && Math.abs(h2) / sc < tol) { converged = true; break; }
      return { ok: false, reason: 'The solver could not converge on an asset value and asset volatility consistent with the observed equity. No distance-to-default is reported.', iterations, converged: false, residuals: [h1, h2] };
    }
    V = nextV; sV = nextS;
  }

  const [rf1, rf2] = residuals(V, sV);
  const scale = Math.max(Math.abs(E), 1);
  if (!converged || !(Math.abs(rf1) / scale < tol && Math.abs(rf2) / scale < tol)) {
    return {
      ok: false,
      reason: 'The solver ran out of iterations before both equations balanced. No distance-to-default is reported.',
      iterations, converged: false, residuals: [rf1, rf2],
    };
  }

  const { d1, d2 } = dvals(V, sV);
  return {
    ok: true,
    V, sigmaV: sV, d1, d2,
    distanceToDefault: d2,
    impliedPd: normCdf(-d2),
    residuals: [rf1, rf2],
    iterations,
    converged: true,
    inputs: { E, sigmaE, D, r, T },
  };
}

// Section 6's honesty requirement, as an actual check rather than a standing
// disclaimer. A structural model reads today's market price as the truth; a
// stock that has just run hard makes the equity cushion -- and therefore the
// distance to default -- look larger than the accounts alone would support.
// Fires on evidence (proximity to the 52-week high, the size of the 52-week
// range, an unusually large distance-to-default), so it stays absent on the
// companies where it would be noise.
function priceContextCaveat(ctx) {
  ctx = ctx || {};
  const price = ctx.currentPrice, hi = ctx.high52w, lo = ctx.low52w;
  const dd = ctx.distanceToDefault;
  const reasons = [];
  let nearHigh = null, runUp = null;
  if (price != null && hi != null && isFinite(price) && isFinite(hi) && hi > 0) {
    nearHigh = price / hi;
    if (nearHigh >= 0.95) reasons.push('the share price is within 5% of its 52-week high');
  }
  if (price != null && lo != null && isFinite(price) && isFinite(lo) && lo > 0) {
    runUp = price / lo - 1;
    if (runUp >= 0.5) reasons.push('the share price is up ' + Math.round(runUp * 100) + '% from its 52-week low');
  }
  if (dd != null && isFinite(dd) && dd >= 6) {
    reasons.push('the computed distance to default (' + dd.toFixed(1) + ' standard deviations) is far outside the range where this model discriminates between companies');
  }
  if (!reasons.length) return { triggered: false, nearHigh, runUp };
  const list = reasons.length === 1 ? reasons[0] : reasons.slice(0, -1).join(', ') + ' and ' + reasons[reasons.length - 1];
  return {
    triggered: true,
    nearHigh,
    runUp,
    reasons,
    text: 'This figure is built on today’s share price, and ' + list + '. A market that has re-priced a company upward makes its equity cushion — and therefore this distance-to-default — look larger than the reported accounts on their own would support. Read it as a market opinion measured precisely, not as an independent reading of the balance sheet.',
  };
}

// ---------------------------------------------------------------------------
// Section 5 — rating-based Expected Loss
//
// READ THIS BEFORE ADDING A ROW.
//
// Every figure in this table must be transcribed from the named agency's own
// published default and transition study, with the study's title and year
// recorded next to it. Do not fill a band from memory, from a secondary
// summary, or by interpolating between two bands that are populated -- the
// agencies publish these annually and the numbers move, and a plausible-
// looking made-up default rate presented to a credit professional as agency
// statistics is the single worst thing this module could do.
//
// A band that is not present here is not an error state to patch around: the
// lookup refuses, the UI says which agency and band it could not source, and
// the Merton model in Section 6 carries the analysis on its own. That path is
// exercised by engine.test.js and is expected to be the common case until
// this table is filled in from the source documents.
//
// `verified: true` means: a person read the figure off the agency's own
// published study and recorded the citation in `study`.
// ---------------------------------------------------------------------------

const RATING_DEFAULT_STUDIES = {
  CRISIL: {
    agency: 'CRISIL Ratings',
    scale: 'long-term India (CRISIL AAA … CRISIL D)',
    source: 'CRISIL Ratings, “Long-run and short-run average default rates”, published as a SEBI regulatory disclosure under circular CIR/MIRSD/CRA/6/2010',
    sourceUrl: 'https://www.crisilratings.com/content/dam/crisil/generic-images1/our-businesses/ratings/regulatory-disclosure-highlighted-policies/regulatory-disclosures/sebi/disclosures-as-per-sebi-circular-cir-mirsd-cra-6-2010/long-run-and-short-run-average-default-rates.pdf',
    retrieved: '2026-09-05',
    methodology: 'Weighted-average cumulative default rates, adjusted for ratings withdrawn during the year and including ratings of non-cooperative issuers, per the methodology SEBI prescribes.',
    defaultDataset: 'longRunAllInstruments',
    defaultShortTermDataset: 'longRunShortTermScale',
    datasets: {
      // ANNEXURE A.1 — the broadest universe, and the right default: an
      // issuer's long-term rating is assigned across all its instruments,
      // not only any listed paper it happens to have.
      longRunAllInstruments: {
        annexure: 'A.1',
        label: 'Long-run, all long-term instruments',
        period: 'April 2015 to March 2026 (last 10 financial years)',
        verified: true,
        bands: {
          AAA: { oneYear: 0.0001, twoYear: 0.0006, threeYear: 0.0013, footnote: 'One default in fiscal 2020, caused by an unexpected legal event.' },
          AA: { oneYear: 0.0006, twoYear: 0.0018, threeYear: 0.0035, footnote: 'Three defaults since fiscal 2020 — an unexpected legal event (2020), the Covid-19 pandemic (2021) and an operational issue (2024). Excluding the 2024 operational default, the rates are 0.04%, 0.14% and 0.27%.' },
          A: { oneYear: 0.0009, twoYear: 0.0037, threeYear: 0.0066, footnote: 'Excluding an operational-issue default in fiscal 2026, the rates are 0.08%, 0.36% and 0.65%.' },
          BBB: { oneYear: 0.0042, twoYear: 0.0107, threeYear: 0.0173, footnote: 'Two operational-reason defaults in fiscal 2025 and 2026. Excluding both, the rates are 0.41%, 1.05% and 1.70%.' },
          BB: { oneYear: 0.0197, twoYear: 0.0370, threeYear: 0.0517 },
          B: { oneYear: 0.0295, twoYear: 0.0526, threeYear: 0.0713 },
          C: { oneYear: 0.1021, twoYear: 0.1627, threeYear: 0.2065 },
        },
      },
      // ANNEXURE A.6, Table 1 — the same agency, same window, restricted to
      // listed debt securities, and up to nine times higher at the lower
      // categories. Carried so the disagreement is visible rather than
      // resolved silently by whichever table got loaded first.
      longRunListedDebt: {
        annexure: 'A.6 (Table 1)',
        label: 'Long-run, listed debt securities only',
        period: 'April 2015 to March 2026',
        verified: true,
        note: 'A much smaller universe than the all-instruments table, so each default moves the rate a long way. Relevant when the exposure is a listed bond rather than the issuer as a whole.',
        // CRISIL publishes the sample ratio itself and states the conclusion:
        // "computation of default rates solely based on listed debt securities
        // (or any single instrument class) is not representative of the default
        // behaviour of Indian corporates." Carrying the ratio turns the spread
        // warning from "these disagree" into "here is why, in the publisher's
        // own numbers".
        sampleShareOfAllInstruments: { AAA: '1/2', AA: '1/4th', A: '1/20th', BBB: '1/160th', BB: '1/500th', B: '1/1800th', C: '1/200th' },
        bands: {
          AAA: { oneYear: 0.0000, twoYear: 0.0000, threeYear: 0.0000 },
          AA: { oneYear: 0.0020, twoYear: 0.0045, threeYear: 0.0069 },
          A: { oneYear: 0.0054, twoYear: 0.0095, threeYear: 0.0144 },
          BBB: { oneYear: 0.0312, twoYear: 0.0540, threeYear: 0.0772 },
          BB: { oneYear: 0.1029, twoYear: 0.3043, threeYear: 0.4819 },
          B: { oneYear: 0.2630, twoYear: 0.4632, threeYear: 0.5589 },
          C: { oneYear: 0.5789, twoYear: 0.9825, threeYear: 1.0000 },
        },
      },
      // ANNEXURE A.3 — recent cohorts only. Lower almost everywhere, because
      // the window misses the 2018-2020 credit cycle.
      shortRunAllInstruments: {
        annexure: 'A.3',
        label: 'Short-run, all long-term instruments',
        period: 'April 2023 to March 2026 (24 cohorts, one-year rate)',
        verified: true,
        note: 'A recent-cohorts view. It excludes the 2018–2020 credit cycle, which is why it sits below the long-run table almost everywhere.',
        bands: {
          AAA: { oneYear: 0.0000, twoYear: 0.0000, threeYear: 0.0000 },
          AA: { oneYear: 0.0001, twoYear: 0.0006, threeYear: 0.0011 },
          A: { oneYear: 0.0013, twoYear: 0.0029, threeYear: 0.0044 },
          BBB: { oneYear: 0.0012, twoYear: 0.0035, threeYear: 0.0057 },
          BB: { oneYear: 0.0118, twoYear: 0.0227, threeYear: 0.0322 },
          B: { oneYear: 0.0110, twoYear: 0.0232, threeYear: 0.0354 },
          C: { oneYear: 0.0212, twoYear: 0.0500, threeYear: 0.0825 },
        },
      },
      // ANNEXURE A.2 — a different rating scale entirely (A1+ … A4), not the
      // long-term one, so its bands never collide with the tables above.
      // Note A1 sits below A1+ here; that inversion is in the published data
      // and is left as printed rather than smoothed.
      longRunShortTermScale: {
        annexure: 'A.2',
        label: 'Long-run, short-term instruments (A1+ … A4 scale)',
        period: 'April 2015 to March 2026',
        verified: true,
        scaleOverride: 'short-term India (A1+ … A4)',
        bands: {
          'A1+': { oneYear: 0.0002 },
          A1: { oneYear: 0.0001 },
          A2: { oneYear: 0.0022 },
          A3: { oneYear: 0.0037 },
          A4: { oneYear: 0.0254 },
        },
      },
      // ANNEXURE A.4 — the short-term scale over recent cohorts only, so the
      // short-term ratings have an alternative to be read against in the same
      // way the long-term ones do. A3 below A2 is another published inversion,
      // left as printed.
      shortRunShortTermScale: {
        annexure: 'A.4',
        label: 'Short-run, short-term instruments (A1+ … A4 scale)',
        period: 'April 2023 to March 2026 (24 cohorts)',
        verified: true,
        scaleOverride: 'short-term India (A1+ … A4)',
        note: 'A recent-cohorts view of the short-term scale.',
        bands: {
          'A1+': { oneYear: 0.0000 },
          A1: { oneYear: 0.0000 },
          A2: { oneYear: 0.0009 },
          A3: { oneYear: 0.0007 },
          A4: { oneYear: 0.0117 },
        },
      },
    },
  },
  // Not loaded. CARE's search endpoint 404s and ICRA's site is a JS-rendered
  // application shell, so neither could be read the way CRISIL's regulatory
  // disclosure PDF could. Left empty so the lookup refuses by name.
  CARE: { agency: 'CARE Ratings', scale: 'long-term India (CARE AAA … CARE D)', datasets: {} },
  ICRA: { agency: 'ICRA', scale: 'long-term India (ICRA AAA … ICRA D)', datasets: {} },
  MOODYS: { agency: 'Moody’s', scale: 'global long-term (Aaa … C)', datasets: {} },
  SP: { agency: 'S&P Global Ratings', scale: 'global long-term (AAA … D)', datasets: {} },
};

// Strips the agency prefix and any outlook/modifier so "CRISIL AA+" and "AA+"
// both resolve to the AA band. Notches are deliberately collapsed: agencies
// publish default statistics by category, not by notch, and interpolating a
// notch-level rate would invent a number the published study does not contain.
// Real ratings are never typed as a bare notch. They are copied off a press
// release or a stock-exchange filing and look like "CRISIL AA+/Stable",
// "[ICRA]AA (Stable)", "CARE AA; Stable", "IND AA+/Rating Watch Negative".
// The band is the one field a person enters by hand here, so the parser has
// to read what they will actually paste.
//
// What it must NOT do is guess. Everything after the notch is classified
// against a closed list; a qualifier that is not on that list is reported as
// unrecognised rather than discarded, because the qualifiers that change what
// a rating MEANS -- (CE), (SO), Issuer Not Cooperating -- look exactly like
// the ones that don't.
const RATING_AGENCY_PREFIX_RE = /^\[?\s*(INDIA\s+RATINGS(\s*&\s*RESEARCH)?|IND-?RA|BRICKWORK|INFOMERICS|ACUITE|SMERA|CRISIL|CARE\s*EDGE|CAREEDGE|CARE|ICRA|FITCH|MOODY'?S|S\s*&\s*P|BWR|IND)\s*\]?\s*[:-]?\s*/;
const RATING_OUTLOOK_RE = /^(STABLE|POSITIVE|NEGATIVE|DEVELOPING)(\s+OUTLOOK)?$/;
const RATING_WATCH_RE = /^((RATING\s*)?WATCH(\s*WITH)?(\s*(DEVELOPING|POSITIVE|NEGATIVE))?(\s*IMPLICATIONS)?|UNDER\s*(RATING\s*)?WATCH|RWD|RWP|RWN)$/;
const RATING_STRUCTURAL_RE = /^(CE|SO|CREDIT\s*ENHANCEMENT|STRUCTURED\s*OBLIGATION)$/;
const RATING_INC_RE = /^(ISSUER\s*NOT\s*CO-?OPERATING|INC)$/;
const RATING_WITHDRAWN_RE = /^(WITHDRAWN|SUSPENDED|NOT\s*MEANINGFUL|NM)$/;

const RATING_SHORT_TERM_RE = /^A[1-4]$/;

// "CRISIL Ratings’s" is wrong on screen; a name already ending in s takes the
// bare apostrophe.
function possessive(name) {
  return /s$/i.test(String(name)) ? name + '’' : name + '’s';
}

function matchRatingNotch(token) {
  return String(token || '').replace(/\s+/g, '').match(/^(AAA|AA|A1\+|A1|A2|A3|A4|A|BBB|BB|B|CCC|CC|C|D)([+-]?)$/);
}

function normaliseRatingBand(band) {
  if (band == null) return null;
  let raw = String(band).trim().toUpperCase().replace(/\s+/g, ' ');
  if (!raw) return null;

  // A provisional rating is assigned ahead of documentation being finalised.
  // It is still a rating on the published scale, so it parses -- but the
  // caller is told, because it can lapse to a different level.
  let provisional = false;
  raw = raw.replace(/^PROVISIONAL\s+/, () => { provisional = true; return ''; });
  raw = raw.replace(RATING_AGENCY_PREFIX_RE, '');
  raw = raw.replace(/^PROVISIONAL\s+/, () => { provisional = true; return ''; });

  // Split on the separators agencies actually use. A spaced hyphen is a
  // separator ("AA - Withdrawn"); an unspaced one is the minus modifier
  // ("AA-"), so the space is what distinguishes them and it must be required.
  const tokens = raw.split(/[/;,()]+|\s+[-–—]\s+/).map((t) => t.trim()).filter(Boolean);
  if (!tokens.length) return null;

  // Ordered longest-first so AAA never matches as AA, and the short-term
  // scale (A1+ … A4) is tested before the bare long-term 'A' -- otherwise
  // "A1+" normalises to "A" and a short-term rating quietly picks up a
  // long-term default rate.
  //
  // Anchored at both ends, with no loose whole-string fallback: a free-text
  // input like "not a rating" must return null, and a \b(A)\b search anywhere
  // in the string would happily match the "a" in "not a rating".
  const notch = matchRatingNotch(tokens[0]);
  if (!notch) return null;

  let outlook = null, watch = null, structural = null;
  let notCooperating = false, withdrawn = false;
  const unrecognised = [];
  const companions = [];
  for (const token of tokens.slice(1)) {
    if (RATING_OUTLOOK_RE.test(token)) { outlook = token.replace(/\s+OUTLOOK$/, ''); continue; }
    if (RATING_WATCH_RE.test(token)) { watch = token; continue; }
    if (RATING_STRUCTURAL_RE.test(token)) { structural = /^(CE|CREDIT)/.test(token) ? 'CE' : 'SO'; continue; }
    if (RATING_INC_RE.test(token)) { notCooperating = true; continue; }
    if (RATING_WITHDRAWN_RE.test(token)) { withdrawn = true; continue; }
    // A press release commonly prints the long-term and short-term ratings on
    // one line -- "CRISIL AA/Stable/CRISIL A1+". The second is a rating the
    // agency published, not an unknown qualifier, so it is recorded rather
    // than treated as something that might change what the first one means.
    const also = matchRatingNotch(token.replace(RATING_AGENCY_PREFIX_RE, ''));
    if (also) { companions.push(also[1] + (also[2] || '')); continue; }
    unrecognised.push(token);
  }

  return {
    category: notch[1],
    modifier: notch[2] || '',
    input: String(band),
    companions: companions.length ? companions : null,
    outlook,
    watch,
    structural,
    notCooperating,
    withdrawn,
    provisional,
    unrecognised: unrecognised.length ? unrecognised : null,
  };
}

function ratingPd(agencyKey, band, datasetKey) {
  const key = String(agencyKey || '').trim().toUpperCase().replace(/[^A-Z]/g, '');
  const agency = RATING_DEFAULT_STUDIES[key];
  if (!agency) {
    return { ok: false, reason: 'No published default study is loaded for rating agency "' + String(agencyKey) + '".' };
  }
  const datasets = agency.datasets || {};
  const parsed = normaliseRatingBand(band);
  if (!parsed) {
    return { ok: false, reason: 'Could not read a rating category out of "' + String(band) + '".' };
  }
  // A1+ … A4 are the short-term scale and are published in their own table.
  // The default dataset is a long-term one, so a short-term rating has to
  // select its own table or it would refuse for data that is actually loaded.
  // An explicit datasetKey from the caller always wins.
  let dsKey = datasetKey;
  let scaleSwitched = false;
  if (!dsKey && RATING_SHORT_TERM_RE.test(parsed.category.replace('+', ''))) {
    // Named explicitly rather than taken from object key order, so adding a
    // dataset can never silently change which table a short-term rating reads.
    const preferred = agency.defaultShortTermDataset;
    dsKey = (preferred && datasets[preferred] && datasets[preferred].bands[parsed.category] != null)
      ? preferred
      : Object.keys(datasets).find((k) => datasets[k].verified && datasets[k].bands[parsed.category] != null);
    scaleSwitched = !!dsKey;
  }
  if (!dsKey) dsKey = agency.defaultDataset;
  const ds = dsKey ? datasets[dsKey] : null;
  if (!ds || !ds.verified) {
    return {
      ok: false,
      reason: 'No published default study is loaded for ' + agency.agency + '. This module only reports default rates transcribed from an agency’s own published study, so it does not estimate one here.',
      agency: agency.agency,
    };
  }
  // Refusals, in the order that a wrong answer would be most misleading.
  //
  // A (CE) or (SO) rating is an opinion on an obligation that carries outside
  // support -- a guarantee, an escrow, a parent's undertaking. The default
  // study is built on standalone corporate ratings, so reading an AA(CE) off
  // the AA row measures the guarantor and reports it as the company.
  if (parsed.structural) {
    return {
      ok: false,
      reason: '“' + String(band) + '” is a ' + (parsed.structural === 'CE' ? 'credit-enhanced (CE)' : 'structured obligation (SO)') +
        ' rating. It describes a specific borrowing that carries outside support, not the company on its own, and ' + possessive(agency.agency) +
        ' published default table is built from standalone ratings. Applying it here would report the strength of the support provider as if it were the company’s.',
      agency: agency.agency,
      category: parsed.category,
    };
  }
  if (parsed.withdrawn) {
    return {
      ok: false,
      reason: '“' + String(band) + '” has been withdrawn or suspended, so it is not a current opinion and no default rate is read from it.',
      agency: agency.agency,
      category: parsed.category,
    };
  }
  if (parsed.unrecognised) {
    return {
      ok: false,
      reason: 'The rating “' + String(band) + '” carries a qualifier this module does not recognise (' + parsed.unrecognised.join(', ') +
        '). Qualifiers change what a rating covers, so it is not read as a plain ' + parsed.category + '. Enter the rating category on its own if that is what was meant.',
      agency: agency.agency,
      category: parsed.category,
    };
  }
  // D is the absorbing state, not a band with a statistic behind it. No study
  // publishes a "probability that a defaulted issuer defaults", and reading
  // the empty D row as a missing figure would say the wrong thing entirely.
  if (parsed.category === 'D') {
    return {
      ok: false,
      reason: 'A ‘D’ rating means ' + agency.agency + ' has recorded that the issuer has already defaulted on a payment. There is no forward one-year default probability to look up — the event the probability describes has happened.',
      agency: agency.agency,
      category: 'D',
      inDefault: true,
    };
  }
  const entry = ds.bands[parsed.category];
  if (!entry || entry.oneYear == null) {
    return {
      ok: false,
      reason: 'No one-year default rate is published for ' + agency.agency + ' ‘' + parsed.category +
        '’ in the ' + ds.label.toLowerCase() + ' table, so none is reported.',
      agency: agency.agency,
      category: parsed.category,
    };
  }
  // A notch above the category floor (AA+ inside AA) uses the category rate,
  // which is deliberately the more pessimistic reading -- the published study
  // has no AA+ figure to be more precise with.
  const conservativeNote = parsed.modifier === '+'
    ? 'The rating carries a ‘+’ modifier, but agencies publish default statistics by category rather than by notch. The plain ' +
      parsed.category + ' rate is used, which is the more pessimistic of the available readings, rather than interpolating a lower figure the study does not contain.'
    : null;

  // Qualifiers that do not change which row is read, but do change how much
  // weight the row deserves. Each is stated rather than folded into the number.
  const qualifierNotes = [];
  if (scaleSwitched) {
    qualifierNotes.push('‘' + parsed.category + '’ is on the short-term rating scale, so the default rate is read from ' + agency.agency +
      possessive(agency.agency) + ' short-term table (' + ds.annexure + ') rather than the long-term one. Short-term ratings describe instruments maturing within a year and are not interchangeable with long-term categories.');
  }
  if (parsed.companions) {
    qualifierNotes.push('The rating as entered also carries ' + parsed.companions.join(' and ') +
      '. The default rate below is for ' + parsed.category + parsed.modifier + ', the first rating given.');
  }
  if (parsed.notCooperating) {
    qualifierNotes.push('This rating is tagged ‘Issuer Not Cooperating’, which means ' + agency.agency +
      ' assigned it without current information from the company. ' + agency.agency +
      ' states that such ratings are based on best available information and may not adequately reflect the credit risk.');
  }
  if (parsed.provisional) {
    qualifierNotes.push('This is a provisional rating, assigned before the supporting documentation was finalised. It can be revised or withdrawn when the final terms are in place.');
  }
  if (parsed.watch) {
    qualifierNotes.push('The rating is on watch (' + parsed.watch.toLowerCase() +
      '), so the agency has flagged that it may change once a specific event resolves. The default rate below is the rate for the current category, not for the outcome being watched.');
  }
  if (parsed.outlook === 'NEGATIVE') {
    qualifierNotes.push('The outlook is negative, which is the agency’s view on the direction over the medium term. The published default rate is for the category as it stands and does not carry the outlook.');
  }

  // Same agency, same window, different dataset -- and at the lower
  // categories the two disagree by up to nine times. Surfacing the alternative
  // is the honest move: a reader who sees one figure alone cannot tell that
  // the choice of table moved it by an order of magnitude.
  const alternatives = [];
  Object.keys(datasets).forEach((k) => {
    if (k === dsKey) return;
    const other = datasets[k];
    const oe = other && other.verified && other.bands[parsed.category];
    if (oe && oe.oneYear != null) {
      alternatives.push({ dataset: k, label: other.label, annexure: other.annexure, period: other.period, oneYear: oe.oneYear });
    }
  });
  let spreadNote = null;
  if (alternatives.length) {
    const all = alternatives.map((a) => a.oneYear).concat([entry.oneYear]);
    const lo = Math.min.apply(null, all), hi = Math.max.apply(null, all);
    // Three gates, all required. A ratio test alone fires on AAA, where the
    // tables read 0.00% and 0.01% -- infinitely different as a ratio, and
    // worth nothing to a reader. The absolute gates make the warning mean
    // "this choice would change your answer", not "these differ".
    if (hi >= 0.001 && hi - lo >= 0.0005 && hi >= lo * 2) {
      spreadNote = 'The same agency publishes more than one default rate for ‘' + parsed.category + '’ over the same window, ranging from ' +
        (lo * 100).toFixed(2) + '% to ' + (hi * 100).toFixed(2) +
        '% depending on which set of instruments is counted. The figure shown here is the ' + ds.label.toLowerCase() +
        ' table; the choice of table moves the answer more than the rating itself does.';
      // The publisher explains its own spread, so quote the reason rather than
      // leaving the reader to assume the higher table is the prudent one. It
      // is not -- it is the small-sample one, and CRISIL says so.
      const listed = [ds].concat(alternatives.map((a) => datasets[a.dataset]))
        .find((x) => x && x.sampleShareOfAllInstruments);
      const share = listed && listed.sampleShareOfAllInstruments[parsed.category];
      if (share) {
        spreadNote += ' The wider figure comes from the listed-debt-securities table, whose sample for ‘' + parsed.category +
          '’ is about ' + share + ' the size of the all-instruments sample. ' + agency.agency +
          ' states that a rate computed on a single instrument class is not representative of how Indian companies actually default, which is why the broader table is used here.';
      }
    }
  }

  return {
    ok: true,
    pd: entry.oneYear,
    twoYearPd: entry.twoYear == null ? null : entry.twoYear,
    threeYearPd: entry.threeYear == null ? null : entry.threeYear,
    agency: agency.agency,
    scale: ds.scaleOverride || agency.scale,
    category: parsed.category,
    modifier: parsed.modifier,
    ratingAsGiven: parsed.input,
    dataset: dsKey,
    datasetLabel: ds.label,
    annexure: ds.annexure,
    period: ds.period,
    study: agency.source,
    sourceUrl: agency.sourceUrl,
    retrieved: agency.retrieved,
    methodology: agency.methodology || null,
    note: ds.note || null,
    bandFootnote: entry.footnote || null,
    conservativeNote,
    qualifierNotes: qualifierNotes.length ? qualifierNotes : null,
    outlook: parsed.outlook,
    watch: parsed.watch,
    notCooperating: parsed.notCooperating,
    provisional: parsed.provisional,
    alternatives,
    spreadNote,
  };
}

// Basel Foundation IRB supervisory LGD for senior unsecured corporate
// exposure. Used only when the caller has no facility-level security
// information; the returned object always says which case applied so the
// number is never mistaken for a company-specific recovery estimate.
const LGD_BASEL_FOUNDATION_SENIOR_UNSECURED = 0.45;

function resolveLgd(explicitLgd) {
  if (explicitLgd != null && isFinite(explicitLgd) && explicitLgd >= 0 && explicitLgd <= 1) {
    return { lgd: explicitLgd, basis: 'supplied', note: 'Loss given default supplied for this specific exposure.' };
  }
  return {
    lgd: LGD_BASEL_FOUNDATION_SENIOR_UNSECURED,
    basis: 'basel_foundation',
    note: 'No facility-level security information was supplied, so this uses the Basel Foundation IRB supervisory assumption of 45% for senior unsecured corporate exposure — a regulatory standard, not an estimate of this company’s recovery rate.',
  };
}

// EAD is the amount the reader has at risk, not the company's own debt. It is
// an explicit input with no default: assuming one would silently answer a
// question the user never asked.
function expectedLoss(pd, lgd, ead) {
  if (pd == null || !isFinite(pd) || pd < 0 || pd > 1) return { ok: false, reason: 'Probability of default must be a fraction between 0 and 1.' };
  if (lgd == null || !isFinite(lgd) || lgd < 0 || lgd > 1) return { ok: false, reason: 'Loss given default must be a fraction between 0 and 1.' };
  const pctOfExposure = pd * lgd;
  if (ead == null) {
    return { ok: true, amount: null, pctOfExposure, pd, lgd, ead: null, note: 'No exposure amount was supplied, so the expected loss is reported only as a percentage of whatever is at risk.' };
  }
  if (!isFinite(ead) || ead < 0) return { ok: false, reason: 'Exposure at default must be a non-negative amount.' };
  return { ok: true, amount: pctOfExposure * ead, pctOfExposure, pd, lgd, ead };
}

// The translation that makes an expected-loss figure mean something to a
// reader who does not already work with them. Deliberately arithmetic in
// words: no adjective, no verdict, no comparison to any other instrument.
function expectedLossSentence(el, currencySymbol) {
  if (!el || !el.ok) return null;
  const sym = currencySymbol || '₹';
  const pct = el.pctOfExposure * 100;
  const pctText = pct < 0.01 ? 'under 0.01%' : pct.toFixed(pct < 1 ? 3 : 2) + '%';
  let s = 'Across many companies carrying this rating, in an average year, ' + pctText +
    ' of the amount at risk was lost — the chance of a default multiplied by the share of the money not recovered when one happens.';
  if (el.amount != null) {
    s += ' On ' + sym + formatAmount(el.ead) + ' at risk that works out to about ' + sym + formatAmount(el.amount) + '.';
  }
  return s;
}

// For amounts whose unit the caller already knows -- the borrowings come off
// the balance sheet in crore, so passing them through formatAmount (which
// converts rupees to crore) would relabel 410 crore as \u20b9410.00. This one
// prints the number and the unit it was told, and never converts.
function formatQty(v, unit) {
  if (v == null || !isFinite(v)) return '\u2014';
  const n = Math.abs(v) >= 1000
    ? v.toLocaleString('en-IN', { maximumFractionDigits: 0 })
    : String(Math.round(v * 100) / 100);
  return unit ? n + ' ' + unit : n;
}

function formatAmount(v) {
  if (v == null || !isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e7) return (v / 1e7).toFixed(2) + ' cr';
  if (abs >= 1e5) return (v / 1e5).toFixed(2) + ' lakh';
  if (abs >= 1000) return v.toLocaleString('en-IN', { maximumFractionDigits: 0 });
  return v.toFixed(2);
}

// ---------------------------------------------------------------------------
// Section 6b — what the borrowings are made of
//
// A rating agency rates an INSTRUMENT, not a company. One issuer carries
// several ratings at once: long-term bank facilities and debentures on the
// long-term scale (AAA ... D), commercial paper and short-term facilities on
// the short-term scale (A1+ ... A4). CRISIL's own tables are titled "for
// long-term instruments" and "for short-term instruments" for that reason.
//
// The balance sheet cannot tell you which is which. It splits borrowings by
// TENOR -- long-term, short-term, leases -- and tenor is not instrument class:
//
//   * "Short-term borrowings" can be commercial paper, a cash-credit line, a
//     packing-credit export facility, or the current maturities of a long-term
//     term loan. The first three are rated on the short-term scale; the last
//     belongs to a long-term instrument and carries its long-term rating.
//   * Lease liabilities are not rated instruments at all. There is no agency
//     rating on a lease, so no published default rate applies to them.
//
// So this section does not decipher instrument class. It reports the split it
// can actually see, states plainly what that split does and does not
// establish, and -- where the composition would materially change the answer
// -- says so instead of letting one rating stand in for the whole stack.
// ---------------------------------------------------------------------------

const DEBT_BUCKETS = [
  {
    key: 'longTerm',
    label: 'Long-term borrowings',
    likelyScale: 'long-term',
    rateable: true,
    note: 'Term loans and debentures. Rated on the long-term scale, though the portion falling due within a year is usually reported under short-term borrowings.',
  },
  {
    key: 'shortTerm',
    label: 'Short-term borrowings',
    likelyScale: 'short-term',
    rateable: true,
    note: 'Working-capital lines, commercial paper and export finance sit here, and so do the current maturities of long-term loans. The first group is rated on the short-term scale; the last carries the long-term instrument\u2019s rating. The balance sheet does not separate them.',
  },
  {
    key: 'leases',
    label: 'Lease liabilities',
    likelyScale: null,
    rateable: false,
    note: 'Recognised as debt under Ind AS 116, but a lease is not an instrument a rating agency rates, so no published default rate applies to it.',
  },
  {
    key: 'other',
    label: 'Other borrowings',
    likelyScale: null,
    rateable: null,
    note: 'The source does not say what these are, so neither the rating scale nor whether they are rated at all can be established from this statement.',
  },
];

// Reads the tenor split the schedules give us and reports it without inferring
// anything the split does not contain.
function debtComposition(buckets, opts) {
  opts = opts || {};
  const unit = opts.unit || null;
  const sym = opts.currencySymbol || '\u20b9';
  if (!buckets || typeof buckets !== 'object') {
    return { ok: false, reason: 'No breakdown of the borrowings was supplied, so the composition of the debt is not described.' };
  }
  const rows = [];
  let total = 0, seen = 0;
  for (const spec of DEBT_BUCKETS) {
    const v = buckets[spec.key];
    if (v == null || !isFinite(v) || v < 0) continue;
    seen += 1;
    total += v;
    rows.push({ key: spec.key, label: spec.label, amount: v, likelyScale: spec.likelyScale, rateable: spec.rateable, note: spec.note });
  }
  if (!seen || total <= 0) {
    return { ok: false, reason: 'The borrowings breakdown carried no usable amounts, so the composition of the debt is not described.' };
  }
  rows.forEach((r) => { r.share = r.amount / total; });
  rows.sort((a, b) => b.amount - a.amount);

  const byKey = {};
  rows.forEach((r) => { byKey[r.key] = r; });
  const shareOf = (k) => (byKey[k] ? byKey[k].share : 0);
  const unrateable = rows.filter((r) => r.rateable === false);
  const unknownClass = rows.filter((r) => r.rateable === null);

  // Which scale the largest rateable bucket sits on. Reported as the scale the
  // bulk of the borrowings is LIKELY to be rated on, never as a finding about
  // any particular facility.
  const rateable = rows.filter((r) => r.rateable === true);
  const dominantScale = rateable.length ? rateable[0].likelyScale : null;

  const notes = [
    'This split is by how long the borrowing runs, not by what kind of borrowing it is. A rating agency rates each instrument separately \u2014 a company usually holds a long-term rating and a short-term rating at the same time \u2014 and the balance sheet does not record which instrument each figure belongs to.',
  ];
  if (shareOf('shortTerm') > 0) {
    notes.push('The short-term line mixes instruments rated on the short-term scale with the part of long-term loans that falls due within a year, which keeps the long-term rating. The two cannot be separated from this statement.');
  }
  if (unrateable.length) {
    const amt = unrateable.reduce((a, r) => a + r.amount, 0);
    notes.push(unrateable.map((r) => r.label.toLowerCase()).join(' and ') + ' of ' + sym + formatQty(amt, unit) +
      ' (' + (amt / total * 100).toFixed(1) + '% of borrowings) carry no agency rating, so no published default rate covers them. They still count as debt for the leverage ratios above.');
  }
  if (unknownClass.some((r) => r.share > 0.02)) {
    notes.push('Part of the borrowings is reported only as \u201cother\u201d, so what those instruments are \u2014 and whether they are rated \u2014 cannot be read from this statement.');
  }

  return {
    ok: true,
    total,
    unit,
    rows,
    dominantScale,
    shortTermShare: shareOf('shortTerm'),
    longTermShare: shareOf('longTerm'),
    unratedShare: unrateable.reduce((a, r) => a + r.amount, 0) / total,
    notes,
  };
}

// The honest consequence of the two facts above: if one long-term rating is
// applied to a stack that is mostly short-term borrowing, the number carries a
// scale the majority of that debt is not rated on. This states it with the
// company's own figures rather than leaving the reader to notice.
function ratingCoverageNote(ratingView, composition) {
  if (!ratingView || !ratingView.ok || !composition || !composition.ok) return null;
  const isShortTermRating = RATING_SHORT_TERM_RE.test(String(ratingView.category || '').replace('+', ''));
  const ratingScale = isShortTermRating ? 'short-term' : 'long-term';
  const mismatched = composition.rows
    .filter((r) => r.rateable === true && r.likelyScale && r.likelyScale !== ratingScale)
    .reduce((a, r) => a + r.share, 0);
  // Only worth saying when the mismatched part is a real share of the debt.
  // Below a fifth it is a footnote about rounding, not about the answer.
  if (mismatched < 0.2) return null;
  const other = ratingScale === 'long-term' ? 'short-term' : 'long-term';
  return 'The rating entered is on the ' + ratingScale + ' scale, and it is applied here to the borrowings as a whole. ' +
    (mismatched * 100).toFixed(0) + '% of those borrowings sit in the ' + other +
    ' bucket, which the agency rates separately and on its own scale. Reading a company\u2019s ' + ratingScale +
    ' rating across the whole stack is the usual first-pass approach and it is what is done here, but the figure below is one rating applied to debt the agency has rated in more than one place.';
}

// Per-instrument expected loss, for when the reader has the facility-wise
// ratings in front of them -- every rating rationale lists them. Each tranche
// gets its own published default rate; nothing is inferred for a tranche whose
// rating was not supplied, and the unrated amount is reported rather than
// spread across the rated ones.
function expectedLossByTranche(tranches, lgdInput, opts) {
  opts = opts || {};
  const unit = opts.unit || null;
  const sym = opts.currencySymbol || '\u20b9';
  if (!Array.isArray(tranches) || !tranches.length) {
    return { ok: false, reason: 'No per-instrument ratings were supplied, so the expected loss is not broken down by instrument.' };
  }
  const lgdInfo = resolveLgd(lgdInput);
  const rows = [];
  const unrated = [];
  let ratedEad = 0, totalEad = 0, elTotal = 0;
  tranches.forEach((t, i) => {
    const label = (t && t.label) || 'Tranche ' + (i + 1);
    const amount = t && t.amount != null && isFinite(t.amount) && t.amount >= 0 ? Number(t.amount) : null;
    if (amount == null) {
      unrated.push({ label, amount: null, reason: 'No exposure amount was supplied for this instrument.' });
      return;
    }
    totalEad += amount;
    if (!t.band) {
      unrated.push({ label, amount, reason: 'No rating was supplied for this instrument, so no published default rate is applied to it.' });
      return;
    }
    const view = ratingPd(t.agency || 'CRISIL', t.band, t.dataset);
    if (!view.ok) {
      unrated.push({ label, amount, reason: view.reason });
      return;
    }
    const rowLgd = (t.lgd != null && isFinite(t.lgd) && t.lgd >= 0 && t.lgd <= 1) ? t.lgd : lgdInfo.lgd;
    const el = expectedLoss(view.pd, rowLgd, amount);
    if (!el.ok) {
      unrated.push({ label, amount, reason: el.reason });
      return;
    }
    ratedEad += amount;
    elTotal += el.amount;
    rows.push({
      label, amount, band: view.ratingAsGiven, category: view.category, scale: view.scale,
      annexure: view.annexure, pd: view.pd, lgd: rowLgd, el: el.amount,
      pctOfExposure: el.pctOfExposure, agency: view.agency,
    });
  });
  if (!rows.length) {
    return { ok: false, reason: 'None of the instruments supplied could be matched to a published default rate, so no expected loss is reported.', unrated, lgd: lgdInfo };
  }
  const unratedAmount = unrated.reduce((a, u) => a + (u.amount || 0), 0);
  return {
    ok: true,
    rows,
    unrated: unrated.length ? unrated : null,
    ratedEad,
    unratedAmount,
    totalEad,
    el: elTotal,
    // The exposure-weighted rate across the rated tranches only. It is not a
    // rating and does not correspond to any published category -- it is what
    // the rated part of this stack works out to.
    weightedPctOfExposure: ratedEad > 0 ? elTotal / ratedEad : null,
    lgd: lgdInfo,
    unit,
    note: unratedAmount > 0
      ? 'The expected loss covers ' + sym + formatQty(ratedEad, unit) + ' of rated exposure. ' + sym + formatQty(unratedAmount, unit) +
        ' could not be matched to a published default rate and is left out of the total rather than assigned a rate it does not have.'
      : 'Every instrument supplied was matched to a published default rate for its own rating and scale.',
  };
}

// ---------------------------------------------------------------------------
// Section 6c — refinancing structure
//
// The tenor split answers a better question than the one it was scraped for.
// Not "what is the expected loss" -- that barely moves -- but "how much of
// this debt has to be found again inside a year, and is there anything on
// hand to find it with".
//
// A company funding long-lived assets with 90-day paper has to go back to the
// market four times a year regardless of how its business is doing. When the
// market is open that is cheap and ordinary; when it shuts, the business is
// unaffected and the funding is not. That is the shape of what happened to
// IL&FS and DHFL, and it is invisible in every ratio computed off the P&L.
//
// Two deliberate limits:
//   * Lease liabilities are excluded from the amount that must be rolled.
//     A lease runs to its contractual term; there is no lender deciding each
//     year whether to renew it.
//   * No band says what share of short-term borrowing is "right". Working
//     capital lines are ordinary for a manufacturer and rare for a utility,
//     and no published benchmark exists to read one against. The share is
//     reported, its direction over time is reported, and what IS benchmarked
//     is cash cover -- which is arithmetic, not a convention: below 1.0x the
//     cash on hand does not repay the borrowing, and the rest must be rolled.
// ---------------------------------------------------------------------------

// Cash cover is a fact about arithmetic, so the only threshold here is 1.0.
// The second number is a stated convention of this page and says so.
const REFI_CASH_COVER = { covered: 1.0, thin: 0.5 };
// Gates for the combined signal. All three are required, in the same shape as
// the divergence rules: a share test, a liquidity test, and a materiality
// floor. Any one alone describes an ordinary manufacturer.
const REFI_SIGNAL = { shareOfDebt: 0.5, cashCover: 0.5, ebitdaMultiple: 1.0 };

function refinancingProfile(input) {
  input = input || {};
  if (input.isLender) {
    return {
      ok: false,
      reason: 'Refinancing structure is not reported for lenders. Borrowing short to lend long is the business model, not a feature of it, and the condensed balance sheet does not separate customer deposits from borrowings — so the figure that would matter here cannot be built from this source.',
    };
  }
  const comp = input.composition && input.composition.ok
    ? input.composition
    : (input.debtBreakdown ? debtComposition(input.debtBreakdown, { unit: input.unit || 'cr' }) : null);
  if (!comp || !comp.ok) {
    return {
      ok: false,
      reason: 'The borrowings were not broken down by how long they run, so how much of the debt falls due within a year cannot be established. The total alone does not say when it has to be repaid.',
    };
  }
  const shortTerm = comp.rows.reduce((a, r) => a + (r.key === 'shortTerm' ? r.amount : 0), 0);
  if (shortTerm <= 0) {
    return {
      ok: false,
      reason: 'No short-term borrowings are reported, so there is nothing falling due within the year to refinance.',
      total: comp.total,
      rollingWithinYear: 0,
    };
  }
  const cash = num(input.cash);
  const ebitda = num(input.ebitda);
  const shortTermShare = shortTerm / comp.total;
  const cashCover = cash != null && cash >= 0 ? cash / shortTerm : null;
  const ebitdaMultiple = ebitda != null && ebitda > 0 ? shortTerm / ebitda : null;

  const notes = [];
  notes.push('Lease liabilities are left out of this figure. A lease runs to its agreed term, so unlike a bank line it is not something a lender decides each year whether to renew.');

  // --- what the cash actually covers ---
  let coverAssessment;
  if (cashCover == null) {
    coverAssessment = {
      status: 'not_assessable',
      reason: 'No cash balance was available, so how much of the amount falling due is already on hand could not be worked out.',
      sentence: null,
    };
  } else {
    const status = cashCover >= REFI_CASH_COVER.covered ? 'covered'
      : cashCover >= REFI_CASH_COVER.thin ? 'partly_covered' : 'roll_dependent';
    const pct = Math.min(cashCover, 1) * 100;
    coverAssessment = {
      status,
      value: cashCover,
      sentence: cashCover >= 1
        ? 'Cash on hand of ' + formatQty(cash, comp.unit) + ' covers the ' + formatQty(shortTerm, comp.unit) +
          ' falling due within the year ' + cashCover.toFixed(2) + ' times over, so repaying it would not require going back to a lender.'
        : 'Cash on hand of ' + formatQty(cash, comp.unit) + ' covers ' + pct.toFixed(0) + '% of the ' +
          formatQty(shortTerm, comp.unit) + ' falling due within the year. The rest has to be rolled over with the existing lenders or refinanced elsewhere.',
      thresholds: REFI_CASH_COVER,
    };
  }

  // --- direction over time ---
  // Two consecutive periods moving the same way before anything is said, for
  // the same reason the divergence rules require persistence: a single year's
  // move in a working-capital line is ordinary seasonality.
  let trend = { ok: false, reason: 'Not enough periods of the borrowings split were supplied to say which way the short-term share has moved.' };
  const hist = Array.isArray(input.history) ? input.history.filter((h) => h && h.total > 0 && h.shortTerm != null) : [];
  if (hist.length >= 3) {
    const shares = hist.map((h) => ({ label: h.label, share: h.shortTerm / h.total }));
    const first = shares[0], last = shares[shares.length - 1];
    const delta = last.share - first.share;
    const steps = shares.slice(1).map((x, i) => x.share - shares[i].share);
    const tail = steps.slice(-2);
    // Persistence has to agree with the direction being reported. Testing the
    // last two steps on their own lets a series that rose 40pp overall but fell
    // in each of the last two periods print as "rising, and moved the same way
    // in each of the last two periods" -- which is two true clauses forming one
    // false sentence.
    const persistent = tail.length === 2 &&
      ((delta > 0 && tail.every((d) => d > 0)) || (delta < 0 && tail.every((d) => d < 0)));
    // A five-point move over the whole window is noise in rounded crore.
    const material = Math.abs(delta) >= 0.05;
    trend = {
      ok: true,
      series: shares,
      from: first, to: last,
      deltaPp: delta * 100,
      direction: !material ? 'flat' : delta > 0 ? 'rising' : 'falling',
      persistent,
      sentence: !material
        ? 'The share of borrowings falling due within a year has stayed within five percentage points across the ' +
          shares.length + ' periods reported (' + (first.share * 100).toFixed(0) + '% to ' + (last.share * 100).toFixed(0) + '%).'
        : 'The share of borrowings falling due within a year has moved from ' + (first.share * 100).toFixed(0) +
          '% in ' + first.label + ' to ' + (last.share * 100).toFixed(0) + '% in ' + last.label + ', a change of ' +
          Math.abs(delta * 100).toFixed(0) + ' percentage points' +
          (persistent ? ', and moved the same way in each of the last two periods.' : '. The path was not in one direction throughout.'),
    };
  }

  // --- the combined signal ---
  // Three gates, all required. Reported as a description of the funding
  // structure, never as a finding about whether the company can pay.
  const gates = {
    share: shortTermShare >= REFI_SIGNAL.shareOfDebt,
    cash: cashCover != null && cashCover < REFI_SIGNAL.cashCover,
    size: ebitdaMultiple != null && ebitdaMultiple >= REFI_SIGNAL.ebitdaMultiple,
  };
  const measurable = cashCover != null && ebitdaMultiple != null;
  let signal;
  if (!measurable) {
    signal = {
      status: 'not_assessable',
      reason: 'The funding structure needs the cash balance and EBITDA alongside the borrowings split. At least one of those was missing, so only the split itself is reported.',
      sentence: null,
    };
  } else if (gates.share && gates.cash && gates.size) {
    signal = {
      status: 'roll_dependent',
      gates,
      sentence: (shortTermShare * 100).toFixed(0) + '% of borrowings fall due within a year, cash covers ' +
        (cashCover * 100).toFixed(0) + '% of that, and the amount is ' + ebitdaMultiple.toFixed(1) +
        ' times a year of EBITDA. On those three figures together, continuing to operate at this level of borrowing depends on lenders renewing rather than on cash the company already holds.',
    };
  } else {
    const missed = [];
    if (!gates.share) missed.push('under half the borrowings fall due within a year');
    if (!gates.cash) missed.push('cash covers at least half of what does');
    if (!gates.size) missed.push('the amount is under one year of EBITDA');
    signal = {
      status: 'ordinary',
      gates,
      sentence: 'The funding structure does not meet all three conditions this page checks together — ' + missed.join('; ') +
        '. Short-term borrowing on its own is ordinary for a company that finances stock and unpaid bills with a bank line.',
    };
  }

  return {
    ok: true,
    unit: comp.unit,
    total: comp.total,
    rollingWithinYear: shortTerm,
    shortTermShare,
    cash,
    cashCover,
    ebitdaMultiple,
    coverAssessment,
    trend,
    signal,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Section 7 — reconciling the two views
//
// Never averages the two into one figure. They answer different questions and
// a blended number would carry the precision of neither.
// ---------------------------------------------------------------------------

function reconcilePdViews(ratingView, mertonView) {
  const haveRating = !!(ratingView && ratingView.ok);
  const haveMerton = !!(mertonView && mertonView.ok);
  if (!haveRating && !haveMerton) {
    return { available: 'neither', sentence: 'Neither a published rating-based default rate nor a market-implied one could be computed for this company.' };
  }
  if (haveRating && !haveMerton) {
    return {
      available: 'rating_only',
      sentence: 'Only the rating-based view is available here. It is a through-the-cycle figure: the historical default rate across many companies carrying this rating, averaged over good years and bad ones, rather than a reading of this company today.',
    };
  }
  if (!haveRating && haveMerton) {
    return {
      available: 'merton_only',
      sentence: 'Only the market-implied view is available here, computed from this company’s own share price and reported borrowings without reference to any rating agency. It is a point-in-time figure: today’s market opinion, not a long-run average.',
    };
  }
  const rPd = ratingView.pd, mPd = mertonView.impliedPd;
  const bigger = mPd > rPd ? 'market-implied' : 'rating-based';
  const smaller = mPd > rPd ? 'rating-based' : 'market-implied';
  return {
    available: 'both',
    ratingPd: rPd,
    mertonPd: mPd,
    sentence: 'These two numbers are allowed to disagree, and the gap is not an error in either one. The rating-based figure is through-the-cycle: the historical default rate across many companies carrying this rating, averaged over good years and bad. The market-implied figure is point-in-time: today’s share price and reported borrowings for this one company. Here the ' +
      bigger + ' figure is the higher of the two, and the ' + smaller + ' the lower; neither is the correction to the other.',
  };
}

// ---------------------------------------------------------------------------
// Section 8 — composite classification
//
// A tier, never a score. Goalden's language rules ban a composite number
// (no "78/100", no rank), and averaging three signals of different kinds into
// one figure would manufacture a precision none of them has. Instead the
// composite is the most cautious of whichever signals are actually available,
// and it always names the signal that set it, so a reader can disagree with
// one input without having to unpick an opaque weighting.
// ---------------------------------------------------------------------------

const TIER_ORDER = ['comfortable', 'adequate', 'stretched'];
const TIER_LABELS = {
  comfortable: 'Comfortable',
  adequate: 'Adequate',
  stretched: 'Stretched',
  not_assessable: 'Not enough data to classify',
};

function compositeCreditTier(signals) {
  const used = (signals || []).filter((s) => s && TIER_ORDER.indexOf(s.status) >= 0);
  if (!used.length) {
    return {
      tier: 'not_assessable',
      label: TIER_LABELS.not_assessable,
      drivenBy: null,
      componentsUsed: [],
      sentence: 'Not enough of this company’s credit inputs could be computed to place it in a tier. The individual figures that were available are shown below.',
    };
  }
  let worst = used[0];
  used.forEach((s) => { if (TIER_ORDER.indexOf(s.status) > TIER_ORDER.indexOf(worst.status)) worst = s; });
  const names = used.map((s) => s.name);
  const sentence = 'Read as ' + TIER_LABELS[worst.status].toLowerCase() + ', set by the most cautious of the ' + used.length +
    ' measure' + (used.length === 1 ? '' : 's') + ' available (' + names.join(', ') + '). This is a description of the reported and market figures below, not a rating, a forecast, or a view on whether to hold this company’s shares or bonds.';
  return {
    tier: worst.status,
    label: TIER_LABELS[worst.status],
    drivenBy: worst.name,
    componentsUsed: used.map((s) => ({ name: s.name, status: s.status })),
    sentence,
  };
}

// Merton's own contribution to the composite. Distance-to-default is in
// standard deviations; the bands here are this module's stated convention and
// are labelled as such wherever they are shown, not presented as an industry
// standard.
const DD_THRESHOLDS = { comfortable: 4.0, adequate: 2.0 };

function assessDistanceToDefault(dd) {
  if (dd == null || !isFinite(dd)) return { status: 'not_assessable', reason: 'No distance-to-default available.', sentence: null };
  const status = dd >= DD_THRESHOLDS.comfortable ? 'comfortable' : dd >= DD_THRESHOLDS.adequate ? 'adequate' : 'stretched';
  const sentence = 'The market-implied asset value sits ' + dd.toFixed(2) +
    ' standard deviations above the point where borrowings would exceed assets. This module reads ' +
    DD_THRESHOLDS.comfortable.toFixed(0) + ' and above as comfortable and below ' + DD_THRESHOLDS.adequate.toFixed(0) +
    ' as stretched — a stated convention of this page.';
  return { status, sentence, value: dd, thresholds: DD_THRESHOLDS };
}

// ---------------------------------------------------------------------------
// The assembled profile — one data model, rendered two ways by the caller.
// ---------------------------------------------------------------------------

function creditProfile(input) {
  input = input || {};
  const provenance = [];
  const caveats = [];
  const notes = [];

  const sector = classifySectorArchetype(input.sector);

  const ebitda = num(input.ebitda);
  const totalDebt = num(input.totalDebt);
  const interestExpense = num(input.interestExpense);
  const cash = num(input.cash);

  const gross = grossLeverage(totalDebt, ebitda);
  const net = netLeverage(totalDebt, cash, ebitda);
  const coverage = interestCoverage(ebitda, interestExpense);

  if (ebitda != null && ebitda <= 0) {
    notes.push('Operating profit for this period is not positive, so leverage and coverage multiples are not reported — dividing debt by a negative earnings figure produces a negative multiple that reads as less levered than a debt-free company.');
  }
  if (cash == null) {
    notes.push('Net leverage is not shown. The condensed balance sheet this page reads does not carry a cash line — its asset rows are Fixed Assets, CWIP, Investments and Other Assets — and Investments cannot stand in for cash because it holds strategic and subsidiary stakes that are not available to repay debt. Supply a cash figure from the company’s own balance sheet to see net leverage.');
  }
  if (interestExpense != null && interestExpense <= 0) {
    notes.push('No interest expense is reported for this period, so interest coverage is not computed.');
  }

  if (input.fiscalYear) {
    provenance.push({
      what: 'Operating profit, borrowings and interest expense',
      source: (input.sourceName || 'screener.in') + (input.consolidated === false ? ' (standalone)' : ' (consolidated)'),
      asOf: 'FY' + input.fiscalYear,
      url: input.sourceUrl || null,
    });
  }

  // A lender fails every EBITDA-based measure on this page for one shared
  // reason, so it is resolved once here and applied to all of them. Screener's
  // `schema` field is authoritative when present; the sector breadcrumb is the
  // fallback for callers that don't pass it.
  const isLender = input.schema === 'financial' || sector.archetype === 'lender';
  const lenderRefusal = SECTOR_ARCHETYPES.lender.refusal;

  const leverageForSector = net != null ? net : null;
  const leverageAssessment = isLender
    ? { status: 'not_assessable', reason: lenderRefusal, sentence: null, archetype: 'lender' }
    : assessLeverageVsSector(leverageForSector, sector);
  const coverageAssessment = isLender
    ? {
      status: 'not_assessable',
      sentence: null,
      reason: 'This company is a lender. Interest paid to depositors and lenders is a cost of goods sold for a bank, not a fixed charge sitting on top of an operating business, so “how many times does EBITDA cover interest” is not a question its accounts answer. It is not shown.',
    }
    : assessCoverage(coverage);
  if (isLender) {
    notes.push(lenderRefusal + ' What can still be read across is on the statements above: revenue, financing profit, return on equity, and who owns the shares.');
  }

  // --- stress ---
  const shocks = input.shocks || { ebitda: -0.20, debt: 0.10, interest: 0.15 };
  const stress = stressedRatios({ ebitda, debt: totalDebt, interest: interestExpense, cash }, shocks);

  // --- Merton ---
  let volInfo = null;
  let merton = { ok: false, reason: 'The market-implied model did not run.' };
  const marketCap = num(input.marketCapCr);
  if (input.equityVolatility != null && isFinite(input.equityVolatility)) {
    // A caller-supplied volatility (the test fixtures, or a professional
    // overriding the window) is used as given and labelled as supplied.
    volInfo = { ok: true, vol: input.equityVolatility, supplied: true };
  } else {
    volInfo = annualisedVolFromPrices(input.priceSeries, { minObservations: input.minPriceObservations });
  }
  if (isLender) {
    // Merton's default point is the face value of debt. For a bank the debt
    // that matters is overwhelmingly customer deposits, which this balance
    // sheet does not expose -- feeding it `Borrowings` alone would understate
    // D by an order of magnitude and return a reassuringly enormous distance
    // to default. Refused outright rather than run on the wrong input.
    merton = {
      ok: false,
      reason: 'The market-implied model is not run for lenders. It measures how far a company’s assets sit above the debt it has to repay, and for a bank most of that debt is customer deposits, which this balance sheet does not separate out. Running it on borrowings alone would understate the debt by a wide margin and report a far larger safety margin than exists.',
    };
  } else if (!volInfo.ok) {
    merton = { ok: false, reason: volInfo.reason };
  } else if (marketCap == null || marketCap <= 0) {
    merton = { ok: false, reason: 'No market capitalisation is available, so the market value of equity for the model is unknown.' };
  } else if (input.riskFreeRate == null || !isFinite(input.riskFreeRate)) {
    merton = { ok: false, reason: 'No risk-free rate was supplied, so the model has no discount rate to work from.' };
  } else {
    merton = mertonSolve({
      E: marketCap,
      sigmaE: volInfo.vol,
      D: totalDebt,
      r: input.riskFreeRate,
      T: input.horizonYears == null ? 1 : input.horizonYears,
    });
    if (merton.ok) {
      merton.volatility = volInfo;
      provenance.push({
        what: 'Equity volatility (' + (volInfo.vol * 100).toFixed(2) + '% annualised)',
        source: volInfo.supplied
          ? 'supplied to the model directly'
          : 'computed from ' + volInfo.observations + ' daily closes' + (volInfo.startDate ? ', ' + volInfo.startDate + ' to ' + volInfo.endDate : ''),
        asOf: volInfo.endDate || null,
      });
      provenance.push({
        what: 'Risk-free rate (' + (input.riskFreeRate * 100).toFixed(2) + '%)',
        source: input.riskFreeRateSource || 'the rate assumption set on this page — an input you can change, not a live government yield feed',
        asOf: null,
      });
      const ctx = priceContextCaveat({
        currentPrice: num(input.currentPrice),
        high52w: num(input.high52w),
        low52w: num(input.low52w),
        distanceToDefault: merton.distanceToDefault,
      });
      if (ctx.triggered) caveats.push({ id: 'price_context', text: ctx.text });
      merton.priceContext = ctx;
      if (volInfo.extremeMoves) {
        caveats.push({
          id: 'extreme_moves',
          text: volInfo.extremeMoves + ' single-day move' + (volInfo.extremeMoves === 1 ? '' : 's') +
            ' beyond ±50% appear in the price series used for volatility. These are kept rather than trimmed, but they may be unhandled corporate actions rather than real moves, which would overstate the volatility figure.',
        });
      }
    }
  }

  const ddAssessment = merton.ok ? assessDistanceToDefault(merton.distanceToDefault) : { status: 'not_assessable', reason: merton.reason, sentence: null };

  // --- what the borrowings are made of ---
  // Computed before the rating so the rating can be reported against the
  // debt it is actually being applied to. Refuses quietly when the caller
  // has no breakdown; nothing downstream depends on it existing.
  const composition = input.debtBreakdown
    ? debtComposition(input.debtBreakdown, { unit: input.amountUnit || 'cr', currencySymbol: input.currencySymbol })
    : { ok: false, reason: 'The borrowings were supplied as a single total, so how they split between long-term, short-term and lease liabilities is not described. A rating covers particular instruments, and that split is what says which instruments are involved.' };
  if (composition.ok && !isLender) {
    provenance.push({
      what: 'Split of borrowings (' + (input.currencySymbol || '\u20b9') + formatQty(composition.total, composition.unit) + ' across ' + composition.rows.length + ' lines)',
      source: input.debtBreakdownSource || 'the expandable borrowings schedule on the source page, reconciled against the borrowings total shown on the balance sheet',
      asOf: input.fiscalYear || null,
    });
  }

  // --- refinancing structure ---
  // The better question the tenor split answers: how much has to be found
  // again inside a year, and is there cash on hand to find it with.
  const refinancing = refinancingProfile({
    isLender,
    composition,
    cash,
    ebitda,
    unit: input.amountUnit || 'cr',
    history: input.debtHistory,
  });
  if (refinancing.ok && refinancing.signal.status === 'roll_dependent') {
    caveats.push({ id: 'roll_dependent_funding', text: refinancing.signal.sentence });
  }

  // --- rating-based expected loss ---
  let ratingView = { ok: false, reason: 'No external credit rating was supplied for this company, so no agency-published default rate is applied. The market-implied model below does not need one.' };
  if (input.ratingAgency && input.ratingBand) {
    ratingView = ratingPd(input.ratingAgency, input.ratingBand, input.ratingDataset);
    if (ratingView.ok) {
      provenance.push({
        what: 'One-year default rate for ' + ratingView.agency + ' ‘' + ratingView.category + '’ (' + (ratingView.pd * 100).toFixed(2) + '%)',
        source: ratingView.study + ' — annexure ' + ratingView.annexure + ', ' + ratingView.datasetLabel.toLowerCase(),
        asOf: ratingView.period,
        url: ratingView.sourceUrl,
      });
      if (ratingView.spreadNote) caveats.push({ id: 'rating_dataset_spread', text: ratingView.spreadNote });
      if (ratingView.qualifierNotes) {
        ratingView.qualifierNotes.forEach((text, i) => caveats.push({ id: 'rating_qualifier_' + (i + 1), text }));
      }
      // One rating applied to a stack the agency rated in more than one
      // place. Raised only when the composition is actually known.
      const coverage = ratingCoverageNote(ratingView, composition);
      if (coverage) caveats.push({ id: 'rating_covers_one_scale', text: coverage });
    }
  }
  const lgdInfo = resolveLgd(input.lgd);
  // When the reader has the facility-wise ratings in front of them (every
  // rating rationale lists them), each instrument is priced off its own
  // published rate instead of one rating standing in for the whole stack.
  const byTranche = input.debtTranches
    ? expectedLossByTranche(input.debtTranches, input.lgd, { unit: input.amountUnit || 'cr', currencySymbol: input.currencySymbol })
    : null;
  let el = { ok: false, reason: ratingView.ok ? 'Expected loss not computed.' : ratingView.reason };
  if (ratingView.ok) {
    el = expectedLoss(ratingView.pd, lgdInfo.lgd, input.ead == null ? null : num(input.ead));
    if (el.ok) {
      el.lgdBasis = lgdInfo.basis;
      el.lgdNote = lgdInfo.note;
      el.sentence = expectedLossSentence(el, input.currencySymbol);
    }
  }

  const reconciliation = reconcilePdViews(ratingView.ok ? ratingView : null, merton.ok ? merton : null);

  const composite = compositeCreditTier([
    { name: 'leverage against its sector band', status: leverageAssessment.status },
    { name: 'interest coverage', status: coverageAssessment.status },
    { name: 'market-implied distance to default', status: ddAssessment.status },
  ]);

  // Keys the recompute-and-verify pass re-derives independently before any of
  // this reaches a user, matching advisor.js's existing figures contract.
  // A lender's leverage and coverage multiples are computed above (the
  // arithmetic runs on whatever rows exist) but are not reported: the text
  // says "it is not shown", and leaving the number in `figures` would put it
  // straight back into the recompute-and-verify payload and any caller that
  // reads figures directly.
  const reportGross = isLender ? null : gross;
  const reportNet = isLender ? null : net;
  const reportCoverage = isLender ? null : coverage;

  const figures = {};
  if (reportGross != null) figures.creditGrossLeverage = reportGross;
  if (reportNet != null) figures.creditNetLeverage = reportNet;
  if (reportCoverage != null) figures.creditInterestCoverage = reportCoverage;
  if (merton.ok) {
    figures.creditDistanceToDefault = merton.distanceToDefault;
    figures.creditImpliedAssetValue = merton.V;
    figures.creditImpliedAssetVol = merton.sigmaV;
  }
  if (el.ok) figures.creditExpectedLossPct = el.pctOfExposure;
  if (refinancing.ok) {
    figures.creditShortTermDebtShare = refinancing.shortTermShare;
    if (refinancing.cashCover != null) figures.creditCashCoverOfShortTermDebt = refinancing.cashCover;
  }

  return {
    ok: true,
    company: {
      symbol: input.symbol || null,
      name: input.companyName || null,
      fiscalYear: input.fiscalYear || null,
      consolidated: input.consolidated !== false,
    },
    sector,
    inputs: { ebitda, totalDebt, cash, interestExpense, marketCapCr: marketCap },
    isLender,
    ratios: {
      grossLeverage: reportGross,
      netLeverage: reportNet,
      interestCoverage: reportCoverage,
      leverageAssessment,
      coverageAssessment,
      notes,
    },
    stress: isLender ? null : stress,
    merton,
    distanceToDefaultAssessment: ddAssessment,
    rating: ratingView,
    debtComposition: isLender ? null : composition,
    refinancing,
    lgd: lgdInfo,
    expectedLoss: el,
    expectedLossByInstrument: byTranche,
    reconciliation,
    composite,
    provenance,
    caveats,
    figures,
  };
}

function num(v) {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Guardrail — Section 2's "classify and explain, never advise", enforced as a
// test over this module's own generated prose rather than trusted to review.
// Every sentence this engine emits is run through it by engine.test.js.
// ---------------------------------------------------------------------------

const CREDIT_BANNED_LANGUAGE = [
  /\b(buy|sell|avoid|exit|accumulate|subscribe|offload|dump)\b/i,
  /\b(you should|we recommend|recommended|advis(e|able))\b/i,
  /\b(cheap|expensive|undervalued|overvalued|attractive|bargain)\b/i,
  /\b(safe bet|safer|riskier|no-brainer|sure shot|multibagger)\b/i,
  /\b(will (rise|fall|default|recover)|is likely to|expected to)\b/i,
  /\b(strong|weak|healthy|deteriorating|improving) (balance sheet|credit|company|business)\b/i,
];

function findBannedLanguage(text) {
  if (!text) return null;
  for (const re of CREDIT_BANNED_LANGUAGE) {
    const m = String(text).match(re);
    if (m) return m[0];
  }
  return null;
}

// Walks a profile and returns every user-facing sentence it contains, so the
// guardrail test has a single place to pull from and cannot silently miss a
// newly added string.
function collectProfileProse(profile) {
  const out = [];
  const push = (s) => { if (s && typeof s === 'string') out.push(s); };
  if (!profile) return out;
  push(profile.sector && profile.sector.why);
  push(profile.ratios && profile.ratios.leverageAssessment && profile.ratios.leverageAssessment.sentence);
  push(profile.ratios && profile.ratios.leverageAssessment && profile.ratios.leverageAssessment.reason);
  push(profile.ratios && profile.ratios.coverageAssessment && profile.ratios.coverageAssessment.sentence);
  (profile.ratios && profile.ratios.notes || []).forEach(push);
  push(profile.distanceToDefaultAssessment && profile.distanceToDefaultAssessment.sentence);
  push(profile.merton && profile.merton.reason);
  push(profile.merton && profile.merton.priceContext && profile.merton.priceContext.text);
  push(profile.rating && profile.rating.reason);
  (profile.rating && profile.rating.qualifierNotes || []).forEach(push);
  push(profile.rating && profile.rating.spreadNote);
  push(profile.rating && profile.rating.conservativeNote);
  push(profile.debtComposition && profile.debtComposition.reason);
  push(profile.refinancing && profile.refinancing.reason);
  push(profile.refinancing && profile.refinancing.coverAssessment && profile.refinancing.coverAssessment.sentence);
  push(profile.refinancing && profile.refinancing.coverAssessment && profile.refinancing.coverAssessment.reason);
  push(profile.refinancing && profile.refinancing.trend && profile.refinancing.trend.sentence);
  push(profile.refinancing && profile.refinancing.trend && profile.refinancing.trend.reason);
  push(profile.refinancing && profile.refinancing.signal && profile.refinancing.signal.sentence);
  push(profile.refinancing && profile.refinancing.signal && profile.refinancing.signal.reason);
  (profile.refinancing && profile.refinancing.notes || []).forEach(push);
  (profile.debtComposition && profile.debtComposition.notes || []).forEach(push);
  (profile.debtComposition && profile.debtComposition.rows || []).forEach((r) => push(r.note));
  push(profile.expectedLossByInstrument && profile.expectedLossByInstrument.reason);
  push(profile.expectedLossByInstrument && profile.expectedLossByInstrument.note);
  (profile.expectedLossByInstrument && profile.expectedLossByInstrument.unrated || []).forEach((u) => push(u.reason));
  push(profile.rating && profile.rating.note);
  push(profile.rating && profile.rating.conservativeNote);
  push(profile.rating && profile.rating.bandFootnote);
  push(profile.rating && profile.rating.spreadNote);
  push(profile.rating && profile.rating.methodology);
  push(profile.lgd && profile.lgd.note);
  push(profile.expectedLoss && profile.expectedLoss.sentence);
  push(profile.expectedLoss && profile.expectedLoss.reason);
  push(profile.expectedLoss && profile.expectedLoss.note);
  push(profile.reconciliation && profile.reconciliation.sentence);
  push(profile.composite && profile.composite.sentence);
  (profile.caveats || []).forEach((c) => push(c && c.text));
  return out;
}

// ---------------------------------------------------------------------------
// Section 10 — chart option builders
//
// Same convention as statements-engine.js: the engine returns ECharts option
// objects, the page hands them to initChart(). No dual y-axes anywhere, no
// legend where a direct label will do, and the semantic palette is kept apart
// from the categorical one.
// ---------------------------------------------------------------------------

const CREDIT_COLORS = {
  ink: '#14283f',
  accent: '#2557c7',
  band: 'rgba(37,87,199,0.14)',
  bandEdge: 'rgba(37,87,199,0.38)',
  marker: '#14283f',
  stressed: '#a03a22',
  dim: 'rgba(20,40,63,0.45)',
};

// Where this company's net leverage sits against its own sector's comfortable
// range. A single horizontal track, the band shaded, the company marked --
// the point is the position, so nothing else competes for attention.
function sectorLeverageBandOption(netLev, archetypeInfo) {
  if (netLev == null || !archetypeInfo || !archetypeInfo.comfortable) return null;
  const band = archetypeInfo.comfortable;
  const maxX = Math.max(band.max * 1.35, netLev * 1.25, band.max + 1);
  const minX = Math.min(0, netLev - 0.5);
  return {
    grid: { left: 12, right: 24, top: 46, bottom: 44, containLabel: true },
    xAxis: {
      type: 'value', min: minX, max: maxX,
      name: 'net debt / EBITDA', nameLocation: 'middle', nameGap: 28,
      nameTextStyle: { color: CREDIT_COLORS.dim, fontSize: 11 },
      axisLabel: { formatter: (v) => v.toFixed(1) + 'x', color: CREDIT_COLORS.dim, fontSize: 11 },
      splitLine: { show: false },
      axisLine: { lineStyle: { color: 'rgba(20,40,63,0.2)' } },
    },
    yAxis: { type: 'category', data: [''], axisLine: { show: false }, axisTick: { show: false }, axisLabel: { show: false } },
    series: [{
      type: 'custom', silent: true,
      renderItem: (params, api) => {
        const y = api.coord([0, 0])[1];
        const x0 = api.coord([band.min, 0])[0];
        const x1 = api.coord([band.max, 0])[0];
        const xc = api.coord([netLev, 0])[0];
        return {
          type: 'group',
          children: [
            { type: 'rect', shape: { x: x0, y: y - 18, width: x1 - x0, height: 36 }, style: { fill: CREDIT_COLORS.band, stroke: CREDIT_COLORS.bandEdge, lineWidth: 1 } },
            { type: 'text', style: { text: 'comfortable for a ' + archetypeInfo.label.toLowerCase(), x: (x0 + x1) / 2, y: y - 30, textAlign: 'center', fill: CREDIT_COLORS.dim, fontSize: 11, fontFamily: 'Spline Sans Mono, monospace' } },
            { type: 'line', shape: { x1: xc, y1: y - 26, x2: xc, y2: y + 26 }, style: { stroke: CREDIT_COLORS.marker, lineWidth: 2.5 } },
            { type: 'text', style: { text: netLev.toFixed(2) + 'x', x: xc, y: y + 30, textAlign: 'center', fill: CREDIT_COLORS.marker, fontSize: 12.5, fontWeight: 600, fontFamily: 'Spline Sans Mono, monospace' } },
          ],
        };
      },
      data: [[0, 0]],
    }],
  };
}

// Base against stressed, one grouped bar per ratio. Coverage is a "higher is
// better" measure and the two leverage multiples are "lower is better", so
// they are not stacked or summed -- only placed side by side, each against
// its own base.
function stressComparisonOption(stress) {
  if (!stress) return null;
  const rows = [
    { key: 'grossLeverage', label: 'Gross leverage' },
    { key: 'netLeverage', label: 'Net leverage' },
    { key: 'interestCoverage', label: 'Interest cover' },
  ].filter((r) => stress.base[r.key] != null && stress.stressed[r.key] != null);
  if (!rows.length) return null;
  const s = stress.shocks;
  const pct = (v) => (v >= 0 ? '+' : '') + Math.round(v * 100) + '%';
  return {
    grid: { left: 12, right: 20, top: 40, bottom: 30, containLabel: true },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v) => (v == null ? '—' : v.toFixed(2) + 'x') },
    xAxis: { type: 'category', data: rows.map((r) => r.label), axisLabel: { color: CREDIT_COLORS.dim, fontSize: 11 }, axisLine: { lineStyle: { color: 'rgba(20,40,63,0.2)' } } },
    yAxis: { type: 'value', axisLabel: { formatter: (v) => v.toFixed(1) + 'x', color: CREDIT_COLORS.dim, fontSize: 11 }, splitLine: { lineStyle: { color: 'rgba(20,40,63,0.08)' } } },
    series: [
      {
        name: 'As reported', type: 'bar', data: rows.map((r) => stress.base[r.key]),
        itemStyle: { color: CREDIT_COLORS.accent }, barMaxWidth: 34,
        label: { show: true, position: 'top', formatter: (p) => p.value.toFixed(2) + 'x', fontSize: 11, color: CREDIT_COLORS.accent, fontWeight: 600, fontFamily: 'Spline Sans Mono, monospace' },
      },
      {
        name: 'Under the shock', type: 'bar', data: rows.map((r) => stress.stressed[r.key]),
        itemStyle: { color: CREDIT_COLORS.stressed }, barMaxWidth: 34,
        label: { show: true, position: 'top', formatter: (p) => p.value.toFixed(2) + 'x', fontSize: 11, color: CREDIT_COLORS.stressed, fontWeight: 600, fontFamily: 'Spline Sans Mono, monospace' },
      },
    ],
    graphic: [{
      type: 'text', right: 8, top: 4,
      style: { text: 'EBITDA ' + pct(s.ebitda) + ' · debt ' + pct(s.debt) + ' · interest ' + pct(s.interest), fill: CREDIT_COLORS.dim, fontSize: 11, fontFamily: 'Spline Sans Mono, monospace' },
    }],
  };
}

// The payoff shape that makes distance-to-default intuitive: equity is worth
// nothing until the assets clear the debt, then rises one-for-one. The
// company's own asset value is marked on the same axis, so the gap between
// the marker and the kink IS the distance being measured.
function mertonPayoffOption(merton) {
  if (!merton || !merton.ok) return null;
  const D = merton.inputs.D, V = merton.V;
  const maxX = Math.max(V * 1.25, D * 2.2);
  const pts = [];
  for (let i = 0; i <= 60; i++) {
    const x = (maxX * i) / 60;
    pts.push([x, Math.max(0, x - D)]);
  }
  return {
    grid: { left: 12, right: 26, top: 42, bottom: 44, containLabel: true },
    tooltip: {
      trigger: 'axis',
      formatter: (ps) => {
        const p = ps[0];
        return 'Assets ' + formatAmount(p.value[0]) + ' cr<br/>Equity ' + formatAmount(p.value[1]) + ' cr';
      },
    },
    xAxis: {
      type: 'value', min: 0, max: maxX,
      name: 'value of the company’s assets', nameLocation: 'middle', nameGap: 28,
      nameTextStyle: { color: CREDIT_COLORS.dim, fontSize: 11 },
      axisLabel: { formatter: (v) => formatAmount(v), color: CREDIT_COLORS.dim, fontSize: 10 },
      splitLine: { show: false }, axisLine: { lineStyle: { color: 'rgba(20,40,63,0.2)' } },
    },
    yAxis: {
      type: 'value', name: 'what the shares are worth', nameTextStyle: { color: CREDIT_COLORS.dim, fontSize: 11 },
      axisLabel: { formatter: (v) => formatAmount(v), color: CREDIT_COLORS.dim, fontSize: 10 },
      splitLine: { lineStyle: { color: 'rgba(20,40,63,0.08)' } },
    },
    series: [
      {
        type: 'line', data: pts, showSymbol: false, lineStyle: { color: CREDIT_COLORS.accent, width: 2.5 },
        markLine: {
          silent: true, symbol: 'none',
          lineStyle: { color: CREDIT_COLORS.stressed, type: 'dashed', width: 1.5 },
          label: { formatter: 'borrowings ' + formatAmount(D) + ' cr', color: CREDIT_COLORS.stressed, fontSize: 11, position: 'insideEndTop', fontFamily: 'Spline Sans Mono, monospace' },
          data: [{ xAxis: D }],
        },
      },
      {
        type: 'scatter', data: [[V, Math.max(0, V - D)]], symbolSize: 13,
        itemStyle: { color: CREDIT_COLORS.marker, borderColor: '#fff', borderWidth: 2 },
        label: {
          show: true, position: 'left', distance: 10,
          formatter: 'today: assets ' + formatAmount(V) + ' cr',
          color: CREDIT_COLORS.marker, fontSize: 11.5, fontWeight: 600, fontFamily: 'Spline Sans Mono, monospace',
        },
      },
    ],
  };
}

// Two lenses, not two competitors. A log axis because the two figures can be
// orders of magnitude apart, with the axis labelled so that is not mistaken
// for a small gap.
function pdComparisonOption(ratingPdValue, mertonPdValue) {
  const items = [];
  if (ratingPdValue != null && isFinite(ratingPdValue)) items.push({ label: 'Rating-based\n(through-the-cycle)', value: ratingPdValue });
  if (mertonPdValue != null && isFinite(mertonPdValue)) items.push({ label: 'Market-implied\n(point-in-time)', value: mertonPdValue });
  if (items.length < 2) return null;
  // A true zero cannot be drawn on a log axis, and a market-implied PD in the
  // far tail is legitimately ~1e-22. Floored for drawing only, and the label
  // shows the real figure.
  const floor = 1e-8;
  return {
    grid: { left: 12, right: 24, top: 36, bottom: 40, containLabel: true },
    xAxis: { type: 'category', data: items.map((i) => i.label), axisLabel: { color: CREDIT_COLORS.dim, fontSize: 11, lineHeight: 15 }, axisLine: { lineStyle: { color: 'rgba(20,40,63,0.2)' } } },
    yAxis: {
      type: 'log', min: floor, name: 'one-year probability of default',
      nameTextStyle: { color: CREDIT_COLORS.dim, fontSize: 11 },
      axisLabel: { formatter: (v) => (v * 100 >= 0.01 ? (v * 100).toFixed(2) + '%' : (v * 100).toExponential(0) + '%'), color: CREDIT_COLORS.dim, fontSize: 10 },
      splitLine: { lineStyle: { color: 'rgba(20,40,63,0.08)' } },
    },
    series: [{
      type: 'bar', barMaxWidth: 62,
      data: items.map((i) => ({ value: Math.max(i.value, floor), itemStyle: { color: CREDIT_COLORS.accent } })),
      label: {
        show: true, position: 'top', fontSize: 11.5, fontWeight: 600, color: CREDIT_COLORS.ink, fontFamily: 'Spline Sans Mono, monospace',
        formatter: (p) => {
          const real = items[p.dataIndex].value;
          if (real <= 0) return '0';
          const pct = real * 100;
          return pct >= 0.01 ? pct.toFixed(2) + '%' : 'under 0.01%';
        },
      },
    }],
  };
}

// How the borrowings are composed, period by period, with cash cover of the
// short-term slice directly beneath on a shared category axis.
//
// Two stacked grids rather than two y-axes. A dual axis lets you place two
// zero-points wherever you like, which means the crossing point between the
// bars and the ratio becomes something the chart author chooses. Stacked
// grids keep the columns aligned and leave the vertical relationship to be
// read by position, which nobody can tune.
//
// No legend: the last column carries its own labels. Series separate on
// lightness as well as hue, so the panel survives being printed in grey.
function refinancingStructureOption(periods, opts) {
  opts = opts || {};
  const rows = (periods || []).filter((p) => p && p.label && p.total > 0);
  if (rows.length < 2) return null;
  const unit = opts.unit || 'cr';
  const labels = rows.map((r) => r.label);
  const last = rows.length - 1;

  const stack = [
    { key: 'shortTerm', name: 'Falls due within a year', color: CREDIT_COLORS.accent, textColor: '#fff' },
    { key: 'longTerm', name: 'Longer than a year', color: CREDIT_COLORS.ink, textColor: '#fff' },
    { key: 'leases', name: 'Leases', color: 'rgba(37,87,199,0.28)', textColor: CREDIT_COLORS.ink },
  ];

  const series = stack.map((sp) => ({
    name: sp.name,
    type: 'bar',
    stack: 'debt',
    barMaxWidth: 46,
    itemStyle: { color: sp.color },
    // Only the final column is labelled, and only where the segment is tall
    // enough to hold the text. Everywhere else the shape does the work.
    label: {
      show: true,
      position: 'inside',
      fontSize: 10.5,
      color: sp.textColor,
      formatter: (pt) => {
        if (pt.dataIndex !== last) return '';
        const share = rows[last].total > 0 ? (pt.value || 0) / rows[last].total : 0;
        return share >= 0.12 ? sp.name : '';
      },
    },
    data: rows.map((r) => (r[sp.key] == null ? 0 : r[sp.key])),
  }));

  const cover = rows.map((r) => {
    const st = r.shortTerm;
    if (!st || st <= 0 || r.cash == null || !isFinite(r.cash)) return null;
    return Number((r.cash / st).toFixed(4));
  });
  const haveCover = cover.some((v) => v != null);

  const option = {
    // One pointer down both grids, so reading a year in the ratio panel
    // highlights the same column in the composition above it.
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: haveCover
      ? [
        { left: 12, right: 96, top: 30, height: '48%', containLabel: true },
        { left: 12, right: 96, top: '72%', height: '18%', containLabel: true },
      ]
      : [{ left: 12, right: 96, top: 30, bottom: 34, containLabel: true }],
    xAxis: haveCover
      ? [
        { type: 'category', gridIndex: 0, data: labels, axisLabel: { show: false }, axisLine: { lineStyle: { color: 'rgba(20,40,63,0.2)' } } },
        { type: 'category', gridIndex: 1, data: labels, axisLabel: { color: CREDIT_COLORS.dim, fontSize: 10 }, axisLine: { lineStyle: { color: 'rgba(20,40,63,0.2)' } } },
      ]
      : [{ type: 'category', data: labels, axisLabel: { color: CREDIT_COLORS.dim, fontSize: 10 }, axisLine: { lineStyle: { color: 'rgba(20,40,63,0.2)' } } }],
    yAxis: haveCover
      ? [
        {
          type: 'value', gridIndex: 0, name: 'borrowings (' + unit + ')', nameTextStyle: { color: CREDIT_COLORS.dim, fontSize: 10.5 },
          axisLabel: { color: CREDIT_COLORS.dim, fontSize: 10 }, splitLine: { lineStyle: { color: 'rgba(20,40,63,0.08)' } },
        },
        {
          type: 'value', gridIndex: 1, name: 'cash \u00f7 amount due', nameTextStyle: { color: CREDIT_COLORS.dim, fontSize: 10.5 },
          axisLabel: { color: CREDIT_COLORS.dim, fontSize: 10, formatter: (v) => v.toFixed(1) + 'x' },
          splitLine: { show: false }, min: 0,
        },
      ]
      : [{
        type: 'value', name: 'borrowings (' + unit + ')', nameTextStyle: { color: CREDIT_COLORS.dim, fontSize: 10.5 },
        axisLabel: { color: CREDIT_COLORS.dim, fontSize: 10 }, splitLine: { lineStyle: { color: 'rgba(20,40,63,0.08)' } },
      }],
    series,
  };

  if (haveCover) {
    series.forEach((sr) => { sr.xAxisIndex = 0; sr.yAxisIndex = 0; });
    series.push({
      name: 'Cash cover of the amount due',
      type: 'line',
      xAxisIndex: 1,
      yAxisIndex: 1,
      data: cover,
      connectNulls: false,
      symbol: 'circle',
      symbolSize: 5,
      lineStyle: { width: 2, color: CREDIT_COLORS.ink },
      itemStyle: { color: CREDIT_COLORS.ink },
      // 1.0x is the only line on this chart that means something absolute:
      // below it, the cash on hand does not repay the borrowing.
      markLine: {
        silent: true,
        symbol: 'none',
        data: [{ yAxis: 1 }],
        lineStyle: { type: 'dashed', width: 1, color: CREDIT_COLORS.dim },
        label: { formatter: 'cash equals the amount due', fontSize: 10, color: CREDIT_COLORS.dim, position: 'insideEndTop' },
      },
      label: {
        show: true,
        position: 'top',
        fontSize: 10,
        fontFamily: 'Spline Sans Mono, monospace',
        color: CREDIT_COLORS.ink,
        formatter: (pt) => (pt.dataIndex === last && pt.value != null ? pt.value.toFixed(2) + 'x' : ''),
      },
    });
  }
  return option;
}

const api = {
  // ratios
  grossLeverage, netLeverage, interestCoverage, stressedRatios,
  // sector
  SECTOR_ARCHETYPES, SECTOR_ARCHETYPE_RULES, classifySectorArchetype,
  assessLeverageVsSector, assessCoverage, COVERAGE_THRESHOLDS,
  // merton
  erfc, normCdf, normPdf, annualisedVolFromPrices, mertonSolve, priceContextCaveat,
  assessDistanceToDefault, DD_THRESHOLDS,
  // rating / expected loss
  RATING_DEFAULT_STUDIES, normaliseRatingBand, ratingPd,
  LGD_BASEL_FOUNDATION_SENIOR_UNSECURED, resolveLgd, expectedLoss, expectedLossSentence,
  // debt composition / per-instrument expected loss
  DEBT_BUCKETS, debtComposition, ratingCoverageNote, expectedLossByTranche,
  // refinancing structure
  refinancingProfile, REFI_CASH_COVER, REFI_SIGNAL,
  // reconcile + composite
  reconcilePdViews, compositeCreditTier, TIER_LABELS, TIER_ORDER,
  // assembled
  creditProfile,
  // guardrail
  CREDIT_BANNED_LANGUAGE, findBannedLanguage, collectProfileProse,
  // charts
  CREDIT_COLORS, sectorLeverageBandOption, stressComparisonOption,
  mertonPayoffOption, pdComparisonOption, refinancingStructureOption, formatAmount, formatQty,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else if (typeof self !== 'undefined') {
  Object.assign(self, api);
}
