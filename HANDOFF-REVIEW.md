# Handoff review: what to apply, what to fix first, and what's missing

**Date:** 2026-10-19
**Reviewed:** the 21 handoffs and the briefing in
`C:\Users\VANSH\Downloads\goalden-research\` (written 2026-10-18/19).
**How:**
- Four independent reviewers, read-only. Each one:
  - checked every proposed change against today's code (branch
    `claude/new-session-4ynhj6`);
  - re-ran the maths on real data from the live site;
  - checked Indian tax and EPF/PPF/NPS rules against official or dated
    sources.
- I tried the three prototypes in the browser.

**Use this file next to the handoffs.** When you apply a handoff, apply the
fixes listed here for it as well. Where this file and a handoff disagree,
this file wins: it was checked against the current code.

---

## 1. The short version

- **The research is good.** Every code change it proposes still matches
  today's code; nothing is stale. All its headline numbers reproduce:
  - ₹22,906 → ₹9,140 SIP with EPF;
  - XIRR 10.89%;
  - "beat the index in 37% of 3-year windows";
  - ₹1,52,750 FD tax;
  - ₹4.28 L harvesting saving.

  The prototypes are calm, accessible and on-style.
- **But 17 of the 21 handoffs need changes before they go in.** Three of them
  would crash a page as written, because each uses a variable that doesn't
  exist where the code runs: 02, 06 (Full Plan) and 07 (Build a Portfolio).
  Handoffs 01–12 were mostly checked by reading the code, not run in the app.
  That is how these slipped through.
- **Four honesty slips.** These matter because "it never fakes numbers" is
  Goalden's main selling point:
  1. 12/13A's bad-price filter deletes real crash days (Yes Bank, March 2020)
     and calls them data errors.
  2. 18 labels old funds "Direct plans" just because "Regular" isn't in the
     name.
  3. 06/17 say the tax figure "overstates" tax. It understates it, because
     surcharge is ignored.
  4. 21 says the plan is "never sent to a server". It is sent if the user
     chats with the advisor.
- **Cut the motion work.** Morphing lines and count-ups (in 15 and 14) add
  risk for little gain. Keep the range buttons and the readout.
- **What the research didn't cover.** It stuck to polishing calculators. The
  things a wealth manager like Dezerv would ask about first are missing:
  - insurance;
  - the tax regime;
  - loans;
  - how to draw money in retirement;
  - a review of what the person already owns.

  See section 4.

---

## 2. Every handoff: verdict and the fixes it needs

Legend: **APPLY** as written · **FIX FIRST** (apply with the listed changes) · **SKIP**.
Value is for a demo to a wealth-management founder and a technical interview.

### Quick Calculate and Full Plan

| # | Handoff | Verdict | Value | Must change before applying |
|---|---|---|---|---|
| 19 | Persona starters | FIX FIRST | High | Show the "Example plan: Priya…" note only while the inputs still match the persona; it goes stale after an edit. Consider swapping Meera (US, Austin) for an Indian high-net-worth example (e.g. Mumbai, 40, ₹1.5 Cr saved), which suits a Dezerv audience better. |
| 06 | Post-tax FD | FIX FIRST | High | **Full Plan crash:** the snippet uses `baseAlloc` before it's declared (line ~1691), so use `BUCKETS[G.bucket]\|\|BUCKETS.moderate`. **Reword** "overstates the plan's tax" to "at your slab, no surcharge; a one-year lump sum would pay more, staged withdrawals less". **Fairness:** existing savings count on the plan side only; give the FD the same starting balance or compare the SIP-only part (`r.gapCorpus`). Education passes no `paidIn`, so savings get taxed as gains. Show the 20% default slab and "new regime" on screen; the Full Plan uses 30% at line 689, so make them agree. Scope the chip handler with `closest('.chart-card')` (duplicate `id="fdCard"`). Keep the US "short by" sentence. |
| 08 | Keep-place fix, ghost line, scrub | FIX FIRST | High (§1–3) / Med (ghost, scrub) | Focus goes to the "Back to 60" button in the action card, not the row. Query `#bp .delay-row[data-retire-preview=…]`. Show the ghost only for retirement, and clear it on every input change. Drop `role="img"` from the element that takes arrow keys. Its `render(opts)` change is the same as 14's: apply it once. |
| 05 | Quick Calculate → Lab stress test | FIX FIRST | High | India only: return `''` when `S.country!=='IN'`, because the Lab's ranges are rupee-only and a $5k plan would be clamped to 10,000. Use `.case-cta.lab-cta{animation:none}`, and wrap `Number()` around `data.corpus` and `data.sip`. |
| 14 | Live result canvas | FIX FIRST, last of this group | High, with real risk | **Phones:** put the `body.lc-on #advisorPanel` lift inside `@media(min-width:481px)`, or the chat panel's header and close button go off-screen. **Motion:** set `animation:false` in `initChart` for quiet or reduced-motion renders, or every 120ms the charts replay their 1-second grow-in. Use `ADVISOR_FIELDS` as the single source of limits (`LC_LIMITS` differs; spend 1e9 vs 1e8). Guard `el.after`/`style.setProperty` for the agent-evals vm, guard `lcApply` with `flow()[S.si]==='results'`, scope `countTo` to `#stage`, and call `lcLift` on resize. |
| 21 | Share link | FIX FIRST | Med-High | Add a version key (`v=1`) so old links don't silently open with changed maths. Carry `postRetAlloc`/`eduAlloc`, or say they're not included. **Reword** the privacy claim to "Goalden's server never sees the link"; the chat app stores it, and the advisor sends state if you chat. The validation itself is solid: no XSS path. |
| 20 | Sticky summary and jump bar | FIX FIRST | Med | `.sum-bar{left:0;right:0}` (not -4px). Otherwise a horizontal scrollbar flickers on Windows Chrome. |
| 16 | EPF, PPF and NPS | FIX FIRST | High realism, Med for Dezerv | See below. |
| 17 | Tax harvesting | FIX FIRST | Med | See below. |

**16, EPF/PPF/NPS, fixes:**
1. **Bug:** `fdComparisonCardHtml(r.sip, r.yrs, r.corpus, …)` (goalden.html ~1447 and the advisor briefing ~2371) would credit the whole pot, ₹2.8 Cr of it EPF, to the SIP. Pass `r.corpus - r.accCounted` (or `r.gapCorpus`).
2. **PF ceiling:** many employers pay PF only on the ₹15,000 ceiling (₹1,800/mo), not full basic. Then the SIP is ₹19,637, not ₹9,140. Ask for the PF deduction from the payslip, or add a "PF on ₹15,000" option.
3. **NPS before 60:** only 20% can be taken as a lump sum (unless 15+ years in NPS). Count 20% when retiring before 60, not 60%.
4. **Wrong text:** "Your existing ₹0 … covers the pot" when EPF alone covers it.
5. **Advisor:** add the accounts to `get_results`, or the AI credits the ₹4.7 Cr to the ₹9,140 SIP.
6. **Wording:** the EPF rate is now **ratified** (June 2026), not "final once notified". "The rest must buy a pension" is wrong since Dec 2025: at least 20% must buy an annuity, and extra cash beyond 60% is taxable. Add "tax-free after 5 years' service; interest on your own contributions over ₹2.5 L/yr is taxed".
7. **Note:** the Cabinet approved raising the EPF wage ceiling to ₹25,000 (Sep 2026, not yet notified). Add a one-line re-check note. With it, the SIP moves ₹9,140 → ₹9,742.

**Rates verified:**
- EPF 8.25% for FY 2025-26 (ratified).
- PPF 7.1% for Oct–Dec 2026.
- LTCG 12.5% above ₹1.25 L, STCG 20%, 4% cess: unchanged by Budget 2026 (secondary sources).
- New-regime slabs: incometax.gov.in.

**17, tax harvesting, fixes:**
- Build the "13% = 12.5% + 4% cess" text from `TAX_IN`, not as a typed string.
- Say that surcharge (up to 15% on LTCG) is ignored, so real savings are a bit higher. With surcharge the saving is ₹4.92 L.
- Show the saving in today's money as well: ₹4.3 L in 2056 is about ₹74k today. Say this honestly; it's a modest saving.
- Mention the costs: stamp duty on the re-buy, 2–3 days out of the market, and the exit-load clock restarting.
- The law says "more than 12 months", so use `>`, not `≥`. The effect is immaterial, but get it right.

### The Lab (Test Real Investments)

| # | Handoff | Verdict | Value | Must change before applying |
|---|---|---|---|---|
| 09 | Starter pairs | APPLY | High | Nothing. Both scheme codes are correct: 120716 is UTI Nifty 50 Index Direct, 119132 is HDFC Gold ETF FoF Direct. **Separate small fix:** raise the fund JUMP threshold in `auditPriceSeries` (Lab ~4458, engine ~236) from 10% to about 15%. It currently flags the real 23 Mar 2020 crash (−12.9%) as "most likely a corporate action", and that shows up in the starter-pair demo. |
| 12 | Real SIP backtest (XIRR) | FIX FIRST | High | **Replace `findRevertingSpikes`.** Flag a day only if the price jumps at least 5× (or falls to 0.2× or below), or matches a k:1 split ratio, *and* returns to within 5% within 3 trading days. Only apply it to instruments the audit already flagged JUMP or SPLITSIG. The current version deletes real Yes Bank crash days (6–19 Mar 2020) and calls them errors. The XIRR maths itself is sound. When the window is under 250 days, say why the card is hidden; don't just hide it. |
| 13 | Small fixes | B, C, D: APPLY. A: SKIP as written | Med | Part A uses the same filter on every "Worst fall", so it would flatter the headline. Redo it with the stricter rule above, only for flagged or overridden instruments, and name the instrument in the note. |
| 04 | Missed gains vs the index | FIX FIRST (after 03) | High | **Currency:** pick the benchmark by the mix's currency (an all-USD mix in India mode isn't converted), or hide the stat. Say why it's missing when the window starts before 2013, and retry after a failed load (don't cache the error). Use one shared Regular-plan cost constant and wording with 18 (the flat 1% overstates debt and index funds). Add a hindsight caveat: the pick-list is today's index members. |
| 18 | "At a glance" verdicts and consistency | FIX FIRST (after 04 and 12) | High | **"Direct plans":** claim it only on a positive `/direct/i` match in the name; otherwise say "plan type not stated". **"Steady":** rename it ("Never lost money over 3 years") or test against the FD rate, because it's awarded next to a 0.8%–29.7% range. **Windows:** say how many independent 3-year periods there are (2,658 overlapping windows ≈ 4 independent), and hide the row below about 2. Use `g.years>=0.95` so 1Y doesn't hide the card. Annualise volatility the same way the Lab does, not √252. Print fund names, not scheme codes. "No fund fee" for ETFs contradicts the expense ratio. |
| 15 | Lab charts that respond | FIX FIRST: pills and readout only | Med | **Carry bug:** with 1Y or 3Y selected, "Turn this into a savings plan" would pass a short-window return as a long-run rate. Compute it on `liveCommonWindow(items,true)`. Add `range` and the window dates to `stateForAdvisor`, or the AI silently reasons on the cut window. **Leave out** morphing lines and count-ups. |
| 11 | Overlap nudges | FIX FIRST | Med | `liveKindOf` only searches the current country's index, so SPY in India mode is called "one company". That includes the 09 starter "Nifty 50 vs S&P 500". Search both, and treat unknown tickers as no note. Don't say "cuts risk by only N%" when N is large. Print fund names, not codes. |

### Charts and accessibility (all pages)

| # | Handoff | Verdict | Value | Must change before applying |
|---|---|---|---|---|
| 01 | Allocation strip (replaces the banned donut) | FIX FIRST | High | Add `allocCaption(...)` to `resultCanvasAlloc` (goalden ~2382) and the three Full Plan sites (use `gr-note`; there is no `.chart-caption` class there). Remove the green/red "After inflation" colouring there too (goalden `resultCanvasAlloc`, door2 ~1700 and ~2747), or the pages disagree. Measure label overflow with `scrollWidth > clientWidth`, not a fixed 96px. |
| 02 | Dot plots (replaces the banned radar) | FIX FIRST | High | **Crash:** the caption uses `d.assetPoints`, but `d` doesn't exist in the briefing's `build()`. Use `const d = lastFrontierData;` with a null guard. **False caption:** "Best balance has the most return per unit of risk" is wrong on its own test data (0.57 vs 0.60), so name whichever row really has the highest Sharpe. The titles overlap at phone width, so use "Return ↑ / Risk ↓ / Sharpe ↑" and explain the arrows in the caption. Guard the case where every Sharpe is null (NaN axis). The CSS reduced-motion rule doesn't stop ECharts animation, so don't claim it does. Apply before 03 (both edit `engine.test.js` ~273–310). |
| 10 | Keyboard and slider names | FIX FIRST (after 08) | High | Full Plan: `focusKeyOf` keys on the first `data-*` attribute, so batched questions focus the wrong option. Key on `data-score` + `data-sec` + `data-idx`. After a screen change, focus the new heading, not the repeated `#nextBtn`/`#nb`. Fill-in chips never re-render, so either sync `aria-pressed` in the click handler or drop it. **Missed bug:** the Lab's `render()` replaces `#main` 130ms after each slider input, so keyboard focus is lost on every arrow press. Keep focus there too (key on `[data-k][data-tab]`). |
| 03 | One palette, end labels, no default red | FIX FIRST: parts B, D, E, F first, theme (A) last | Med-High | Contrast: ochre `#B8740F` (3.8:1) and green `#1F8A70` (4.3:1) are under 4.5:1 for small text. Print the end labels for bench and profit-vs-cash in ink `#14283F`, not the series colour. Statements bar names ride only on the 10-year bar, so a company without 10 years of data shows no name. Put the name on the first non-empty bar and don't hide it on overlap. "One palette everywhere" misses the race chart (`#8FC79E`/`#E8977A`, `.race-legend`), the Lab `.rc-legend`/`.fx-legend`/`.risk-comp-legend`, and about 22 more `#D97757` uses. The theme change (A) recolours any series without an explicit colour, so check every page by eye after it. |
| 07 | Accessible term tips | FIX FIRST, last | Med | **Crash:** `currentSharpe` doesn't exist in `frontierTakeawayHTML` (Lab ~2912); use `sharpe`. **Wrong sentence:** "₹1L at the peak fell to…" treats the start as the peak; use `amt*g.mix[w.peakK]` → `amt*g.mix[w.k]`. An `infoIcon` inside the `.tglbtn` button makes a button inside a button. Name each of the 76 icons from its label, not "What does this mean?". Scope the MutationObserver to `#stage`/`#main`, because watching `body` runs it on every ECharts animation frame. |

---

## 3a. The plan by what a retail investor comes for (2026-10-19, replaces 3 below)

Goalden's value is that a real retail investor can check **real** things. They
can test real investments on live prices, work out a corpus they can trust,
and read a real company's numbers. So every item below is grouped by which of
those three it makes better and what question it answers. Items marked
**new** aren't in the research handoffs. The research either missed them or
listed them as gaps without writing them up.

### Pillar 1: Test Real Investments ("How did these really do, and should I mix them?")

| The investor's question | What answers it | Source |
|---|---|---|
| "If I'd done a monthly SIP in this, what would I have now?" | Real SIP backtest with XIRR, vs the plan's assumed rate | 12 (with the stricter bad-price rule) |
| "Did it beat just buying a Nifty index fund?" | Missed gains in ₹ vs an index fund, same dates (Dezerv's own lead metric) | 04 (with currency, retry and hindsight fixes) |
| "Was that luck of the start date?" | Rolling 3-year consistency, with the number of independent periods stated | 18 (with fixes) |
| "What is my fund's fee costing me?" | Regular vs Direct in ₹. Plan type claimed only when the name says so | 04 + 18, one shared constant |
| "What would I actually keep after tax?" | **New.** Under the SIP backtest: "if sold today: LTCG 12.5% on gains above ₹1.25 L → you keep ₹X", using 06's dated `TAX_IN` | new, S |
| "Is my fund good, or was the market just good?" | Category line: average of 5 named funds, labelled exactly that way | N6, after 04 |
| "Show me the last 1 / 3 / 5 years" | Range buttons and a pointer readout (no morphing) | 15, trimmed |
| "Are my two picks really the same thing?" | Calm overlap and concentration notes | 11 (with fixes) |
| "Tell me about this company" | **New.** A "Read this company →" link on any NSE stock card, opening Read the Company. Today the link only goes the other way | new, S |
| "Review what I actually own" | Holdings with amounts: real mix vs risk profile, duplicate categories, fee drag, tax-aware rebalancing | B1 |

### Pillar 2: The corpus calculator ("How much do I need, how much a month, is it realistic?")

| The investor's question | What answers it | Source |
|---|---|---|
| "Is a 9.9% return assumption realistic?" | **New.** A reality check from the real market history already in the engine (`marketSeries`): "This plan assumes 9.9% a year. In real Indian market history, N-year stretches returned between a% and b%, and X% of them beat this assumption." | new, S–M |
| "After tax, does it still beat an FD?" | Post-tax FD comparison | 06 (with the Full Plan crash fix and honest wording) |
| "What about my PF, PPF, NPS?" | They reduce the SIP you still need | 16 (with the PF-ceiling option and FD-card bug fixed) |
| "Can I start with a smaller amount?" | **Step-up row:** "or start at ₹15,800 and raise it 10% a year". The research listed it as gap #8 but never wrote a handoff | research gap #8, S |
| "How likely is this to work?" | "Stress-test this in the Lab": Monte Carlo survival | 05 (India only) |
| "How do I live off it after I retire?" | Three buckets, monthly withdrawals vs FD interest after tax, the NPS annuity part | B4 |
| "Am I covered if something happens?" | Term and health cover gap, sized from Goalden's own goal pots | B2 |
| "Old or new tax regime?" | Comparison linked to EPF (80C) and health cover (80D) | B3 |
| Easier to use | Example people (done), keep-place fix, live canvas, sticky summary, share link | 19 ✓, 08, 14, 20, 21 |

### Pillar 3: Read the Company ("Is this a good business, and is it priced sensibly?")

The research found Read the Company already explains more than Screener or
Tickertape. Its one gap: **the judgement comes last**.

| The investor's question | What answers it | Source |
|---|---|---|
| "Give me the verdict first" | **Scorecard row** at the top: Growth · Profitability · Debt · Cash conversion · Valuation · Red flags. Each label is computed from checks the page already runs and has its rule shown. It jumps to its section and is never locked | research gap #9, extended (new: Valuation and Red flags) |
| "Is it expensive right now?" | The scorecard's Valuation label: P/E against the company's own 10-year band (`peHistoryBand`) and peers | existing, surfaced |
| "Has the share price run ahead of the business?" | Price growth vs EPS growth (`reratingSpread`), surfaced in the scorecard | existing, surfaced |
| "Any warning signs?" | Divergence flags, promoter-pledge check and dilution, summarised as one Red-flags label, counting against the red budget | existing, surfaced |
| "What if I'd bought this?" | A "Test this as an investment →" link (exists) plus the new reverse link from Test Real Investments | existing + new |
| Charts readable for everyone | A company without 10 years of data loses its bar labels; label contrast | 03 C (with fixes) |

### Across all three

**B5, the yearly plan review by the advisor.** The advisor works through a
fixed checklist across all three areas: plan health, cover gap, tax regime,
portfolio drift and harvesting room. It ends with a dated action list. This
is the agentic workflow your college wants.

### Build order

| Group | What | Status |
|---|---|---|
| 1 | 09 starter pairs (+ fund threshold, set to 20% in the end), 13 B/C/D, 19 personas (Rohan replaces the US persona) | done, deployed |
| 2 | Pillar 1 core: 03 parts B/D/E/F (prereq) → 12 → 04 → "Read this company" link (new); SIP vs index fund added | done (after-tax line moved to 3) |
| 3 | After-tax line on the SIP card (new, uses 06's `TAX_IN`) → Pillar 2 core: 06 → return reality check (new) → step-up row (#8) | next |
| 4 | Pillar 3 core: Read the Company scorecard (#9 extended) | |
| 5 | The banned charts: 01 allocation strip, 02 dot plots | |
| 6 | 08 keep-place fix, 18 verdicts and consistency, 15 pills and readout, 11 nudges | |
| 7 | 16 EPF/PPF/NPS, 17 harvesting, 05 stress test | |
| 8 | 10 keyboard, 03 A theme, 14 live canvas, 20, 21, 07 | |
| 9 | Beyond: B1 holdings review, B2 cover, B3 regime, B4 retirement income, B5 yearly review, B6 loans | |

Each group gets the same treatment: tests, an independent reviewer, deploy,
then a live check.

## 3. The order I first recommended (kept for reference; 3a replaces it)

Smaller groups, the riskiest last, and the crash and honesty fixes folded in.
After each group: run the tests, have a reviewer check it, deploy, live-check.

| Group | Handoffs | Why this order |
|---|---|---|
| 1. Safe demo wins | 09 (+ JUMP threshold 15%), 13 B/C/D, 19 | Low risk, and every demo starts with one tap. |
| 2. Rule breaks an evaluator spots | 01, 02 | Removes the banned donut and radar. |
| 3. The visible bug | 08 §1–3 (keep-place and focus fix) | The most-used screen. Ghost and scrub can come with 14. |
| 4. Post-tax honesty | 06 | "Pre-tax or post-tax?" is the first question Dezerv asks. |
| 5. Real history, honestly | 12 (new spike rule), 13 A rewritten, 04 | Needs 03 parts B, D, E, F first (04 builds on them). |
| 6. Judgement | 15 (pills and readout only), 18, 11 | Lab verdicts, with the honesty fixes. |
| 7. Keyboard | 10 (including Lab focus keep) | After 08. |
| 8. Palette | 03 A (theme), then a page-by-page check | Biggest blast radius, so done separately. |
| 9. Feel | 14, then 08's ghost and scrub, 20, 21, 05 | 14 is the biggest Quick Calculate change. |
| 10. India realism | 16, 17 | 16 needs 14's `rerenderResultsInPlace` (or a copy of it). 17 needs 06. |
| 11. Polish | 07 | Last: a capture-phase handler on every page. |

---

## 4. Beyond the research: what a wealth manager would ask first

The research stayed inside Goalden's current idea: better calculators,
better charts. It explicitly left out anything to do with a user's real
finances. That's sensible for privacy, but it leaves out the questions that
start every conversation at a firm like Dezerv. Each idea below:
- works in plain JS;
- invents no data (no insurance premiums or fund ratings);
- keeps the user's data in the browser.

Ranked by value.

### B1. Portfolio review of what you already own ★ (highest value for a Dezerv demo)
- **What:** "Add what you hold." Type or search fund names and enter amounts
  (no statement upload, no account linking). Goalden shows:
  - your **actual mix** against the target from your Full Plan risk profile;
  - **overlap at category level**, e.g. "4 large-cap funds doing one job";
  - **Regular vs Direct** cost drag in ₹ over your horizon;
  - a **rebalancing plan** that uses new SIP money first, then sells within
    the ₹1.25 L tax-free limit (handoff 17's engine).
- **Why:** it is literally what a wealth manager does at a first meeting. It
  turns Goalden from "plan from zero" into "here's what to change in what
  you have".
- **How:** fund search and MFAPI scheme categories already exist in the Lab.
  Category-level only; say plainly that holding-level overlap needs AMFI
  portfolio files.
- **Where:** a new Lab tool, fed by the Full Plan's risk profile.
- **Effort:** M–L.

### B2. Protection check: term and health cover ★
- **What:** "Your plan only works if you're around to fund it."
  - **Term cover need:** your family's future expenses until your dependants
    are independent, plus outstanding loans, plus **the goal pots Goalden
    already computed**, minus savings and existing cover.
  - **Health:** a family-floater size for your city, grown at medical
    inflation, plus the idea of a super top-up.
- **Shows:** cover amounts and the gap. **No premiums**, because we have no
  honest source for them.
- **Why:** protection comes before investing in every Indian planning
  conversation, and Plan Health says "protection" but doesn't model it. It
  reuses Goalden's own goal numbers, which a stand-alone calculator can't do.
- **Where:** the Full Plan (after emergency fund, which already asks about
  dependants and EMIs) and Plan Health.
- **Effort:** M.

### B3. Old vs new tax regime, linked to the plan ★
- **What:** salary, basic, HRA and rent, 80C, 80D, NPS 80CCD(1B), home-loan
  interest. 80C fills automatically from EPF (handoff 16) and 80D from B2's
  health premium. Shows which regime wins, the ₹ difference, and what it
  means for the plan, e.g. "on the new regime, ELSS and PPF give no tax
  benefit".
- **Why:** it's a real yearly decision for every salaried Indian. The Full
  Plan already suggests ELSS "for old-regime taxpayers" without knowing the
  user's regime, which is a live inconsistency.
- **How:** dated rules (FY 2026-27, verified at build time) and a re-check
  note, like handoff 06.
- **Effort:** M.

### B4. Retirement income plan: drawing the money ★
- **What:** Goalden builds the corpus but never says how to live on it.
  - A **three-bucket plan:** 1–2 years in liquid funds, 3–7 years in
    debt/hybrid, the rest in equity, with refill rules.
  - **SWP vs FD interest after tax:** an SWP is taxed only on the gain part,
    FD interest in full.
  - **Sequence risk**, shown with the existing Monte Carlo.
  - The **NPS annuity part** (after 16).
- **Why:** Dezerv's clients are often 45–60. "How much income, from where,
  after tax" is their question.
- **Where:** Retirement Lab and Sustainable Withdrawal.
- **Effort:** M.

### B5. The yearly plan review: the advisor as an agent ★ (the interview story)
- **What:** "Review my plan." The advisor runs a fixed checklist across the
  tools: Plan Health, B2 cover gap, B3 regime, B1 drift, harvesting room. It
  produces a **dated action list** through the existing plan-and-approve
  flow, e.g.:
  - "This month: 1) raise term cover by ₹50 L, 2) you're better off on the
    new regime by ₹18k, 3) top up the SIP by ₹2,000."
- **Why:** your college wants agentic workflows. This is one with real
  tools, a fixed checklist (so it can't skip steps), and every number
  re-checked by the engine, as the advisor already does.
- **Effort:** M. Start with today's modules, and add B1–B4 as they land.

### B6. Loans: prepay or invest, and expensive debt first
- **What:**
  - **Home loan:** compare the after-tax loan rate (old regime: 24(b)
    interest deduction up to ₹2 L) with the expected after-tax return, as
    "guaranteed saving vs expected return", with the break-even shown, not a
    verdict.
  - **Expensive debt:** clear credit-card and personal-loan debt (often
    14–40%) before investing.
- **Why:** after "how much should I save", this is the most common Indian
  money question. The Full Plan only asks the EMI burden as a bucket.
- **Effort:** S–M.

### B7. Rent vs buy (maybe)
- **What:** for the "big purchase" goal. Down-payment opportunity cost, EMI,
  maintenance, rent growth, price-growth assumption. Show the **break-even
  price growth**, not a verdict.
- **Effort:** M.
- **Verdict:** maybe, after B1–B6.

### Deliberately still out
- Statement (CAS) upload and account-aggregator linking: consent and
  regulation. B1's typed entry gets most of the value without them.
- Product recommendations or insurance quotes: no honest data source, and
  that is advice.
- Anything gamified.

---

## 5. Notes on the research session's process and prompt

**What it did well:**
- strictly read-only;
- live checks on the real site;
- handoffs 13–21 tested in a scratch copy;
- an overlap table;
- every idea checked against the chart rules.

**What to correct in `PROMPT-for-goalden-session.md` before using it:**
- The port is **8000** (`local_server.py` default), not 8080. AGENTS.md is
  out of date on this too.
- It says "don't commit or deploy". In practice you use Claude Code to
  commit to `claude/new-session-4ynhj6`, push that branch and deploy, with a
  reviewer agent before each deploy. Say that instead, and name the branch.
  Never merge into main without asking.
- Use the group order in section 3, and apply each handoff's fixes from
  section 2 here.
