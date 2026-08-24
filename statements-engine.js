/**
 * statements-engine.js — pure logic for the Lab's "Read the Company" tab.
 * No DOM, no fetch, no ECharts calls — just data in, structured judgments
 * out, so every rule here is unit-testable the same way goalden-engine.js
 * already is. Consumes the shape /api/financials returns (see
 * screener-parser.js): { profitLoss, balanceSheet, cashFlow, ratios, schema }
 * where each section is { periods: [{type,year,key,label}], rows: [{label,
 * values:[{raw,value}]}] }.
 *
 * Dual-format shim at the bottom mirrors goalden-engine.js.
 */

function findRow(section, label) {
  if (!section) return null;
  return section.rows.find((r) => r.label === label) || null;
}

// Fiscal-year-only view of a row: TTM is never a data point in a time
// series — including it would duplicate the latest year and poison every
// growth/median computation. Returns [{year, value}], oldest first.
function fySeries(section, label) {
  const row = findRow(section, label);
  if (!row || !section) return [];
  const out = [];
  section.periods.forEach((p, i) => {
    if (p.type !== 'fy') return;
    const cell = row.values[i];
    out.push({ year: p.year, value: cell ? cell.value : null });
  });
  return out;
}

function median(values) {
  const clean = values.filter((v) => v != null).sort((a, b) => a - b);
  if (!clean.length) return null;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
}

// (b-a)/|a|, refusing on a sign flip or a zero/near-zero base — a change
// computed across a loss year is not a percentage anyone can read ("-50 to
// +100" computes as +300%, which asserts nothing true about the business).
function pctChange(a, b, materialityFloor) {
  if (a == null || b == null) return null;
  if (materialityFloor != null && Math.abs(a) < materialityFloor) return null;
  if (a === 0) return null;
  if ((a < 0) !== (b < 0) && b !== 0) return null; // sign flip
  return (b - a) / Math.abs(a);
}

function yearIndex(series, year) {
  return series.findIndex((p) => p.year === year);
}

// vs-own-median: the sticky rightmost table column and the deviation bars.
// Ratio > 1 means "above its own 12-year normal", which is legible to a
// beginner in a way an absolute rupee figure is not.
function vsOwnMedian(series) {
  const values = series.map((p) => p.value);
  const med = median(values);
  return series.map((p) => ({
    year: p.year,
    value: p.value,
    median: med,
    ratio: med && p.value != null ? p.value / med : null,
  }));
}

/* =====================================================================
   SCHEMA CLASSIFICATION AND REFUSAL MACHINERY
   ===================================================================== */

// Deliberately no synonym map — aliasing Sales|Revenue would let a bank's
// numbers flow through manufacturing ratios. `schema` already arrives
// precomputed on the /api/financials result (see screener-parser.js); this
// re-derives it client-side only as a fallback for old cached responses.
function classifySchema(profitLoss) {
  if (!profitLoss) return 'unknown';
  const labels = new Set(profitLoss.rows.map((r) => r.label));
  const hasFinancing = labels.has('Financing Profit') || labels.has('Financing Margin %');
  const hasOperating = labels.has('Operating Profit') || labels.has('OPM %');
  if (hasFinancing && !hasOperating) return 'financial';
  if (hasOperating && !hasFinancing) return 'nonfinancial';
  return 'unknown';
}

// Every refusal takes this exact shape: what won't be shown, why in one
// sentence, and what's comparable instead. Returns null when no refusal
// applies for this pair.
function compareRefusal(companyA, companyB) {
  if (!companyA || !companyB) return null;
  const schemaA = companyA.schema || classifySchema(companyA.profitLoss);
  const schemaB = companyB.schema || classifySchema(companyB.profitLoss);
  if (schemaA !== schemaB && schemaA !== 'unknown' && schemaB !== 'unknown') {
    const lender = schemaA === 'financial' ? companyA : companyB;
    const other = lender === companyA ? companyB : companyA;
    return {
      code: 'SCHEMA_MISMATCH',
      title: "We're not showing the balance sheet or cash flow side by side.",
      reason: `${lender.symbol} is a lender — for a bank or NBFC, borrowing money is the business, so rows like "Borrowings" and "Deposits" mean something completely different than they do for ${other.symbol}.`,
      comparable: ['Market cap', 'Price to earnings', 'Price to book', 'Return on equity', 'Dividend yield', 'Price history'],
    };
  }
  return null;
}

/* =====================================================================
   THE COMPANION MAP — Phase 1 subset buildable from statement data alone
   (Stock P/E, Dividend Yield and 52-week range need price history merged
   in, which this pass doesn't wire up yet — see the session notes).
   ===================================================================== */
const COMPANION_MAP = {
  'ROCE %': [
    { key: 'Borrowings', section: 'balanceSheet', reason: 'a high return can just mean the capital behind it was borrowed' },
    { key: 'Working Capital Days', section: 'ratios', reason: "a return trapped in unpaid bills isn't spendable" },
  ],
  'OPM %': [
    { key: 'Sales', section: 'profitLoss', reason: 'rising margin with rising sales is operating leverage; with flat sales it is cost-cutting, which runs out' },
    { key: 'Tax %', section: 'profitLoss', reason: 'margin is pre-tax; a profit jump can be tax, not the business' },
    { key: 'Other Income', section: 'profitLoss', reason: 'operating margin excludes other income, but headline profit does not' },
  ],
  'Sales': [
    { key: 'Debtor Days', section: 'ratios', reason: "sales you haven't been paid for still count as sales" },
    { key: 'OPM %', section: 'profitLoss', reason: 'growth bought by cutting price shows up here' },
  ],
  'Cash from Operating Activity': [
    { key: 'Net Profit', section: 'profitLoss', reason: 'the whole point of the comparison — profit that never becomes cash is a paper number' },
    { key: 'Working Capital Days', section: 'ratios', reason: 'the usual explanation for a gap between the two' },
  ],
  // Stock P/E and Dividend Yield are today's-value facts from screener's
  // top-ratios snapshot, not statement rows — they can't be pinned to the
  // Bench themselves (no time series), but they still point at rows that
  // can be, which is what the companion strip actually surfaces.
  'Stock P/E': [
    { key: 'Net Profit', section: 'profitLoss', reason: "you're paying a multiple for the company's earnings — pin Net Profit to check the growth is actually there" },
    { key: 'CFO/OP', section: 'cashFlow', reason: 'a low multiple on profit that never becomes cash is not cheap' },
  ],
  'Dividend Yield': [
    { key: 'Dividend Payout %', section: 'profitLoss', reason: 'a high yield on a payout near 100% leaves nothing to reinvest' },
    { key: 'Cash from Investing Activity', section: 'cashFlow', reason: 'a positive investing cash flow in the same year can mean the dividend was funded by selling assets, not earning them' },
  ],
};

/* =====================================================================
   FIVE DIVERGENCE RULES
   Each returns one entry per fiscal-year transition it could evaluate:
   {year, status: 'fired'|'clear'|'not_applicable', reason?, message?,
    detail?}. Persistence: a rule only surfaces as a visible flag when it
   also fired (or was clear-but-close is NOT enough — must have fired) on
   the immediately preceding transition, cutting single-year noise.
   ===================================================================== */

const MATERIALITY_FLOOR = 1; // Rs crore — screener's rows are already in Cr

function ruleDividendNotFromOps(bundle) {
  const cfo = fySeries(bundle.cashFlow, 'Cash from Operating Activity');
  const cfi = fySeries(bundle.cashFlow, 'Cash from Investing Activity');
  const payout = fySeries(bundle.profitLoss, 'Dividend Payout %');
  const np = fySeries(bundle.profitLoss, 'Net Profit');
  const out = [];
  for (let i = 1; i < cfo.length; i++) {
    const year = cfo[i].year;
    const cfoT = cfo[i].value, cfoT1 = cfo[i - 1].value, cfiT = cfi[i] && cfi[i].value;
    const payoutT = payout[i] && payout[i].value, npT = np[i] && np[i].value;
    if (cfoT == null || cfoT1 == null || cfiT == null || payoutT == null || npT == null) {
      out.push({ year, status: 'not_applicable', reason: 'missing an input for this year' });
      continue;
    }
    if (npT <= 0) { out.push({ year, status: 'not_applicable', reason: 'no profit to compute a dividend outflow from' }); continue; }
    const divOutflow = (payoutT / 100) * npT;
    const meanCfo = (cfoT + cfoT1) / 2;
    const fired = divOutflow > meanCfo && cfiT > 0;
    out.push({
      year, status: fired ? 'fired' : 'clear',
      message: fired ? 'The dividend paid was larger than the cash the business earned — the company sold assets to help pay it.' : null,
      detail: fired ? `FY${year} — dividend paid was ${(divOutflow / meanCfo).toFixed(1)}x average cash from operations, and investing cash flow was positive (net asset sales), at +Rs ${Math.round(cfiT)} Cr.` : null,
      materiality: fired ? Math.abs(divOutflow - meanCfo) : null,
    });
  }
  return out;
}

function ruleCfoDivergence(bundle) {
  const cfo = fySeries(bundle.cashFlow, 'Cash from Operating Activity');
  const np = fySeries(bundle.profitLoss, 'Net Profit');
  const out = [];
  for (let i = 3; i < np.length; i++) {
    const year = np[i].year;
    const growth = pctChange(np[i - 3].value, np[i].value, MATERIALITY_FLOOR);
    const npWindow = [np[i - 2], np[i - 1], np[i]].map((p) => p.value);
    const cfoWindow = [cfo[i - 2], cfo[i - 1], cfo[i]].map((p) => p && p.value);
    if (growth == null || npWindow.some((v) => v == null) || cfoWindow.some((v) => v == null)) {
      out.push({ year, status: 'not_applicable', reason: 'missing an input, or the 3-year-ago base is not comparable (loss year / too small)' });
      continue;
    }
    const sumNp = npWindow.reduce((a, b) => a + b, 0);
    if (sumNp <= 0) { out.push({ year, status: 'not_applicable', reason: '3-year profit sum is not positive' }); continue; }
    const sumCfo = cfoWindow.reduce((a, b) => a + b, 0);
    const ratio = sumCfo / sumNp;
    const fired = growth > 0.15 && ratio < 0.50;
    out.push({
      year, status: fired ? 'fired' : 'clear',
      message: fired ? 'Reported profit has grown strongly but less than half of it arrived as actual cash.' : null,
      detail: fired ? `FY${year - 2}-FY${year} — net profit grew ${(growth * 100).toFixed(0)}% over 3 years, but cash from operations covered only ${(ratio * 100).toFixed(0)}% of it.` : null,
      materiality: fired ? Math.abs(sumNp - sumCfo) : null,
    });
  }
  return out;
}

function ruleDebtorBalloon(bundle) {
  const dd = fySeries(bundle.ratios, 'Debtor Days');
  const sales = fySeries(bundle.profitLoss, 'Sales').length ? fySeries(bundle.profitLoss, 'Sales') : fySeries(bundle.profitLoss, 'Revenue');
  const out = [];
  if (!dd.length) return out; // lenders don't report this row at all — silently not applicable, not a wall of N/A rows
  for (let i = 3; i < dd.length; i++) {
    const year = dd[i].year;
    const t = dd[i].value, t3 = dd[i - 3].value;
    if (t == null || t3 == null || t3 <= 0) { out.push({ year, status: 'not_applicable', reason: 'missing debtor-days data' }); continue; }
    const ratio = t / t3;
    const delta = t - t3;
    const fired = ratio > 1.30 && t > 60 && delta > 15;
    // Rupee-materiality proxy: incremental sales-days now sitting uncollected,
    // approximated from this year's sales — a day count alone can't be ranked
    // against the other rules' rupee figures for the 3-flag cap.
    const salesT = sales[i] && sales[i].value;
    const impliedRupees = fired && salesT != null ? (delta / 365) * salesT : null;
    out.push({
      year, status: fired ? 'fired' : 'clear',
      message: fired ? 'The company is waiting much longer to be paid than it was three years ago.' : null,
      detail: fired ? `FY${year} — debtor days rose from ${Math.round(t3)} to ${Math.round(t)} (+${Math.round(delta)} days) over 3 years.` : null,
      materiality: fired ? (impliedRupees != null ? impliedRupees : delta) : null,
    });
  }
  return out;
}

function ruleAssetSaleGain(bundle) {
  const cfi = fySeries(bundle.cashFlow, 'Cash from Investing Activity');
  const oi = fySeries(bundle.profitLoss, 'Other Income');
  const pbt = fySeries(bundle.profitLoss, 'Profit before tax');
  const out = [];
  for (let i = 5; i < oi.length; i++) {
    const year = oi[i].year;
    const cfiT = cfi[i] && cfi[i].value, oiT = oi[i].value, pbtT = pbt[i] && pbt[i].value;
    const window = oi.slice(i - 5, i).map((p) => p.value);
    if (cfiT == null || oiT == null || pbtT == null || window.some((v) => v == null)) {
      out.push({ year, status: 'not_applicable', reason: 'missing an input for this year' });
      continue;
    }
    if (pbtT <= 0) { out.push({ year, status: 'not_applicable', reason: 'no pre-tax profit to compare other income against' }); continue; }
    const med = median(window);
    const fired = cfiT > 0 && med > 0 && oiT > 2 * med && (oiT / pbtT) > 0.30;
    out.push({
      year, status: fired ? 'fired' : 'clear',
      message: fired ? 'A large part of this year’s profit came from a one-time gain, not the ongoing business.' : null,
      detail: fired ? `FY${year} — other income was Rs ${Math.round(oiT)} Cr, ${(oiT / med).toFixed(1)}x its 5-year median, and ${(oiT / pbtT * 100).toFixed(0)}% of pre-tax profit; investing cash flow was positive.` : null,
      materiality: fired ? Math.abs(oiT - med) : null,
    });
  }
  return out;
}

function ruleTaxDrivenMargin(bundle) {
  const np = fySeries(bundle.profitLoss, 'Net Profit');
  const pbt = fySeries(bundle.profitLoss, 'Profit before tax');
  const taxPct = fySeries(bundle.profitLoss, 'Tax %');
  const out = [];
  for (let i = 1; i < np.length; i++) {
    const year = np[i].year;
    const npGrowth = pctChange(np[i - 1].value, np[i].value, MATERIALITY_FLOOR);
    const pbtGrowth = pctChange(pbt[i - 1] && pbt[i - 1].value, pbt[i] && pbt[i].value, MATERIALITY_FLOOR);
    const taxT = taxPct[i] && taxPct[i].value, taxT1 = taxPct[i - 1] && taxPct[i - 1].value;
    if (npGrowth == null || pbtGrowth == null || taxT == null || taxT1 == null) {
      out.push({ year, status: 'not_applicable', reason: 'missing an input, or a base year is not comparable (loss year / too small)' });
      continue;
    }
    const fired = npGrowth > 0.20 && pbtGrowth < 0.08 && taxT < taxT1 - 5;
    // Rupee-materiality proxy: the extra post-tax profit attributable purely
    // to the lower tax rate, holding pre-tax profit fixed.
    const pbtT = pbt[i] && pbt[i].value;
    const taxSavingRupees = fired && pbtT != null ? Math.abs(((taxT1 - taxT) / 100) * pbtT) : null;
    out.push({
      year, status: fired ? 'fired' : 'clear',
      message: fired ? 'Profit jumped mainly because the company paid less tax, not because the business earned more.' : null,
      detail: fired ? `FY${year} — net profit grew ${(npGrowth * 100).toFixed(0)}% while pre-tax profit grew only ${(pbtGrowth * 100).toFixed(0)}%; the tax rate fell from ${taxT1.toFixed(1)}% to ${taxT.toFixed(1)}%.` : null,
      materiality: taxSavingRupees,
    });
  }
  return out;
}

// Cash-conversion rules assume operating cash flow tracks the operating
// business. For a lender, deploying capital into loans *is* the business,
// so CFO is routinely and healthily negative — these rules have no meaning
// in that domain and must not be evaluated at all, not evaluated-and-clear.
const DIVERGENCE_RULES = [
  { id: 'DIVIDEND_NOT_FROM_OPS', run: ruleDividendNotFromOps, validSchemas: ['nonfinancial'] },
  { id: 'CFO_DIVERGENCE', run: ruleCfoDivergence, validSchemas: ['nonfinancial'] },
  { id: 'DEBTOR_BALLOON', run: ruleDebtorBalloon, validSchemas: ['nonfinancial'] },
  { id: 'ASSET_SALE_GAIN', run: ruleAssetSaleGain, validSchemas: ['nonfinancial'] },
  { id: 'TAX_DRIVEN_MARGIN', run: ruleTaxDrivenMargin, validSchemas: ['nonfinancial', 'financial'] },
];

// Known market-wide reporting discontinuities. A flag whose transition
// crosses one of these years gets an inline note, not suppression — the
// two-consecutive-years persistence gate above already prevents a flag
// whose *entire* signal is one such transition from surfacing at all (it
// would have no prior-year "fired" to chain from), so there's nothing
// left to suppress; the honest remaining case is just disclosure.
const KNOWN_DISCONTINUITIES = [
  { year: 2018, note: 'FY2018 — GST changed how the revenue line is reported industry-wide.' },
  { year: 2020, note: 'FY2020 — Ind AS 116 moved operating lease costs into depreciation and interest, lifting EBITDA and debt on paper for lease-heavy businesses.' },
  { year: 2021, note: 'FY2021 — COVID-19 disruption.' },
];
function discontinuityNote(year) {
  const hit = KNOWN_DISCONTINUITIES.find((d) => d.year === year);
  return hit ? hit.note : null;
}

// A business is cyclical when its long-run and recent growth point opposite
// ways, or its margin has swung wide over the last decade — steel, cement,
// sugar, chemicals. At the cyclical trough every margin/leverage rule fires
// simultaneously, which is roughly when the business is least distressed
// relative to its own future: anti-signal, not signal. Detected once per
// company and used to note (not hide) the flags below.
function detectCyclical(profitLoss) {
  const sales = fySeries(profitLoss, 'Sales').length ? fySeries(profitLoss, 'Sales') : fySeries(profitLoss, 'Revenue');
  const opm = fySeries(profitLoss, 'OPM %').length ? fySeries(profitLoss, 'OPM %') : fySeries(profitLoss, 'Financing Margin %');
  if (sales.length < 4) return { cyclical: false };
  const growth10y = pctChange(sales[0].value, sales[sales.length - 1].value);
  const growth3y = pctChange(sales[Math.max(0, sales.length - 4)].value, sales[sales.length - 1].value);
  const signFlip = growth10y != null && growth3y != null && (growth10y < 0) !== (growth3y < 0) && growth10y !== 0 && growth3y !== 0;
  const opmValues = opm.map((p) => p.value).filter((v) => v != null);
  const opmRange = opmValues.length ? Math.max(...opmValues) - Math.min(...opmValues) : 0;
  if (signFlip) return { cyclical: true, reason: '10-year and 3-year sales growth point in opposite directions.' };
  if (opmRange > 15) return { cyclical: true, reason: `Operating margin has ranged over ${opmRange.toFixed(0)} percentage points across the last 12 years.` };
  return { cyclical: false };
}

// Applies the schema gate and the two-consecutive-years persistence gate,
// returning both the visible flags and the counts the check-summary line needs.
function evaluateDivergenceRules(bundle) {
  const flags = [];
  let notApplicable = 0, clear = 0, fired = 0;
  const schema = bundle.schema || classifySchema(bundle.profitLoss);
  DIVERGENCE_RULES.forEach((rule) => {
    if (!rule.validSchemas.includes(schema)) { notApplicable++; return; }
    const results = rule.run(bundle);
    results.forEach((r, i) => {
      if (r.status === 'not_applicable') { notApplicable++; return; }
      if (r.status === 'clear') { clear++; return; }
      // fired — only surfaces if the previous transition for this same rule also fired
      const prev = results[i - 1];
      if (prev && prev.status === 'fired') {
        flags.push({ ruleId: rule.id, year: r.year, message: r.message, detail: r.detail, note: discontinuityNote(r.year), materiality: r.materiality || 0 });
      }
      fired++;
    });
  });

  // Correlated-flag collapse: one accounting event (an exceptional item, a
  // demerger) can trip several rules in the same company-year. Presenting
  // that as three independent problems overstates it — collapse same-year
  // flags into one.
  const byYear = new Map();
  flags.forEach((f) => { if (!byYear.has(f.year)) byYear.set(f.year, []); byYear.get(f.year).push(f); });
  let collapsed = [];
  byYear.forEach((group, year) => {
    if (group.length > 1) {
      collapsed.push({
        ruleId: 'CORRELATED', year,
        message: `Profit moved sharply for reasons the condensed statement doesn't break out on its own — check the annual report for exceptional items.`,
        detail: `FY${year} — ${group.length} separate checks (${group.map((g) => g.ruleId).join(', ')}) fired together, which usually means one underlying event rather than several.`,
        note: group.map((g) => g.note).find(Boolean) || null,
        // A collapsed group is presented as one event; its materiality is the
        // largest of the rupee figures behind it, not their sum — the checks
        // overlap in what they're measuring, so summing would double-count.
        materiality: Math.max(...group.map((g) => g.materiality || 0)),
      });
    } else {
      collapsed = collapsed.concat(group);
    }
  });
  // Ranked by absolute rupee materiality, not recency — a five-year-old
  // ₹2,000 Cr divergence matters more than last year's ₹40 Cr one. Year is
  // only a tie-break, so ordering stays deterministic.
  collapsed.sort((a, b) => (b.materiality || 0) - (a.materiality || 0) || b.year - a.year);

  const cyclical = detectCyclical(bundle.profitLoss);

  return {
    checksRun: notApplicable + clear + fired,
    notApplicable, clear, fired,
    flags: collapsed.slice(0, 3),
    flagsTotal: collapsed.length,
    cyclical,
  };
}

/* =====================================================================
   CHART OPTION BUILDERS — pure data-in, ECharts-option-out. No dual
   y-axes anywhere: a shared category axis with stacked grids instead.
   ===================================================================== */
const SERIES_PALETTE = [
  { color: '#2557C7', lineStyle: { type: 'solid' }, symbol: 'circle' },
  { color: '#A03A22', lineStyle: { type: [8, 4] }, symbol: 'rect' },
  { color: '#2E8B6F', lineStyle: { type: [2, 3] }, symbol: 'triangle' },
  { color: '#14283F', lineStyle: { type: 'dashed' }, symbol: 'diamond' },
];

// Pinned rows over time. Indexed to 100 at the earliest common year by
// default so a small and a large company's growth rate compare fairly.
// Each pin is {label, series, compareSeries?, compareLabel?} -- the second
// company (if any) shares the pin's own palette colour at reduced opacity
// rather than taking a second palette slot, since two companies x four pins
// would need eight colours and this page caps comparison at two companies
// specifically to avoid needing a legend (see the plan's palette notes).
function benchChartOption(pins, indexed) {
  const allSeries = pins.flatMap((p) => [p.series, p.compareSeries || []]);
  const allYears = Array.from(new Set(allSeries.flat().map((s) => s.year))).sort((a, b) => a - b);
  const indexBase = (series) => {
    if (!indexed) return null;
    const firstVal = series.find((s) => s.value != null);
    return firstVal ? firstVal.value : null;
  };
  const seriesFor = (points, base) => {
    const byYear = new Map(points.map((s) => [s.year, s.value]));
    return allYears.map((y) => {
      const v = byYear.has(y) ? byYear.get(y) : null;
      if (v == null) return null;
      return indexed && base ? (v / base) * 100 : v;
    });
  };
  const series = [];
  pins.forEach((pin, i) => {
    const style = SERIES_PALETTE[i % SERIES_PALETTE.length];
    series.push({
      name: pin.label, type: 'bar', data: seriesFor(pin.series, indexBase(pin.series)),
      itemStyle: { color: style.color }, label: { show: false },
    });
    if (pin.compareSeries && pin.compareSeries.length) {
      series.push({
        name: (pin.compareLabel || 'Compare') + ' — ' + pin.label, type: 'bar',
        data: seriesFor(pin.compareSeries, indexBase(pin.compareSeries)),
        itemStyle: { color: style.color, opacity: 0.45 }, label: { show: false },
      });
    }
  });
  return {
    color: SERIES_PALETTE.map((s) => s.color),
    legend: { show: false },
    xAxis: { type: 'category', data: allYears.map((y) => 'FY' + String(y).slice(2)) },
    yAxis: { type: 'value', name: indexed ? 'Indexed (=100)' : '' },
    series,
    // Not an ECharts option key — carried through so the table-hover cross
    // highlight (chart.dispatchAction({type:'highlight'})) can turn a
    // data-period value (a plain fiscal year, e.g. 2023) into the dataIndex
    // this chart's category axis actually uses (e.g. "FY23").
    __years: allYears,
  };
}

// Net Profit (bar) vs Cash from Operating Activity (line), one shared
// y-axis — the gap between the two IS the message, and putting them on
// two different scales would let you manufacture a crossover that isn't
// real. Second grid: cumulative CFO / cumulative Net Profit, ref line at 1.
function profitVsCashChartOption(npSeries, cfoSeries) {
  const years = npSeries.map((p) => p.year);
  let cumNp = 0, cumCfo = 0;
  const cumRatio = years.map((y, i) => {
    cumNp += npSeries[i].value || 0;
    cumCfo += (cfoSeries[i] && cfoSeries[i].value) || 0;
    return cumNp > 0 ? cumCfo / cumNp : null;
  });
  // No legend anywhere on this page — a legend is a memory task, a direct
  // label is a reading task. Each series carries its own name as a label at
  // its last point instead, in the series colour, reusing the page's
  // registered 4-slot palette (colour + line style + symbol together) rather
  // than a bare hardcoded hex pair.
  const [A, B, C] = SERIES_PALETTE;
  const npData = npSeries.map((p) => p.value);
  const lastIdx = npData.length - 1;
  return {
    color: [A.color, B.color, C.color],
    legend: { show: false },
    grid: [
      { left: 50, right: 150, top: 20, height: '55%', containLabel: true },
      { left: 50, right: 150, top: '68%', bottom: 24, height: '22%', containLabel: true },
    ],
    xAxis: [
      { type: 'category', gridIndex: 0, data: years.map((y) => 'FY' + String(y).slice(2)) },
      { type: 'category', gridIndex: 1, data: years.map((y) => 'FY' + String(y).slice(2)) },
    ],
    yAxis: [
      { type: 'value', gridIndex: 0, name: 'Rs Cr' },
      { type: 'value', gridIndex: 1, name: 'Cumulative CFO/NP', min: 0 },
    ],
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    series: [
      {
        name: 'Net Profit', type: 'bar', xAxisIndex: 0, yAxisIndex: 0, itemStyle: { color: A.color },
        data: npData.map((v, i) => (i === lastIdx
          ? { value: v, label: { show: true, position: 'top', color: A.color, fontWeight: 600, formatter: '{a}' } }
          : v)),
      },
      {
        name: 'Cash from Operations', type: 'line', xAxisIndex: 0, yAxisIndex: 0,
        lineStyle: { color: B.color, type: B.lineStyle.type }, itemStyle: { color: B.color }, symbol: B.symbol,
        data: cfoSeries.map((p) => p && p.value),
        endLabel: { show: true, formatter: '{a}', color: B.color, fontWeight: 600 },
      },
      {
        name: 'Cumulative CFO / NP', type: 'line', xAxisIndex: 1, yAxisIndex: 1,
        lineStyle: { color: C.color, type: C.lineStyle.type }, itemStyle: { color: C.color }, symbol: C.symbol,
        data: cumRatio,
        endLabel: { show: true, formatter: '{a}', color: C.color, fontWeight: 600 },
        markLine: { symbol: 'none', data: [{ yAxis: 1 }], lineStyle: { color: 'rgba(20,40,63,.35)', type: 'dashed' } },
      },
    ],
    __years: years,
  };
}

// Plain-language caption computed from the real numbers, not static text.
function profitVsCashCaption(npSeries, cfoSeries) {
  let sumNp = 0, sumCfo = 0;
  npSeries.forEach((p, i) => { sumNp += p.value || 0; sumCfo += (cfoSeries[i] && cfoSeries[i].value) || 0; });
  if (sumNp <= 0) return null;
  const paise = Math.round((sumCfo / sumNp) * 100);
  const years = npSeries.length;
  return `Over ${years} years this company reported Rs ${Math.round(sumNp).toLocaleString('en-IN')} Cr of profit and collected Rs ${Math.round(sumCfo).toLocaleString('en-IN')} Cr of actual cash from operations — about ${paise} paise of cash per rupee of profit.`;
}

/* =====================================================================
   CANONICAL ROW SCHEMA — one fixed row set and order per business type,
   verified empirically against all six fixture companies. Every company
   renders into this shape; a line it doesn't report keeps its slot and
   shows as "—" rather than shifting every row below it up by one. Display
   still uses the as-reported label (screener says "Revenue" for a bank and
   "Sales" for a manufacturer) — only the row's position and its presence
   as a comparison target are canonical.
   ===================================================================== */
const CANONICAL_ROWS = {
  nonfinancial: {
    profitLoss: ['Sales', 'Expenses', 'Operating Profit', 'OPM %', 'Other Income', 'Interest', 'Depreciation', 'Profit before tax', 'Tax %', 'Net Profit', 'EPS in Rs', 'Dividend Payout %'],
    balanceSheet: ['Equity Capital', 'Reserves', 'Borrowings', 'Other Liabilities', 'Total Liabilities', 'Fixed Assets', 'CWIP', 'Investments', 'Other Assets', 'Total Assets'],
    cashFlow: ['Cash from Operating Activity', 'Cash from Investing Activity', 'Cash from Financing Activity', 'Net Cash Flow', 'Free Cash Flow', 'CFO/OP'],
    ratios: ['Debtor Days', 'Inventory Days', 'Days Payable', 'Cash Conversion Cycle', 'Working Capital Days', 'ROCE %'],
  },
  financial: {
    profitLoss: ['Revenue', 'Interest', 'Expenses', 'Financing Profit', 'Financing Margin %', 'Other Income', 'Depreciation', 'Profit before tax', 'Tax %', 'Net Profit', 'EPS in Rs', 'Dividend Payout %'],
    balanceSheet: ['Equity Capital', 'Reserves', 'Deposits', 'Borrowing', 'Other Liabilities', 'Total Liabilities', 'Fixed Assets', 'CWIP', 'Investments', 'Other Assets', 'Total Assets'],
    cashFlow: ['Cash from Operating Activity', 'Cash from Investing Activity', 'Cash from Financing Activity', 'Net Cash Flow', 'Free Cash Flow', 'CFO/OP'],
    ratios: ['ROE %'],
  },
};

// A data property, not a display property: whether higher is better, lower
// is better, or neither claim is supportable from this row alone. Most
// balance-sheet rows are neutral on purpose — rising borrowings is good for
// a company funding capex at 14% ROCE and bad for one funding losses, and a
// table must not assert a direction the data doesn't support.
const ROW_POLARITY = {
  'Sales': 'higher-better', 'Revenue': 'higher-better', 'Expenses': 'neutral',
  'Operating Profit': 'higher-better', 'OPM %': 'higher-better',
  'Financing Profit': 'higher-better', 'Financing Margin %': 'higher-better',
  'Other Income': 'neutral', 'Interest': 'neutral', 'Depreciation': 'neutral',
  'Profit before tax': 'higher-better', 'Tax %': 'neutral', 'Net Profit': 'higher-better',
  'EPS in Rs': 'higher-better', 'Dividend Payout %': 'neutral',
  'Equity Capital': 'neutral', 'Reserves': 'neutral', 'Borrowings': 'neutral', 'Borrowing': 'neutral',
  'Deposits': 'neutral', 'Other Liabilities': 'neutral', 'Total Liabilities': 'neutral',
  'Fixed Assets': 'neutral', 'CWIP': 'neutral', 'Investments': 'neutral', 'Other Assets': 'neutral', 'Total Assets': 'neutral',
  'Cash from Operating Activity': 'higher-better', 'Cash from Investing Activity': 'neutral', 'Cash from Financing Activity': 'neutral',
  'Net Cash Flow': 'higher-better', 'Free Cash Flow': 'higher-better', 'CFO/OP': 'higher-better',
  'Debtor Days': 'lower-better', 'Inventory Days': 'lower-better', 'Days Payable': 'neutral',
  'Cash Conversion Cycle': 'lower-better', 'Working Capital Days': 'lower-better',
  'ROCE %': 'higher-better', 'ROE %': 'higher-better',
};
function rowPolarity(label) { return ROW_POLARITY[label] || 'neutral'; }

const ROW_UNIT = {
  'OPM %': 'pct', 'Financing Margin %': 'pct', 'Tax %': 'pct', 'Dividend Payout %': 'pct', 'ROCE %': 'pct', 'ROE %': 'pct',
  'EPS in Rs': 'rupee',
  'Debtor Days': 'days', 'Inventory Days': 'days', 'Days Payable': 'days', 'Cash Conversion Cycle': 'days', 'Working Capital Days': 'days',
  'CFO/OP': 'ratio',
};
function rowUnit(label) { return ROW_UNIT[label] || 'cr'; }

// The per-table box score: best year, worst year, and the CAGR across the
// row's own reported span. CAGR is refused (null) across a sign flip or a
// non-positive base for the same reason pctChange refuses one — a single
// two-endpoint CAGR fitted across a loss year asserts a rate that isn't real.
function rowBoxScore(series) {
  const clean = series.filter((p) => p.value != null);
  if (clean.length < 2) return null;
  const best = clean.reduce((a, b) => (b.value > a.value ? b : a));
  const worst = clean.reduce((a, b) => (b.value < a.value ? b : a));
  const first = clean[0], last = clean[clean.length - 1];
  const years = clean.length - 1;
  let cagr = null;
  if (years > 0 && first.value > 0 && (last.value > 0)) {
    cagr = Math.pow(last.value / first.value, 1 / years) - 1;
  }
  return { best, worst, cagr, years, windowStart: first.year, windowEnd: last.year };
}

const api = {
  findRow, fySeries, median, pctChange, yearIndex, vsOwnMedian,
  classifySchema, compareRefusal,
  COMPANION_MAP,
  KNOWN_DISCONTINUITIES, discontinuityNote, detectCyclical,
  DIVERGENCE_RULES, evaluateDivergenceRules,
  SERIES_PALETTE, benchChartOption, profitVsCashChartOption, profitVsCashCaption,
  CANONICAL_ROWS, ROW_POLARITY, rowPolarity, ROW_UNIT, rowUnit, rowBoxScore,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else if (typeof self !== 'undefined') {
  Object.assign(self, api);
}
