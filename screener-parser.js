/**
 * screener-parser.js — pure functions for parsing screener.in's statement
 * tables, shared between src/worker.js (Cloudflare Worker, ES module import)
 * and engine.test.js (Node, CommonJS require). No I/O, no fetch, no cache —
 * just HTML-in, structured-data-out, so every rule here is unit-testable
 * against saved fixture HTML without a network call.
 *
 * Dual-format shim at the bottom mirrors goalden-engine.js: plain globals
 * when loaded as a script, module.exports when required.
 */

function stripHtmlTags(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

// screener.in wraps every statement in <section id="profit-loss">...</section>
// (and balance-sheet, cash-flow) with no closing marker other than the next
// <section id="...">, so the slice boundary is "next section start, or EOF".
function screenerSectionSlice(html, id) {
  const m = new RegExp(`<section[^>]*id="${id}"`).exec(html);
  if (!m) return null;
  const rest = html.slice(m.index + m[0].length);
  const next = rest.search(/<section[^>]*id="/);
  return rest.slice(0, next === -1 ? rest.length : next);
}

// A screener statement page is real evidence of a company page, not an
// interstitial or a redirected error page — every genuine statement table
// carries at least one <th data-date-key="...">. Cheap, and it lets us tell
// "unfamiliar layout" apart from "not a company page at all".
function hasCompanyPageEvidence(html) {
  return /data-date-key="/.test(html);
}

// A section can (in principle, e.g. a future quarterly/yearly toggle) hold
// more than one <table class="data-table">. Never trust "first match" blindly
// — score each candidate by how many of its header cells look like real
// fiscal-period keys (YYYY-MM-DD or the literal "TTM") and take the highest.
function pickDataTable(sectionHtml) {
  const tableRe = /<table[^>]*class="[^"]*data-table[^"]*"[^>]*>([\s\S]*?)<\/table>/g;
  let best = null;
  let bestScore = -1;
  let m;
  while ((m = tableRe.exec(sectionHtml))) {
    const tableHtml = m[1];
    const theadMatch = /<thead>([\s\S]*?)<\/thead>/.exec(tableHtml);
    let score = 0;
    if (theadMatch) {
      const thRe = /<th[^>]*data-date-key="([^"]*)"[^>]*>/g;
      let thM;
      while ((thM = thRe.exec(theadMatch[1]))) {
        if (thM[1] === 'TTM' || /^\d{4}-\d{2}-\d{2}$/.test(thM[1])) score++;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = tableHtml;
    }
  }
  return best;
}

// Tags each header cell with its fiscal year (from the data-date-key, which
// is always the period's last day, e.g. "2025-03-31") or marks it TTM.
// TTM must never be treated as a fiscal year — it duplicates the latest
// observation and poisons every CAGR/growth computation that walks the array.
function classifyPeriods(rawPeriods) {
  return rawPeriods.map((p) => {
    if (p.key === 'TTM') return { type: 'ttm', key: 'TTM', label: p.label || 'TTM' };
    const yearMatch = /^(\d{4})-\d{2}-\d{2}$/.exec(p.key || '');
    const year = yearMatch ? Number(yearMatch[1]) : null;
    return { type: 'fy', year, key: p.key, label: p.label };
  });
}

// Normalises one reported cell to {raw, value}. `raw` is always the
// as-scraped text (for display); `value` is a number or null — never a
// string smuggled into a numeric array. Dash variants (-, en dash, em dash,
// minus sign), blank, "NA" and "N/A" all mean "not reported", not zero.
// Parenthesised numbers, e.g. "(1,234)", are accounting notation for
// negative and parse as such.
const DASH_RE = /^[-‐‑‒–—−]$/;
const NA_RE = /^(NA|N\/A)$/i;
function parseCellValue(text) {
  const raw = text;
  const trimmed = (text || '').trim();
  if (trimmed === '' || DASH_RE.test(trimmed) || NA_RE.test(trimmed)) {
    return { raw, value: null };
  }
  const parenNegative = /^\((.*)\)$/.exec(trimmed);
  const body = parenNegative ? parenNegative[1] : trimmed;
  const cleaned = body.replace(/,/g, '').replace(/%/g, '').trim();
  const num = Number(cleaned);
  if (cleaned === '' || Number.isNaN(num)) return { raw, value: null };
  return { raw, value: parenNegative ? -num : num };
}

// Every statement section holds (normally) one <table class="data-table">: a
// <thead> of <th data-date-key="YYYY-MM-DD"> period labels (or "TTM"), and a
// <tbody> of <tr><td>Label</td><td>value</td>...</tr> rows.
function screenerParseTable(sectionHtml) {
  const tableHtml = pickDataTable(sectionHtml);
  if (!tableHtml) return null;

  const rawPeriods = [];
  const theadMatch = /<thead>([\s\S]*?)<\/thead>/.exec(tableHtml);
  if (theadMatch) {
    const thRe = /<th[^>]*data-date-key="([^"]*)"[^>]*>([\s\S]*?)<\/th>/g;
    let m;
    while ((m = thRe.exec(theadMatch[1]))) rawPeriods.push({ key: m[1], label: stripHtmlTags(m[2]) || m[1] });
  }
  const periods = classifyPeriods(rawPeriods);

  const rows = [];
  const tbodyMatch = /<tbody>([\s\S]*?)<\/tbody>/.exec(tableHtml);
  if (tbodyMatch) {
    const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
    let trM;
    while ((trM = trRe.exec(tbodyMatch[1]))) {
      const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/g;
      const tds = [];
      let tdM;
      while ((tdM = tdRe.exec(trM[1]))) tds.push(tdM[1]);
      if (!tds.length) continue;
      const label = stripHtmlTags(tds[0]).replace(/\+\s*$/, '').trim();
      if (!label) continue;
      const values = tds.slice(1).map((td) => parseCellValue(stripHtmlTags(td)));
      rows.push({ label, values });
    }
  }
  return { periods, rows };
}

// Fingerprint-based schema classification. Deliberately NOT a synonym map —
// aliasing "Sales|Revenue" would let bank data flow through manufacturing
// ratios (debt-to-equity on a bank whose "borrowing" is its raw material).
// Every derived metric declares which schema(s) it's valid for and checks
// this classification before computing anything.
function classifySchema(profitLossRows) {
  const labels = new Set((profitLossRows || []).map((r) => r.label));
  const hasFinancingProfit = labels.has('Financing Profit') || labels.has('Financing Margin %');
  const hasOperatingProfit = labels.has('Operating Profit') || labels.has('OPM %');
  if (hasFinancingProfit && !hasOperatingProfit) return 'financial';
  if (hasOperatingProfit && !hasFinancingProfit) return 'nonfinancial';
  return 'unknown';
}

const api = {
  stripHtmlTags,
  screenerSectionSlice,
  hasCompanyPageEvidence,
  pickDataTable,
  classifyPeriods,
  parseCellValue,
  screenerParseTable,
  classifySchema,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else if (typeof self !== 'undefined') {
  Object.assign(self, api);
}
