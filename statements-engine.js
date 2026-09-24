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
  // --- Profit & Loss ---
  'Sales': [
    { key: 'Debtor Days', section: 'ratios', reason: 'sales you haven\u2019t been paid for still count as sales' },
    { key: 'OPM %', section: 'profitLoss', reason: 'growth alongside flat sales is a margin story, not a volume story' },
    { key: 'EPS in Rs', section: 'profitLoss', reason: 'growth alongside flat EPS means the share count is growing too' },
  ],
  'Revenue': [
    { key: 'Net Profit', section: 'profitLoss', reason: 'revenue and profit moving together is operating leverage; revenue alone is a scale story' },
  ],
  'Expenses': [
    { key: 'Sales', section: 'profitLoss', reason: 'expenses growing faster than sales compresses the operating margin below' },
  ],
  'Operating Profit': [
    { key: 'Sales', section: 'profitLoss', reason: 'operating profit moving with sales is operating leverage; moving alone is a margin story' },
    { key: 'Depreciation', section: 'profitLoss', reason: 'rising depreciation absorbs operating profit before it reaches the bottom line' },
  ],
  'OPM %': [
    { key: 'Sales', section: 'profitLoss', reason: 'rising margin with rising sales is operating leverage; with flat sales it is cost-cutting, which runs out' },
    { key: 'Tax %', section: 'profitLoss', reason: 'margin is pre-tax; a profit jump can be tax, not the business' },
    { key: 'Other Income', section: 'profitLoss', reason: 'operating margin excludes other income, but headline profit does not' },
  ],
  'Financing Margin %': [
    { key: 'Interest', section: 'profitLoss', reason: 'the margin is after interest — a narrowing margin with rising interest means funding costs are rising faster than lending income' },
  ],
  'Other Income': [
    { key: 'Net Profit', section: 'profitLoss', reason: 'a large other-income share of profit means the ongoing business is a smaller contributor than the headline suggests' },
    { key: 'Cash from Investing Activity', section: 'cashFlow', reason: 'other income alongside positive investing cash flow can mean one-time asset sales rather than recurring earnings' },
  ],
  'Interest': [
    { key: 'Borrowings', section: 'balanceSheet', reason: 'interest against the borrowings balance gives the effective cost of debt' },
    { key: 'Profit before tax', section: 'profitLoss', reason: 'interest as a share of PBT shows how much of the operating result goes to lenders before shareholders' },
  ],
  'Depreciation': [
    { key: 'Fixed Assets', section: 'balanceSheet', reason: 'depreciation against the fixed-asset base gives a read on the age and reinvestment cycle of the asset base' },
    { key: 'Cash from Operating Activity', section: 'cashFlow', reason: 'depreciation is added back to operating cash — a large depreciation figure means the cash-to-profit gap is partly non-cash cost, not a collection problem' },
  ],
  'Profit before tax': [
    { key: 'Tax %', section: 'profitLoss', reason: 'the same PBT can produce very different net profit at different tax rates' },
    { key: 'Interest', section: 'profitLoss', reason: 'interest as a share of PBT shows the lender\u2019s share of the operating result' },
  ],
  'Tax %': [
    { key: 'Profit before tax', section: 'profitLoss', reason: 'a falling tax rate on rising PBT amplifies net profit growth beyond what the business earned' },
  ],
  'Net Profit': [
    { key: 'Cash from Operating Activity', section: 'cashFlow', reason: 'profit that never arrives as cash is a paper number' },
    { key: 'EPS in Rs', section: 'profitLoss', reason: 'net profit growing while EPS stays flat means the share count is growing too' },
    { key: 'Dividend Payout %', section: 'profitLoss', reason: 'the share of profit paid out — the rest stays in the business as reserves' },
  ],
  'EPS in Rs': [
    { key: 'Net Profit', section: 'profitLoss', reason: 'EPS growing slower than net profit means dilution is absorbing the difference' },
  ],
  'Dividend Payout %': [
    { key: 'Cash from Operating Activity', section: 'cashFlow', reason: 'a high payout on weak operating cash means the dividend is funded from somewhere other than the business' },
    { key: 'Free Cash Flow', section: 'cashFlow', reason: 'payout above free cash flow leaves nothing for reinvestment or debt reduction' },
  ],
  // --- Balance Sheet ---
  'Equity Capital': [
    { key: 'EPS in Rs', section: 'profitLoss', reason: 'equity capital changes signal bonus issues or splits, which change EPS without changing the business' },
  ],
  'Reserves': [
    { key: 'Net Profit', section: 'profitLoss', reason: 'reserves growing slower than cumulative profit means dividends are taking the difference' },
  ],
  'Borrowings': [
    { key: 'ROCE %', section: 'ratios', reason: 'borrowings against the return on capital \u2014 the return on borrowed capital is a different claim from the return on owned capital' },
    { key: 'Interest', section: 'profitLoss', reason: 'rising borrowings with flat interest means lower borrowing costs; rising both is a compounding obligation' },
  ],
  'Fixed Assets': [
    { key: 'Depreciation', section: 'profitLoss', reason: 'depreciation against the fixed-asset base gives a read on the age of the asset base' },
    { key: 'Sales', section: 'profitLoss', reason: 'sales divided by fixed assets shows how much revenue each rupee of plant produces' },
  ],
  'CWIP': [
    { key: 'Fixed Assets', section: 'balanceSheet', reason: 'CWIP converting to fixed assets means capex is completing; CWIP growing year after year means projects are stalling' },
    { key: 'Sales', section: 'profitLoss', reason: 'rising CWIP without rising sales means spending on capacity that hasn\u2019t started earning yet' },
  ],
  'Investments': [
    { key: 'Other Income', section: 'profitLoss', reason: 'a large investment book against other income gives the yield earned on non-operating assets' },
  ],
  // --- Cash Flow ---
  'Cash from Operating Activity': [
    { key: 'Net Profit', section: 'profitLoss', reason: 'profit that never arrives as cash is a paper number' },
    { key: 'Working Capital Days', section: 'ratios', reason: 'the usual explanation for a gap between the two' },
    { key: 'Free Cash Flow', section: 'cashFlow', reason: 'operating cash less capex is what\u2019s available for dividends and debt reduction' },
  ],
  'Cash from Investing Activity': [
    { key: 'Cash from Operating Activity', section: 'cashFlow', reason: 'investing outflow against operating inflow shows whether the business funds its own growth' },
  ],
  'Cash from Financing Activity': [
    { key: 'Borrowings', section: 'balanceSheet', reason: 'financing cash flow against the borrowings balance shows whether debt is being raised or repaid' },
    { key: 'Dividend Payout %', section: 'profitLoss', reason: 'dividend payments appear here \u2014 the payout ratio alongside the cash outflow shows whether the dividend is funded from earnings or from the balance sheet' },
  ],
  'Net Cash Flow': [
    { key: 'Cash from Operating Activity', section: 'cashFlow', reason: 'a negative net cash flow funded by strong operations is a different situation from one funded by borrowing' },
  ],
  'Free Cash Flow': [
    { key: 'Dividend Payout %', section: 'profitLoss', reason: 'free cash flow against the dividend shows whether the business generates enough after reinvestment to fund its own payout' },
    { key: 'Borrowings', section: 'balanceSheet', reason: 'persistent negative free cash flow with rising borrowings means debt is funding the gap' },
  ],
  'CFO/OP': [
    { key: 'Working Capital Days', section: 'ratios', reason: 'the most common explanation for cash conversion below 100%' },
    { key: 'Net Profit', section: 'profitLoss', reason: 'profit growing while cash conversion sits below 75% is the finding, not the percentage itself' },
  ],
  // --- Ratios ---
  'Debtor Days': [
    { key: 'Sales', section: 'profitLoss', reason: 'debtor days rising alongside flat sales means the character of the sales is changing, not the volume' },
  ],
  'Inventory Days': [
    { key: 'Sales', section: 'profitLoss', reason: 'inventory days rising against flat sales carries obsolescence and write-down exposure' },
  ],
  'Working Capital Days': [
    { key: 'Cash from Operating Activity', section: 'cashFlow', reason: 'the bridge between reported profit and actual cash' },
  ],
  'Cash Conversion Cycle': [
    { key: 'Cash from Operating Activity', section: 'cashFlow', reason: 'a lengthening cycle pulls cash out of operations even when profit is stable' },
  ],
  'ROCE %': [
    { key: 'Borrowings', section: 'balanceSheet', reason: 'a high return can just mean the capital behind it was borrowed' },
    { key: 'Working Capital Days', section: 'ratios', reason: 'a return trapped in unpaid bills isn\u2019t spendable' },
  ],
  'ROE %': [
    { key: 'Borrowings', section: 'balanceSheet', reason: 'ROE above ROCE means leverage is amplifying the return \u2014 the cost of that amplification is in the interest line' },
  ],
  // --- Market facts (today's-value, not pinnable themselves) ---
  'Stock P/E': [
    { key: 'Net Profit', section: 'profitLoss', reason: 'you\u2019re paying a multiple for the company\u2019s earnings \u2014 pin Net Profit to check the growth is actually there' },
    { key: 'CFO/OP', section: 'cashFlow', reason: 'a low multiple on profit that never becomes cash is not cheap' },
  ],
  'Dividend Yield': [
    { key: 'Dividend Payout %', section: 'profitLoss', reason: 'a high yield on a payout near 100% leaves nothing to reinvest' },
    { key: 'Cash from Investing Activity', section: 'cashFlow', reason: 'a positive investing cash flow in the same year can mean the dividend was funded by selling assets, not earning them' },
  ],
};

// Context-sensitive companion lookup. For a company flagged cyclical
// (detectCyclical), Stock P/E's companions change: the earnings multiple is
// least meaningful at a cyclical's profit peak, so the book-value side of the
// balance sheet (reserves) replaces the growth-check companion — reserves
// don't swing with the cycle the way profit does.
function companionMapFor(label, isCyclical) {
  let list = COMPANION_MAP[label];
  if (!list) return null;
  if (isCyclical && label === 'Stock P/E') {
    return [
      { key: 'Net Profit', section: 'profitLoss', reason: 'you\u2019re paying a multiple for the company\u2019s earnings \u2014 pin Net Profit to check the level and trend' },
      { key: 'Reserves', section: 'balanceSheet', reason: 'for a cyclical, reserves (the accumulated retained earnings) are a steadier comparison than the earnings multiple \u2014 book value moves less with the cycle than profit does' },
    ];
  }
  return list;
}

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
    // No dividend, nothing to fund. Without this a 0% payout still "fired"
    // whenever average CFO was negative (0 > −432 for PAYTM FY26), telling
    // the reader a company that paid nothing had sold assets to pay it.
    if (payoutT <= 0) { out.push({ year, status: 'clear' }); continue; }
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

// The dividend was bigger than the cash left after capex (FCF), and
// borrowings rose the same year — the gap was, in effect, borrowed.
// DIVIDEND_NOT_FROM_OPS above only catches the asset-sale route (CFI > 0);
// the debt route is the more common one and it missed it entirely: VEDL
// paid out 357%, 259% and 113% of profit in FY23–FY25 while borrowings went
// from Rs 53,583 Cr to Rs 91,479 Cr. The dividend is estimated as payout% ×
// Net Profit (screener's payout is dividend ÷ profit, so this inverts it,
// including in a loss year where both are negative). Materiality is only
// the part of the dividend FCF didn't cover — never more than the dividend
// itself — so a capex-heavy year with negative FCF and a small dividend
// doesn't outrank a genuinely debt-funded payout.
function ruleDividendExceedsFcf(bundle) {
  const byYear = (section, label) => new Map(fySeries(section, label).map((p) => [p.year, p.value]));
  const payout = fySeries(bundle.profitLoss, 'Dividend Payout %');
  const np = byYear(bundle.profitLoss, 'Net Profit');
  const fcf = byYear(bundle.cashFlow, 'Free Cash Flow');
  const borrowRaw = fySeries(bundle.balanceSheet, 'Borrowings');
  const borrowSeries = borrowRaw.length ? borrowRaw : fySeries(bundle.balanceSheet, 'Borrowing');
  const out = [];
  if (!payout.length || !borrowSeries.length) return out;
  for (let i = 1; i < borrowSeries.length; i++) {
    const year = borrowSeries[i].year;
    const bT = borrowSeries[i].value, bT1 = borrowSeries[i - 1].value;
    const payoutRow = payout.find((p) => p.year === year);
    const payoutT = payoutRow ? payoutRow.value : null;
    const npT = np.get(year), fcfT = fcf.get(year);
    if (bT == null || bT1 == null || payoutT == null || npT == null || fcfT == null) {
      out.push({ year, status: 'not_applicable', reason: 'missing an input for this year' });
      continue;
    }
    const dividend = (payoutT / 100) * npT;
    if (!(dividend > 0)) { out.push({ year, status: 'clear' }); continue; } // no dividend paid
    const uncovered = dividend - Math.max(fcfT, 0);
    const borrowRise = bT - bT1;
    const fired = dividend > fcfT && borrowRise > MATERIALITY_FLOOR;
    out.push({
      year, status: fired ? 'fired' : 'clear',
      message: fired ? 'The dividend was larger than the cash left after investment, and borrowings rose — part of the payout was effectively funded with debt.' : null,
      detail: fired ? `FY${year} — estimated dividend Rs ${Math.round(dividend).toLocaleString('en-IN')} Cr (${payoutT.toFixed(0)}% of profit) against free cash flow of Rs ${Math.round(fcfT).toLocaleString('en-IN')} Cr, while borrowings rose Rs ${Math.round(borrowRise).toLocaleString('en-IN')} Cr.` : null,
      materiality: fired ? Math.min(dividend, uncovered) : null,
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

// Inventory Days rising the same way Debtor Days does in DEBTOR_BALLOON —
// same three-condition shape (relative change, absolute floor, absolute
// delta) for the same reason: unsold stock piling up is only worth flagging
// once it's deteriorated *from* a level that already mattered.
function ruleInventoryBuild(bundle) {
  const idays = fySeries(bundle.ratios, 'Inventory Days');
  const salesRaw = fySeries(bundle.profitLoss, 'Sales');
  const sales = salesRaw.length ? salesRaw : fySeries(bundle.profitLoss, 'Revenue');
  const out = [];
  if (!idays.length) return out; // not every business carries inventory (services, some financials) -- silently not applicable
  for (let i = 3; i < idays.length; i++) {
    const year = idays[i].year;
    const t = idays[i].value, t3 = idays[i - 3].value;
    if (t == null || t3 == null || t3 <= 0) { out.push({ year, status: 'not_applicable', reason: 'missing inventory-days data' }); continue; }
    const ratio = t / t3;
    const delta = t - t3;
    const fired = ratio > 1.30 && t > 60 && delta > 15;
    const salesT = sales[i] && sales[i].value;
    const impliedRupees = fired && salesT != null ? (delta / 365) * salesT : null;
    out.push({
      year, status: fired ? 'fired' : 'clear',
      message: fired ? 'Inventory is piling up much faster than it was three years ago — unsold stock ties up cash and risks write-downs.' : null,
      detail: fired ? `FY${year} — inventory days rose from ${Math.round(t3)} to ${Math.round(t)} (+${Math.round(delta)} days) over 3 years.` : null,
      materiality: fired ? (impliedRupees != null ? impliedRupees : delta) : null,
    });
  }
  return out;
}

// EBIT = Profit before tax + Interest, per fiscal year, as a year-keyed
// Map. Interest cover is EBIT ÷ interest, not screener's "Operating
// Profit" (which is EBITDA — before depreciation): on EBITDA a
// depreciation-heavy business looks better covered than it is, since
// plant has to be replaced out of the same earnings.
function ebitByYear(profitLoss) {
  const interest = new Map(fySeries(profitLoss, 'Interest').map((p) => [p.year, p.value]));
  return new Map(fySeries(profitLoss, 'Profit before tax').map((p) => {
    const i = interest.get(p.year);
    return [p.year, (p.value != null && i != null) ? p.value + i : null];
  }));
}

// EBIT thinly covering interest -- a company whose interest cover has
// fallen below a safety margin is one bad year away from difficulty
// servicing debt. Borrowings = 0 is not_applicable, not clear: there is
// nothing to cover, so the check has no meaning that year (the same
// treatment condition 5 of the Compounding Checklist gives it). An
// operating LOSS gets its own message: a cover of "−88.6x" (PAYTM FY25)
// isn't a thin cover, it's no cover, and a negative multiple printed next
// to "thinly" reads as a small positive problem.
function ruleInterestCoverThin(bundle) {
  const pbt = fySeries(bundle.profitLoss, 'Profit before tax');
  const interest = new Map(fySeries(bundle.profitLoss, 'Interest').map((p) => [p.year, p.value]));
  const ebit = ebitByYear(bundle.profitLoss);
  const borrowRaw = fySeries(bundle.balanceSheet, 'Borrowings');
  const borrow = new Map((borrowRaw.length ? borrowRaw : fySeries(bundle.balanceSheet, 'Borrowing')).map((p) => [p.year, p.value]));
  const out = [];
  pbt.forEach(({ year }) => {
    const ebitT = ebit.get(year), intT = interest.get(year);
    const borrowT = borrow.get(year);
    if (borrowT === 0) { out.push({ year, status: 'not_applicable', reason: 'no borrowings this year — interest cover is moot' }); return; }
    if (ebitT == null || intT == null || intT < MATERIALITY_FLOOR) { out.push({ year, status: 'not_applicable', reason: 'missing an input, or interest expense too small to divide by' }); return; }
    const cover = ebitT / intT;
    const loss = ebitT <= 0;
    const fired = loss || cover < 3;
    out.push({
      year, status: fired ? 'fired' : 'clear',
      message: !fired ? null : loss
        ? 'The business made a loss before interest this year — there was no operating profit at all to pay interest from.'
        : 'Profit before interest and tax is covering interest only thinly this year — a dip in profit could make interest payments difficult.',
      detail: !fired ? null : loss
        ? `FY${year} — profit before interest and tax was Rs ${Math.round(ebitT).toLocaleString('en-IN')} Cr, against interest of Rs ${Math.round(intT).toLocaleString('en-IN')} Cr.`
        : `FY${year} — interest cover was ${cover.toFixed(1)}x: profit before interest and tax Rs ${Math.round(ebitT).toLocaleString('en-IN')} Cr against interest of Rs ${Math.round(intT).toLocaleString('en-IN')} Cr.`,
      materiality: fired ? intT : null,
    });
  });
  return out;
}

// Borrowings rising while ROCE falls -- new debt that isn't yet earning
// its keep. Both legs must move: rising debt alone funds healthy growth
// all the time, and falling ROCE alone can just mean a cyclical trough.
function ruleLeverageUpReturnsDown(bundle) {
  const borrowRaw = fySeries(bundle.balanceSheet, 'Borrowings');
  const borrow = borrowRaw.length ? borrowRaw : fySeries(bundle.balanceSheet, 'Borrowing');
  const roce = fySeries(bundle.ratios, 'ROCE %');
  const out = [];
  if (!borrow.length || !roce.length) return out;
  for (let i = 1; i < borrow.length; i++) {
    const year = borrow[i].year;
    const borrowGrowth = pctChange(borrow[i - 1].value, borrow[i].value, MATERIALITY_FLOOR);
    const roceT = roce[i] && roce[i].value, roceT1 = roce[i - 1] && roce[i - 1].value;
    if (borrowGrowth == null || roceT == null || roceT1 == null) { out.push({ year, status: 'not_applicable', reason: 'missing an input, or the prior-year borrowings base is not comparable' }); continue; }
    const roceDelta = roceT - roceT1;
    const fired = borrowGrowth > 0.15 && roceDelta < -2;
    out.push({
      year, status: fired ? 'fired' : 'clear',
      message: fired ? 'Borrowings grew while return on capital fell — the new debt does not yet appear to be earning its keep.' : null,
      detail: fired ? `FY${year} — borrowings rose ${(borrowGrowth * 100).toFixed(0)}% while ROCE fell from ${roceT1.toFixed(1)}% to ${roceT.toFixed(1)}%.` : null,
      materiality: fired ? Math.abs(borrow[i].value - borrow[i - 1].value) : null,
    });
  }
  return out;
}

// CWIP that hasn't shrunk in three years and is still a material slice of
// fixed assets -- capital tied up in a project that isn't converting into
// productive, revenue-generating assets. A completed project capitalises
// out of CWIP into Fixed Assets, so CWIP staying flat or rising is the
// signal, not CWIP being large in isolation (some capital-intensive
// businesses always carry a sizeable CWIP balance mid-expansion).
// "Stayed" is a band, not a floor: ratio >= 0.90 alone also fired on CWIP
// that had multiplied (Hindalco FY26: Rs 49,526 Cr against Rs 7,700 Cr —
// a capex programme ramping up, reported as "little changed"). And a flat
// CWIP balance next to fast-growing fixed assets is a rolling programme
// whose projects ARE completing and being replaced, so the rule also needs
// fixed assets to have barely moved over the same three years.
function ruleCwipFrozen(bundle) {
  const cwip = fySeries(bundle.balanceSheet, 'CWIP');
  const fixedAssets = fySeries(bundle.balanceSheet, 'Fixed Assets');
  const out = [];
  if (!cwip.length) return out;
  for (let i = 3; i < cwip.length; i++) {
    const year = cwip[i].year;
    const t = cwip[i].value, t3 = cwip[i - 3].value;
    const faT = fixedAssets[i] && fixedAssets[i].value;
    const faT3 = fixedAssets[i - 3] && fixedAssets[i - 3].value;
    if (t == null || t3 == null || t3 < MATERIALITY_FLOOR || faT == null || faT <= 0 || faT3 == null || faT3 <= 0) { out.push({ year, status: 'not_applicable', reason: 'missing CWIP or fixed-assets data, or CWIP was negligible three years ago' }); continue; }
    const ratio = t / t3;
    const share = t / faT;
    const faGrowth = faT / faT3 - 1;
    const fired = ratio >= 0.90 && ratio <= 1.30 && faGrowth < 0.10 && share > 0.10;
    out.push({
      year, status: fired ? 'fired' : 'clear',
      message: fired ? 'A large share of capital has stayed tied up in unfinished projects for years without converting into productive assets.' : null,
      detail: fired ? `FY${year} — capital work in progress was Rs ${Math.round(t)} Cr against Rs ${Math.round(t3)} Cr three years earlier (${ratio >= 1 ? '+' : '−'}${Math.abs((ratio - 1) * 100).toFixed(0)}%), ${(share * 100).toFixed(0)}% of fixed assets, while fixed assets themselves grew only ${(faGrowth * 100).toFixed(0)}%.` : null,
      materiality: fired ? t : null,
    });
  }
  return out;
}

// Fixed assets growing much faster than sales over three years -- recent
// capital spending that hasn't (yet) shown up as revenue. Silent on
// whether it ever will; the honest claim is only that it hasn't yet.
function ruleCapexNoRevenue(bundle) {
  const fixedAssets = fySeries(bundle.balanceSheet, 'Fixed Assets');
  const salesRaw = fySeries(bundle.profitLoss, 'Sales');
  const sales = salesRaw.length ? salesRaw : fySeries(bundle.profitLoss, 'Revenue');
  const out = [];
  if (!fixedAssets.length || !sales.length) return out;
  for (let i = 3; i < fixedAssets.length; i++) {
    const year = fixedAssets[i].year;
    const faGrowth = pctChange(fixedAssets[i - 3].value, fixedAssets[i].value, MATERIALITY_FLOOR);
    const salesGrowth = pctChange(sales[i - 3] && sales[i - 3].value, sales[i] && sales[i].value, MATERIALITY_FLOOR);
    if (faGrowth == null || salesGrowth == null) { out.push({ year, status: 'not_applicable', reason: 'missing an input, or a 3-year-ago base is not comparable' }); continue; }
    const fired = faGrowth > 0.30 && salesGrowth < 0.05;
    out.push({
      year, status: fired ? 'fired' : 'clear',
      message: fired ? 'Fixed assets have grown much faster than sales over three years — recent capital spending has not yet shown up as revenue.' : null,
      detail: fired ? `FY${year - 3}–FY${year} — fixed assets grew ${(faGrowth * 100).toFixed(0)}% while sales grew ${(salesGrowth * 100).toFixed(0)}%.` : null,
      materiality: fired ? Math.abs(fixedAssets[i].value - fixedAssets[i - 3].value) : null,
    });
  }
  return out;
}

// Cash-conversion rules assume operating cash flow tracks the operating
// business. For a lender, deploying capital into loans *is* the business,
// so CFO is routinely and healthily negative — these rules have no meaning
// in that domain and must not be evaluated at all, not evaluated-and-clear.
// Same reasoning extends to inventory, interest cover, leverage, CWIP and
// capex-vs-revenue: a bank's balance sheet doesn't separate these the same
// way a manufacturer's does (see compareRefusal's SCHEMA_MISMATCH note).
const DIVERGENCE_RULES = [
  { id: 'DIVIDEND_NOT_FROM_OPS', run: ruleDividendNotFromOps, validSchemas: ['nonfinancial'] },
  // A lender's FCF is CFO net of loan growth — negative by design — and its
  // borrowings are raw material, so "dividend above FCF while debt rose" is
  // every healthy bank every year.
  { id: 'DIVIDEND_EXCEEDS_FCF', run: ruleDividendExceedsFcf, validSchemas: ['nonfinancial'] },
  { id: 'CFO_DIVERGENCE', run: ruleCfoDivergence, validSchemas: ['nonfinancial'] },
  { id: 'DEBTOR_BALLOON', run: ruleDebtorBalloon, validSchemas: ['nonfinancial'] },
  { id: 'ASSET_SALE_GAIN', run: ruleAssetSaleGain, validSchemas: ['nonfinancial'] },
  { id: 'TAX_DRIVEN_MARGIN', run: ruleTaxDrivenMargin, validSchemas: ['nonfinancial', 'financial'] },
  { id: 'INVENTORY_BUILD', run: ruleInventoryBuild, validSchemas: ['nonfinancial'] },
  { id: 'INTEREST_COVER_THIN', run: ruleInterestCoverThin, validSchemas: ['nonfinancial'] },
  { id: 'LEVERAGE_UP_RETURNS_DOWN', run: ruleLeverageUpReturnsDown, validSchemas: ['nonfinancial'] },
  { id: 'CWIP_FROZEN', run: ruleCwipFrozen, validSchemas: ['nonfinancial'] },
  { id: 'CAPEX_NO_REVENUE', run: ruleCapexNoRevenue, validSchemas: ['nonfinancial'] },
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
// Not assessed for a lender: its "Financing Margin %" swings on provisioning
// and on how screener splits income between Revenue and Other Income
// (HDFCBANK: +18% to −16% across its merger while profit kept rising), so
// the margin-range test called HDFCBANK cyclical on accounting, not on a
// business cycle. Returns cyclical:false with applicable:false so a caller
// can say "not assessed" rather than "not cyclical" if it wants to.
function detectCyclical(profitLoss, schema) {
  if ((schema || classifySchema(profitLoss)) === 'financial') {
    return { cyclical: false, applicable: false, reason: 'Cyclicality is judged from sales and operating margin, which a lender does not report.' };
  }
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
        rules: group.map((g) => g.ruleId),
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

  const cyclical = detectCyclical(bundle.profitLoss, schema);

  return {
    checksRun: notApplicable + clear + fired,
    notApplicable, clear, fired,
    flags: collapsed.slice(0, 3),
    flagsTotal: collapsed.length,
    allFlags: collapsed, // every visible-eligible flag, ranked; checklistQualityGate reads this
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
  // Each series prints its ACTUAL latest value (in the row's own unit)
  // above its last bar — even when the bars are indexed, since "245" on an
  // index is a shape, while "₹2.67L Cr" is the fact a reader came for.
  // Only the last bar: labels on every year of up to eight series would be
  // unreadable, and the table under the chart already has every cell.
  const endLabel = (points, color, rowLabel) => {
    const byYear = new Map(points.map((s) => [s.year, s.value]));
    const lastYear = [...allYears].reverse().find((y) => byYear.get(y) != null);
    const lastIdx = lastYear == null ? -1 : allYears.indexOf(lastYear);
    const raw = lastYear == null ? null : byYear.get(lastYear);
    return {
      label: { show: lastIdx >= 0, position: 'outside', distance: 4, fontSize: 10, fontWeight: 600, color,
        formatter: (p) => (p.dataIndex === lastIdx ? formatRowValueCompact(rowLabel, raw) : '') },
      labelLayout: { hideOverlap: true },
    };
  };
  const series = [];
  pins.forEach((pin, i) => {
    const style = SERIES_PALETTE[i % SERIES_PALETTE.length];
    series.push(Object.assign({
      name: pin.label, type: 'bar', data: seriesFor(pin.series, indexBase(pin.series)),
      itemStyle: { color: style.color },
    }, endLabel(pin.series, style.color, pin.label)));
    if (pin.compareSeries && pin.compareSeries.length) {
      series.push(Object.assign({
        name: (pin.compareLabel || 'Compare') + ' — ' + pin.label, type: 'bar',
        data: seriesFor(pin.compareSeries, indexBase(pin.compareSeries)),
        itemStyle: { color: style.color, opacity: 0.45 },
      }, endLabel(pin.compareSeries, style.color, pin.label)));
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

// Fixed, deterministic one-line reasons shown in the tooltip alongside each
// series' value -- arithmetic and a template, never a model, so the tooltip
// says the same thing on every hover and every refresh, same discipline as
// the reading column and the divergence-rule messages. Kept to one short,
// why-it-matters clause each rather than a formula -- a longer tooltip is a
// bigger box, and a bigger box covers more of the very chart it's meant to
// explain.
const PROFIT_CASH_TOOLTIP_REASONS = {
  'Net Profit': "The company's reported profit — not the same as cash actually collected.",
  'Cash from Operations': 'The cash that actually came in — the real-world check on that profit number.',
  'Cumulative CFO / NP': 'Whether reported profit has shown up as real cash over time — 1.00 means all of it has.',
};

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
  const yearLabels = years.map((y) => 'FY' + String(y).slice(2));
  // The ratio line sits flat near 1.0 for a healthy company -- with min:0
  // and no explicit max, ECharts auto-ranged to roughly the data's own span,
  // which ran the line along the very top edge of its grid and clipped the
  // 1.0 reference line against the axis boundary. Give it real headroom.
  const validRatios = cumRatio.filter((v) => v != null);
  const maxRatio = validRatios.length ? Math.max(...validRatios, 1) : 1;
  // Capped at 4x: early cumulative profit near zero makes the running ratio
  // explode (VEDL FY20: 159x), and scaling the axis to that one spike
  // flattened every other year onto the zero line. Anything above the cap
  // is clipped at the top edge ("4+" tick); the tooltip keeps the real value.
  const RATIO_CAP = 4;
  const ratioMax = maxRatio * 1.2 > RATIO_CAP ? RATIO_CAP : Math.ceil(maxRatio * 1.2 * 10) / 10;
  return {
    color: [A.color, B.color, C.color],
    legend: { show: false },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      // Keeps the tooltip box inside the chart's own container instead of
      // free-floating over whichever part of the page has room -- combined
      // with the short, one-clause reasons above, this stops the box from
      // swallowing half the chart it's supposed to be explaining.
      confine: true,
      formatter: (params) => {
        if (!params || !params.length) return '';
        const rows = params.map((p) => {
          const isRatio = p.seriesName === 'Cumulative CFO / NP';
          const valText = p.value == null ? '—'
            : isRatio ? Number(p.value).toFixed(2)
              : 'Rs ' + Math.round(p.value).toLocaleString('en-IN') + ' Cr';
          const reason = PROFIT_CASH_TOOLTIP_REASONS[p.seriesName];
          return '<div style="margin-top:5px"><b style="color:' + p.color + '">' + p.seriesName + '</b>: ' + valText
            + (reason ? '<div style="color:#8a97a8;font-size:11px;margin-top:2px;max-width:230px;white-space:normal">' + reason + '</div>' : '')
            + '</div>';
        }).join('');
        return '<div style="font-weight:600">' + params[0].axisValueLabel + '</div>' + rows;
      },
    },
    // Grid0's own x-axis labels are hidden -- grid1 shares the identical
    // category list directly underneath (linked via axisPointer), so
    // showing both was pure duplication and ate the vertical space the
    // axis names needed, which is what was driving the label collisions.
    grid: [
      { left: 56, right: 80, top: 20, height: '48%', containLabel: true },
      { left: 56, right: 80, top: '70%', bottom: 30, height: '22%', containLabel: true },
    ],
    xAxis: [
      { type: 'category', gridIndex: 0, data: yearLabels, axisLabel: { show: false }, axisTick: { show: false } },
      { type: 'category', gridIndex: 1, data: yearLabels },
    ],
    // No axis `name` on either grid -- with two stacked grids this close
    // together, ECharts computes each one's label-reservation space
    // independently, blind to its neighbour, so a name reliably ends up
    // overlapping the OTHER grid's tick labels (confirmed live: "CFO/NP"
    // landing directly on top of the "0" tick). The chart's own title and
    // the caption line below it already say what's being measured and in
    // what unit, so the axis name was decoration, not information.
    yAxis: [
      { type: 'value', gridIndex: 0 },
      // splitNumber:3 -- grid1 is only ~22% of a 360px container (roughly
      // 80px). ECharts' default auto-ticking on a 0..ratioMax range packed
      // in 6-7 tick labels there, each ~12px tall in an ~11px pitch, so
      // consecutive labels ("0.2"/"0.4"/etc) overlapped each other by a
      // pixel or two. Capping the tick count gives each label real room.
      { type: 'value', gridIndex: 1, min: 0, max: ratioMax, splitNumber: 3, axisLabel: { formatter: (v) => (ratioMax === RATIO_CAP && v >= RATIO_CAP ? RATIO_CAP + '+' : String(v)) } },
    ],
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    series: [
      {
        // Labelled inside the bar (not floating above it) so it can never
        // collide with the Cash-from-Operations line's end label -- the two
        // series often converge near the last year, which is exactly the
        // point the chart is making, and exactly where two "above the data"
        // labels would otherwise glue together into unreadable text. Kept to
        // a short tag, not the full series name -- the full name is already
        // in the chart title, the tooltip and the caption below, and a
        // ~90px-wide bar can't reliably fit "Net Profit" without it
        // spilling into the neighbouring column.
        // The tag carries the latest value on a second line so the number
        // is readable without hovering; two short lines fit a bar's width
        // where one long "NP 49.5k" line would not.
        name: 'Net Profit', type: 'bar', xAxisIndex: 0, yAxisIndex: 0, itemStyle: { color: A.color },
        data: npData.map((v, i) => (i === lastIdx
          ? { value: v, label: { show: true, position: 'insideTop', distance: 6, color: '#fff', fontWeight: 600, fontSize: 10, lineHeight: 12, formatter: () => 'NP\n' + formatCroreCompact(v) } }
          : v)),
      },
      {
        // Same reasoning as Net Profit's tag above -- "Cash from Operations"
        // at 21 characters needs more right-margin than a narrower browser
        // window leaves this chart, and reliably ran off the visible edge.
        // The value goes on a second line for the same width reason.
        name: 'Cash from Operations', type: 'line', xAxisIndex: 0, yAxisIndex: 0,
        lineStyle: { color: B.color, type: B.lineStyle.type }, itemStyle: { color: B.color }, symbol: B.symbol,
        data: cfoSeries.map((p) => p && p.value),
        endLabel: { show: true, formatter: (p) => 'CFO\n' + formatCroreCompact(Array.isArray(p.value) ? p.value[1] : p.value), color: B.color, fontWeight: 600, lineHeight: 13 },
      },
      {
        name: 'Cumulative CFO / NP', type: 'line', xAxisIndex: 1, yAxisIndex: 1,
        lineStyle: { color: C.color, type: C.lineStyle.type }, itemStyle: { color: C.color }, symbol: C.symbol,
        data: cumRatio,
        // A markPoint on the last real value, not endLabel: this series
        // starts with nulls whenever early cumulative profit is <= 0 (VEDL,
        // PAYTM), and ECharts' endLabel then computes its position from a
        // null point -- SVG "translate(x NaN)" console errors and a label
        // that never appears.
        markPoint: (() => {
          let li = -1; cumRatio.forEach((v, i) => { if (v != null) li = i; });
          return {
            symbol: 'circle', symbolSize: 1, silent: true,
            label: { show: true, position: 'right', distance: 6, formatter: () => 'CFO/NP\n' + Number(cumRatio[li]).toFixed(2), color: C.color, fontWeight: 600, lineHeight: 13 },
            data: li >= 0 ? [{ coord: [li, cumRatio[li]] }] : [],
          };
        })(),
        // A dashed line at y=1, unlabelled -- the axis' own "1" tick already
        // names this value. An inline text label here (tried at two
        // different position keywords) kept rendering at the plot's left
        // edge regardless of the keyword, landing on top of the ratio
        // axis' own tick labels; the axis tick is the reliable annotation.
        // label.show:false is explicit because a markLine labels itself by
        // default: it printed "1" at the line's RIGHT end, which is exactly
        // where the CFO/NP end label sits whenever the ratio is near 1.0 --
        // the collision that looked like the label hitting the "1" tick.
        markLine: {
          symbol: 'none', data: [{ yAxis: 1 }], silent: true,
          label: { show: false },
          lineStyle: { color: 'rgba(20,40,63,.5)', type: 'dashed', width: 1.5 },
        },
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
    quarterly: ['Sales', 'Expenses', 'Operating Profit', 'OPM %', 'Other Income', 'Interest', 'Depreciation', 'Profit before tax', 'Tax %', 'Net Profit', 'EPS in Rs'],
    shareholding: ['Promoters', 'FIIs', 'DIIs', 'Government', 'Public'],
  },
  financial: {
    profitLoss: ['Revenue', 'Interest', 'Expenses', 'Financing Profit', 'Financing Margin %', 'Other Income', 'Depreciation', 'Profit before tax', 'Tax %', 'Net Profit', 'EPS in Rs', 'Dividend Payout %'],
    balanceSheet: ['Equity Capital', 'Reserves', 'Deposits', 'Borrowing', 'Other Liabilities', 'Total Liabilities', 'Fixed Assets', 'CWIP', 'Investments', 'Other Assets', 'Total Assets'],
    cashFlow: ['Cash from Operating Activity', 'Cash from Investing Activity', 'Cash from Financing Activity', 'Net Cash Flow', 'Free Cash Flow', 'CFO/OP'],
    ratios: ['ROE %'],
    quarterly: ['Revenue', 'Interest', 'Expenses', 'Financing Profit', 'Financing Margin %', 'Other Income', 'Depreciation', 'Profit before tax', 'Tax %', 'Net Profit', 'EPS in Rs'],
    shareholding: ['Promoters', 'FIIs', 'DIIs', 'Government', 'Public'],
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
  // Screener prints this row as a percentage ("93%") and the parser keeps
  // the number as 93, so 'ratio' rendered it "93.00x".
  'CFO/OP': 'pct',
  'Promoters': 'pct', 'FIIs': 'pct', 'DIIs': 'pct', 'Government': 'pct', 'Public': 'pct', 'Pledged %': 'pct',
};
function rowUnit(label) { return ROW_UNIT[label] || 'cr'; }

// The per-table box score: best year, worst year, and the CAGR across the
// row's own reported span. CAGR is refused (null) across a sign flip or a
// non-positive base for the same reason pctChange refuses one — a single
// two-endpoint CAGR fitted across a loss year asserts a rate that isn't real.
//
// Pass the row's label to make it polarity- and unit-aware (without one it
// keeps the original label-blind behaviour, best = highest):
//  - lower-better rows (Debtor Days…) swap best/worst — TCS Debtor Days
//    printed "BEST 93d" for its slowest-collecting year;
//  - neutral rows set directional:false, so a caller prints HIGH/LOW
//    rather than claiming a direction the row doesn't support;
//  - %, day-count and x rows get no CAGR (cagrRefusal:'unit') — a
//    "1.5% CAGR" of debtor days or of a margin is compounding something
//    that doesn't compound — and instead carry the plain end-to-end
//    `change` in `changeUnit` ('pp', 'days' or 'x').
// `high`/`low` are always the raw extremes whatever the polarity.
// `years` is the fiscal-year span (last.year − first.year), not the point
// count: PAYTM reports no FY2017/18, so FY15–FY26 is 11 years, not 9.
const CHANGE_UNIT = { pct: 'pp', days: 'days', ratio: 'x' };
function rowBoxScore(series, label) {
  const clean = series.filter((p) => p.value != null);
  if (clean.length < 2) return null;
  const high = clean.reduce((a, b) => (b.value > a.value ? b : a));
  const low = clean.reduce((a, b) => (b.value < a.value ? b : a));
  const polarity = label ? rowPolarity(label) : null;
  const unit = label ? rowUnit(label) : null;
  const lowerBetter = polarity === 'lower-better';
  const first = clean[0], last = clean[clean.length - 1];
  const years = last.year - first.year;
  const changeUnit = unit ? (CHANGE_UNIT[unit] || null) : null;
  let cagr = null, cagrRefusal = null;
  if (changeUnit) {
    cagrRefusal = 'unit';
  } else if (years > 0 && first.value > 0 && (last.value > 0)) {
    cagr = Math.pow(last.value / first.value, 1 / years) - 1;
  } else {
    cagrRefusal = 'non-positive-base'; // a loss year or a zero start (PAYTM Borrowings FY15 = 0)
  }
  return {
    best: lowerBetter ? low : high, worst: lowerBetter ? high : low,
    cagr, years, windowStart: first.year, windowEnd: last.year,
    high, low, polarity, unit,
    directional: polarity == null ? null : polarity !== 'neutral',
    cagrRefusal,
    change: changeUnit ? last.value - first.value : null,
    changeUnit,
  };
}

/* =====================================================================
   PHASE 2 — DEEPER DERIVED METRICS
   Screener's condensed statements don't report these directly; this
   implementation computes them from rows that ARE reported, using
   standard equity-analysis formulas rather than a external specification.
   Each function documents the formula and any approximation it makes, and
   follows the same refusal discipline as the five divergence rules: null
   on a sign flip, a missing input, or a division too close to zero to be
   meaningful -- never a fabricated number.
   ===================================================================== */

// Overlapping-window CAGR (10y/5y/3y/1y are separate windows anchored to
// the latest year, not sequential periods -- a company that grew 40% in
// year 1 and 2% a year since has a very different 1y and 5y number, and
// showing both is the point).
// The start point is the fiscal year exactly `years` before the latest one,
// found by year: counting back N points instead would silently stretch the
// window across a gap in the reported history (PAYTM has no FY2017/18, so
// "5 points back" from FY2026 is FY2019 over 7 years, still divided as 5).
// A missing start year refuses rather than borrowing a neighbour.
function windowCagr(series, years) {
  const clean = series.filter((p) => p.value != null);
  if (clean.length < 2) return null;
  const last = clean[clean.length - 1];
  const start = clean.find((p) => p.year === last.year - years);
  if (!start) return null;
  if (start.value <= 0 || last.value <= 0) return null;
  return Math.pow(last.value / start.value, 1 / years) - 1;
}
function growthSummary(series) {
  return { y10: windowCagr(series, 10), y5: windowCagr(series, 5), y3: windowCagr(series, 3), y1: windowCagr(series, 1) };
}

// Bonus-issue multiples as (a+b)/b for an a:b bonus -- 1:2, 1:1, 3:2, 2:1,
// 3:1, 4:1, 5:1, 9:1, 10:1. Detected factors snap to these so a 1-2% wobble
// in the EPS witness below doesn't leave every adjusted year 1.3% off.
const BONUS_MULTIPLES = [1.5, 2, 2.5, 3, 4, 5, 6, 10, 11];

// Per-year bonus factor that restates an older year's share count in
// today's units. A bonus issue is capitalised out of reserves at face
// value, so Equity Capital jumps (TCS FY19 ×2, BAJFINANCE FY26 ×5) exactly
// as it would for a real issue of new shares -- capital alone can't tell
// the two apart, which is how "Dilution +418%" got onto BAJFINANCE.
// Screener's EPS row IS restated for bonuses and splits, so Net Profit ÷
// EPS gives an implied share count that doesn't jump on a bonus but does
// jump on a real issue (HDFCBANK's FY24 merger: capital ×1.36, implied ×1.39).
// That implied count is only a WITNESS here, never the share count itself:
// it's unusable as a level because consolidated Net Profit includes
// minority interest while EPS is on the owners' share (VEDL's implied count
// swings 265–661 crore on a flat 372 crore shares), and screener leaves
// pre-listing EPS unrestated (PAYTM FY15–FY21 imply ~6 crore shares, not
// 60). So a transition counts as a bonus only when capital jumped at least
// 1.4× AND the implied count stayed within 0.8–1.25× — a real issue moves
// both, a bonus moves only capital. Smaller bonuses (1:3, 1:4) sit below
// the 1.4× gate on purpose: VEDL's 1.25× Cairn merger would otherwise pass
// as a 1:4 bonus, and misreading real dilution as none is the worse error.
function bonusFactorsByYear(balanceSheet, profitLoss) {
  const capital = fySeries(balanceSheet, 'Equity Capital');
  const factors = new Map(capital.map((p) => [p.year, 1]));
  if (!profitLoss) return factors;
  const np = new Map(fySeries(profitLoss, 'Net Profit').map((p) => [p.year, p.value]));
  const eps = new Map(fySeries(profitLoss, 'EPS in Rs').map((p) => [p.year, p.value]));
  const impliedShares = (year) => {
    const n = np.get(year), e = eps.get(year);
    if (n == null || e == null || e === 0 || Math.abs(n) < MATERIALITY_FLOOR || (n < 0) !== (e < 0)) return null;
    return n / e;
  };
  const transitions = [];
  for (let i = 1; i < capital.length; i++) {
    const a = capital[i - 1], b = capital[i];
    if (a.value == null || b.value == null || a.value <= 0) continue;
    const capRatio = b.value / a.value;
    if (capRatio < 1.4) continue;
    const sa = impliedShares(a.year), sb = impliedShares(b.year);
    if (sa == null || sb == null) continue; // no witness -- read the jump as real issuance, not a guess
    const impliedRatio = sb / sa;
    if (impliedRatio < 0.8 || impliedRatio > 1.25) continue;
    const residual = capRatio / impliedRatio;
    const snap = BONUS_MULTIPLES.reduce((best, m) => (Math.abs(m - residual) < Math.abs(best - residual) ? m : best));
    transitions.push({ year: b.year, factor: Math.abs(snap - residual) / snap <= 0.05 ? snap : residual });
  }
  // Every year before a bonus is multiplied by that bonus (and every later one).
  capital.forEach((p) => {
    factors.set(p.year, transitions.filter((t) => t.year > p.year).reduce((acc, t) => acc * t.factor, 1));
  });
  return factors;
}

// Split- and bonus-adjusted share count, in today's share units. Dividing
// Equity Capital by *today's* face value handles a split (capital unchanged,
// face value halved); the bonus factor above handles a bonus (capital
// multiplied, face value unchanged). Pass profitLoss to get the bonus
// adjustment -- without it this is the split-only count, which reads every
// bonus issue as dilution. `bonusFactor` is carried per point so a caller
// can disclose that a year was restated.
function sharesSeries(balanceSheet, currentFaceValue, profitLoss) {
  const capital = fySeries(balanceSheet, 'Equity Capital');
  const bonus = bonusFactorsByYear(balanceSheet, profitLoss);
  return capital.map((p) => {
    const factor = bonus.get(p.year) || 1;
    return {
      year: p.year,
      value: (p.value != null && currentFaceValue > 0) ? (p.value * 1e7 * factor) / currentFaceValue : null,
      bonusFactor: factor,
    };
  });
}

// Net Profit / split-and-bonus-adjusted shares -- one consistent basis
// across every corporate action, matched by year (not index) to the share
// count. Note consolidated Net Profit includes minority interest, so for a
// group with large outside holdings (VEDL) this runs above screener's
// owners'-share EPS row; it's the same bias every year, so the series'
// shape (and a P/E band's percentile) is still internally consistent.
function epsFromShrink(profitLoss, balanceSheet, currentFaceValue) {
  const np = fySeries(profitLoss, 'Net Profit');
  const shares = new Map(sharesSeries(balanceSheet, currentFaceValue, profitLoss).map((p) => [p.year, p.value]));
  return np.map((p) => {
    const sh = shares.get(p.year);
    return { year: p.year, value: (p.value != null && sh) ? (p.value * 1e7) / sh : null };
  });
}

// Share-count growth over 5 years -- the "cost" of dilution, expressed the
// same way DILUTION_DRAG is defined in this implementation: how much more
// of the company today's shareholder owns a smaller slice of, purely from
// issuance, independent of whether the business itself grew. Pass
// profitLoss so a bonus issue isn't counted as issuance (see sharesSeries).
// The base is the year exactly five fiscal years earlier, looked up by
// year -- an index offset would silently stretch the window across a gap
// in the reported history (PAYTM has no FY2017/FY2018).
function dilutionDrag(balanceSheet, currentFaceValue, profitLoss) {
  const shares = sharesSeries(balanceSheet, currentFaceValue, profitLoss);
  const byYear = new Map(shares.map((p) => [p.year, p.value]));
  const out = [];
  shares.forEach((p) => {
    if (!byYear.has(p.year - 5)) return;
    const t = p.value, t5 = byYear.get(p.year - 5);
    out.push({ year: p.year, value: (t != null && t5 > 0) ? (t / t5 - 1) : null });
  });
  return out;
}

// Capital employed approximated as Equity Capital + Reserves + Borrowings
// -- the financing-side equivalent of "Total Assets minus current
// liabilities" that screener's condensed balance sheet supports, since it
// doesn't separate current from non-current within "Other Liabilities".
// Nonfinancial schema only; a lender's balance sheet doesn't support this
// distinction at all (see compareRefusal's SCHEMA_MISMATCH reasoning).
function capitalEmployedSeries(balanceSheet) {
  const eq = fySeries(balanceSheet, 'Equity Capital');
  const res = fySeries(balanceSheet, 'Reserves');
  const borRaw = fySeries(balanceSheet, 'Borrowings');
  const bor = borRaw.length ? borRaw : fySeries(balanceSheet, 'Borrowing');
  return eq.map((p, i) => {
    const r = res[i] && res[i].value, b = bor[i] && bor[i].value;
    const v = (p.value != null && r != null && b != null) ? p.value + r + b : null;
    return { year: p.year, value: v };
  });
}

// Incremental ROCE: change in EBIT (PBT + Interest) over change in capital
// employed, across a 3-year window (FY t-3 to FY t, found by year) -- the
// marginal return on the capital added recently, vs plain ROCE which is
// diluted by capital deployed decades ago.
// Refuses (value null, with a reason) whenever the ratio stops meaning
// "return on the capital added":
//  - capital employed grew less than 10%: a small denominator manufactures
//    an enormous ratio (Hindalco FY18 printed 3,760%, TCS's median was
//    169% because a buyback-heavy balance sheet barely grows);
//  - capital employed fell: a negative denominator flips the sign, so a
//    profit decline on shrinking capital reads as a positive return;
//  - EBIT not positive at either end: a move from a loss to a smaller loss
//    is not a return on anything (PAYTM "passed" at a 22% median).
// Screener's Operating Profit is EBITDA, which also flattered the
// numerator on capital-heavy businesses; EBIT is what ROCE itself uses.
const INC_ROCE_MIN_CE_GROWTH = 0.10;
function incrementalRoce(profitLoss, balanceSheet) {
  const ebit = ebitByYear(profitLoss);
  const ceSeries = capitalEmployedSeries(balanceSheet);
  const ce = new Map(ceSeries.map((p) => [p.year, p.value]));
  const out = [];
  ceSeries.forEach(({ year }) => {
    if (!ce.has(year - 3)) return;
    const e0 = ebit.get(year - 3), e1 = ebit.get(year);
    const c0 = ce.get(year - 3), c1 = ce.get(year);
    let value = null, reason = null;
    if (e0 == null || e1 == null || c0 == null || c1 == null || c0 <= 0) reason = 'missing an input';
    else if (e0 <= 0 || e1 <= 0) reason = 'EBIT was not positive at one end of the window';
    else if (c1 < c0) reason = 'capital employed fell over the window';
    else if ((c1 - c0) / c0 < INC_ROCE_MIN_CE_GROWTH) reason = 'capital employed grew less than 10% — too little new capital to measure a return on';
    else value = (e1 - e0) / (c1 - c0);
    out.push(reason ? { year, value, reason } : { year, value });
  });
  return out;
}

// Sales / Total Assets -- how much revenue each rupee of the balance sheet
// produces. Nonfinancial schema only (a lender's "assets" are loans made,
// not productive capacity, so the ratio means something different).
function assetTurnover(profitLoss, balanceSheet) {
  const salesRaw = fySeries(profitLoss, 'Sales');
  const sales = salesRaw.length ? salesRaw : fySeries(profitLoss, 'Revenue');
  const assets = fySeries(balanceSheet, 'Total Assets');
  return sales.map((p, i) => {
    const a = assets[i] && assets[i].value;
    return { year: p.year, value: (p.value != null && a > 0) ? p.value / a : null };
  });
}

// (Equity Capital + Reserves) / split-and-bonus-adjusted shares -- book
// value per share in today's share units, comparable across a split or a
// bonus the way screener's as-reported book-value figures are not. Without
// profitLoss, years before a bonus are overstated by the bonus multiple.
function bookValuePerShareSeries(balanceSheet, currentFaceValue, profitLoss) {
  const eq = fySeries(balanceSheet, 'Equity Capital');
  const res = fySeries(balanceSheet, 'Reserves');
  const shares = sharesSeries(balanceSheet, currentFaceValue, profitLoss);
  return eq.map((p, i) => {
    const r = res[i] && res[i].value, sh = shares[i] && shares[i].value;
    const v = (p.value != null && r != null && sh) ? ((p.value + r) * 1e7) / sh : null;
    return { year: p.year, value: v };
  });
}

// Current price / latest book value per share -- uses today's snapshot
// price (already fetched in topRatios) rather than a historical series,
// so it needs no new price-history plumbing.
function priceToBookLatest(currentPrice, bookValuePerShareSeriesResult) {
  const clean = bookValuePerShareSeriesResult.filter((p) => p.value != null);
  if (!clean.length || currentPrice == null) return null;
  const latest = clean[clean.length - 1].value;
  return latest > 0 ? currentPrice / latest : null;
}

// Stock Price CAGR(years) minus Profit Growth CAGR(years) -- how much of a
// share-price rise came from the market paying more, versus the company
// earning more. priceFySeries is one price point per fiscal year (see
// fyEndPriceSeries below); profitSeries is normally Net Profit.
function reratingSpread(priceFySeries, profitSeries, years) {
  const priceCagr = windowCagr(priceFySeries, years);
  const profitCagr = windowCagr(profitSeries, years);
  if (priceCagr == null || profitCagr == null) return null;
  return priceCagr - profitCagr;
}

// Picks one raw-close price per fiscal year (the last trading day on or
// before each fiscal year end) from a daily {date, close} series. The plan
// is explicit that P/E history must use Yahoo's raw `close`, never
// `adjclose` -- adjclose is dividend-backward-adjusted and manufactures a
// fake-cheap historical P/E for exactly the high-yield names where a
// beginner is most likely to be reaching for yield. This is a *different*
// series from the one /api/quote already returns for Test Real
// Investments (which deliberately prefers adjclose, for total-return CAGR
// -- see src/worker.js's fetchEquityHistory) -- callers must pass the
// dedicated raw-close series, not repurpose that one.
function fyEndPriceSeries(dailyRawCloseBars, fyYears, fyEndMonth) {
  const month = fyEndMonth || 3; // Indian fiscal year ends in March by default
  const sorted = [...dailyRawCloseBars].sort((a, b) => a.date < b.date ? -1 : 1);
  return fyYears.map((year) => {
    const cutoff = `${year}-${String(month).padStart(2, '0')}-31`;
    let best = null;
    for (const bar of sorted) {
      if (bar.date <= cutoff) best = bar; else break;
    }
    return { year, value: best ? best.close : null };
  });
}

// Where the current P/E sits within its own trailing 10-year band, as a
// percentile (0 = cheapest it's been, 100 = most expensive) -- "cheap vs
// its own history" is a different question from "cheap vs peers", and this
// is the former. peSeries is {year, value} built from fyEndPriceSeries and
// epsFromShrink (price / EPS, refusing on a loss year the same as every
// other ratio here).
function peHistoryBand(priceFySeries, epsSeries) {
  const pe = priceFySeries.map((p, i) => {
    const eps = epsSeries[i] && epsSeries[i].value;
    const value = (p.value != null && eps > 0) ? p.value / eps : null;
    return { year: p.year, value };
  });
  const clean = pe.filter((p) => p.value != null);
  if (clean.length < 2) return { series: pe, percentile: null, min: null, max: null, median: null, current: null };
  const values = clean.map((p) => p.value);
  const current = clean[clean.length - 1].value;
  const below = values.filter((v) => v <= current).length;
  return {
    series: pe,
    current,
    min: Math.min(...values),
    max: Math.max(...values),
    median: median(values),
    percentile: Math.round((below / values.length) * 100),
  };
}

/* =====================================================================
   PHASE 3 — THE COMPOUNDING CHECKLIST
   Ten conditions, each independently checkable, using the plan's exact
   formulas. This function never totals or ranks them -- it returns one
   entry per condition, in a fixed order, each carrying its own real
   computed value (never just a boolean) so the caller can render "Sales
   growth 3y: 7.4% -- below the 10% checkpoint" rather than a bare tick.
   Condition 8 (promoter holding + pledge trend) needs quarterly
   shareholding data this app does not scrape -- it reports
   available:false with a stated reason rather than a fabricated pass,
   fail, or a defaulted 0% pledge. `meets` is null whenever a condition
   isn't computable, and must never render as either a pass or a fail.
   ===================================================================== */
function yearsMeetingCount(series, lastN, predicate) {
  const clean = series.filter((p) => p.value != null);
  const window = clean.slice(-lastN);
  return { met: window.filter((p) => predicate(p.value)).length, of: window.length };
}

function compoundingChecklist(bundle, options) {
  options = options || {};
  const pl = bundle.profitLoss, bs = bundle.balanceSheet, cf = bundle.cashFlow, ratios = bundle.ratios;
  const faceValue = options.faceValue;
  const schema = bundle.schema || classifySchema(pl);
  const conditions = [];

  const roce = fySeries(ratios, 'ROCE %');
  if (roce.length) {
    const { met, of } = yearsMeetingCount(roce, 10, (v) => v >= 15);
    conditions.push({ id: 1, label: 'ROCE at least 15% in 8 of the last 10 years', value: `${met} of ${of} years >= 15%`, meets: of > 0 ? met >= 8 : null, available: of > 0 });
  } else {
    conditions.push({ id: 1, label: 'ROCE at least 15% in 8 of the last 10 years', value: 'ROCE % is not reported for this schema', meets: null, available: false });
  }

  // The window count is printed because incrementalRoce now refuses most
  // windows for a buyback-heavy or loss-making company — "−77.8%" from one
  // usable window (VEDL) is a much thinner claim than a median of nine.
  const incRoce = incrementalRoce(pl, bs);
  const incValues = incRoce.map((r) => r.value).filter((v) => v != null);
  const incMed = median(incValues);
  conditions.push({ id: 2, label: 'Median incremental ROCE (3-year rolling) at least 15%', value: incMed != null ? `${(incMed * 100).toFixed(1)}% (median of ${incValues.length} of ${incRoce.length} 3-year windows)` : (incRoce.length ? 'not computable — no 3-year window had positive EBIT at both ends and capital employed up at least 10%' : 'not computable'), meets: incMed != null ? incMed >= 0.15 : null, available: incMed != null });

  const salesRaw = fySeries(pl, 'Sales');
  const sales = salesRaw.length ? salesRaw : fySeries(pl, 'Revenue');
  const salesGrowth = growthSummary(sales);
  const cond3ok = (salesGrowth.y10 != null && salesGrowth.y3 != null) ? (salesGrowth.y10 >= 0.12 && salesGrowth.y3 >= 0.10) : null;
  conditions.push({ id: 3, label: 'Sales growth: 10-year at least 12% AND 3-year at least 10%', value: `10y ${salesGrowth.y10 != null ? (salesGrowth.y10 * 100).toFixed(1) + '%' : '—'}, 3y ${salesGrowth.y3 != null ? (salesGrowth.y3 * 100).toFixed(1) + '%' : '—'}`, meets: cond3ok, available: salesGrowth.y10 != null && salesGrowth.y3 != null });

  const cfo10 = fySeries(cf, 'Cash from Operating Activity').slice(-10);
  const np10 = fySeries(pl, 'Net Profit').slice(-10);
  let sumCfo = 0, sumNp = 0, cfoOk = np10.length > 0;
  for (let i = 0; i < np10.length; i++) {
    const c = cfo10[i] && cfo10[i].value, n = np10[i] && np10[i].value;
    if (c == null || n == null) { cfoOk = false; break; }
    sumCfo += c; sumNp += n;
  }
  const cfoRatio = (cfoOk && sumNp > 0) ? sumCfo / sumNp : null;
  const cond4Label = 'Cumulative cash from operations at least 75% of cumulative net profit (10 years)';
  if (schema === 'financial') {
    // Same reason CFO_DIVERGENCE is gated off for a lender: new loans are an
    // operating cash OUTFLOW, so a growing lender's CFO runs far below (or
    // under) profit by construction — BAJFINANCE scores −426% on this — and
    // a "Not met" would read as an earnings-quality finding it isn't.
    conditions.push({ id: 4, label: cond4Label, value: 'Not meaningful for a lender — lending money out is counted as operating cash outflow', meets: null, available: false });
  } else {
    conditions.push({ id: 4, label: cond4Label, value: cfoRatio != null ? `${(cfoRatio * 100).toFixed(0)}%` : 'not computable', meets: cfoRatio != null ? cfoRatio >= 0.75 : null, available: cfoRatio != null });
  }

  // Cover on EBIT (PBT + Interest), same as INTEREST_COVER_THIN and for the
  // same reason; a loss year prints as a loss, never as a negative multiple.
  // Lenders never reach the cover branch: interest is their cost of goods,
  // and screener gives them no Operating Profit to have ever computed it on.
  const interestMap = new Map(fySeries(pl, 'Interest').map((p) => [p.year, p.value]));
  const ebit = ebitByYear(pl);
  const borrowRaw = fySeries(bs, 'Borrowings');
  const borrow = borrowRaw.length ? borrowRaw : fySeries(bs, 'Borrowing');
  const latestBorrow = borrow.length ? borrow[borrow.length - 1].value : null;
  let cond5 = null, cond5Value = 'not computable';
  if (latestBorrow === 0) {
    cond5 = true; cond5Value = 'Borrowings are zero — interest cover is moot';
  } else if (schema !== 'financial') {
    const last5 = [...ebit.keys()].slice(-5);
    const covers = last5.map((y) => {
      const e = ebit.get(y), i = interestMap.get(y);
      if (e == null || i == null || i <= 0) return null;
      return e <= 0 ? { loss: true } : { cover: e / i };
    }).filter(Boolean);
    cond5 = covers.length === 5 ? covers.every((c) => !c.loss && c.cover > 6) : null;
    cond5Value = covers.length ? `Interest cover ${covers.map((c) => (c.loss ? 'loss' : c.cover.toFixed(1) + 'x')).join(', ')} (last ${covers.length} years)` : 'not computable';
  }
  conditions.push({ id: 5, label: 'Profit before interest and tax more than 6x interest every year for 5 years, or no borrowings', value: cond5Value, meets: cond5, available: cond5 !== null });

  const payout = fySeries(pl, 'Dividend Payout %');
  if (payout.length) {
    const { met, of } = yearsMeetingCount(payout, 10, (v) => v <= 40);
    conditions.push({ id: 6, label: 'Dividend payout at most 40% in 8 of the last 10 years', value: `${met} of ${of} years <= 40%`, meets: of > 0 ? met >= 8 : null, available: of > 0 });
  } else {
    conditions.push({ id: 6, label: 'Dividend payout at most 40% in 8 of the last 10 years', value: 'not reported', meets: null, available: false });
  }

  // Bonus-adjusted (profitLoss passed) and year-anchored: a 1:1 bonus is not
  // a doubled share count, and "5 years" means FY(t-5), not six data points
  // back across a gap in the history.
  const shares = sharesSeries(bs, faceValue, pl).filter((p) => p.value != null);
  let dilutionRatio = null;
  if (shares.length >= 2) {
    const last = shares[shares.length - 1];
    const base = shares.find((p) => p.year === last.year - 5);
    dilutionRatio = base && base.value > 0 ? last.value / base.value : null;
  }
  conditions.push({ id: 7, label: 'Share count grew at most 10% over the last 5 years', value: dilutionRatio != null ? `${((dilutionRatio - 1) * 100).toFixed(1)}% change` : 'not computable', meets: dilutionRatio != null ? dilutionRatio <= 1.10 : null, available: dilutionRatio != null });

  conditions.push({ id: 8, label: 'Promoter holding fell by at most 5 percentage points over 12 quarters, and pledge is under 10%', value: 'Shareholding pattern is not fetched by this app yet', meets: null, available: false });

  // A lender's "Financing Margin %" is Revenue − Interest − Expenses over
  // Revenue, and screener's Expenses line carries provisions and (after
  // HDFCBANK's merger) insurance-business costs whose income sits in Other
  // Income — HDFCBANK's margin went from +18% to −16% with profit still
  // rising. Pre-tax profit over total income (Revenue + Other Income) is the
  // lender's comparable "margin": every rupee earned, every cost charged.
  let margin, marginLabel;
  if (schema === 'financial') {
    const pbt = new Map(fySeries(pl, 'Profit before tax').map((p) => [p.year, p.value]));
    const oi = new Map(fySeries(pl, 'Other Income').map((p) => [p.year, p.value]));
    margin = fySeries(pl, 'Revenue').map((p) => {
      const total = p.value != null && oi.get(p.year) != null ? p.value + oi.get(p.year) : null;
      const b = pbt.get(p.year);
      return { year: p.year, value: (total != null && total > 0 && b != null) ? (b / total) * 100 : null };
    });
    marginLabel = 'Median pre-tax margin on total income (3-year) at least as high as its 10-year median';
  } else {
    margin = fySeries(pl, 'OPM %');
    marginLabel = 'Median operating margin (3-year) at least as high as median operating margin (10-year)';
  }
  const opm = margin.filter((p) => p.value != null);
  // Windows by fiscal year, not by point count, so a gap in the history
  // (PAYTM has no FY2017/18) can't stretch "10 years" to twelve.
  const opmLastYear = opm.length ? opm[opm.length - 1].year : null;
  const opm3 = median(opm.filter((p) => p.year > opmLastYear - 3).map((p) => p.value));
  const opm10 = median(opm.filter((p) => p.year > opmLastYear - 10).map((p) => p.value));
  conditions.push({ id: 9, label: marginLabel, value: (opm3 != null && opm10 != null) ? `3y ${opm3.toFixed(1)}% vs 10y ${opm10.toFixed(1)}%` : 'not computable', meets: (opm3 != null && opm10 != null) ? opm3 >= opm10 : null, available: opm3 != null && opm10 != null });

  const assetsCagr = windowCagr(fySeries(bs, 'Total Assets'), 5);
  conditions.push({ id: 10, label: 'Total assets grew at least 10% a year over the last 5 years', value: assetsCagr != null ? `${(assetsCagr * 100).toFixed(1)}%` : 'not computable', meets: assetsCagr != null ? assetsCagr >= 0.10 : null, available: assetsCagr != null });

  return conditions;
}

// The plan requires the checklist to render behind a dismissible overlay
// whenever "any HIGH-severity rule is open". The overlay's own sentence is
// about whether the reported numbers can be TRUSTED, so the rules that
// gate it are the earnings-quality ones — profit not arriving as cash,
// receivables/inventory piling up, one-off gains, tax-driven profit, a
// dividend the business didn't earn. Balance-sheet-risk rules (thin
// interest cover, leverage, stalled CWIP, capex without revenue) are real
// findings but say nothing about whether the numbers are honest; gating on
// "any flag" hid the whole checklist for Hindalco and PAYTM on interest
// cover alone. A CORRELATED flag gates only if one of the rules it
// collapsed is itself an earnings-quality rule.
const EARNINGS_QUALITY_RULES = ['CFO_DIVERGENCE', 'DEBTOR_BALLOON', 'INVENTORY_BUILD', 'ASSET_SALE_GAIN', 'TAX_DRIVEN_MARGIN', 'DIVIDEND_NOT_FROM_OPS', 'DIVIDEND_EXCEEDS_FCF'];
function checklistQualityGate(divergenceResult) {
  if (!divergenceResult) return { blocked: false };
  // allFlags, not flags: flags is the top-3-by-rupees display cut, and an
  // earnings-quality flag ranked 4th behind three interest-cover years is
  // still open.
  const all = divergenceResult.allFlags || divergenceResult.flags || [];
  const gating = all.filter((f) => EARNINGS_QUALITY_RULES.includes(f.ruleId)
    || (f.ruleId === 'CORRELATED' && (!f.rules || f.rules.some((id) => EARNINGS_QUALITY_RULES.includes(id)))));
  if (!gating.length) return { blocked: false };
  return {
    blocked: true,
    reason: 'This company has open questions about the quality of its reported numbers. The checklist below describes how its growth has looked; it does not check whether those numbers can be trusted.',
    gatingFlags: gating,
  };
}

/* =====================================================================
   EXPLORE DECK — pure helpers behind the tab's fullscreen comparison
   space. Same contract as everything above: data in, structured output
   out, no DOM, no model — every number a viewer sees traces to these.
   ===================================================================== */

// Section order/key contract of the parser, mirrored here so the Explore
// deck's pickers list rows in the same order the tables render them.
const EXPLORE_SECTIONS = [
  { key: 'profitLoss', label: 'Profit & Loss' },
  { key: 'balanceSheet', label: 'Balance Sheet' },
  { key: 'cashFlow', label: 'Cash Flow' },
  { key: 'ratios', label: 'Ratios' },
];

// Every plottable row in a parsed bundle, in canonical section order then
// as-reported row order. Rows carrying no fiscal-year value at all are
// skipped — a picker option that can never plot anything is noise.
function stmtExploreCatalog(bundle) {
  if (!bundle) return [];
  const out = [];
  EXPLORE_SECTIONS.forEach((sec) => {
    const section = bundle[sec.key];
    if (!section || !Array.isArray(section.rows)) return;
    section.rows.forEach((row) => {
      const series = fySeries(section, row.label);
      if (!series.some((p) => p.value != null)) return;
      out.push({ key: sec.key + '|' + row.label, label: row.label, sectionKey: sec.key, sectionLabel: sec.label });
    });
  });
  return out;
}

// Aligns two FY series on their common years — the X-vs-Y scatter's
// backbone. Years present in only one series are dropped (and the caller
// discloses the shrinkage), never silently paired against a wrong year.
function alignFyPairs(seriesX, seriesY) {
  const byYearX = new Map();
  (seriesX || []).forEach((p) => { if (p.value != null) byYearX.set(p.year, p.value); });
  const out = [];
  (seriesY || []).forEach((p) => {
    if (p.value == null) return;
    if (!byYearX.has(p.year)) return;
    out.push({ year: p.year, x: byYearX.get(p.year), y: p.value });
  });
  out.sort((a, b) => a.year - b.year);
  return out;
}

// Each year expressed as a percentage of the same year's Sales (or Revenue)
// — turns absolute rupee rows into comparable margin-like shapes. Null
// wherever sales is missing or non-positive; never a fabricated zero.
function pctOfSalesSeries(series, salesSeries) {
  const byYear = new Map();
  (salesSeries || []).forEach((p) => { if (p.value != null && p.value > 0) byYear.set(p.year, p.value); });
  return (series || []).map((p) => {
    const sales = byYear.get(p.year);
    const value = (sales && p.value != null) ? (p.value / sales) * 100 : null;
    return { year: p.year, value };
  });
}

// Grouped-bar chart for the growth summary across overlapping windows
// (10y/5y/3y/1y — these are window lengths, not sequential periods, so the
// x-axis is categorical and a line would imply progression that doesn't
// exist). salesG and npG are growthSummary() outputs.
// Values are printed on the bars (position 'outside' puts a negative bar's
// label below it, where there's room) and the two series are named in a
// legend — with two same-width colours side by side, colour alone was the
// only way to tell Sales from Net Profit without hovering. Pass salesLabel
// ('Revenue' for a lender) so the name matches the row the table shows.
function growthChartOption(salesG, npG, salesLabel) {
  const cats = ['10y', '5y', '3y', '1y'];
  const fmt = v => v == null ? null : +(v * 100).toFixed(1);
  const barLabel = { show: true, position: 'outside', distance: 4, fontSize: 10, fontWeight: 600, formatter: (p) => (p.value == null ? '' : p.value + '%') };
  const salesName = (salesLabel || 'Sales') + ' CAGR';
  return {
    legend: { show: true, top: 0, left: 'center', itemWidth: 12, itemHeight: 8, textStyle: { fontSize: 10.5 }, data: [salesName, 'Net Profit CAGR'] },
    grid: { left: 60, right: 20, top: 34, bottom: 36, containLabel: true },
    xAxis: { type: 'category', data: cats, axisLabel: { fontSize: 11, color: 'rgba(20,40,63,.55)' }, axisLine: { lineStyle: { color: 'rgba(20,40,63,.2)' } } },
    yAxis: { type: 'value', name: '% CAGR', nameTextStyle: { fontSize: 10.5, color: 'rgba(20,40,63,.6)' }, axisLabel: { formatter: v => v + '%', fontSize: 10, color: 'rgba(20,40,63,.55)' }, splitLine: { lineStyle: { color: 'rgba(20,40,63,.06)' } } },
    tooltip: { trigger: 'axis', confine: true, formatter: function (params) {
      const arr = Array.isArray(params) ? params : [params];
      const win = arr.length ? arr[0].axisValue : '';
      return '<b>' + win + '</b>' + arr.map(function (p) { return '<br/>' + p.marker + ' ' + advisorEscapeSafe(p.seriesName) + ': ' + (p.value != null ? p.value + '%' : '\u2014'); }).join('');
    } },
    series: [
      { name: salesName, type: 'bar', barMaxWidth: 32, data: cats.map((c, i) => fmt([salesG.y10, salesG.y5, salesG.y3, salesG.y1][i])), itemStyle: { color: '#2557C7', borderRadius: [3, 3, 0, 0] }, label: Object.assign({ color: '#2557C7' }, barLabel), labelLayout: { hideOverlap: true } },
      { name: 'Net Profit CAGR', type: 'bar', barMaxWidth: 32, data: cats.map((c, i) => fmt([npG.y10, npG.y5, npG.y3, npG.y1][i])), itemStyle: { color: '#A03A22', borderRadius: [3, 3, 0, 0] }, label: Object.assign({ color: '#A03A22' }, barLabel), labelLayout: { hideOverlap: true } },
    ],
  };
}

// Cash-flow bridge, one column per year: CFO, CFI and CFF as SIGNED
// segments of a diverging stacked bar, Net Cash Flow as a labelled dot.
// ECharts 5 stacks same-sign values separately (stackStrategy 'samesign',
// the default), so inflows build up from zero, outflows build down from
// zero, and the dot sits at (top of the inflows) − (depth of the outflows)
// — the arithmetic is still visible without any helper series.
// An earlier version stacked transparent "base" spacer series into the same
// column to fake a floating waterfall; every spacer added its own height to
// the stack, so TCS FY26 drew a ~₹1.46 lakh Cr tower for a year whose net
// cash flow was −₹1,925 Cr. A true floating waterfall needs one category per
// component, which 12 years × 4 steps doesn't fit — hence the diverging bar.
function cashFlowWaterfallOption(cfoSeries, cfiSeries, cffSeries, ncfSeries) {
  const yearsNum = cfoSeries.map((p) => p.year);
  const years = yearsNum.map((y) => 'FY' + String(y).slice(2));
  // Every component is looked up by year, not by array index — the four
  // rows are separate fySeries calls and nothing guarantees equal lengths.
  const byYear = (series) => {
    const m = new Map((series || []).map((p) => [p.year, p.value]));
    return yearsNum.map((y) => (m.has(y) ? m.get(y) : null));
  };
  const cfo = byYear(cfoSeries), cfi = byYear(cfiSeries), cff = byYear(cffSeries);
  const ncfReported = byYear(ncfSeries);
  // Screener's Net Cash Flow row is CFO+CFI+CFF; derive it only when the
  // reported cell is missing and all three components are present.
  const ncf = ncfReported.map((v, i) => (v != null ? v
    : (cfo[i] != null && cfi[i] != null && cff[i] != null ? cfo[i] + cfi[i] + cff[i] : null)));
  const lastIdx = years.length - 1;
  // Values visible without hover: every year's net figure is printed on its
  // dot (it's the answer the chart exists to give), and the latest year's
  // three components are printed beside the last column, where the right
  // margin has room. Labelling all 36 segments would bury the bars in text;
  // the tooltip still carries every year's breakdown.
  const componentSeries = (name, data, color) => ({
    name, type: 'bar', stack: 'flow', barMaxWidth: 30, itemStyle: { color },
    data: data.map((v, i) => (i === lastIdx && v != null
      ? { value: v, label: { show: true, position: 'right', distance: 6, color, fontWeight: 600, fontSize: 10, formatter: () => name.split(' ')[0] + ' ' + formatCroreCompact(v) } }
      : v)),
  });
  // The x-axis is pinned to the bottom (onZero:false) so year labels don't
  // run through the outflow bars; this line marks zero instead, which is
  // the line inflows and outflows diverge from.
  const zeroLine = { silent: true, symbol: 'none', label: { show: false }, data: [{ yAxis: 0 }], lineStyle: { color: 'rgba(20,40,63,.45)', type: 'solid', width: 1 } };
  return {
    legend: { show: true, top: 0, left: 'center', itemWidth: 12, itemHeight: 8, textStyle: { fontSize: 10.5 },
      data: ['Operations (CFO)', 'Investing (CFI)', 'Financing (CFF)', 'Net cash flow'] },
    grid: { left: 60, right: 118, top: 34, bottom: 30, containLabel: true },
    xAxis: { type: 'category', data: years, axisLabel: { fontSize: 10, color: 'rgba(20,40,63,.55)' }, axisLine: { onZero: false, lineStyle: { color: 'rgba(20,40,63,.2)' } } },
    yAxis: { type: 'value', name: '\u20b9 Cr', nameTextStyle: { fontSize: 10.5, color: 'rgba(20,40,63,.6)' }, axisLabel: { formatter: v => formatCroreSafe(v), fontSize: 10, color: 'rgba(20,40,63,.55)' }, splitLine: { lineStyle: { color: 'rgba(20,40,63,.06)' } } },
    tooltip: { trigger: 'axis', confine: true, formatter: function (params) {
      const arr = Array.isArray(params) ? params : [params];
      const year = arr.length ? arr[0].axisValue : '';
      const i = arr.length ? arr[0].dataIndex : 0;
      const lines = [
        'Operations: <b>' + formatCroreSafe(cfo[i]) + '</b>',
        'Investing: <b>' + formatCroreSafe(cfi[i]) + '</b>',
        'Financing: <b>' + formatCroreSafe(cff[i]) + '</b>',
        'Net cash flow: <b>' + formatCroreSafe(ncf[i]) + '</b>',
      ];
      return '<b>' + year + '</b><br/>' + lines.join('<br/>');
    } },
    series: [
      Object.assign(componentSeries('Operations (CFO)', cfo, '#2E8B6F'), { markLine: zeroLine }),
      componentSeries('Investing (CFI)', cfi, '#A03A22'),
      componentSeries('Financing (CFF)', cff, '#14283F'),
      {
        // A scatter, not a line: consecutive years' net flows aren't a path,
        // and a connecting line would imply a trend between unrelated totals.
        name: 'Net cash flow', type: 'scatter', data: ncf, symbol: 'circle', symbolSize: 9, z: 10,
        itemStyle: { color: '#2557C7', borderColor: '#fff', borderWidth: 1.5 },
        // White halo so the number stays legible where it sits on a bar.
        label: { show: true, position: 'top', distance: 5, fontSize: 9.5, fontWeight: 600, color: '#2557C7', textBorderColor: '#fff', textBorderWidth: 2,
          formatter: (p) => formatCroreCompact(Array.isArray(p.value) ? p.value[1] : p.value) },
        // On a narrow (phone-width) chart twelve labels can't all fit; drop
        // the ones that would collide rather than print them on each other.
        labelLayout: { hideOverlap: true },
      },
    ],
    __years: yearsNum,
  };
}

// Safe format for use inside engine-level chart builders (no dependency on
// the page's formatCroreValue, which lives in goalden-lab.html).
function formatCroreSafe(v) {
  if (v == null || !isFinite(v)) return '\u2014';
  const abs = Math.abs(v);
  if (abs >= 1e7) return (v / 1e7).toFixed(1) + 'L Cr';
  if (abs >= 1e3) return (v / 1e3).toFixed(1) + 'k Cr';
  return v.toFixed(0) + ' Cr';
}
// formatCroreSafe's "k" step without the unit, for on-chart value labels
// where the axis name already says "₹ Cr" and every character of width
// counts. Deliberately the same k-scaling as the axis ticks beside it, so
// a label and the tick next to it never use two conventions.
function formatCroreCompact(v) {
  if (v == null || !isFinite(v)) return '—';
  const abs = Math.abs(v), sign = v < 0 ? '−' : '';
  if (abs >= 1e3) return sign + (abs / 1e3).toFixed(1) + 'k';
  return sign + abs.toFixed(0);
}
// A statement row's value in its own unit (rowUnit), short enough for an
// on-chart label — the engine-side twin of the Lab's formatCellRaw.
function formatRowValueCompact(label, v) {
  if (v == null || !isFinite(v)) return '';
  const unit = rowUnit(label);
  if (unit === 'pct') return v.toFixed(1) + '%';
  if (unit === 'days') return Math.round(v) + 'd';
  if (unit === 'ratio') return v.toFixed(2) + 'x';
  if (unit === 'rupee') return '₹' + v.toFixed(1);
  return '₹' + formatCroreCompact(v) + ' Cr';
}
function advisorEscapeSafe(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
}

const api = {
  findRow, fySeries, median, pctChange, yearIndex, vsOwnMedian,
  classifySchema, compareRefusal,
  COMPANION_MAP, companionMapFor,
  KNOWN_DISCONTINUITIES, discontinuityNote, detectCyclical,
  DIVERGENCE_RULES, evaluateDivergenceRules,
  SERIES_PALETTE, benchChartOption, profitVsCashChartOption, profitVsCashCaption,
  CANONICAL_ROWS, ROW_POLARITY, rowPolarity, ROW_UNIT, rowUnit, rowBoxScore,
  windowCagr, growthSummary, sharesSeries, epsFromShrink, dilutionDrag,
  capitalEmployedSeries, incrementalRoce, assetTurnover, bookValuePerShareSeries,
  priceToBookLatest, reratingSpread, fyEndPriceSeries, peHistoryBand,
  compoundingChecklist, checklistQualityGate,
  stmtExploreCatalog, alignFyPairs, pctOfSalesSeries,
  growthChartOption, cashFlowWaterfallOption, companionMapFor,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else if (typeof self !== 'undefined') {
  Object.assign(self, api);
}
