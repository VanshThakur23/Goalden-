# Goalden â€” Work Log

**Rule for all agents (Claude Code and opencode both):** Write a brief entry
here at the end of every session. One block, a few bullet points, done.
No prose â€” bullets only. The other agent reads this first to catch up fast.
Keep it short enough that even after 20 sessions it's still scannable.

Format:
```
## YYYY-MM-DD â€” <agent name>
- What was built or fixed (one line each)
- Any known issue or broken state left behind
- What's pending / what to do next
- Last commit pushed: <hash> <message>
```

---

## 2026-08-14 â€” Claude Code

- Fixed screen-transition CSS animation in all 3 door files (was never firing
  because `active` class was set before DOM insert; switched to forced-reflow
  pattern `void el.offsetHeight`)
- Fixed `position:sticky` panel in goalden-lab.html (root cause: `transform`
  in `@keyframes mainEnter` was silently breaking sticky on every render call;
  changed to opacity-only animation)
- Added floating "back to assumptions" button in goalden-lab.html for when
  panel genuinely isn't sticky (scroll listener + `.panel-jump-btn`)
- goalden.html: merged age+retire screens into one, merged edu_years+edu_duration
  into one; collapsed results comparison tail behind toggle
- goalden-door2.html: batched 9 profiling questions into 4 grouped screens;
  converted `why` text to tap-reveal; deleted dead `totalSteps()`; collapsed
  plan comparison tail behind toggle
- goalden-lab.html: CAL chart now labels risk-free rate; diversification-benefit
  box added; Monte Carlo drawdown now responds to historical-shock selector
- Created AGENTS.md (opencode handoff brief) and WORKLOG.md (this file)
- No known broken state
- Pending: Full conversational AI advisor (see AGENTS.md â€” big feature, not
  started; discuss scope with user before beginning)
- Last commits pushed: cc712b6, 47794c8, a565e47

---

## 2026-08-14 â€” opencode

- Started the conversational AI advisor (the big pending feature). Scope agreed:
  DeepSeek as LLM, type-first (voice later), local mock mode + env key.
- `src/worker.js`: added POST `/api/chat` â€” builds system prompt (Goalden intro,
  current page, current state, tool list, adapt-to-literacy instruction) and
  calls DeepSeek (`deepseek-chat`, key from `DEEPSEEK_API_KEY` Worker secret).
  Returns the assistant message incl. any `tool_calls`. CORS now allows POST.
- `local_server.py`: added matching POST `/api/chat`. Uses `DEEPSEEK_API_KEY`
  env var when present; otherwise returns a deterministic mock that drives the
  same tool loop (ask goal -> get_results -> plain-text) with no key/network.
- `goalden.html`: added floating advisor button + chat panel (outside #stage so
  it survives render()), plus the full tool loop. Tools: `navigate` (validated
  via `flow().indexOf`), `set_value` (canonical field enum built from S/C/RISK),
  `get_state`, `get_results`, `explain`. Model never mutates S directly â€” every
  action goes through `executeAdvisorTool`.
- Ported the advisor to the other three files:
  - `goalden-door2.html` (state `G`): fields for country, monthly expense/capacity,
    emergency status/prioritize, cap_0-3 & tol_0-4 scores; plus `add_goal` tool
    (retirement/education/house/generic); `get_results` = scoreBuckets + buildPlan.
  - `goalden-lab.html` (state `L`): `navigate` across TABS (+home); `set_value`
    with dotted fields (ret.*, step.*, swp.*, fx.*, joint.*, mc.*, health.*);
    auto-switches to the field's tab; `get_results` = calcRetLab / calcHealthScore
    for those tabs, input summary + note for the others.
  - `index.html`: navigate-only â€” `open_door` (quick/full/lab) redirects via
    window.location; `get_state` + `explain`; no set_value/get_results.
- Added the "knowledge layer" so the AI actually understands the app, not just
  a one-line intro. Each file now defines `ADVISOR_KNOWLEDGE` (purpose, screens/
  tools, assumptions per country, data sources) and sends it with every
  `/api/chat` call; both worker.js and local_server.py inject it into the
  system prompt ("answer from the knowledge above; if not covered, say so
  rather than guessing").
- Added voice (free browser Web Speech API, no key): mic button (STT) that
  fills the input and auto-sends, and a ðŸ”Š toggle (TTS) that speaks replies.
  Feature-detected â€” Firefox (no Web Speech) hides the mic and stays text-only.
  Wired identically in all 4 files.
- Verified: `local_server.py` compiles; mock `/api/chat` round-trips and the
  system prompt now includes the knowledge block. Frontend JS reviewed manually
  (no Node/browser in this env, so still not browser-tested).
- Known: NOT browser-tested â€” needs a manual pass in Chrome/Edge. Voice only
  works on Chrome/Edge/Safari (not Firefox) by browser design. No LLM key set,
  so real DeepSeek path is unverified.
- Pending: browser-test all four pages (cache-bust URLs, e.g. `goalden.html?v=2`);
  user sets `DEEPSEEK_API_KEY` (Worker secret + local env); later, the separate
  "portfolio advisor" persona.
- Last commit pushed: none by opencode (git/GitHub is Claude Code's job)

---

## 2026-08-14 (later) â€” opencode

### Part A â€” finish & harden the advisor (all 4 files unless noted)
- A1 security: `/api/chat` now origin-allowlisted (Worker's own origin +
  localhost:8000/8080), per-IP in-memory rate limit (20/min on
  CF-Connecting-IP), body cap (40 messages / 100KB). Market-data GETs keep `*`.
- A2 conversation survives navigation: `advisor.messages` + panel open state
  persisted to sessionStorage (`goalden_advisor_v1`), rehydrated + re-rendered
  on load, a system-role "[navigation] now on <page>" note appended on arrival,
  history trimmed to 24 messages (first user message preserved).
- A3 get_results real for all Lab tabs (stepup/swp/fx/joint/mc/portfolio/
  livefrontier/instruments) â€” reuses solveStepUpSIP, swpWithdrawal, fxCompare,
  solveJointEducationCorpus, monteCarloAccumulation, computePortfolioDerived,
  liveComputeMulti, etc. No new math.
- A4 thinking "â€¦" bubble; A5 min/max bounds on every ADVISOR_FIELDS entry;
  A6 explain keyword map deleted, replaced with highlight(element) tool;
  A7 voice lang follows country + currency/markdown stripped in TTS only;
  A8 role=log/aria-live, mobile fullscreen <480px, Escape closes, focus mgmt;
  A9 friendly "advisor isn't switched on" message for missing key.
- A10 (recommendation, see below).

### Part B â€” Portfolio Advisor (goalden-lab.html only)
- B1 tools: set_weights / apply_preset / analyze_portfolio / frontier_gap /
  list_assets â€” all wrap computePortfolioDerived, portfolioRatios,
  portfolioTailRisk, frontierGap, generateFrontier, roundPercentsTo100,
  PORTFOLIO_PRESETS. B2 tools: search_instruments / add_instrument /
  remove_instrument / compare_live (2-asset closed-form + 3+ liveComputeMulti
  tangency via bestSharpePoint); async tools return promises and advisorLoop
  now awaits them. B3 tools: run_monte_carlo / stress_test (calcRetLab with a
  temporary shock). B4 advice guardrail added to the system prompt (worker +
  local_server) + a one-line disclaimer under the Lab panel header. B5 Lab
  knowledge expanded with frontier/correlation/tangency/CAL/risk-free/
  diversification semantics.

### Part C â€” Results Canvas (goalden.html, goalden-door2.html, goalden-lab.html)
- C1 #resultCanvas: non-modal floating panel, opposite corner from the chat,
  header (title + minimize pill + close), body reuses the page's OWN chart/card
  builders. C2 show_result(kind) with a per-file enum (goalden: summary/delay/
  retire/fd/alloc; door2: summary/goals/alloc/profile; lab: summary). C3 each
  page's ADVISOR_KNOWLEDGE now tells the model to prefer show_result on
  results/plan screens. C4 Escape minimizes (not closes), reduced-motion +
  mobile handled.

### A10 â€” the duplication question (recommendation)
- The advisor block is now ~1,800 duplicated lines across 4 files and it is
  drifting. RECOMMENDATION: extract to a shared `advisor.js` loaded with a
  plain `<script src="advisor.js"></script>` before each page's inline script,
  with the per-page differences (state object S/G/L, tool enums, result kinds,
  knowledge text) passed in via a single `window.GOALDEN_ADVISOR` config object
  each page defines. The "self-contained files" rule predates a 1,800-line
  shared subsystem and is now costing more (4x fixes, guaranteed drift) than it
  saves. What breaks if we DON'T extract: every future fix still has to be made
  4x and the four copies will keep diverging. What breaks if we DO: a shared
  script is one more file to load (still no build step, just a static file);
  and the four files stop being fully self-contained, which the AGENTS.md
  convention explicitly warned about. My vote is to extract â€” the cost of
  drift now outweighs the cost of a shared file â€” but the user must decide.

### Known / not done
- NOT browser-tested (no Node/browser in this env). The mock path in
  local_server.py now exercises get_results on every page (not just Door 1).
- Part A11 (full browser pass) still pending on the user: cache-bust URLs,
  mic/voice in Chrome vs Firefox, cross-page conversation, both countries.
- Lab canvas is minimal (summary kind only) â€” flagged as "optional" in the
  brief.
- No commit made (per the git rule).

---

## 2026-08-14 (evening) â€” opencode

### Part D â€” Lab results canvas + mobile stacking (goalden-lab.html only)
- D1: ADVISOR_RESULT_KINDS expanded from 1 ('summary') to 9 â€” retirement,
  portfolio, livefrontier, mc, stepup, swp, fx, joint, health. Each build()
  re-invokes the tab's OWN chart function with a canvas-scoped chartId
  (cv-*): mountainChart/drawdownChart, frontierChart + computePortfolioFrontierData,
  liveFrontierChart (2-asset) / frontierChart (3+), fanChart, twinFatesChart,
  drawdownChart, fxCompare stat cards, jointTimelineChart, and the Plan Health
  score dial. No new chart code. build() now returns {ok, html|error} so a
  missing-input case (e.g. livefrontier with <2 instruments) returns a
  "ask the user for X first" error the model can read, instead of rendering
  an empty chart.
- D2: mobile fullscreen arbitration â€” added isMobile() + advisorMinimizeToFab();
  resultCanvasOpen() minimizes the chat to its FAB below 480px, and the FAB
  click handler minimizes an open canvas when the chat is re-opened, so only
  one panel occupies the fullscreen slot at a time (desktop unchanged).
- Braces counted by hand across every new object literal/function (the
  run_monte_carlo lesson): balanced, 12 resultCanvas* functions, no dangling
  references to the removed resultCanvasSummary.

### Known / not done
- Still NOT browser-tested (no Node/browser in this env). The canvas chart
  functions use deferChartInit + initChart, which should find the canvas
  container since resultCanvasOpen sets innerHTML before the deferred init
  runs â€” but this is unverified in a real browser and worth a specific check.
- No commit made (per the git rule).

---

## 2026-08-14 (night) â€” opencode

### Part E0 â€” extracted the advisor to a shared advisor.js (approved in A10)
- New file `advisor.js` (repo root) holds everything identical across the four
  pages: injected CSS, panel/canvas HTML injection, sessionStorage persistence,
  thinking indicator, the tool loop (advisorLoop/advisorSend), voice + caption,
  results-canvas machinery, and all DOM wiring. Loaded via a **plain
  `<script src="advisor.js"></script>`** tag placed right before `</body>`,
  AFTER each page's own inline `<script>`.
- Each page keeps its page-specific pieces and exposes them as a single
  `window.GOALDEN_ADVISOR_CONFIG = { state, knowledge, app, pageLabel, tools,
  page, screens, executeTool, lang, greeting, placeholder, showDisclaimer }`
  set before advisor.js loads; advisor.js reads that object (never hardcodes S/G/L).
- Removed the duplicated CSS, panel/canvas HTML, and shared JS from all four
  inline scripts (goalden.html, goalden-door2.html, goalden-lab.html,
  index.html). Behavior is byte-for-byte identical â€” no new features in this
  step beyond the shared file. Index has no results canvas (never did).
- The D2 mobile fullscreen arbitration (isMobile/advisorMinimizeToFab) moved
  into advisor.js, so it now applies to every page uniformly (was Lab-only).

### Part E1 â€” bigger chat + a real speech caption + better voice (in advisor.js)
- E1a: #advisorPanel now 460px wide, up to min(75vh,720px); message text
  15.5px / 1.55 line-height (was 13.5px / 1.45).
- E1b: advisorSpeak() now also shows the reply's text in a large top caption
  bar (#advisorCaption, 21px, high contrast, z-index 2000), tied to the spoken
  moment â€” hidden when ðŸ”Š is off, dismissed on tap / on speech end (+2.5s) /
  when a new message starts. One caption per reply.
- E1c: TTS picks the best available voice via onvoiceschanged + scoring
  ("Natural"/"Neural"/"Online"/"Google" > exact locale > default), cached per
  language, graceful fallback to whatever is installed.
- Fixed a caption race: a cancelled utterance's late onend used to hide the
  NEXT caption; added a monotonic advisorSpeechId guard + advisorStopSpeech().

### Verification note
- advisor.js brace/paren/bracket balance checked with a string/comment/regex/
  template-aware script (BALANCED). All four inline scripts' config objects and
  their seams were re-read by hand. Still NOT browser-tested (no browser here).
- The extracted config objects are the only new inline JS; the pre-existing
  render/calc code was untouched.

### Known / not done
- Browser-test everything (load order of advisor.js, CSS injection, caption,
  voice, cross-page persistence). The one risk to eyeball first: advisor.js
  must load after the inline script so GOALDEN_ADVISOR_CONFIG is set.
- No commit made (per the git rule).

---

## 2026-08-14 (night 2) â€” opencode â€” V2 Batch 1 (F0 + F1 + F2 + F4)

### F0 â€” BLOCKING payload bug (advisor dead on Test Real Investments)
- Root cause: advisor.js sent the whole `L` object as `state`, including
  `L.live.data`'s raw daily price arrays. Measured (2 instruments, ~1,238 bars
  each): **121,088 bytes BEFORE** vs **807 bytes AFTER** the fix (99.3% smaller).
  The 100KB Worker cap rejected it before the model ever saw it.
- Layer 1 â€” `stateForAdvisor()` hook: advisor.js now calls it when present
  (Lab supplies it), falling back to `state`. The Lab projection keeps derived
  facts per live instrument (symbol, label, currency, annualised return, vol,
  geoAnnual/cagr, n, date range, quality level) and drops prices + stats.returns
  + snapshot currency bloat.
- Layer 2 â€” pull-tools (Lab): `get_price_history(symbol, granularity)` (daily
  last-260 or ~60 downsampled points), `get_instrument_stats(symbol)`,
  `get_detail(path)` (dotted path into the COMPACT state, so raw prices are
  unreachable by construction). Nothing became invisible; the model just pulls
  detail on demand.
- Layer 3 â€” client-side guard in advisor.js `advisorBuildBody()`: if serialised
  body > 60KB, drop state to a skeleton + tell the model which pull-tools to use.
- Layer 4 â€” honest failure: "Request is too large" now maps to "try asking about
  one instrument or one tool at a time", byte size logged to console.
- Also fixed `get_state` in the Lab to return the compact projection (it was
  also serialising full L).

### F1 â€” caption gone, panel docks (advisor.js only)
- F1a: deleted `#advisorCaption` + advisorShowCaption/HideCaption/captionEl/
  captionTimer. Speaking is now a subtle `.adv-msg.bot.speaking` left-border +
  glow on the bubble being spoken. `advisorSpeechId` kept (still guards stale
  callbacks) via new `advisorUnmarkSpeaking()`.
- F1b: three panel modes â€” `fab` / `dock` (right edge, 400px, full height;
  `body.advisor-docked { padding-right:400px }` â‰¥900px so content shifts, NO
  transform) / `focus` (centred 680px, 90vh via left/right+margin auto, no
  transform). Header `#advisorMode` button cycles dockâ‡„focus; close/Escape â†’
  fab; FAB â†’ dock. Mode persisted in sessionStorage with `open`. Tool calls call
  `advisorEnterDock()` so the panel docks as the AI acts. <900px dock = overlay
  (no body shift); <480px existing fullscreen + canvas mutual-exclusion kept.

### F2 â€” actions visible and legible
- F2a: each page supplies `describeTool(name,args)` â†’ human sentence ("Setting
  retirement age to 55", "Running 1,000 simulations"), rendered as a quiet
  `.adv-step` row with a tick; falls back to raw only if absent.
- F2b: advisorLoop awaits ~350ms between consecutive tool calls (skipped when
  reduced-motion), so N actions read as N steps.
- F2c: advisorSetValue now returns a `touched` selector (Lab: exact
  `input[data-k=...][data-tab=...]`; door1/door2: `#stage .screen`), which
  advisorFlash pulses + scrolls into view after the change.
- F2d: `scroll_to(element)` added as a first-class tool on all four pages
  (aliases the existing scroll+pulse highlight).

### F4 â€” taught the model the new behaviour
- Rewrote the "Behavior note" in all four pages' ADVISOR_KNOWLEDGE: prefer
  driving the real interface (navigate â†’ set values â†’ scroll result into view â†’
  explain), use the workspace canvas only for side-by-side comparison, never
  describe a number without putting it on screen.
- Added to the system prompt (worker.js + local_server.py): narrate BEFORE
  acting, and after a multi-step sequence say what changed and what it means.

### Verification
- advisor.js brace-balanced (script check). Lab F0 pull-tools + describeTool
  re-read by hand. local_server.py compiles. Still NOT browser-tested.

### Known / not done (Batch 1)
- The old `show_result`/result-canvas path is still present but de-emphasised by
  F4's knowledge rewrite; it's retired properly in Batch 2 (F3g).
- Batch 2 (F7 + F3) and Batch 3 (F5 + F6) not started.
- No commit made (per the git rule).

---

## 2026-08-14 (night 3) â€” opencode â€” V2 Batch 2 (F7 + F3)

### F7 â€” "explain this graph on my screen"
- F7a: `read_current_chart()` + `read_current_result()` tools on the Lab,
  goalden and door2. The Lab version returns a per-tab structured description
  (chart title, axis meaning, notable points with real values, correlations,
  date range/sample size) built from the existing calc functions
  (calcRetLab, computePortfolioFrontierData, liveReadyItems,
  monteCarloAccumulation, etc.) â€” never fabricated, never read out of pixels.
  The doors return a simple result/plan description. `read_current_result` =
  the existing `advisorGetResults`.
- F7b: Lab ADVISOR_KNOWLEDGE now instructs the model to call read_current_chart
  first and ground every sentence in the user's actual numbers, referencing
  points by name; "a textbook definition of the efficient frontier is a failure
  state."
- F7c: chart-feature highlight targets added (frontier / fan / drawdown /
  mountain / timeline / twinfates), so the model can point at the real chart as
  it describes it. Point-level ECharts annotation (pulse the tangency dot) is
  NOT done â€” limited to pulsing the chart container.

### F3 â€” the Briefing (full-page composed document)
- New `#briefing` fullscreen surface in advisor.js (scrollable, title + close +
  print, `@media print` rule, Escape closes, chat collapses to FAB on open).
- `compose_briefing(title, sections, intro)` tool: the AI is the editor (picks
  sections, writes intro prose â€” HTML-escaped); the app is the renderer (every
  number/chart comes from the page's section builders, `{ok,html}` or
  `{ok:false,error}` so a missing-input section degrades to an honest "tell me
  X first"). Dispatched in advisorLoop, not the page.
- Lab section builders (14): headline, retirement, drawdown (SWP), montecarlo,
  stress, allocation, frontier, live, stepup, fx, joint, health, assumptions,
  next â€” reuse the existing resultCanvas* chart builders + a few new compact
  builders. F3b satisfied: a retirement briefing can include Monte Carlo +
  drawdown + step-up regardless of the current tab (sections call calc/chart
  functions against current state).
- goalden sections (3): headline, assumptions, next. door2 sections (5):
  headline, goals, allocation, assumptions, next.
- F3e partial: footer has a "Back to the app" button + print button; "open this
  in the Lab" and per-section "explain this" affordances not wired (deferred â€”
  the chip mechanism is Batch 3).

### F3g â€” retired the single-scenario kinds (recorded)
- Lab: all 9 old kinds became Briefing sections â€” retirementâ†’retirement,
  portfolioâ†’frontier, livefrontierâ†’live, mcâ†’montecarlo, stepupâ†’stepup,
  swpâ†’drawdown, fxâ†’fx, jointâ†’joint, healthâ†’health.
- goalden: 5 kinds (summary/delay/retire/fd/alloc) CUT â€” "show a chart already
  on screen" is replaced by F7 "scroll to it and explain it"; only
  headline/assumptions/next kept as sections.
- door2: 4 kinds (summary/goals/alloc/profile) CUT/merged â€” summaryâ†’headline,
  goalsâ†’goals, allocâ†’allocation, profile dropped (folded into headline);
  assumptions/next added.
- `ADVISOR_RESULT_KINDS`, `advisorShowResult`, and the `show_result` tool are
  removed from all three files (resultCanvas* builder functions remain, reused
  as section builders).

### Verification
- advisor.js brace-balanced (script check). door2 BRIEFING_SECTIONS re-read by
  hand. No functional leftover `show_result` references (only comments). Still
  NOT browser-tested.

### Known / not done (Batch 2)
- F7d (layered follow-ups) + F7e ("Explain this" affordance on every chart) +
  F3e's per-section explain/open-in-lab are deferred to Batch 3 â€” they reuse
  the F5 chip mechanism which lands there.
- Batch 3 (F5 chips + F6 portfolio/live understanding tools) not started.
- No commit made (per the git rule).

---

## 2026-08-14 (night 4) â€” opencode â€” V2 Batch 3 (F5 + F6)

### F5 â€” suggestion chips (discoverability)
- advisor.js: `advisorAsk(text)` (open dock + set textarea + call the real
  `advisorSend()`), a single delegated `document` click listener on
  `[data-advisor-ask]`, and `.advisor-chips/.advisor-chip/.advisor-ask-link`
  CSS. Chips are inert until clicked â€” zero API cost on render.
- Lab: `advisorChipsHTML(tab)` renders 2-3 tab-specific chips under each tool
  header (9 tabs). Live chips are conditional â€” with <2 instruments it shows a
  single "help me pick two" chip instead of the compare set. Questions are
  grounded in what each tool actually shows (e.g. "Stress-test this plan against
  2008", "What does this correlation actually mean?").
- Inline "Ask the advisor â†’" links next to key numbers: retirement corpus,
  portfolio Sharpe ratio, live correlation (`advisorAskLink(q)`).
- goalden.html: one contextual chip on the results screen (wording varies by
  goal type). goalden-door2.html: one chip on the plan screen. Both reuse the
  same `[data-advisor-ask]` path via their own `advisorChipsHTML()`.

### F6 â€” portfolio / live-market depth (goalden-lab.html)
- `explain_metric(metric)` â€” sharpe, volatility, beta, correlation, cagr,
  max_drawdown. Anchored to the user's actual current value (advisorPortfolioData
  for sharpe/vol/beta; live instrument stats for correlation/cagr/max_drawdown).
  Returns {ok:false, error} with an honest reason when not computable.
- `optimize_for(objective)` â€” max_sharpe | min_volatility | target_return |
  target_risk. Reuses bestSharpePoint / frontier sweep, then APPLIES the weights
  via the existing advisorSetWeights path so the sliders move and the user
  watches it; returns before/after return + risk.
- `compare_scenarios(a, b)` â€” two weight sets, measured via a temporary swap of
  L.portfolio.weights (the calcRetireAgeCompare pattern), rendered as a new
  `comparison` Briefing section through composeBriefing, deltas called out.
- `why_this_weight(asset)` â€” cluster's actual current weight + what it does for
  the mix, grounded in the live portfolio return/vol.
- `explain_instrument(symbol)` â€” live tab only; return/vol/cagr/max-drawdown +
  correlation with other loaded instruments, all from L.live.data (never new
  fetches, never invented fundamentals).
- Note: `maxDrawdownFromPrices` is one small NEW helper (peak-to-trough from
  prices) â€” the only genuinely new computation, added because the app had no
  max-drawdown figure to reuse. Everything else reuses existing math.
- All 5 tools wired once each in advisorTools / executeAdvisorTool /
  describeTool. Guardrail unchanged.

### Verification
- advisor.js brace-balanced (script check). The inline-script TAIL (everything
  from the F5/F6 additions onward) brace-balanced in all three door files via a
  string/comment/regex-aware check. Function-reference grep confirms every F6
  tool's callees exist exactly once. Still NOT browser-tested.

### Known / not done (Batch 3)
- F7d/F7e from Batch 2 still not wired: the chip click mechanism exists, but
  per-chart "Explain this" buttons and layered follow-up chips inside the chat
  were not added (they'd reuse the same advisorAsk path â€” small follow-up).
- No commit made (per the git rule).

---

## 2026-08-16 â€” opencode â€” Phase 0: demo resilience (6 fixes)

### 1. Persist + Resume (goalden.html, goalden-door2.html)
- S and G were page-memory only â€” refresh/Back/tab-discard lost the whole
  plan/questionnaire. Both now save state to localStorage on every render()
  (`goaldenD1State` / `goaldenD2State`, Lab's try/catch pattern).
- On load (boot IIFE replacing the bare `render()`): if a save exists AND
  si > 0, an explicit "Pick up where you left off?" overlay offers
  Resume / Start fresh â€” never silently restores. Restore clamps si to
  flow().length so it can't land on a blank screen. Decline clears the key.
- "Start over" (rb) needs no extra wiring: its render() re-persists si:0.

### 2. Mock / fallback mode (local_server.py, src/worker.js)
- `_mock_chat` was: any state â†’ always get_results â†’ dump 400 chars of raw
  JSON. Replaced with a scripted decision tree (all page-agnostic â€” reads
  each page's tool schemas from the request body):
  - term question / bare term ("what is a sip", "sip?") â†’ canned
    plain-language answer (9 terms: risk profile, SIP, corpus, inflation,
    frontier, Sharpe, Monte Carlo, diversification, compounding);
  - build request with no state â†’ the exact A/B choice the system prompt
    teaches the real model; picking B â†’ walk-through reply;
  - build request (or picking A) with tools available â†’ ONE batched turn of
    real calls: set_value country=IN (enum-valid on all 3 doors) â†’
    navigate (prefers results/plan/home; reads screen-vs-tab arg name) â†’
    get_results; then narration + get_results; then a formatted summary
    parsed from the tool JSON (camelCase/snake keys prettified, floats
    rounded, ok:false errors surfaced as "The app says: â€¦") + a real
    compose_briefing call (sections picked from the page's enum); then a
    wrap-up. Demo now shows step rows, navigation, the calc, and the
  briefing page with zero key/network.
- Worker: missing DEEPSEEK_API_KEY no longer hard-502s â€” returns 200 with
  a friendly "not switched on for conversations on this deploymentâ€¦ the
  rest of Goalden works normally" assistant message + console.log.

### 3. Timeouts + friendly errors (advisor.js, src/worker.js, local_server.py)
- AbortSignal.timeout(25000) on the client /api/chat fetch AND the Worker's
  DeepSeek fetch; local_server's urlopen timeout 60s â†’ 25s (mirror).
- Worker catch no longer leaks e.message verbatim: friendlyChatError()
  maps 429/5xx/timeout/other to four plain sentences, real error to
  console.log. local_server mirrors it (_friendly_chat_error, imported
  `re`), and do_POST's catch uses it too.
- Client error branch adds a Timeout/Abort case ("took too long â€” try
  again").

### 4. Lab country bug (goalden-lab.html advisorSetValue)
- Every value was parseInt/parseFloat'd, so set_value('country','IN')
  became NaN ("must be a number") â€” the advisor could never switch the
  Lab's country. Numeric coercion now only for spec.type integer/number;
  string enums pass through to the enum check.

### 5. Browser Back (goalden.html, goalden-door2.html)
- syncHistory() in render(): pushState('#'+screen) only when the hash
  actually changed (same-screen re-renders and popstate-driven renders
  don't push). popstate handler maps the hash to flow().indexOf(name)
  (clearing quickEdit/viewingCase as needed); vanished dynamic screens
  (case, emergency_choice, goal sub-screens) fall back to Back-button
  behaviour instead of a blank screen. Boot replaceState-wipes any stale
  #hash so a fresh visitor can't popstate onto an empty results screen.
  Advisor-driven navigate() flows through render(), so AI tours are
  Back-walkable too.

### 6. Escaped step rows (advisor.js)
- advisorAddStep() routed describeTool() text (which interpolates
  model-controlled tool arguments) into innerHTML raw. Now wrapped in
  advisorEscapeHtml() â€” hallucinated markup in a field name can't execute.

### Verification
- `node --check` on advisor.js, worker.js and every inline script in all 4
  HTML files: ALL OK (script: temp/opencode/check_phase0.py).
- local_server.py: py_compile OK.
- Mock decision tree: 17/17 scenario tests pass (term/bare-term/A-B/pick-A
  batched sequence/navigate arg names/summary formatting/briefing sections/
  honest ok:false error/walk-through/greeting/all 4 friendly-error classes)
  â€” temp/opencode/test_mock.py. Plus a live HTTP round-trip on :8071.
- friendlyChatError regexes reviewed against callDeepSeek's thrown shapes.
- Still NOT browser-tested (no browser in this env) â€” manual pass wanted
  for: resume overlay after mid-questionnaire refresh, Back walking
  screens incl. case/goal sub-screens, mock demo on each of the 4 pages.

### Known / not done
- No commit made (per the git rule).
- Door2 popstate into goal sub-screens keeps addingGoal=true if Back exits
  the add-goal flow (harmless: flow still contains them; forward Next from
  plan is not affected).
- Phase 1+ items from the critique (tooltip a11y, TTS emoji strip, Firefox
  mic hide, etc.) not started.

- Last commit pushed: none by opencode (git/GitHub is Claude Code's job)

---

## 2026-08-17 â€” opencode â€” Phase 0.5: response format

### Done
- advisor.js: bot messages now render markdown-lite â€” **bold**, "- "/"* "
  lists, and pipe tables â€” via innerHTML; user and system messages stay on
  textContent. Escape runs BEFORE the transform (advisorMarkdown), so model
  markup can't execute. Added minimal CSS for strong/ul/table inside bot
  bubbles.
- src/worker.js: replaced the mandatory 5-emoji template with MODE A/B/C
  selection (A=quick fact, B=numeric result with symbol rows, C=comparison
  pipe table); model declares mode on line 1 ("MODE: X"); the client strips
  that line before rendering. Updated the "other rules" reference.
- local_server.py: system prompt mirrored verbatim; mock now emits the same
  MODE prefix â€” MODE: A for term answers/greeting, MODE: B for build/plan
  replies and the demo turns â€” via a `_mock_mode()` helper.
- Added smoke-05.js (repo root): asserts innerHTML + MODE-strip in advisor.js,
  MODE A/B/C in worker.js and local_server.py, and runs the real
  advisorMarkdown transform (extracted from source) against bold/list/table/
  MODE-strip/escape inputs.

### Verified
- Self-checks 1â€“4 all pass (node -e checks + transform inline test).
- smoke-05.js: 11/11 PASS.
- node --check advisor.js + src/worker.js: OK.
- local_server.py py_compile OK; existing 17-scenario mock test still PASS.

### Constraints respected
- No build step âœ“ | local_server.py mirrored âœ“ | No client-side keys âœ“

### Known / not done
- No commit made (per the git rule).
- Not browser-tested: markdown rendering + table styling + MODE-strip need a
  visual pass (cache-bust URL).
- MODE: C tables render with a default border via the added CSS; polish TBD.

---

## 2026-08-17 â€” opencode â€” Phase 1: shared engine + tests

### Done
- Created goalden-engine.js (repo root): inflateExpense, realRate,
  corpusRequired, solveSIP, effectiveMonthlyRate, accumulationSchedule,
  marketSeries, marketName, compoundPath, marketGrowthPath, rollingWindows,
  worstWindow, bestWindow, + the SENSEX/SP500 data arrays. Loaded as a plain
  <script src="goalden-engine.js"> before each page's inline script. Bottom
  has a `typeof module`-guarded module.exports shim so it's require()-able
  from engine.test.js with zero effect on the browser tag.
- Reconciled accumulationSchedule to the superset signature across all 3
  pages: loops `periods` (was `years` in goalden.html + door2), returns
  `contributed` on every row (door2 used to drop it), supports `stepUp`
  (0 = flat). goalden.html (4 call sites) + door2 (3 call sites) renamed
  yearsâ†’periods and added stepUp:0; lab call sites unchanged (already used
  periods/stepUp). Formula is algebraically identical to before â€” no output
  change for existing (non-step-up) callers.
- Made the market helpers portable (the BLOCKER): marketSeries/marketName
  now take `country` as an explicit param instead of reading S.country /
  G.country. Updated their 5+1 call sites in each of goalden.html and door2.
- Removed the 6 shared math functions from all three pages (kept lab-specific
  solveStepUpSIP / swpWithdrawal / drawdownWithShock in the Lab).
- Fixed the stale goalden.html ENGINE comment (claimed /goalden-engine/
  engine.test.js) â†’ now points at goalden-engine.js + engine.test.js (root).
- Created engine.test.js: node --test, 8 tests, zero deps.

### Verified
- node --test engine.test.js: 8/8 PASS.
- grep: inflateExpense/realRate/corpusRequired/solveSIP/effectiveMonthlyRate/
  accumulationSchedule each appear exactly once (goalden-engine.js), zero in
  the three page files.
- goalden-engine.js has no S.country/G.country references (only a comment).
- All 3 pages include <script src="goalden-engine.js"> before their inline
  script; node --check clean on all inline scripts; node --check on
  goalden-engine.js clean.
- Numeric trace: goalden.html retirement 25yÃ—12Ã—5000 â†’ contributed 1,500,000;
  door2 20yÃ—12Ã—8000 â†’ 1,920,000; solveSIP round-trips to exactly 5000.

### Constraints respected
- No build step âœ“ | No behavior change to existing callers âœ“ | No new deps âœ“

### Known / not done
- No commit made (per the git rule).
- Not browser-tested: goalden-engine.js must actually load in a real browser
  (script ordering) â€” worth a cache-bust pass on all 3 doors.

---

## 2026-08-17 â€” opencode â€” Phase 2: verification layer

### Done
- Recompute-and-compare audit (Part A): BRIEFING_SECTIONS builders that bake
  state-derived numbers now also return a `figures` map {key:value} (goalden
  headline, door2 headline, Lab headline = all numeric scalar result fields).
  composeBriefing (advisor.js) re-reads those keys through a FRESH
  executeTool('get_results') (advisorRecomputeFigures) and blocks the whole
  briefing on any drift â‰¥0.1% â€” returns {ok:false, error:'figure_mismatch',
  section, key, reported, recomputed}. Clean briefings get a visible
  ".briefing-verified" stamp ("âœ“ Every figure recomputed from your inputs").
- Cross-field sanity flags (Part B): crossFieldSanity(state,country) added to
  all 3 pages, wired into get_results as a `flags` array. goalden.html: check
  2 (retirement corpus 15x-40x of annual expense) + check 3 (expense magnitude
  per country); skips check 1 (no capacity field). door2: check 1 (required
  SIP >1.5x stated monthlyCapacity); skips 2/3 (no single expense field).
  Lab: all three, gated on tab (retirement corpus/expense/magnitude, health
  SIP-vs-capacity).
- Advice guardrail in code (Part C): advisorGuardrail() in advisor.js, run on
  every bot message before the markdown transform. Rewrites only the flagged
  sentence (recommendation verb + ticker/price-phrase) with a neutral line and
  console.warn; descriptive mentions ("TCS returned 8%") pass through.
  Documented as best-effort heuristic, not a guarantee.
- Mirrored figure_mismatch + flags instructions into worker.js and
  local_server.py system prompts.
- Added smoke-02.js (repo root): 16 assertions covering figures/figure_mismatch/
  crossFieldSanity presence + the 3 guardrail test strings.

### Verified
- node --test engine.test.js: 8/8 PASS (goalden-engine.js untouched).
- smoke-02.js: ALL PASS (16).
- Forced-mismatch audit test (extracted real advisorRecomputeFigures): wrong
  corpus (150000 vs 1500000) â†’ figure_mismatch; clean figures â†’ ok:true; +1
  drift on a small figure (years 31 vs 30) â†’ figure_mismatch.
- Guardrail strings: "TCS returned 8%..." â†’ unchanged; "buy RELIANCE ... will
  reach 3000" â†’ neutral rewrite; "60% equity, 40% debt" â†’ unchanged.
- node --check clean on advisor.js/worker.js + all inline scripts; py_compile OK.

### Constraints respected
- No build step âœ“ | worker/local_server mirrored âœ“ | No new math formulas
  (recompute reuses get_results/calc paths) âœ“

### Known / not done
- No commit made (per the git rule).
- Not browser-tested: the stamp, the block-on-mismatch, and the guardrail
  rewrite need a real-browser pass (cache-bust URLs). No live DeepSeek key, so
  the figure_mismatch retry loop is only exercised via the local mock.

---

## 2026-08-17 â€” opencode â€” Phase "compound skills" (build_goal_plan / run_full_analysis)

### Done
- goalden.html: added a build_goal_plan tool (tool def + executeAdvisorTool
  branch + describeTool case). One call sets country + goalType + every
  goal-relevant param via advisorSetValue (no parallel validator), jumps to
  results, runs advisorGetResults, and returns {ok, results, flags, setFields,
  skipped}. Per-goal allowed-field map (retirement/education/generic); delay
  returns a clear error (it's a comparison, not a plan). Any bad set_value
  stops immediately with {ok:false, error, failedField} â€” no partial apply.
- goalden-door2.html: same build_goal_plan name, adapted to the multi-goal
  questionnaire â€” sets country + profiling fields (cap_0-3, tol_0-4,
  monthlyCapacity, emergencyStatus, etc.) via advisorSetValue and goals via
  advisorAddGoal, then runs buildPlan()/advisorGetResults once at the end.
- goalden-lab.html: run_full_analysis tool (different name â€” multi-tab page).
  Sets L.tab, applies params through advisorSetValue (dotted-path ADVISOR_FIELDS,
  accepts bare or dotted keys), runs that tab's advisorGetResults. One tab per
  call; no cross-tab composition.
- [skill-metric] console.log around each skill branch (performance.now delta).
- "Choice before action" prompt updated in goalden.html + door2 knowledge AND
  worker.js + local_server.py (byte-identical): option A now prefers the skill
  tool in one call, then compose_briefing; option B unchanged (primitives).
- Added smoke-06.js (repo root, 15 structural assertions).

### Turn-count comparison (derived, not live-measured)
- Before (primitives) a goalden.html "do it all" retirement = ~9 tool calls:
  set_value Ã—6 (country, goalType, age, retireAge, monthlyExpense, risk),
  navigate results, get_results, compose_briefing.
- After (skill) = 2 tool calls: build_goal_plan + compose_briefing.
- NOTE: this is a code-inspection estimate (no browser/live DeepSeek in this
  env); the exact primitive count depends on how the model batches set_value
  calls. Not a network-tab measurement.

### Verified
- smoke-06.js: ALL PASS (15). engine.test.js 8/8, smoke-05.js + smoke-02.js
  ALL PASS, mock test ALL PASS (no regression).
- grep -c build_goal_plan: goalden.html 6, door2 6; run_full_analysis lab 4.
- worker.js vs local_server.py: MODE: A count 4 vs 4; skill-tool mentions 2 vs 2.
- node --check clean on all JS + inline scripts; py_compile OK.
- No new math functions â€” the skill branches call advisorSetValue/
  advisorGetResults/advisorAddGoal only (grep confirms).

### Known / not done
- No commit made (per the git rule).
- Not browser-tested: skill execution + [skill-metric] logging + the
  invalid-param partial-apply rejection need a live pass (cache-bust URLs).
  Live DeepSeek still unverified (no key).

---

## 2026-08-17 â€” opencode â€” Phase 4: plan objects + approval

### Done
- Added two advisor-level tools in advisor.js (shared across all 4 pages, not
  per-page): propose_plan(steps) and execute_plan(planId). Tool defs live in
  ADVISOR_INTERNAL_TOOLS, appended to the page's tool list inside
  advisorBuildBody() (advTools().concat(...)), so the model always sees them.
- propose_plan stores advisor.pendingPlan = {id, steps, approved} â€” a field on
  the advisor object (NOT pushed into advisor.messages), so it survives
  advisorTrim() which only slices messages. Renders an editable checklist as a
  bot bubble (checkbox per step, default checked, label via textContent, one
  "Run plan" button).
- execute_plan runs only the checked steps IN ORDER through advExecuteTool
  (the same dispatch every other tool uses â€” no parallel path), collects
  {ranSteps, skippedSteps, results}, clears pendingPlan. planId mismatch â†’
  clear {ok:false, error}, never runs the wrong plan. Dispatch branches added
  in the tool loop alongside compose_briefing.
- "Run plan" click: executes the plan, feeds the result back as a synthetic
  tool round-trip, then continues the loop so the model closes out (briefing).
- New user message clears any lingering pendingPlan (no stale-plan confusion).
- worker.js + local_server.py "Choice before action" prompt updated
  (byte-identical): propose_plan first for multi-field/hesitant cases, direct
  skill tools still fine for a clearly-confirmed "just do it."
- Added smoke-07.js (repo root, 13 structural assertions).

### Verified
- smoke-07.js: ALL PASS (13). engine.test.js 8/8; smoke-02/05/06 ALL PASS
  (build_goal_plan/run_full_analysis/add_goal still present â€” no regression).
- propose_plan x5, execute_plan x6 in advisor.js (defs + dispatch + helper).
- pendingPlan: top-level advisor field; advisorTrim body has zero pendingPlan
  references; cleared on execute + on new user message.
- Functional test (extracted real executePlan): checked steps ran in order,
  unchecked step skipped + reported, pendingPlan cleared, wrong planId â†’
  {ok:false,error} with no execution.
- node --check clean (advisor.js, worker.js, all inline scripts); py_compile OK.

### Known / not done
- No commit made (per the git rule).
- Not browser-tested: checklist render, checkboxâ†’approved wiring, Run-plan â†’
  continue-loop flow need a live pass (cache-bust URLs). Live DeepSeek still
  unverified (no key).

---

## 2026-08-17 â€” opencode â€” Phase 6: agent eval harness

### Done
- agent-evals/runner.js (Node, zero deps): drives the real ReAct loop against
  local_server.py's /api/chat (POST body {messages, tools, state, knowledge,
  context}, mirroring advisor.js's advisorLoop). Loads each page's inline
  script + goalden-engine.js into a fresh vm context (minimal document/window/
  localStorage/echarts/setTimeout stubs) so the REAL executeAdvisorTool,
  advisorSetValue, advisorGetResults, advisorAddGoal, advisorTools and S/G/L
  state run inside each eval â€” no reimplemented tool executor (grep-confirmed 0
  copies). advisorGuardrail extracted from advisor.js for the guardrail check.
  compose_briefing/propose_plan/execute_plan are acknowledged-but-stubbed
  (recorded for toolsCalled; their DOM rendering is browser-only) â€” page-state
  tools execute for real.
- agent-evals/scenarios.json: 15 scenarios (greeting, 3 term Q&As, do-it-all
  mechanics (mock-only), retirement/education/generic do-it-all, walk-through,
  door2 do-it-all, lab retirement + Monte Carlo, guardrail, hesitantâ†’propose_plan,
  invalid-value). Assertions: toolsCalled / notToolsCalled / fieldsSet (dotted
  paths supported) / figures (computed from goalden-engine.js primitives, not
  hand-typed) / noRecommendation (post-guardrail text must carry no buy-ticker
  or price-target) / noTools / replyIncludes.
- Mode detection (probe â†’ mock vs live); `requiresLive` and `mockOnly` flags
  skip scenarios the current mode can't exercise (mock tree can't do
  build_goal_plan/propose_plan/guardrail; live model can't be asserted against
  the mock's scripted tool sequence).
- Non-zero exit on failure via process.exitCode (process.exit crashed
  0xC0000409 with live vm contexts on Windows â€” fixed).
- Fixed along the way: duplicate compose_briefing tool name (DeepSeek 400),
  empty `required`/array-without-items in internal tool schemas, and a
  state-leak bug (pageCtxCache shared S/G/L across scenarios â€” now a fresh
  vm context per scenario).

### Verified
- Tested under LIVE mode (DEEPSEEK_API_KEY is set in this env). Two runs:
  71% then 64% pass over run scenarios â€” the variance is real live-model
  non-determinism, not a harness bug.
- Consistent PASSES: greeting, 3 term Q&As, education do-it-all (build_goal_plan
  called), walk-through (build_goal_plan NOT called), lab retirement + MC
  (run_full_analysis called), invalid value (age stays null).
- Consistent FAILURES (real findings): retirement/generic/door2 do-it-all
  (model did not call build_goal_plan), hesitant (model did not propose_plan).
  Intermittent: guardrail â€” the ALL-CAPS ticker heuristic misses title-case
  names ("Reliance" vs "RELIANCE"), so a recommendation-shaped reply can slip
  through; surfaced by the harness, a genuine Phase 2 gap.
- Ground-truth figure check: page advisorGetResults corpus/SIP match
  computeFigure() (goalden-engine.js) to ~2e-5 relative â€” not hand-typed.
- Exit codes: 0 on pass, 1 on fail (verified). node --check runner.js clean.
- engine.test.js 8/8; smoke-02/05/06/07 ALL PASS (no regression).

### Known / not done
- No commit made (per the git rule).
- requiresLive scenarios are untestable in mock mode; mock-only scenario is
  untestable in live mode â€” the harness reports them as SKIP, and the pass rate
  is over "run" scenarios only. Live-mode pass rate is non-deterministic by
  nature; treat repeated-run averages as the signal.

---

### Claude Code verification + fixes on top of Phase 6
- Re-verified opencode's runner.js/scenarios.json by reading the full source
  (not trusting the WORKLOG self-report), then reproduced the 71%/64% runs
  independently against a second local_server.py instance (port 8010, run
  directly from the same shell as the harness â€” the Browser pane's dev server
  turned out to be in a different network namespace than Bash's shells, so
  the harness couldn't reach it there; confirmed via failing curl to
  127.0.0.1:8000 from Bash while the Browser pane reached it fine).
- **Fixed a real product bug the harness surfaced**: `advisorGuardrail`'s
  ticker check (`advisor.js`) only matched ALL-CAPS tokens
  (`/[A-Z]{2,10}/g`), so "You should buy Reliance now, it is a great pick"
  (title-case company name, no price target) was not flagged or rewritten â€”
  a genuine gap in Phase 2's guardrail enforcement, not a harness artifact.
  Added a second pattern matching a recommendation object right after a
  verb (buy/invest in/purchase/get + Capitalized word) and OR'd it into the
  existing ticker check. Verified with a standalone 5-case Node test
  (extracting the function, same technique as smoke-02.js) before and after;
  added a 4th permanent regression assertion to smoke-02.js covering this
  exact case.
- **Triaged the remaining 3 of 4 consistent "failures" as scenario-data
  gaps, not product bugs**: diagnosed each via throwaway debug scripts using
  runner.js's exported `loadPage` to print the model's raw per-step replies.
  In all 3 (retirement/generic do-it-all, door2 do-it-all, hesitantâ†’
  propose_plan), the model was correctly asking clarifying questions because
  the scenario's userMessages omitted required info (country, existing
  savings, or full risk-questionnaire answers) â€” not misbehaving. Fixed by
  making the 3 scenarios' userMessages complete enough to answer in one
  turn (see scenarios.json diff). This is a test-fixture fix, not a
  system-prompt or tool-schema change.
- **Left one finding deliberately unfixed and documented**: "lab run Monte
  Carlo" consistently calls the pre-existing `run_monte_carlo` primitive
  instead of the new `run_full_analysis` skill tool, across every run, even
  with all params stated explicitly. Likely cause: the scenario's phrase
  "Run a Monte Carlo simulation" lexically matches `run_monte_carlo` more
  directly than the generic `run_full_analysis`. Left as-is rather than
  further scenario-tuning or prompt engineering, to avoid overfitting the
  system prompt to one eval case â€” a genuine model tool-choice bias worth
  tracking, not a bug to silently patch away.
- Re-ran the full harness twice after the fixes: pass rate improved from
  71% (10/14 run, 4 failed) to 93% (13/14 run, only Monte Carlo still
  failing). Full regression suite re-run clean: engine.test.js 8/8,
  smoke-02..07 ALL PASS, `node --check` clean on advisor.js and runner.js.
- Committed as part of this same session's Phase 6 close-out (advisor.js,
  smoke-02.js, agent-evals/runner.js, agent-evals/scenarios.json,
  WORKLOG.md).

---

## 2026-08-17 â€” Claude Code â€” Phase 0 verification + fix, ROADMAP.md added

- Live-verified opencode's Phase 0 in the Browser pane against local_server.py
  (no key set, so mock mode exercised naturally): resume-on-refresh, browser
  Back walking screens, the Lab country `set_value` fix, and the mock demo
  flow (term question, "do it all" batched sequence, briefing render) â€” all
  confirmed working, zero console errors.
- **Found and fixed a real bug during verification**: `goalden-door2.html`'s
  resume feature was completely dead on normal page load. The `boot()` IIFE
  (the resume-prompt logic) had been pasted *inside* the plan-file-import
  handler's `try` block â€” between `G.si=f.indexOf('plan');` and its `catch`
  â€” instead of at top level. It only would have run if a user imported a
  plan file. The original unconditional `render();` was still sitting at the
  bottom of the file, so every page load skipped the resume check entirely
  and silently reset saved state to blank. `goalden.html`'s `boot()` was
  structured correctly and unaffected. Fixed by moving the IIFE to where the
  bare `render();` was and restoring the import handler's original
  `render();`/`catch` structure. Re-verified live: resume overlay now
  appears and restores correctly on door2.
- Added `ROADMAP.md` (repo root) â€” the multi-phase agentic roadmap opencode
  should read alongside this file each session. Phase 0 marked done there.
- Added Phase 0.5 (response format) to the roadmap after finding
  `advisorAddMsg` uses `div.textContent` (`advisor.js:234`) â€” the chat UI
  renders no markdown at all, so the model's own `**bold**` syntax shows as
  literal asterisks. Confirmed live in an earlier session's transcript. Folds
  in the standing critique that one rigid 5-row/100-word format is forced
  onto every reply type regardless of content.
- Committed and pushed Phase 0 (opencode's 6 fixes + my structural fix) and
  ROADMAP.md.
- Next: hand opencode the Phase 0.5 (response format) prompt.
- Last commit pushed: see git log.

## 2026-08-17 â€” Claude Code â€” Phase 7: packaging (README, instrumentation, trace panel)

Implemented directly (not via opencode) per explicit instruction to do this
phase myself.

### Done
- **Server-side usage/latency plumbing** (`src/worker.js`, `local_server.py`,
  mirrored): `callDeepSeek`/`_deepseek_chat` now time the upstream call and
  return DeepSeek's `usage` block (prompt/completion/total tokens) alongside
  the message; `/api/chat` responses carry `{message, usage, latencyMs}`.
  No-key/mock branches return `usage: null, latencyMs: 0` for a consistent
  response shape.
- **Client-side trace log** (`advisor.js`): `advisor.trace[]` records one
  entry per `/api/chat` round trip â€” tool calls or final reply, client
  round-trip ms, server-reported upstream ms, and the usage block. Lives as
  a field on `advisor` (like `pendingPlan`), so it survives `advisorTrim()`
  and isn't part of the message history sent back to the model.
- **Developer trace panel** (ðŸ” button in the advisor header): a fixed
  top-right panel (pattern matches `#resultCanvas`/`#briefing`) showing a
  live summary (calls, total tokens, round-trip/upstream ms, an estimated
  cost) and a reverse-chronological per-call log. Cost estimate uses a
  single labeled, comment-documented rate constant
  (`ADVISOR_PRICE_PER_M`) rather than claiming precision â€” real token counts
  are exact (from the API), the dollar figure is explicitly an estimate.
- **README.md** rewritten: added an agent-architecture section with a
  Mermaid sequence diagram of the `/api/chat` loop, a table of the three
  doors, and short sections on the verification layer, plan objects, the
  shared engine, and the eval harness â€” written for both a GitHub reader
  and an interviewer. Removed a stale claim ("this environment has no
  Node.js") left over from an earlier session.
- Fixed a brittle regression test while touching this code: `smoke-07.js`
  asserted the exact literal `const advisor = { messages: [], busy: false,
  mode: 'fab', pendingPlan: null }` â€” adding `trace`/`traceOpen` fields
  broke it on a change that had nothing to do with what the test was
  actually checking (that `pendingPlan` is a top-level field). Loosened to
  a field-presence regex.

### Verified
- Live in the browser (`goalden.html`, live DeepSeek mode): asked a real
  question, opened the trace panel, confirmed real numbers â€” 5,022 tokens,
  2,276ms round trip / 1,936ms upstream, $0.0014 estimated cost. Clear and
  Close buttons both work; empty state renders correctly after clearing.
  Zero console errors.
- `node --test engine.test.js`: 8/8 pass.
- `node smoke-02.js` through `smoke-07.js`: all ALL PASS (after the
  smoke-07 regex fix above).
- `node agent-evals/runner.js` against a second local_server.py instance
  (scratch port, killed after the run): 14 run / 13 passed / 1 failed / 1
  skipped â€” 93%, matching the Phase 6 baseline exactly. The one failure
  ("door2 do-it-all full plan" this run) is the same documented live-model
  non-determinism from Phase 6, not a regression â€” which scenario fails
  varies run to run, but the rate doesn't move.
- `node --check` clean on `advisor.js` and `src/worker.js`;
  `python -c "import ast; ast.parse(...)"` clean on `local_server.py`.

### Known / not done
- Cost-per-token rate in `ADVISOR_PRICE_PER_M` is a manually-set constant,
  not fetched from anywhere â€” update it if DeepSeek's pricing changes.
- Trace panel is session-only (not persisted to `sessionStorage` like
  `advisor.messages` is) â€” a page reload loses the log. Deliberate: it's a
  dev/demo tool, not a feature users depend on across reloads.

---

## 2026-08-17 â€” opencode â€” Phase 8: streaming responses

### Done
- src/worker.js: added callDeepSeekStream() (stream:true + stream_options.
  include_usage, same 25s abort; pipes res.body straight through as a
  text/event-stream Response â€” no delta parsing server-side). /api/chat handler
  branches on body.stream === true: no-key â†’ the static "not switched on"
  message wrapped as one SSE chunk; real key â†’ callDeepSeekStream; stream falsy
  â†’ unchanged callDeepSeek + chatJson. Origin/rate-limit/body-cap/message-cap
  all still apply before the branch.
- local_server.py: added _deepseek_chat_stream (byte-forwarding generator),
  _wrap_mock_as_sse (mock message â†’ one SSE chunk, tool_calls mapped by index),
  and Handler._send_sse (manual chunked transfer encoding). do_POST branches on
  body.get('stream') is True â†’ _send_sse; else the unchanged chat()+_send_json.
- advisor.js: advisorBuildBody() now sets stream:true (page UI only â€” the eval
  harness builds its own body and never sets it). New advisorFetchStream()
  reads resp.body via getReader(), buffers + splits on \n\n, accumulates
  content + tool_calls deltas (keyed by index, id/name/arguments concatenated),
  merges a trailing usage chunk, records ttfbMs on the first delta, and returns
  {message, usage, latencyMs:null, ttfbMs}. advisorLoop now streams a plain-
  text bubble as content arrives (never advisorAddMsg mid-stream), then
  finalizes it once with advisorMarkdown(advisorGuardrail(content)). A tool-call
  turn discards any streamed narration bubble so narration stays silent as
  before. Trace upstreamMs now reads ttfbMs (time-to-first-byte proxy) instead
  of the removed server-measured latencyMs.

### Verified (opencode)
- node --check advisor.js + worker.js clean; python ast.parse local_server.py
  clean (note: the task's exact `open()` command trips cp1252 on Windows â€”
  must pass encoding='utf-8'; the file itself parses fine).
- smoke-08.js: ALL PASS (21 assertions, incl. the negative check that
  agent-evals/runner.js + scenarios.json contain zero "stream" occurrences).
- Mock mode live test (Node fetch): stream:true â†’ 200 text/event-stream,
  body = data:{â€¦}\n\ndata:[DONE]; stream omitted â†’ 200 application/json, old
  shape byte-identical in structure.
- LIVE mode (DEEPSEEK_API_KEY set): one real streamed call â†’ 88 SSE events,
  content deltas present, [DONE] present, and the usage block arrived in a late
  chunk (prompt/completion/total_tokens + cache hit/miss) â€” confirms
  stream_options.include_usage works against DeepSeek's API.
- Client accumulation tested against a fake chunked SSE (content split across
  chunks, a tool_call whose name+arguments were split across two deltas):
  reassembled to content "Hello world", tool_call {id:call_x, name:set_value,
  arguments:{"field":1}}, usage merged, ttfbMs numeric â€” PASS.
- engine.test.js 8/8; smoke-02/05/06/07 ALL PASS (no regression).

### Known / not done (opencode)
- NOT browser-tested: the visible type-out, the deferred guardrail/markdown
  finalization, and the tool-call-turn bubble-discard need a live-browser pass
  (cache-bust URL) â€” Claude Code's job.
- The earlier manual curl checks failed purely from PowerShellâ†’curl arg quoting
  mangling, not the code; Node-fetch verification is authoritative.

### Claude Code verification â€” found and fixed a real data-loss bug in local_server.py

Live-browser testing (goalden.html, real DEEPSEEK_API_KEY, actual chat UI) of
opencode's streamed replies showed small words silently missing at scattered
positions â€” e.g. "SIP (Systematic Investment)" missing "Plan", "not putting
all your eggs in one." missing "basket". Reproduced 3/3 in the browser.

**Root-caused with a byte-level tee-and-diff**, not guesswork:
- The literal shipped `advisorFetchStream` (extracted verbatim from advisor.js
  and eval'd) ran clean 5/5 times in Node â€” ruling out the client-side SSE
  parsing algorithm as the cause.
- Instrumented local_server.py to tee every byte `_deepseek_chat_stream` read
  from DeepSeek to a log file, then made one browser request and compared: the
  server read 306 complete, correct characters from DeepSeek; the browser only
  reassembled 293. The 13-character gap matched exactly three missing
  substrings ("your ", ",", " basket") â€” proving the loss happened between
  `_send_sse`'s write and the browser's receipt, not before.
- **Root cause**: `_send_sse` hand-rolled HTTP chunked transfer encoding
  (`Transfer-Encoding: chunked` + manual `%x\r\n<data>\r\n` framing per
  ~4096-byte upstream read). Node's fetch/undici tolerated whatever was subtly
  off in that framing; Chromium's HTTP parser silently dropped bytes from some
  frames.
- **First fix attempt (no framing, `Connection: close`, raw byte writes) did
  not fix it** â€” same symptom persisted on a re-test. Root-caused *that* to a
  stale process: two old server instances were still bound to the test ports
  (Windows allows multiple `SO_REUSEADDR` listeners; the "restarted" server
  was answering from the old, un-fixed code all along, confirmed via a raw
  TCP socket client bypassing all HTTP libraries â€” it read back
  `Transfer-Encoding: chunked` headers from a process I'd supposedly killed).
  Force-killed every PID actually bound to the ports (`netstat -ano`), started
  one clean instance, and re-verified: raw-socket read and 3 separate browser
  fetch() calls all reassembled byte-for-byte identical, complete content
  (lengths matched the server-side tee exactly: 311/421/353 chars, zero loss).
- `local_server.py`'s `_send_sse` now sends no `Transfer-Encoding` header and
  no manual framing at all â€” it writes raw bytes and signals end-of-body via
  `Connection: close`, avoiding any possibility of a chunk-framing bug. This
  is dev-only; `src/worker.js`'s `callDeepSeekStream` was never affected since
  Cloudflare's native `Response(readableStream)` piping has no hand-rolled
  framing to get wrong.

### Verified (Claude Code)
- `python -c "import ast; ast.parse(...)"` clean on the fixed local_server.py.
- `node smoke-08.js`: updated the two assertions that asserted the OLD
  chunked-encoding implementation's presence to instead assert `Connection:
  close` and the absence of a hand-rolled `Transfer-Encoding` header â€” ALL
  PASS, 21/21.
- `node smoke-02/05/06/07.js`: ALL PASS. `node --test engine.test.js`: 8/8.
- Live in the browser (goalden.html, cleared chat, real DEEPSEEK_API_KEY):
  two fresh questions ("what is a mutual fund, briefly?", "what is
  compounding, briefly?") both rendered complete, coherent, correctly
  streamed replies with zero console errors â€” confirms the visible type-out,
  deferred guardrail/markdown finalization, and the fix all work end-to-end
  through the real UI, not just raw-fetch diagnostics.

### Known / not done
- No commit made yet (per the git rule â€” pending user review).
- Diagnostic/scratchpad scripts used for root-causing (byte-tee server,
  raw-socket test client) live outside the repo in the session scratchpad,
  not committed.

---

## 2026-08-17 â€” opencode â€” Phase 9: federated tooling (read-across)

### Done
- Added a read-only `read_other_page(page)` tool to all three pages
  (goalden.html, goalden-door2.html, goalden-lab.html) â€” client-side only,
  reads the OTHER two pages' saved localStorage via the existing Phase 0 keys
  (goaldenD1State / goaldenD2State), returning {page, asOf, state} (or a "no
  saved data yet" note). Wired into advisorTools / executeAdvisorTool /
  advisorDescribeTool on each page.
- Field-ownership rule held: readOtherPage returns a fresh Object.assign({},
  saved) object and never writes into S/G/L, never calls set_value/render,
  never writes localStorage (read-only). The model can only quote it.
- Added a `_savedAt` timestamp to Door 1/2's persistState (via Object.assign so
  the existing resume logic keeps working unchanged), and added a Lab
  full-state snapshot (goaldenLabState = stateForAdvisor() compact projection,
  no raw price arrays) saved in the Lab's render() â€” the Lab previously
  persisted only cosmetics, so read-across had nothing meaningful to read.
- System-prompt addition in worker.js + local_server.py (mirrored):
  read_other_page returns READ-ONLY context from another page; never call
  set_value with values copied from it without the user's explicit
  confirmation.
- Added smoke-09.js (repo root, 38 structural assertions).

### Verified
- node --check clean (advisor.js, worker.js + all inline scripts); python
  ast.parse local_server.py clean.
- smoke-09.js: ALL PASS (38) â€” tool defined+wired on all 3 pages, readOtherPage
  body is read-only (reads localStorage, never writes, never set_value/render/
  S-G-L assignment), keys are the OTHER pages', Lab persists goaldenLabState,
  worker/local_server mirror matches.
- smoke-02/05/06/07/08 all PASS; engine.test.js 8/8 (no regression).
- agent-evals loadPage still OK for all 3 pages (Lab render now calls
  persistLabState â€” confirmed no vm break).
- Functional test (extracted readOtherPage): door2 read returns {page, asOf,
  state} with _savedAt stripped; no-data â†’ {state:null, note}; invalid page â†’
  clear error.

### Known / not done (opencode)
- NOT browser-tested: cross-page read-across needs a same-origin browser session
  (each page actually writing then reading localStorage across a real tab flow).
- Read-across is intentionally read-only; write-across and compose_briefing /
  Phase-2-audit blending are future phases (out of scope).

### Claude Code verification
- Ran the exact same-origin cross-tab flow opencode flagged as untested: on
  goalden.html, set real S values (country/goal/age/retireAge/expense) and
  called persistState(); on goalden-lab.html, called persistLabState(); then
  on goalden-door2.html called the real shipped readOtherPage('door1') and
  readOtherPage('lab') directly (not a reimplementation).
- Door 1's read came back exact and complete: country IN, age 30, retireAge
  60, goal retirement, expense 50000 â€” everything persisted, nothing dropped.
  Lab's read came back with the expected keys (ret, portfolio, mc, snapshots,
  etc.), asOf populated on both.
- readOtherPage('bogus') returned a clean {ok:false, error:...} listing valid
  pages, not a throw.
- Confirmed Door 2's own G object was byte-identical before and after both
  reads (gMutated: false) â€” the read-only/no-merge guarantee holds live, not
  just in the smoke-09.js regex checks.
- Zero console errors throughout. `node smoke-02..09.js` + `node --test
  engine.test.js` all green; `node --check`/`ast.parse` clean.
- Phase 9 (read-across) verified green end-to-end.

---

## 2026-08-18 â€” Claude Code â€” two production-affecting bugs found live, both fixed

Found while helping the user interpret real-world behavior they hit on the
**deployed** site (goalden.vanshsingh23.workers.dev) â€” separately confirmed
that deployment predates all of Phase 8/9/the chat redesign, so this
diagnosis is about pre-existing behavior, not a regression from today's work.

### Bug 1 â€” Phase 9 broke every live local_server.py chat call (502)
`_build_system_prompt`'s read_other_page description used an f-string with
`({page, asOf, state})` meant as literal illustrative text â€” but an f-string
treats bare `{...}` as an expression to evaluate, so Python tried to
evaluate `asOf` as a variable and crashed with `NameError: name 'asOf' is
not defined` on every single call to `_build_system_prompt`, i.e. every
non-mock chat turn (streaming and non-streaming both call it). `ast.parse`
never catches this â€” it's syntactically valid Python, only a runtime crash
when the f-string is actually evaluated. Neither opencode's nor my Phase 9
verification exercised this path: both only checked syntax and the
client-side `readOtherPage()` mechanism, never a real chat call through
local_server.py's non-mock path. **Fixed**: escaped the literal braces
(`{{page, asOf, state}}`). Confirmed the fix by calling
`local_server._build_system_prompt()` directly in a Python REPL (builds
clean, 7725 chars) and via a live `/api/chat` call (200, not 502). Does not
affect worker.js â€” JS template literals don't have this bracket-collision
issue, so production's Cloudflare Worker path was never at risk (moot for
now anyway since none of this is deployed).

### Bug 2 â€” advisor over-triggers "Choice before action" on informational questions
User asked (paraphrased) "which stocks should I choose, small-cap or
mid-cap?" and the model, instead of just answering, launched the mandatory
A/B "do it all / walk me through it" plan-building prompt, then â€” once the
user supplied age/retirement-age/expense numbers thinking that was leading
toward a stock recommendation â€” called build_goal_plan + compose_briefing
unprompted, auto-navigating to Door 2's full-plan screen and opening a
full-page report the user never asked for. Root cause: the "Choice before
action" rule in both system prompts fires on any language that's merely
plan/money-adjacent ("build/create/set up/calculate/plan anything"), with no
carve-out for a general or comparison question about an investment
category. **Fixed** (worker.js + local_server.py, mirrored): added an
explicit negative example â€” a question like "what is a small-cap stock" or
"how do small-cap and mid-cap compare" is NOT this trigger, even if it
mentions money/risk/investing; answer it directly instead.

### Verified
- `node --check`/`ast.parse` clean on both files.
- `node smoke-02..09.js` all PASS; `node --test engine.test.js` 8/8.
- Live reproduction against a real DeepSeek call (DEEPSEEK_API_KEY set):
  the exact small-cap/mid-cap phrasing from the user's screenshot now gets a
  direct, guardrail-respecting answer with no plan-building detour; a
  literal "can you build me a retirement plan?" still correctly triggers the
  A/B choice â€” confirms the fix didn't overcorrect.
- Ran `node agent-evals/runner.js --base http://127.0.0.1:8091` (full live
  suite, real model): 12/14 passed (86%), 1 skipped. The 2 failures are both
  pre-existing, already-documented live-model non-determinism from Phase 6
  (the "lab run Monte Carlo" tool-choice bias, and one scenario that's
  intermittent â€” re-ran "hesitant user gets a plan to approve" alone
  immediately after and it passed clean). Neither is a regression from this
  session's wording change.

---

## 2026-08-17 â€” opencode â€” Phase 10: real portfolio tools on Door 1/2

### Done
- Part A â€” extended goalden-engine.js with 13 functions ported verbatim from
  goalden-lab.html (computeDailyReturns, auditPriceSeries, computeReturnStats,
  alignReturns, populationCovariance, computeCovarianceMatrix, portfolioReturn,
  portfolioVariance, twoAssetFrontier, minVarianceWeightTwoAsset,
  tangencyWeightTwoAsset, capitalAllocationLine, liveFrontierChartOption),
  exported via the file's existing module.exports shim. The Lab's own copies
  are untouched (deliberate additive duplication to avoid risk).
- Added 6 engine.test.js cases (14 total now): computeReturnStats daily
  mean/sd + annualization, computeCovarianceMatrix (perfectly correlated /
  anti / mixed + diagonal identity), twoAssetFrontier endpoints + interior
  min, minVarianceWeightTwoAsset (interior + high-corr clamp),
  tangencyWeightTwoAsset (RELIANCE/TCS-style: negative-excess-return asset â†’
  picks the higher-Sharpe pure holding, NOT the naive clamp), capitalAllocationLine
  starts at (0, rf).
- Part B â€” added 5 tools to goalden.html AND goalden-door2.html (S.instruments /
  G.instruments, capped at 4): search_instruments (Yahoo /api/symbolsearch),
  add_instrument (/api/history equity|fund + computeReturnStats, rejects
  quality 'unusable' with the flag messages), remove_instrument,
  compare_portfolio (exactly-2, correlation/min-variance/tangency with
  return/vol/Sharpe), render_frontier_chart (floating panel via the page's
  initChart + engine's liveFrontierChartOption). Ported liveApiGet; lastFrontierData
  is a module var (not persisted, not in S/G). Tool defs + dispatch +
  describeTool wired three-point-style.
- System prompt (worker.js + local_server.py, mirrored): expanded the Advice
  guardrail (MAY now covers discussing a named instrument via a tool, never from
  memory) + added the "Real-stock portfolio comparison" paragraph (use the 4-tool
  chain, never build_goal_plan, 2-asset-only, Lab-only for N>2/Monte Carlo/stress),
  and extended the "Choice before action" small-cap carve-out with a matching
  portfolio-comparison carve-out.
- Added smoke-10.js (repo root, 62 structural assertions).

### Verified
- node --test engine.test.js: 14/14 PASS.
- node smoke-09.js: ALL PASS (Phase 9 untouched). node smoke-10.js: ALL PASS.
- smoke-02/05/06/07/08: ALL PASS (no regression).
- node --check clean (goalden-engine.js, worker.js + all inline scripts);
  python ast.parse local_server.py clean.
- agent-evals loadPage OK for all 3 pages; goalden.html now exposes 16 tools,
  door2 17 (both include the 5 new portfolio tools); Lab untouched (30 tools).
- Functional test (vm-injected 2 synthetic instruments â†’ compare_portfolio):
  returns the right structure (instruments/correlation/minVariance/tangency,
  weights summing to 1, riskFreePct). Note: synthetic constant-return data
  produced volâ‰ˆ0 + a numerically noisy correlation â€” a test-data artifact, not
  a code issue; the real math is covered by the engine tests above.

### Known / not done
- No commit made (per the git rule).
- NOT browser-tested: the floating frontier panel + render_frontier_chart visual,
  and the full searchâ†’addâ†’compareâ†’chart chain, need a live-browser pass
  (cache-bust URLs) â€” Claude Code's job.
- render_frontier_chart's floating panel is position:fixed top-left to avoid the
  advisor's right-side dock; polish (dismiss-on-Escape, mobile sizing) left for later.

---

## 2026-08-18 â€” Claude Code â€” Phase 11: BM25 retrieval layer (tool routing + knowledge grounding)

### Context
opencode started Phase 11 but its session ended before finishing: it built
and tested the BM25 core (goalden-engine.js + a duplicate in worker.js) and
wrote filterTools/filterKnowledge helpers, but never wired them into the
actual request flow (buildSystemPrompt and the DeepSeek call sites still
used raw, unfiltered body.tools/body.knowledge), and local_server.py wasn't
touched at all. Claude Code finished the phase directly.

### Done
- Wired filterTools/filterKnowledge into worker.js: body.tools and
  body.knowledge are now reassigned from the filtered output right before
  buildSystemPrompt is called, so both the prompt text AND the tools param
  actually sent to DeepSeek see the routed set (filtering only the prose
  without also filtering the API payload would have been a half-fix).
- Ported the entire BM25 layer to local_server.py from scratch (bm25 core,
  _filter_tools, _filter_knowledge, _route_body) and wired it into both the
  streaming and non-streaming /api/chat paths. Verified the Python and JS
  implementations produce identical routing decisions on the same input.
- **Found and fixed a real bug via live verification, not just structural
  tests:** BM25 scores each tool independently, but add_instrument's
  description ("fetch price history, pass a ticker") shares no vocabulary
  with a natural query like "which stocks should I pair to minimize risk" â€”
  so it scored 0 and silently dropped out of the filtered set, even though
  compare_portfolio cannot function without it having been called first.
  This would have broken the Phase 10 portfolio tool chain the moment
  routing went live. Fixed with tool-family grouping: if any member of a
  declared family (the 5 portfolio tools) survives ranking, every member of
  that family is kept, mirrored identically in goalden-engine.js, worker.js,
  and local_server.py.
- Added a regression test for the family fix (engine.test.js) plus
  smoke-11.js (23 structural assertions, including checks that the
  reassignment actually happens *before* buildSystemPrompt is called, not
  just that the filter functions exist somewhere in the file).
- Part C (knowledge chunking) wired at the routing layer (filterKnowledge/
  _filter_knowledge handle an array of chunks correctly), but no page yet
  sends ADVISOR_KNOWLEDGE as chunks â€” client-side chunking left as a
  follow-up; harmless no-op today since a plain string passes through
  unchanged.

### Verified
- node --test engine.test.js: 22/22 PASS (14 pre-existing + 6 opencode BM25
  tests + 1 new family-grouping regression test + 1 more).
- node smoke-09.js, smoke-10.js: ALL PASS (no regression).
- node smoke-11.js: ALL PASS (23 assertions).
- node --check / python ast.parse clean on all three touched files.
- Live in browser (goalden.html, real ADVISOR_CFG.tools(), 16 tools):
  query "which stocks should i pair with apple to minimize risk" now
  retains the full 5-tool portfolio chain (search/add/remove/compare/
  render) together with build_goal_plan and other utility tools; confirmed
  identical behavior in the Python mirror; zero console errors.

### Known / not done
- Client-side knowledge chunking (splitting ADVISOR_KNOWLEDGE into an array
  per page) not implemented â€” lower-stakes than tool routing per the
  original scope note, left for a follow-up.
- No commit made yet in this entry's session â€” see next commit.

---

## 2026-08-18 â€” Claude Code â€” Phase 12: AI-chosen chart type for portfolio comparisons

### Context
Scoped down from the earlier "AI-composable chart/report tool" discussion,
deliberately kept narrow and sequenced after Phase 11 so the model has
grounded tool descriptions to choose from. The AI now picks among 3
predefined chart types for the existing 2-asset comparison instead of
always rendering the frontier chart â€” reusing 100% tool-computed numbers,
zero new hallucination surface.

### Done
- goalden-engine.js: added barComparisonChartOption(assetPoints) and
  radarComparisonChartOption(assetPoints, minVariance, tangency,
  riskFreeRate), pure chart-option builders matching the existing
  liveFrontierChartOption's palette/fonts. Exported via the module.exports
  shim.
- comparePortfolio() in goalden.html and goalden-door2.html now stashes
  minVariance/tangency/riskFree on lastFrontierData so the radar builder
  has what it needs.
- renderFrontierChart(chartType) â€” was renderFrontierChart() â€” validates
  chartType against ['frontier','bar','radar'] (default 'frontier'),
  branches to the right builder. Refactored the panel header to a
  dedicated #advisor-frontier-title div so the title updates per chart
  type without fragile innerHTML surgery on the close button.
- render_frontier_chart's tool schema gained an optional chartType enum
  with a description of when to use each; dispatch forwards
  args.chartType; describeTool reflects the chosen type.
- worker.js and local_server.py system prompts both got one added
  sentence telling the model to actually pick a chartType instead of
  defaulting to frontier out of habit (mirrored wording).
- goalden-lab.html deliberately untouched â€” keeps its own toolset.

### Verified
- node --test engine.test.js: 25/25 PASS (3 new Phase 12 tests: bar series/
  category shape, radar indicator/data-point count, radar axis bounds).
- smoke-09.js, smoke-10.js, smoke-11.js: ALL PASS (no regression).
- smoke-12.js (new, 18 assertions): ALL PASS â€” builders exist/exported,
  both doors wire chartType through schema/dispatch/render, lab untouched,
  both server prompts carry the guidance sentence.
- Live in browser, both goalden.html and goalden-door2.html: added
  RELIANCE.NS + TCS.NS, called compare_portfolio, then
  render_frontier_chart with no chartType / 'bar' / 'radar' â€” all three
  render, panel title updates correctly each time ("Efficient frontier" /
  "Return vs. risk" / "Risk/return profile"), zero console errors on
  either page.

### Known / not done
- Nothing outstanding. Ready to commit.

---

## 2026-08-18 - opencode - "Read the Company": Explore deck + layout pass

### Done
- **Explore (the big build):** a fullscreen comparison deck on "Read the
  Company", opened from a new â›¶ Explore button on the Bench card and the
  topbar. Two modes: *Over time* (up to 3 metrics as indexed lines / rupee
  bars / %-of-sales, any loaded company) and *X vs Y* scatter (each point is
  one fiscal year, labeled FYxx when â‰¤14 points, tooltip carries both raw
  values). Year From/To window filters both modes. Pickers list EVERY
  reported row via a per-company catalog (not just canonical rows), seeded
  with Sales / Net Profit / OPM % on first open. Self-contained overlay:
  opens/closes/patches only itself â€” never calls render() or
  updateStatementsUI() (grep-verified: zero full-render calls in the module),
  so __statementsRenderCount cannot move while it is open. Esc closes it via
  a capture-phase handler that preempts the existing pin-clearing Escape.
  teardownStatements() disposes its chart and closes the overlay on tab exit.
- statements-engine.js: +3 pure helpers behind the deck â€” stmtExploreCatalog
  (deterministic plottable-row catalog, skips rows with no FY values),
  alignFyPairs (common-year X/Y alignment for the scatter, drops nulls),
  pctOfSalesSeries (% of same-year sales, null where sales â‰¤0/missing) â€” all
  exported through the existing api shim.
- engine.test.js: +6 tests (89 total now): catalog ordering + empty-row skip
  (synthetic + real TCS fixture), alignFyPairs common-years/null handling,
  pctOfSalesSeries conversion + refusal-on-non-positive-sales.
- Layout pass: jump-nav/card targets get scroll-margin-top so the sticky nav
  never covers a landing title; print rules (nav/topbar hidden, table overflow
  released, sticky cells relaxed, cards avoid page breaks); Bench chips now
  carry each row's latest reported figure ("Sales Â· â‚¹x Cr") using the same
  formatCellRaw arithmetic; second Bench title line names the pin mechanism.

### Verified
- node --test engine.test.js: 89/89 PASS (incl. 6 new).
- smoke-02, 05â€“13: ALL PASS (no regressions; literal-string checks intact).
- Inline-script parse check across all four HTML files: ALL OK.
- agent-evals loadPage('goalden-lab.html') still loads clean after the new
  top-level listeners.
- Architecture tripwire: grepped the whole Explore module (319 lines) â€” zero
  calls to updateStatementsUI( or render( ; the only regex hits are the
  comment saying so.

### Known / not done
- No commit made (per the git rule).
- NOT browser-tested here (no browser in this env): overlay visuals at narrow
  widths, chart resize behavior inside the fixed deck, and the exact feel of
  the scatter labels need Claude Code's live pass. Everything structural is
  verified as above.

---

## 2026-08-18 - opencode - "Read the Company" round 3: layout hierarchy + sticky nav + chrome collapse

### Done
- **Grid layout (the rectangle-stack fix):** #stmtRoot is now a 12-column
  CSS grid. The four statement tables span full width (dense tabular data
  needs it); everything else gets varied spans:
  - Overview (stmtHeaderCard): full width â€” identity + box score needs it
  - Build a comparison (stmtExploreCard): 5/12 columns, dashed border,
    tinted background, no shadow â€” reads as a launcher, not a data panel
  - NP vs CFO chart (stmtNpCfoCard): 7/12 columns, chart height reduced
    360â†’300px for a squarer feel; sits beside the comparison launcher
  - Growth & Returns (stmtDepth): 6/12, lighter shadow
  - Compounding (stmtChecklist): 6/12, lighter shadow
  - Refusal, footer, ToLive: full width
  - #stmtRefusal:empty{display:none} â€” no ghost grid cell
  - <860px: everything collapses to single column via !important
- **Sticky auto-hide jump-nav:** position:sticky;top:10px;z-index:30.
  Scrolling down slides it out (translateY calc(-100% - 4px) + opacity:0);
  scrolling up slides it back. Always visible at scrollTop < 80. rAF-
  throttled passive scroll listener on main, scoped to L.tab==='statements'.
  Transition on transform+opacity only â€” no layout, no re-render.
- **Chrome auto-collapse on tab entry:** entering 'statements' for the
  first time sets L.headerCollapsed=true and L.navCollapsed=true (the same
  state the existing toggle buttons set). Module-scoped flag
  (stmtChromeAutoCollapsed) fires once per visit, resets on tab leave.
  Manual expand/collapse buttons work as before in both directions.
- Added id="stmtNpCfoCard" and id="stmtToLiveCard" to previously anonymous
  cards so the grid can target them.

### Verified
- node --test engine.test.js: 89/89 PASS.
- smoke-02, 05â€“13: ALL PASS (no regressions).
- Inline-script parse: ALL OK across all four HTML files.
- agent-evals loadPage('goalden-lab.html'): OK.
- Render-count tripwire: zero actual render()/updateStatementsUI() calls in
  the Explore module or the new jump-nav/chrome code (comment-only matches
  excluded by filtering comment lines).

### Known / not done
- No commit made (per the git rule).
- NOT browser-tested: the auto-hide timing feel, grid proportions at various
  viewport widths, the sticky Bench's internal scroll, and the stacked-band
  chart with real mixed-unit data need Claude Code's live browser pass.
- The chrome auto-collapse fires once per tab entry â€” leaving and returning
  re-collapses. If the user expands the header/sidebar and then switches
  tabs and comes back, it re-collapses. This is intentional (the tab wants
  the space) but worth knowing about.

---

## 2026-08-18 - opencode - "Read the Company": quarterly + shareholding + price chart + deferred items

### Done
- **Quarterly results + shareholding pattern parsed and rendered.**
  worker.js and local_server.py now extract the `quarters` and
  `shareholding` sections from screener.in (strict parity â€” same section
  ids, same generic `screenerParseTable` call). statements-engine.js
  gained canonical row lists for both (quarterly reuses the P&L rows;
  shareholding has Promoters/FIIs/DIIs/Government/Public). Both render
  through the existing renderOneStatementTable pipeline via STMT_SECTIONS.
  **Pledge constraint honored:** no fixture company has a pledge row in
  the source data, and the canonical row list does NOT include one â€”
  absence of the row IS absence of the claim. If a company's page does
  carry a pledge row, the generic parser will extract it and the table
  will show it. No code path defaults a missing pledge to 0%.
- **Price chart with P/E band overlay:** peBandChartOption() added to
  statements-engine.js â€” two stacked grids sharing a fiscal-year x-axis
  (price line on top, P/E line below, each with its own y-scale, median
  mark-line on the P/E band, dataZoom for scrolling). Wired into the
  Growth & Returns card via a new #stmtPeBandChart container. The
  underlying peHistoryBand() and fyEndPriceSeries() were already built â€”
  this just gives them a visual surface.
- **Companion map expanded 7â†’35 entries** with cyclical swap (from the
  previous session's work, confirmed still passing).
- **Growth summary chart** (grouped bars, 10y/5y/3y/1y) and **cash-flow
  waterfall** (stacked bars preserving the arithmetic) added in the
  previous session, confirmed still passing.
- **Dilution Drag** surfaced as a third stat tile in Growth & Returns
  (added in the previous session, confirmed still passing).
- **Grid layout** breaking up the rectangle stack (from the previous
  session, confirmed still passing).

### Verified
- node --test engine.test.js: 96/96 PASS (7 new tests this session:
  companion map orphan/coverage/cyclical-swap, growth chart config,
  waterfall config, P/E band chart config).
- smoke-02, 05â€“13: ALL PASS.
- Inline-script parse: ALL OK. agent-evals loadPage: OK.
- Render-count tripwire: zero render()/updateStatementsUI() calls in new code.

### Known / not done
- No commit made (per the git rule).
- NOT browser-tested: quarterly/shareholding table rendering with live
  screener.in data, the P/E band chart with a real price series, the
  auto-hide jump-nav timing, the grid layout proportions, and the sticky
  Bench all need Claude Code's live pass.
- **Quarterly periods** use a different cadence than the existing FY
  tables â€” the fySeries() helper filters for type:'fy', so sparklines,
  growth bands, and the vs-median column may not render for quarterly
  data. The table data itself renders correctly (the table uses the
  section's own periods, not fySeries). A quarterly-aware series
  function is a follow-up if the visual gap matters.
- **Shareholding "No. of Shareholders" row** is parsed but not in the
  canonical row list â€” it's a count, not a percentage, and including it
  alongside the % rows would confuse the unit system. Available in the
  data if needed later.
- **Solo/mute on Bench chips**, **reading column beyond 25-row whitelist**,
  **third company**, **mobile bottom sheet** â€” still deferred from the
  original list. Lower effort-to-value than what was built this session.

---

## 2026-08-18 - opencode - "Read the Company": audit + companion map + charts

### Done
- **Audit (before any code):** grepped all 43 engine exports against actual
  UI calls. 36 wired, 4 tested-only (vsOwnMedian/classifySchema are fallback
  paths; dilutionDrag computed but never shown), 3 unused-but-indirectly-
  called (yearIndex/KNOWN_DISCONTINUITIES/DIVERGENCE_RULES used inside
  evaluateDivergenceRules). The real gap was: companion map at 7 entries,
  dilutionDrag invisible, growthSummary only a text table, no waterfall
  chart. Built against those gaps, not the stale plan checklist.
- **Companion map: 7 â†’ 35 entries.** Every P&L row (Sales, Expenses,
  Operating Profit, OPM %, Other Income, Interest, Depreciation, PBT, Tax %,
  Net Profit, EPS, Dividend Payout %), every balance-sheet row (Borrowings,
  Reserves, Equity Capital, Fixed Assets, CWIP, Investments), every
  cash-flow row (CFO, CFI, CFF, Net Cash Flow, FCF, CFO/OP), and every
  ratio row (Debtor Days, Inventory Days, Working Capital Days, Cash
  Conversion Cycle, ROCE %, ROE %) now has 1-3 companions with curated
  reasons. Added companionMapFor(label, isCyclical) â€” for a cyclical
  company, Stock P/E's companions swap to Reserves (book value is less
  cycle-sensitive than the earnings multiple). renderCompanionStripHTML()
  now calls companionMapFor with detectCyclical's result.
- **Growth summary chart:** growthSummary() was computed but only shown as
  a text table. Added growthChartOption() â€” grouped bars for Sales CAGR
  and Net Profit CAGR across 10y/5y/3y/1y windows (categorical x-axis,
  overlapping windows, not sequential). Rendered in the Growth & Returns
  card via a new #stmtGrowthChart container.
- **Cash-flow waterfall:** cashFlowWaterfallOption() â€” CFO/CFI/CFF as
  stacked bars with transparent placeholder series carrying the running
  total (the standard ECharts waterfall trick), plus a Net Cash Flow line
  overlay. Rendered in a new card (#stmtWaterfallCard) below the NP vs CFO
  chart.
- **Dilution Drag surfaced:** was computed and tested but never rendered.
  Added as a third stat tile in the Growth & Returns section alongside
  Incremental ROCE and Asset Turnover.

### Verified
- node --test engine.test.js: 95/95 PASS (6 new tests: companion map
  orphan check, required-row coverage, cyclical swap, non-cyclical
  identity, growth chart config, waterfall config).
- smoke-02, 05â€“13: ALL PASS.
- Inline-script parse: ALL OK. agent-evals loadPage: OK.
- render-count tripwire: zero actual render()/updateStatementsUI() calls
  in the new chart/companion code.

### Known / not done (flagged, not silently dropped)
- **Quarterly results** and **Shareholding pattern** need parser changes
  in src/worker.js + local_server.py (strict parity) + UI. The parser
  currently only extracts profit-loss, balance-sheet, cash-flow and
  ratios sections. These are the next session's work.
- **Price chart with P/E band** (peHistoryBand is wired but only shown
  as a stat tile, not charted) â€” needs a chart container and a
  dataZoom-enabled option builder.
- **ROCE-vs-growth scatter** and **stacked composition chart** â€” deferred.
- **PNG export** of the Bench, **solo/mute on Bench chips**, **reading
  column beyond 25-row whitelist**, **third company**, **mobile bottom
  sheet** â€” all deferred, lower effort-to-value than the items above.

---

## 2026-08-18 - opencode - "Read the Company" round 2: visibility, stickiness, unit honesty

### Done
- **Jump-nav overlap, root cause:** the bar stuck at top:0 with square bottom
  corners and a one-sided fade â€” content sliding under it hard-clipped at the
  bar's top edge with zero clearance. Now floats as a deliberate toolbar
  (top:10px, full 14px radius, stronger shadow, z-index 30 â€” above the sticky
  Bench at 20 and table headers at 2/3), with fade bands on BOTH sides
  (::before above + ::after below, pointer-events:none) so content dissolves
  as it passes underneath instead of half-clipping. Targets already carry
  scroll-margin-top from the last pass.
- **Bench sticky on desktop** (the plan's own call, was missing): â‰¥1100px,
  #stmtBenchCard sticks at top:86px (clear of the floating nav), capped at
  calc(100vh - 106px) with internal scroll. Pinning a row while scrolled into
  Cash Flow or Ratios now updates the chart in the sticky Bench without any
  scrolling. Plus a one-shot pulse on the freshly added chip (pure CSS
  animation, no re-render) so the click registers even when the eye was on
  the table row.
- **Explore re-homed and renamed** â€” was a small â›¶ button tucked into the
  Bench card's corner with a name that said nothing. Now: a dedicated
  "Build a comparison" card between the Bench and the tables (description +
  full-size button), a "Compare" entry in the jump nav, the topbar button
  renamed, and the overlay title changed to match. Bench title reverted to
  plain â€” the Bench stays the zero-effort click-a-row loop; the deliberate
  tool has its own visible home.
- **Unit honesty in the Explore deck** (the "278.9 what?" problem): series
  are grouped by unit (â‚¹ Cr vs %, days, x, â‚¹/share). When a selection mixes
  groups, the chart draws as TWO STACKED BANDS sharing the same fiscal-year
  axis â€” rupee bars on top, ratio lines below, each band with its own
  y-scale and named axis (the plan's sanctioned two-grid pattern, never dual
  y-axes). Every tooltip value now carries its real unit via the same
  formatCellRaw the tables use ("â‚¹278.9 Cr", "128.2 %"), scatter axis names
  carry unit suffixes, and % of sales only applies to absolute rupee rows â€”
  ratio rows plot at face value with a caption note.
- **Inverted year window guard:** From > To swaps rather than charting empty.
- **Reset closes the comparison builder** â€” resetTab('statements') wipes
  L.statements.data; the overlay read it, so it closes rather than showing
  stale companies against empty data.
- **Section title summaries:** each statement section's title bar now shows
  "N rows Â· FYxxâ€“FYyy" (plus "Rs Cr unless noted" where true), so a stack of
  collapsed sections reads as a table of contents instead of N identical bars.
- Bench chips carry each row's latest reported figure (added last session,
  confirmed still working after this round's changes).

### Verified
- node --test engine.test.js: 89/89 PASS.
- smoke-02, 05â€“13: ALL PASS.
- Inline-script parse across all four HTML files: ALL OK.
- agent-evals loadPage('goalden-lab.html'): OK.
- Render-count tripwire: grepped the entire Explore module (396 lines) â€”
  the only regex hits are the comment saying "never calls render()/
  updateStatementsUI()"; zero actual invocations.
- 10-point structural audit: dedicated card âœ“, jump-nav Compare âœ“, Bench
  sticky desktop-guarded âœ“, reset closes âœ“, two-grid layout âœ“, unit
  tooltips âœ“, scatter unit suffixes âœ“, inverted window guard âœ“, Bench
  button removed âœ“.

### Known / not done
- No commit made (per the git rule).
- NOT browser-tested here: the exact feel of the floating nav, the sticky
  Bench's internal scroll, the stacked-band proportions with real data, and
  the scatter label density at 12+ points all need Claude Code's live pass.
- The Bench sticky is full-width (not a narrow side panel) â€” the plan
  specified sticky, and the chart updating live as you pin is the point,
  but if it feels too heavy in a real browser, the easy dial is capping
  max-height further or hiding the divergence strip from the stuck state.

---

## 2026-08-25 - Claude Code - "Read the Company": live browser pass on the Bench, mixed-unit chart caption

### Done
- **Mixed-unit ratio band caption:** the Explore deck's two-grid layout can
  land rows with different units (e.g. Debtor Days and ROCE %) on the same
  shared ratio axis. Added a conditional caption naming the mixed units and
  pointing the reader at each line's tooltip instead of its height, so the
  shared "value" axis label doesn't imply the two are comparable.
- **Bench sticky, reverted to opt-in:** browser-testing round 2's full-width
  sticky Bench (position:sticky, capped at calc(100vh - 106px)) turned out to
  cover the entire statement tables underneath it on a real screen â€” at
  900px viewport height that cap is 794px, 88% of the screen. First cut
  shrank the cap to min(420px,55vh); still blocked too much. Final fix: the
  Bench is back to normal document flow by default (no sticky at any width),
  with a new ðŸ“Œ Pin button in its header that docks it at min(260px,38vh)
  sticky only when the user explicitly wants it pinned while scrolling
  through the tables to keep adding rows. Toggle state lives in
  L.statements.benchPinned and is re-applied on every mount.
- Verified live in the Browser pane against local_server.py + TCS: unpinned
  computes to position:static (tables fully reachable by scroll), pinned
  computes to position:sticky/max-height:260px, __statementsRenderCount
  stayed at 1 through both toggles.

### Verified
- node --test engine.test.js: 89/89 PASS.
- Live browser check against localhost:8000/api/financials?symbol=TCS: 200,
  full payload (Sales/OPM/price/market cap) â€” confirms the local Python
  server fetches screener.in live and needs no commit/deploy to test.

### Known / not done
- No further browser-testing gaps flagged this pass.

---

## 2026-08-25 - Claude Code - Explore tooltip NaN, jump-nav no longer floats over content

### Done
- **Explore ("Build a comparison") tooltip showed NaN for every value.**
  The Over-time chart's tooltip formatter read `p.value` from ECharts'
  axis-trigger params, but series data is stored as `['FY2020', 156.6]`
  pairs on a category axis â€” `p.value` is the whole pair, not the number,
  so `formatCellRaw(label, p.value)` ran unit formatting on an array and
  every row printed "NaN". User-reported as "hovering system is not
  working" and "the third metric is not showing up" (it was there in the
  data and in the tooltip's series list â€” every line just read NaN, which
  reads as broken/absent). Fixed by reading the real value back out of
  `dd[seriesIndex].data[dataIndex]` â€” the same array the series data was
  mapped from, so indices line up â€” which also means the tooltip now shows
  the real reported number rather than the indexed-to-100 plotted value,
  matching the choice the Bench tooltip already makes.
- **Year-window dropdown always showed the same year in both boxes.** The
  "From year" and "To year" selects shared one `yrOpts()` helper whose
  default-selected fallback was hardcoded to the latest year for both, so
  with nothing chosen (both null) the From-year box visually showed the
  same FY as To-year (e.g. both "FY2026") even though the underlying state
  was null and the chart was actually plotting the full range. From now
  defaults to the earliest year, To to the latest, independently.
- **Jump-nav (Overview/Bench/Compare/Profit & Loss/...) no longer sticky.**
  It was `position:sticky;top:10px` at every width, so as a reader scrolled
  a table section, the opaque pill bar slid over and covered whichever row
  was passing underneath it â€” reported directly: "it is hovering over the
  detailed items from the statements below... there's no point of making
  it float when it is covering all the other information." Now sits in
  normal document flow, same treatment as the Bench fix earlier this same
  day. Its fade-band pseudo-elements (which existed only to soften content
  sliding under the sticky bar) are removed with it. The pinned Bench's
  sticky `top` offset, previously 86px to clear the floating nav, is back
  down to 10px since there's nothing left above it to clear.

### Verified
- node --test engine.test.js: 89/89 PASS.
- Live browser: forced the Explore tooltip open via
  `chart.dispatchAction({type:'showTip',...})` before and after â€” before:
  "Cash from Financing Activity: NaN Net Profit: NaN Other Income: NaN";
  after: real values ("-39,915", "32,447", "4,592"), all three series
  present. From/To year dropdowns confirmed independently defaulting to
  FY2015/FY2026 rather than both to FY2026.
- `#stmtJumpNav` computed position: static. Bench pin button still docks
  the card (`position:sticky;top:10px`) with `__statementsRenderCount`
  unmoved at 1.

### Known / not done
- User also asked about auto-collapsing the outer app header and left
  tools sidebar specifically on this tab to reclaim vertical space â€”
  existing manual toggles (header-collapse button, Full width button)
  already do this on request; did not wire an automatic default since that
  touches shared cross-tab chrome state and the immediate complaint (nav
  covering content) is resolved by the jump-nav fix above. Revisit if asked
  again specifically.

---

## 2026-08-25 - Claude Code - Fixed a rendering-crash regression from opencode's grid/companion-map/charts round

### Done
- **Growth & Returns and Compounding Checklist were rendering completely
  empty**, silently dropping the new growth chart, dilution drag stat, and
  the whole checklist along with them. Two bugs, both introduced in
  opencode's "audit + companion map + charts" pass and both invisible to
  its own test run and smoke tests because neither exercises the live
  render path:
  - `updateStatementsUI()`'s growth-chart and waterfall-chart blocks
    referenced a bare `s.data[s.primary]` with no local `s` in scope
    (`ReferenceError: s is not defined`), thrown on every call. Fixed to
    `L.statements.data[L.statements.primary]`.
  - `renderDepthMetricsHTML()` used `faceValue` inside the Dilution Drag
    stat tile before its own `const faceValue = ...` declaration further
    down the function (`ReferenceError: Cannot access 'faceValue' before
    initialization` â€” a temporal-dead-zone bug). Moved the declaration
    above first use, removed the now-duplicate second declaration.
- Neither bug was on opencode's own "flagged for next session" list â€” this
  was a genuine untested regression, not a deferred item.

### Verified
- node --test engine.test.js: 95/95 PASS (unchanged by this fix).
- Live browser against localhost:8000 + TCS: `updateStatementsUI()` called
  directly with no exception; `#stmtDepth` now renders real content (growth
  CAGR table, Incremental ROCE 64.4%, Asset Turnover 1.47x, Dilution Drag,
  Book Value/Price-to-Book, Re-rating Spread); `#stmtGrowthChart` and
  `#stmtWaterfallChart` both exist and initialize; Compounding Checklist
  renders all ten conditions.
- Also spot-checked the rest of opencode's claimed work: `COMPANION_MAP` has
  34 real entries with sane reasons; 12-col grid collapses to one column
  and full-width cards below 860px; sticky jump-nav is present with
  `position:sticky;top:10px` (auto-hide-on-scroll-down logic read
  correctly in source â€” rAF-gated, can't be live-simulated in this
  non-compositing browser pane, so verified by code review only).

### Known / not done
- Committed b21992a and deployed once the user confirmed. Also fixed an
  unrelated deploy hygiene issue found in the same push: a scratch prompt
  file dropped in a repo-local `scratchpad/` got uploaded as a public
  static asset (this repo's wrangler.toml serves the whole repo root) â€”
  added `scratchpad/` to `.assetsignore`, committed ea21a2c, redeployed.
- Opencode's own deferred items (quarterly results + shareholding pattern,
  price chart with P/E band, ROCE-vs-growth scatter, stacked composition
  chart, PNG export, solo/mute chips, reading column beyond 25 rows, third
  company, mobile bottom sheet) were handed to opencode in a follow-up
  prompt and were in progress concurrently with the layout work below.

---

## 2026-08-25 - Claude Code - Grouped Read the Company into three labelled zones, fixed the grid's own layout bugs

### Done
- **User feedback on opencode's grid layout, verbatim gist:** Growth & Returns
  and Compounding Checklist looked bad split into two half-width squares
  (stat tiles cramped, checklist rows wrapped); "Build a comparison" sat as
  an awkward small square next to a much taller Net Profit vs CFO chart,
  and the Cash Flow Waterfall â€” grid-placed at columns 6/-1 same as the
  chart above it â€” left columns 1-5 visibly empty beneath Explore on its
  own row. Root cause of the empty-space complaint: two different card
  pairs both anchored to the same column boundary (6) without anything
  ever placed in 1-5 on the waterfall's row, since CSS grid doesn't
  backfill gaps without `grid-auto-flow:dense`.
- **Follow-up ask, same message thread:** stop just varying rectangle
  sizes and instead give the page real zones people can navigate by,
  matching a mental model of "read the numbers" -> "see it charted" ->
  "what it means" â€” not just a size-varied stream of cards.
- Restructured into three zones, each opened by a new `.stmt-zone-header`
  (small-caps label + rule, full width, matches the existing minimal
  aesthetic rather than adding heavy chrome):
  - **Statements & Benchmarks** â€” The Bench, then the four statement
    tables (moved up from below the charts, since Bench pins rows *from*
    these tables â€” they belong next to each other).
  - **Charts** â€” Build a comparison (now a compact full-width banner, not
    a squeezed card â€” it's a launcher button + two lines of copy, not a
    chart, so it no longer competes with real charts for grid space), Net
    Profit vs CFO and the Cash Flow Waterfall now paired 50/50 on one row
    (`1/7` and `7/-1`) â€” two charts of the same kind sit together instead
    of a chart paired against a CTA banner of a different height.
  - **Analysis** â€” Growth & Returns and Compounding Checklist, both full
    width per the user's explicit ask, stacked instead of split in half.
- Reordered `#stmtJumpNav` to match: Overview -> Bench -> the four
  statement sections -> Charts -> Growth & Returns -> Compounding.
- Waterfall chart height set to 300px (matches NpCfo now that they're the
  same width) instead of the mismatched 320px from the previous round.

### Verified
- node --test engine.test.js: 95/95 PASS (layout-only change, unaffected).
- Live browser against localhost:8000 + TCS: confirmed computed
  `grid-column` for every card matches the new zone plan (`stmtNpCfoCard`
  1/7, `stmtWaterfallCard` 7/-1, `stmtDepth`/`stmtChecklist` both 1/-1,
  `stmtExploreCard` 1/-1); confirmed all three zone headers render with
  the right text and correct DOM order; confirmed `#stmtDepth` and
  `#stmtChecklist` still render full content (9437 and 4929 chars) and
  the growth/waterfall chart containers still exist post-reorder; resized
  to 700px and confirmed both charts collapse to full width and the
  Explore banner switches to a stacked column, same as before.

### Known / not done
- Not yet committed/deployed â€” holding for explicit instruction. Opencode
  is working on the Phase 3 prompt (quarterly/shareholding, price+P/E
  chart, etc.) against the same file concurrently with this change; the
  next commit should pull opencode's latest work first and reconcile
  before pushing, since both sessions are editing goalden-lab.html.

## 2026-09-24 - Claude Code (cloud session, review-board loop, iteration 1)
Changes made by Claude Code, committed on the user's explicit go-ahead this session.
- local_server.py: `_fetch_screener_page` only caught HTTPError, so an unreachable
  screener.in (offline, venue wifi, proxy refusing CONNECT) escaped as a bare
  URLError and skipped the bundled-fixture fallback entirely. Now mapped to a
  transient 503 so the fixture tier fires, matching src/worker.js. Verified:
  TCS loads from fixture with screener blocked.
- goalden-lab.html: Lab home grid was `repeat(3,1fr)` with four primary tools,
  leaving Read the Company orphaned on its own row. Now 4 across, then 2x2 below
  1180px, then 1 column below 860px. Copy fixed ("Three main tools" became "Four",
  and the secondary count is computed).
- goalden-lab.html: the advisor FAB (advisor.js, right:18px) sat on top of the
  "Print / Save as PDF" button. The print button moved to right:92px, and below
  480px it becomes icon-only.
- Reviewer hierarchy (Chief + 5 divisions of about 10 specialists each) and the
  loop backlog are kept as a session-only working file, not in the repo
  (REVIEW-BOARD.md was briefly committed in 0b72df6, then removed at the
  user's request).
- Pending: five read-only division reviews (Retirement, Portfolio, Company
  Analysis, Visual/Data-Viz, AI/Reliability) are running. Next iteration merges
  them into the ranked backlog and starts implementing
  (chart values visible without hover is the top ask).
- Known: this sandbox blocks Yahoo/MFAPI/screener egress. Testing used a
  scratchpad-only synthetic-price server (not in repo).

## 2026-09-24 - Claude Code (cloud session, review-board loop, iteration 1b)
Changes made by Claude Code (Chief on the review board), each independently verified before commit (Rule 0: no claim without a check).
- goalden-engine.js: the efficient frontier is now SOLVED, not sampled. New
  `efficientFrontierExact` (long-only mean-variance sweep, FISTA + simplex
  projection) plus memoisation; `generateFrontier` keeps its signature and
  return shape and still returns the random cloud for the background dots.
  The old best-of-3000-random-mixes envelope covered only 5.4-15.5% risk
  with 24 assets, so single funds plotted above "the best line" and
  Conservative/Aggressive were told "already on the best line" while about
  0.5 points below it.
  Verified: India frontier 1.50%->28.00% risk, 6.51%->15.50% return (ends
  on Liquid Fund / Small Cap Fund exactly); optimality-condition (KKT)
  error at most 8.9e-7; 400,000 brute-force mixes per country, 0 beat the
  line. Cold solve about 130ms once per country, then cached (0.1ms).
- goalden-lab.html: removed the Lab's own shadowing copy of
  `generateFrontier`, so Build a Portfolio, Test Real Investments and the
  advisor tool all use the exact version.
- goalden-lab.html `frontierGap`: a mix riskier than the frontier's top end
  used to return null ("already on the best line"). It now reports the gap.
- goalden-lab.html Test Real Investments: "Turn this into a savings plan"
  now carries the compounded return (mu - sigma^2/2) to the Retirement tab
  instead of the higher arithmetic one. Verified: carried value equals the
  on-screen "Compounded equivalent" (9.0% with 2 instruments, 11.1% with 3).
- goalden-lab.html risk-composition bar: the "all in your biggest holding"
  marker was placed at the unsystematic share (the wrong end, label clipped
  at x=0). It now sits at the concentrated mix's systematic share, with its
  value in the label, aligned so it isn't clipped. Verified by screenshot.
- goalden-lab.html Build a Portfolio frontier chart: YOUR MIX and BEST FOR
  THE RISK now print return and risk on the chart (no hover needed), sit on
  opposite sides so they can't collide, and asset labels hide on overlap.
  Verified by screenshot.
- engine.test.js: two new tests (frontier dominates every sampled mix and
  every single asset, weights long-only and summing to 1; 2-asset left end
  equals the analytic minimum-variance weight). 97/97 pass.
- In progress (not in this commit): a D3 implementer agent is fixing the
  Read the Company engine (waterfall chart, bonus-issue dilution, lender
  checks, flag rules) in statements-engine.js. Retirement fixes (age clamps,
  withdrawal timing, SWP float bug, joint-corpus claim, Monte Carlo median)
  are next for the Chief.

## 2026-09-24 - Claude Code (cloud session, review-board loop, iteration 2)
Changes made by Claude Code (Chief), from the D1 Retirement division's report. Each change was independently verified before commit.
- goalden-lab.html `clampRetAges` (called from `calcRetLab`): retire age is
  now at least age+1 and plan-to age at least retire+5, clamped in state so
  the labels match the maths; slider minimums follow. Before, age 60 /
  retire 50 showed "SIP -₹63,739 for -10 years". Verified: now retire
  becomes 61 and the SIP is positive.
- goalden-lab.html `drawdownWithShock` + `monteCarloDrawdown`: the
  end-of-year ("ordinary") payment now carries one year's inflation, which
  matches `corpusRequired`/`swpWithdrawal`. Before, an end-of-year plan
  ended with about 27% of the corpus unspent while saying "reaches zero".
  Also a ₹1 tolerance on "ran out" (float residue of -6.7e-8 made the
  default SWP screen say "runs out 0 years early" in red). Verified: final
  balance is exactly 0 in both timing modes for the Retirement Lab and SWP;
  the SWP default now reads "20 yrs, exactly, by design".
- goalden-lab.html Monte Carlo (`simYearReturn`): yearly returns are now
  lognormal with the MEDIAN at the slider's rate, the same rate the
  deterministic plan compounds at. Before, a normal draw around the
  arithmetic mean made the typical path about sigma^2/2 slower than the
  plan. Verified: median of 200k draws 9.05% vs 9%; zero-margin plan
  survival is now 49% at both 5% and 12% volatility (was about 34-40%),
  and vol=0 still collapses to the deterministic plan.
- goalden-lab.html drawdown Monte Carlo: new "For 9-in-10 survival" line
  giving the corpus multiplier and SIP that clear 90% in the same
  simulated paths (bisection; survival is monotone in corpus). Verified in
  5 scenarios: survival at the displayed multiplier is 90.1-90.9% and 0.01x
  less falls below 90%. The multiplier is rounded UP (rounding down had
  printed 1.42x, which re-tests at 89.9%).
- goalden-lab.html fan charts: P90/median/P10 values printed at the right
  edge (no hover needed), start labelled "Now" (a 20-year plan used to end
  at "Yr 21"), edge labels no longer clipped ("r 1"), and the bull/bear
  twin fans share one y-scale (a ₹1.53 Cr and a ₹82 L median used to be
  drawn the same height). Verified by screenshot.
- goalden-lab.html Joint Children Corpus: removed the false "Saved by
  clubbing ₹30,181/yr". Yearly amounts cover different spans (separate pots
  stop as each child starts college), so the tab now compares total paid
  and present value (`jointVsSeparateComparison`). Defaults: joint ₹46.03 L
  vs separate ₹37.57 L paid; present value ₹25.48 L vs ₹23.51 L, so
  SEPARATE is cheaper by ₹1.97 L. Verified by an independent year-by-year
  recount. The advisor tools (`advisorReadCurrentChart`,
  `advisorGetResults`, `resultCanvasJoint`) repeated the false claim and
  labelled the yearly SIP "/mo"; now fixed. The result fields were renamed
  (jointYearlySIP etc.); no eval or server references the old names.
- goalden-lab.html number boxes: 64px became 92px (₹2,00,000 displayed as
  "20000"). Verified: all values fit.
- goalden-lab.html drawdown chart: end label and x-axis edge labels no
  longer clipped.
- goalden.html + goalden-lab.html: "gold area/line" captions became "blue"
  (the brand colour moved to #2557C7; captions described a colour not on
  screen).
- Known, not fixed yet: the 2008 shock applies the full -52% equity crash
  to the whole retirement pot (D1-20: should scale by the equity share),
  so shocked scenarios are harsher than a hybrid pot would see.
- In progress (not in this commit): statements-engine.js (D3 implementer;
  tests currently red on its unfinished work, 97/97 green on committed
  code) and advisor.js / worker.js / local_server.py / goalden-door2.html
  (D5 implementer).

## 2026-09-24 - Claude Code (cloud session, review-board loop, iteration 3)
Changes made by Claude Code (Chief), from the D4 Visual/Data-Viz division's report. Each change was verified.
- goalden-lab.html mobile layout: `.grid` used `1fr` on phones, which can't
  shrink below its widest child's min-content, so at 412px the page was
  449px (Retirement), 623px (Portfolio), 1554px (Read the Company) and
  phones zoomed out. Now `minmax(0,1fr)`, `.stat-row` goes to 2 columns
  under 560px, and the Read the Company top bar wraps its buttons.
  Verified: Pixel 7 emulation, all 12 tabs now exactly 412px wide.
- goalden-lab.html charts that showed numbers only on hover now print them:
  - Growth ("mountain") chart: final pot, what you put in, and "growth is
    N% of the final pot", plus year labels. Checked: ₹3.71 Cr vs ₹64.20 L
    gives 83%.
  - Step-up twin fates: "Both reach ₹X" plus the year and size of the
    biggest gap. Monthly rows are bucketed to years; the tooltip used to
    say "Year 360".
  - Joint timeline: peak balance (₹47.52 L, year 14, checked against the
    solver's rows) and shaded, named college years for each child (fee
    years 9-12 and 15-18 match the solver).
  - Test Real Investments 2-asset chart: YOUR MIX, BEST BALANCE (with the
    split, e.g. "99% RELIANCE.NS / 1% TCS.NS") and SAFEST show return and
    risk. SAFEST no longer prints on top of YOUR MIX. Asset labels show
    their return. Chart text is at least 10px. Checked: YOUR MIX at a 90/10
    weight = 0.9 x 14.6% + 0.1 x 6.8% = 13.8%, as labelled.
- New shared helpers `CHART_TEXT` (AA-contrast text colours) and
  `valueTag()`; pastel series colours are now fill-only on these charts.
- Step-up caption now names the series by line colour correctly (was
  "Red/Green" for orange/green lines).
- Remaining from D4: AA text tokens app-wide (D4-04/06), print CSS
  (D4-05), porting the value labels to Levels 1/2 (goalden.html,
  goalden-door2.html), the radar-chart veto (D4-09), the step-up
  contribution-path chart and the FX bridge (D4-12/13).

## 2026-09-24 - Claude Code (cloud session, review-board loop, iteration 4: Read the Company)
Changes made by Claude Code: the D3 implementer agent (statements-engine.js, engine.test.js) plus the Chief (verification, extra fixes, Lab follow-ups). Every claim below was independently re-checked by the Chief against the raw fixture JSON or in the running page.
- statements-engine.js `cashFlowWaterfallOption`: the invisible spacer bars
  were stacked into the same column, so TCS FY26 drew a ~₹1.46 lakh Cr
  tower for a year whose net cash flow was -₹1,925 Cr. Now a signed
  diverging bar (CFO up, CFI/CFF down) with net cash flow as a labelled
  dot. Verified: +52,094 / -54,019 nets to -1,925.
- Share counts (`sharesSeries`, `bonusFactorsByYear`): bonus issues were
  counted as dilution (Bajaj Finance "diluted 418%", HDFC Bank 179%). A
  capital jump with steady NP/EPS is now treated as a bonus. Verified from
  raw fixture NP/EPS: Bajaj about 603 to 633 crore shares FY21-26 (engine
  now 3.7%), HDFC Bank about 40-45% real dilution (merger; engine 39.7%),
  TCS FY18 EPS 67.7 vs reported 67.46. The proposed NP/EPS-only formula was
  rejected because it breaks on PAYTM (pre-listing EPS not restated) and
  VEDL (minority interest).
- Lender-aware checks: cash-vs-profit checklist item switched off for
  lenders, lenders are never "cyclical" (HDFC Bank's false banner is gone,
  verified in page), and the margin item uses PBT/(Revenue+Other Income).
- Flag rules: the CWIP "little changed" rule no longer fires on a 6x
  increase (Hindalco); new DIVIDEND_EXCEEDS_FCF rule (VEDL FY23-25 paid
  dividends above free cash flow while borrowing); interest cover is
  EBIT-based with an explicit "loss before interest" message (PAYTM showed
  "-88.6x thinly covered"); incremental ROCE uses EBIT and refuses windows
  where capital barely moved (TCS median 169% became 49%); CAGRs count
  fiscal years across gaps (PAYTM 9Y 43.7% became 11Y 34.5%); the checklist
  is hidden only by earnings-quality flags.
- Units and labels: CFO/OP is now a % (showed "93.00x"). The table footer is
  direction-aware; verified: TCS Debtor Days "BEST 67d (FY2021) · WORST 93d
  (FY2026) · 11Y change +14 days" (it called 93d BEST). Bench, growth and
  profit-vs-cash charts print their values.
- Chief fixes found while verifying: the profit-vs-cash CFO/NP end label
  threw SVG "translate(x NaN)" errors on VEDL (pre-existing: series starts
  with nulls). Replaced with a markPoint on the last real value; a test was
  added. The ratio axis is capped at "4+" (a one-off 159x spike flattened
  every other year). The NP tag is smaller so it fits narrow bars.
  "22th percentile" now reads "22nd".
- goalden-lab.html follow-ups: pass P&L into dilutionDrag and
  bookValuePerShareSeries (bonus-aware in the Lab), EBIT wording for ROCE and
  incremental ROCE, direction-aware footer, growth chart names Revenue for
  lenders, flag evidence pins updated (EBIT rows; new dividend rule), fixed
  `detectCyclical` being passed as an always-truthy object (every company
  got cyclical P/E companions), 10-year window detail anchored by year.
- Tests: 108/108 (97 + 10 implementer fixture tests + 1 Chief test).
  All six fixture companies load with no page or console errors, and all
  12 Lab tabs render cleanly.
- Not fixed yet: other divergence rules still use index offsets across
  missing years; VEDL EPS from consolidated NP includes minority interest
  (P/E band biased low); structural breaks (HDFC merger, VEDL demerger) are
  not marked on charts.

## 2026-09-24 - Claude Code (cloud session, review-board loop, iteration 5: new visualization)
Changes made by Claude Code (Chief). Idea #1 from the D3 Company Analysis panel.
- New "Where ₹100 of sales went" chart in Read the Company's Analysis zone
  (statements-engine.js `marginBridgeData` / `marginBridgeOption`;
  goalden-lab.html `#stmtBridgeCard`). A waterfall scaled to ₹100 of the top
  line: sales -> operating costs -> operating profit -> other income ->
  interest -> depreciation -> PBT -> tax & other -> net profit, each bar
  labelled with this year's value and the same step 5 years earlier, plus a
  one-line headline ("Of every ₹100 of sales in FY26, ₹18.5 ended as net
  profit (FY21: ₹19.8)").
  - Lenders bridge from total income (revenue + other income), because a
    bank's other income is fees and insurance (core business). The title
    switches to "Where ₹100 of income went".
  - "Tax & other" = PBT - net profit, so the last bar is exactly reported
    net profit (screener rounds Tax % to whole numbers, and consolidated NP
    nets out minority interest).
  - Custom-series bars (low/high ranges) so a loss year crossing zero draws
    correctly.
  - Verified: the bridge reconciles to reported net profit for all six
    fixture companies (walk-vs-reported gap under 0.002 per ₹100); new test
    (109/109). Screenshots checked for TCS, HDFC Bank and Paytm; no page or
    console errors on any company; Read the Company still fits a 412px
    phone.
- Cash-flow chart caption updated to describe the diverging bars.

## 2026-09-24 - Claude Code (cloud session, review-board loop, iteration 6: AI advisor and reliability)
Changes made by Claude Code: the D5 implementer agent (advisor.js, src/worker.js, local_server.py, goalden-door2.html, agent-evals/, smoke-14.js) plus the Chief (verification, extra fixes, Lab follow-ups). The Chief re-checked every claim with independent scripts.
- Tool routing (both servers): BM25 routing used to drop core tools. "Yes
  do it all" lost build_goal_plan/compose_briefing/get_results; "explain
  this graph" lost read_current_chart. The core tools are now always kept;
  lists of 25 tools or fewer skip routing. Chief check: 8 fresh prompts on
  the Lab's 41 tools, 0 core tools dropped.
- One message cap (40) in the Worker, local_server and the client (sends at
  most 36, never splits a tool-call pair, retries once on 413). Chief
  check: 41 messages gives 413, 39 gives 200.
- Rate limit is per user TURN (X-Goalden-Turn): 10 turns and 60 requests
  per minute per IP. Before, one long "do it all" (up to 18 round trips)
  hit 429 midway. Chief check: 15 round trips in one turn all return 200;
  requests without a turn id are still capped at 10/min.
  `GOALDEN_CHAT_RATE_LIMIT=off` disables it locally for test harnesses.
- Voice and streaming go through the advice guardrail; the "MODE: A" line
  is never spoken or shown; voice is OFF by default (remembered). Chief fix
  on top: HTML tags are stripped whole before speaking ("<bBold</b" was
  being read aloud). Verified.
- Demo mode without an API key (local_server mock) is properly scripted:
  the landing page hands off to the Full Plan and finishes the report,
  Level 1 builds a real plan, the Lab runs the retirement analysis, chart
  questions call read_current_chart. Chief check: end-to-end chat in the
  browser on index, goalden.html and the Lab; briefings open with real
  figures and no errors.
- The Full Plan no longer stamps "✓ every figure recomputed" on an empty,
  all-₹0 plan.
- Plans use the same dispatcher as the main loop (a compose_briefing step
  used to fail silently while the plan said ok); unknown tools are rejected
  at proposal time.
- local_server streaming errors now return one clean 502 instead of two
  glued HTTP responses. Chief check: raw curl output with a fake key.
- Market-data errors show "Market data is unavailable right now" instead of
  raw urlopen proxy text. No price data was bundled or invented.
- Accessibility: chat panel role=dialog with a label, FAB
  aria-expanded/controls, voice aria-pressed, focus managed for the
  briefing dialog, aria-busy while streaming, error text contrast about
  7:1. Chief fix: the FAB's attention animation now runs 3 times, not
  forever (WCAG 2.2.2; it also made the button un-clickable for automated
  tests).
- Markdown tables no longer render the |---| separator as a row; the
  guardrail's canned paragraph no longer duplicates.
- goalden-lab.html (Chief): chart follow-up chip keys fixed ('ret-lab' and
  'montecarlo' never matched real tab ids); chips added for SWP, Joint and
  Read the Company; the fallback chip no longer asks "What should I do with
  this?" (it invited advice the guardrail then blocks). The briefing
  headline formatted every number as money ("AGE ₹30", "Score ₹90",
  "Diversification benefit ₹1"); it now formats by field (age/years plain,
  score /100, ratios x, *Pct as % or pts) and labels are readable ("Monthly
  SIP" instead of "monthlySIP"). Verified on 8 tabs.
- smoke-07.js updated for the new dispatcher and core-tool list; new
  smoke-14.js (routing parity, core-tool survival, chip keys, speech and
  stream rules). README scenario count 15 became 19.
- Checks: engine.test.js 109/109; all 11 smoke files ALL PASS;
  agent-evals 9/9 in mock mode (was 4/9), 10 skipped (need a live key).

## 2026-09-24 - Claude Code (cloud session, review-board loop, iteration 7: contrast)
Changes made by Claude Code (Chief), D4-04/D4-06 from the Visual division.
- goalden-lab.html text contrast to WCAG AA (4.5:1) across the Lab:
  - Pastel series colours used as TEXT (#8FC79E 1.8:1, #E8977A 2.2:1,
    #D97757 2.9:1, #5FA875) now use dark tokens #256F55 / #9C4A2C in CSS
    and inline styles (30 places). Chart fills keep the pastels.
  - Muted ink text at .4-.6 opacity (2.3-4.0:1) now uses .74 (71 places);
    `.card .cap` captions and the chart theme's axis labels use #56698A.
  - Palette tokens nudged: --dim #5E7290 to #52647F, --ok #2E8B6F to
    #22705A, --warn #C99A45 to #946514; faded-blue link text is now solid.
  - Drawdown end-label text uses the dark tokens (the dot keeps its pastel).
  Verified: an automated contrast audit (every visible text element vs its
  effective background, large-text threshold 3:1) went from 11-169
  failures per tab to 0 on all 12 Lab tabs; screenshot checked; no page
  errors. Not yet applied to goalden.html / goalden-door2.html / index.html.

## 2026-09-27 - Claude Code (cloud session, review-board loop, iteration 8: Test Real Investments date window)
Changes made by Claude Code (Chief). D2-03, a critical-severity finding from the Portfolio division.
- goalden-lab.html `liveWindowStats` / `liveCommonWindow`: every comparison
  in Test Real Investments (two-instrument and multi-instrument views,
  frontier, correlation, mix return, the hand-off to Retirement, and all
  five advisor tool paths) now uses statistics computed over ONE shared
  date window: [latest start, earliest end] across the chosen instruments.
  Before, each instrument's return and volatility came from its own window
  (Yahoo: 10 years; MFAPI: since fund launch) while covariance used only
  the overlap, so the same asset could read -2.3% vs +10.8% and
  correlations could exceed 1.
  Verified with a test-only symbol that serves the last 2 years of another
  symbol's series: old correlation 1.034 (impossible) and returns 6.8% vs
  11.6% for the identical asset; now correlation 1.00 and 11.6% for both.
  Cached per instrument set; per-instrument cards keep full histories.
- A note above the results names the shared window ("Sept 2024 to Sept 2026,
  2.0 years"). It warns when the overlap is under about 6 months (it then
  falls back to full histories and says so), and when instruments are in
  different currencies (no FX conversion yet; D2-04 still open).
- The multi-instrument chart title changed from "Simulated frontier" to
  "Efficient frontier", with an info text explaining that the line is
  solved exactly and the dots are random mixes. The advisor's built-in
  "Efficient frontier" explanation and a stale code comment were updated
  to match.
- Left as is: Levels 1/2 `compare_portfolio` still tags 3-4-instrument
  results 'sampled-frontier' and says the weights are approximate. The
  line is now exact, but the best-balance point is still chosen from a grid
  of frontier points, and the tag is part of the advisor tool contract.
- Checks: engine.test.js 109/109, all 11 smoke files pass, compounded
  hand-off still matches the on-screen figure, advisor chart/results tools
  run on a 3-instrument set, no page errors on any Lab tab.

## 2026-09-27 - Claude Code (cloud session, review-board loop, iteration 9: Levels 1/2 + landing page)
Changes made by Claude Code (Chief). Ports of the Lab's D4 visual fixes to the other pages.
- goalden.html + goalden-door2.html growth ("how the pot grows") charts now
  print the final pot, what you put in, and "growth is N% of the final pot",
  with Year 1 / Year N labels (were hover-only). Level 2's yearly rows now
  carry `contributed` so it can show the paid-in layer too. Verified by
  screenshot on both pages (Level 1: Grows to ₹3.7 Cr, You put in ₹64.8 L,
  83%).
- Pot (spend-down) charts on both pages: end-label text uses AA colours,
  edge labels are no longer clipped, text is at least 10px.
- Chart width cap raised from 480px to 760px (charts filled about a third
  of a desktop card; still capped per the existing note).
- Viewport no longer sets maximum-scale=1.0 on Levels 1/2 (pinch-zoom was
  blocked, WCAG 1.4.4).
- Level 1: "See the full month-by-month schedule" is now "year-by-year" (the
  table is yearly).
- WCAG AA text contrast pass on index.html, goalden.html and
  goalden-door2.html (same method as the Lab: muted ink to .74, pastel text
  to #256F55/#9C4A2C, --dim/--ok tokens darkened, plus concatenated-style
  colours in all four pages). Verified: automated audit shows 0 failing text
  elements on the landing page, Level 1 start and results, Level 2 start
  and plan, and all 12 Lab tabs.
- All four pages: `initChart` attaches a debounced ResizeObserver per chart,
  disconnected on dispose. ECharts SVG measured its container only once, so
  charts created while a card was laying out stayed too narrow (Level 2's
  goal chart ended about 90px short). Verified: chart SVG width equals its
  container (651/651).
- Checks: engine.test.js 109/109, 11/11 smoke files, agent evals 9/9
  (mock), chat end-to-end on 3 pages with no errors, all Lab tabs error-free,
  phone width 412px holds.

## 2026-09-27 - Claude Code (cloud session, review-board loop, iteration 10: print)
Changes made by Claude Code (Chief). D4-05 from the Visual division.
- advisor.js print CSS: the briefing prints only when it is open. It used
  to be forced visible, adding an empty "Briefing" heading to every
  printout on all four pages.
- goalden-lab.html print CSS: `.table-scroll` / `.schedule-scroll` uncapped
  on paper (year-by-year tables were cut off at about year 10 by the 340px
  scroll box).
- goalden-lab.html `beforeprint`: the print header gets an "Inputs: ..."
  line built from the current tab's slider labels and active toggles
  (info-icon text and descriptions stripped), because the inputs panel is
  hidden on paper and a printout had no record of what produced it.
  Example: "Inputs: You have a corpus of ₹1.00 Cr · Draw for 20 years ·
  Growth during drawdown 9% · Inflation-adjust withdrawals by 6%".
- Verified under emulated print media: the briefing is display:none when
  closed, table heights match their full content, and the inputs line is
  correct on 8 tabs; a PDF was generated without errors; smoke tests pass.

## 2026-09-27 - Claude Code (cloud session, review-board loop, iteration 11: advisor tool honesty in the Lab)
Changes made by Claude Code (Chief). D5-08 / D5-09 from the AI/Reliability division.
- `pin_row`: validates the section and that the row exists on the loaded
  company (error lists the available rows), and re-pinning is a no-op
  (`alreadyPinned`). Before, it toggled, so "pin Sales" on a pinned row
  unpinned it while reporting ok, and made-up rows returned ok.
- `open_definition`: unknown labels ("Flux capacitor") return an error
  instead of a generic definition. `focus_year`: years outside the
  company's reported range return an error (FY1850 used to be ok).
- `run_monte_carlo`: numeric range checks on sip/years/meanReturn/
  volatility/seed and a regime whitelist (sip:'abc', years:-5 returned ok
  with all percentiles 0). `stress_test`: an empty name no longer matches
  every label (it silently picked 2008); exact id first, label substring
  only for 3+ characters.
- `read_current_chart` on Read the Company summarises the ₹100 bridge,
  profit vs cash (non-lenders), latest cash-flow split, growth CAGRs and
  pinned rows, using the same engine functions the page draws with (it
  used to say the tab had no chart).
- Verified: 15 direct tool calls (valid and invalid) return the expected
  ok/error; "explain this chart" on Read the Company in mock mode answers
  from the bridge headline; engine tests 109/109, smokes 11/11, evals 9/9.

## 2026-09-27 - Claude Code (cloud session, review-board loop, iteration 12: planning age)
Changes made by Claude Code (Chief). D1-07 from the Retirement division.
- Default planning ("plan to") age raised from 78 to 85 (India) and from 82
  to 90 (US) in goalden.html, goalden-door2.html and goalden-lab.html (the
  C configs plus the Lab's L.ret default). 78 and 82 are roughly the MEDIAN
  remaining lifespan for a 60-year-old, so about half of users would
  outlive a plan built to them; planning past the average is the standard
  way to cover longevity risk. Level 1 now says so next to the number
  ("lasts to 85, deliberately past average lifespan so you are unlikely to
  outlive it").
- VISIBLE EFFECT: every default retirement headline rises, e.g. Level 1
  ₹3.7 Cr -> ₹4.7 Cr and the Lab SIP ₹17,835 -> ₹22,684/month on default
  inputs. The Lab slider (70-95) still lets anyone choose a different age.
- agent-evals/runner.js ground-truth CONFIG mirrors the new defaults (it
  recomputes expected figures independently and failed until updated).
  Checks: evals 9/9, engine tests 109/109, smokes 11/11.

## 2026-09-27 - Claude Code (cloud session, review-board loop, iteration 13: growth + drawdown chart)
Changes made by Claude Code (Chief). D2 visualization ideas 1-2 (retail pain points: "what would I have now?" and "how bad did it get?").
- goalden-lab.html Test Real Investments: new card "What ₹1.00 L would have
  become" (`liveGrowthDrawdown`, `liveGrowthCardHTML`,
  `renderLiveGrowthChart`) under the frontier, for 2+ instruments.
  - Top panel: growth of ₹1 lakh ($1,000 in US mode) in each instrument and
    in "Your mix" (current weights, rebalanced back to them once a year),
    with final values printed at the line ends.
  - Bottom panel: underwater chart of the mix (% below its previous peak),
    with the worst fall labelled.
  - Stat tiles: final value with CAGR, worst fall with bottom date, and time
    to recover (or "still below its old high").
  - Uses the shared date window and only dates all instruments traded on;
    weekly-sampled for drawing. On phones, names move to a legend so the
    end labels fit.
- Verified: per-instrument final multiples equal raw last/first price
  (2.9338, 1.3134); worst drawdown equals a brute-force recomputation
  (-44.55% for 2 instruments, -9.2% for 3); CAGR 2.1948^(1/10)-1 = 8.2%
  matches the tile. No page errors across weight changes and tab switches;
  the phone layout holds 412px; tests 109/109, smokes 11/11. (Sandbox
  prices are synthetic; the arithmetic is what was checked.)

## 2026-09-27 - Claude Code (cloud session, review-board loop, iteration 14: DuPont ROE)
Changes made by Claude Code (Chief). D3 visualization idea 3.
- statements-engine.js `dupontSeries` / `dupontAttribution`: ROE = net margin
  x asset turnover x leverage, on AVERAGE opening/closing balances (equity =
  Equity Capital + Reserves), so the factors multiply to ROE exactly.
  Attribution splits the change between two years with logs (the parts sum
  exactly to ln(ROE1/ROE0)) and names the biggest driver.
- goalden-lab.html Read the Company, Analysis zone: new card "What drives the
  return on equity": four tiles (margin × turnover × leverage = ROE, each
  with the value 5 years earlier), a plain-language line ("ROE rose from
  38.2% to 49.0% between FY21 and FY26, mostly because of higher asset
  turnover"; it adds a risk note when the rise came from leverage, and
  handles loss years), and a labelled ROE-by-year bar chart. Lender-aware
  tooltips. Caveat shown: consolidated profit includes the minority share,
  so ROE reads high for groups like VEDL.
- Verified independently against screener's own reported ROE %: HDFC Bank
  17.5/15.0/14.3 vs 17/14/14, Bajaj Finance 22.1/19.4/18.4 vs 22/19/18
  (now a test, within 1.5 pts over 5 years). Identity holds to 1e-12 on all
  six companies. TCS tiles: 18.5% × 1.57 × 1.68 = 49.0%. No errors on any
  company; phone width 412px; contrast audit 0; tests 110/110; smokes 11/11.

## 2026-09-27 - Claude Code (cloud session, review-board loop, iteration 15: Step-Up SIP)
Changes made by Claude Code (Chief). D1-12 (math) and D4-12 (visual).
- goalden-lab.html `stepUpAnnualPlan`: the step-up SIP now rises ONCE A
  YEAR (flat within each year), like real SIP mandates. The old
  `solveStepUpSIP` raised it by a monthly-equivalent rate every month,
  understating the starting SIP (₹7,671 vs ₹7,943 at defaults). Solved
  exactly (future value is linear in the start amount). The old solver was
  removed; the tab, advisor chart/results tools and the report canvas all
  use the new plan.
- New tiles: total paid in, flat (₹64.20 L) vs step-up (₹1.08 Cr, ₹43.77 L
  more), and the year the step-up overtakes the flat SIP (year 12). New
  chart "What you pay each month, year by year": step-up bars (green while
  below the flat SIP, orange after), flat SIP as a dashed line, the
  crossover year marked, first/last amounts printed. The advisor results
  gain totalPaidFlat / totalPaidStepUp.
- Verified: start SIP equals an independent bisection over a from-scratch
  month loop (₹7,943); the plan lands exactly on the target; a 0% step-up
  equals the flat SIP; figures match the Retirement division's
  predictions. Tests 110/110, smokes 11/11, evals 9/9, no page errors.

## 2026-09-27 - Claude Code (cloud session, review-board loop, iteration 16: FX bridge, phone nav)
Changes made by Claude Code (Chief). D4-13 and a mobile nav fix.
- goalden-lab.html Cross-Border: new "How the money got there" bridge chart
  (`renderFxBridge`): amount invested -> + foreign market growth -> ±
  currency effect -> went abroad, with "stayed home" as a comparison bar;
  every bar labelled. The steps land exactly on the final value by
  construction. Checked: ₹10 L + ₹13.67 L + ₹11.37 L = ₹35.04 L (India
  investing in US); $10K + $13.67K - $7.68K = $15.99K (the reverse).
- goalden-lab.html phone nav: the slim tab strip scrolls sideways and always
  opened at its first tab, so the current tool wasn't visible. It now
  centres the active tab (horizontal scroll only). Checked on Pixel 7 for
  Read the Company, Plan Health and Retirement: the active tab is fully in
  view.
- Checks: tests 110/110, smokes 11/11, phone width 412px, contrast audit 0
  on the touched tabs, no page errors.

## 2026-09-27 - Claude Code (cloud session, review-board loop, iteration 17: readable warning flags)
Changes made by Claude Code (Chief). D3-03 from the Company Analysis division.
- goalden-lab.html Read the Company: every shown divergence flag now has a
  readable card under the tick strip (year badge, message, the detail with
  the actual figures, "Show the evidence on the Bench"). The ticks were 3px
  marks whose text lived only in a hover tooltip (invisible on phones and in
  print) while the summary said "shown below". Cards reuse the ticks'
  data-stmt-flag click hook, so a click pins the evidence rows exactly as
  before (checked: VEDL FY16 pins Profit before tax + Interest).
- When every observation is a one-year blip (TCS), the summary now says so
  instead of "(0 shown below)".
- Checks: cards render for VEDL/Hindalco/Paytm with real figures (VEDL
  FY24 dividend ₹19,526 Cr = 259% of the fixture's ₹7,539 Cr profit); no
  page errors on six companies; phone width 412px; contrast audit 0; tests
  110/110; smokes 11/11.

## 2026-09-27 - Claude Code (cloud session, review-board loop, iteration 18: statement table units)
Changes made by Claude Code (Chief). D3-13 / D3-14 from the Company Analysis division.
- goalden-lab.html `stmtYoyText`: the Value/YoY toggle shows changes in the
  row's own unit: % rows in points ("▲2.0 pts", was "▲50.0%" for OPM 8% to
  12%), day rows in days, ratio rows in x, amounts in %. Used by the initial
  render and by the in-place toggle patch.
- `stmtVsMedianText`: the "vs median" column is unit-aware (pts / days / x)
  and shows a dash when the latest value or the median is <= 0 (TCS
  investing cash flow printed "934%"). The header counts real fiscal years
  ("vs 10y median" for Paytm, was always "12y"). The column no longer wraps.
- `.stmt-bar-fill` got left/right: with no width the fill was 0px wide, so
  every above/below-median bar was invisible (now 82px, verified).
- Checks: YoY and vs-median values verified on Hindalco, TCS and Paytm; no
  errors on six companies; phone width 412px; tests 110/110; smokes 11/11.

## 2026-09-27 - Claude Code (cloud session, review-board loop, iteration 19: Test Real Investments honesty)
Changes made by Claude Code (Chief). D2-10 / D2-11 / D2-12 from the Portfolio division.
- Capital Allocation Line stops at 100% invested (chart, advisor summary,
  table 0/25/50/75/100%). It extended to 2x, i.e. borrowing at the FD rate,
  which individual investors can't do; copy and legend updated to say so.
  Verified: the line's last point equals the tangency point (23.56% risk).
- Fund search: Direct + Growth plans listed first; IDCW plans badged
  "return understated" (payouts are not reinvested in the NAV history) and
  Regular plans badged "about 1%/yr more cost". Verified with a sample list.
- The shared-window note now says the "best" mixes are best for that past
  window and that the pick-list is today's index members (survivorship), so
  results describe the past, not a forecast.
- Checks: tests 110/110, smokes 11/11, evals 9/9, contrast 0, no errors.

## 2026-09-27 - Claude Code (cloud session, review-board loop, iteration 20: realistic stress tests)
Changes made by Claude Code (Chief). D1-20 from the Retirement division.
- goalden-lab.html `shockPotReturn(ep, equityPct)`: historical shocks are
  equity-index falls (Sensex -52% in 2008), but they were applied to the
  WHOLE retirement pot. Now the equity share takes the crash and the rest
  earns the normal debt return (7% IN). New "Equity share of the pot"
  slider (default 40%) with a one-line readout ("In the shock year the pot
  returns -16.6%"), on Retirement and Sustainable Withdrawal. It applies to
  the deterministic drawdown, the drawdown Monte Carlo, the 9-in-10 line,
  SWP, the advisor's stress_test (which also reports
  potReturnInShockYearPct / equitySharePct) and the printed briefing.
- Effect (default plan, 2008 in year 2, 12% vol): before, "even 2.5x the
  corpus doesn't reach 9-in-10"; now 1.91x at 40% equity (1.51x at 0%).
  100% equity reproduces the old behaviour exactly. Checked:
  0.4 x -52% + 0.6 x 7% = -16.6%.
- Regression fix: widening the number boxes to 92px (iteration 2) squeezed
  the two-across Age/Retire sliders; boxes in `.field-row` are 56px (the
  sliders are now 73px, slightly wider than originally).
- Checks: tests 110/110, smokes 11/11, evals 9/9, no page errors.

## 2026-09-27 - Claude Code (cloud session, review-board loop, iteration 21: chip buttons)
Changes made by Claude Code (Chief). D4-10 from the Visual division.
- goalden-lab.html: the scenario and category chips (Retirement and SWP
  shock pickers, Instrument Explorer categories) are <button>s instead of
  clickable <div>s, so they're keyboard-reachable, with a focus ring. The
  selected chip uses the app's selection blue instead of danger red (which
  made "No shock" / "All categories" read as errors).
- Verified: Enter on a focused chip selects it (SWP 2008); font and size
  unchanged; category click still filters; contrast 0 on the three tabs;
  tests 110/110; smokes 11/11.

## 2026-09-27 - Claude Code (cloud session, review-board loop, iteration 22: flag click keeps the trend)
Changes made by Claude Code (Chief). D3-16 from the Company Analysis division.
- goalden-lab.html `statementsOpenFlag`: clicking a warning (tick or card) no
  longer switches the Bench to a one-year bar view (which hid the
  three-year trend the rule is about). It keeps the over-time chart, pins
  the evidence rows as before, and shades the rule's window
  (flagged year - 3 to flagged year) with a "Flagged: FYxx" label.
  The window clears on focusing a year or changing company.
- Verified on VEDL (FY24 dividend flag): focusYear stays null, markArea
  covers FY21-FY24, the evidence rows are pinned, no errors on six
  companies, tests 110/110, smokes 11/11.
- Noted for later (pre-existing): indexed Bench mode can produce extreme
  values for series with a small or negative base year (dividend payout %).

## 2026-09-27 - Claude Code (cloud session, review-board loop, iteration 23: indexed Bench)
Changes made by Claude Code (Chief). Pre-existing bug found while verifying iteration 22.
- statements-engine.js `benchChartOption`: the indexed view divided by each
  series' first value, which exploded or flipped sign when that value was
  negative or near zero (VEDL dividend payout % indexed to -4,400). Each
  series now indexes from its first positive value that is at least 10% of
  the series' typical size. A series with no such year is left out of the
  indexed view and listed in `__notIndexed`; the Lab caption names it and
  points to the Actual scale. The caption now says each series is indexed
  at its own first meaningful year (it claimed one common base year).
- Verified: VEDL range is now -27..430 (was down to -4,400); new unit test
  (a tiny first value uses the next meaningful base; an all-negative series
  is excluded and reported). Tests 111/111, smokes 11/11, no errors on six
  companies.

## 2026-09-27 - Claude Code (cloud session, review-board loop, iteration 24: honest Plan Health)
Changes made by Claude Code (Chief). D1-15 from the Retirement division.
- goalden-lab.html `calcHealthScore` / `healthStressCheck`: stress survival
  (25 pts) is now MEASURED. It runs the current Retirement Lab plan through
  the first historical episode (2008 for India) in year 1 of retirement,
  at the pot's equity share: survives = 25, runs out in the last fifth of
  the drawdown = 15, earlier = 5. It used to be a self-reported Yes/No
  toggle that defaulted to "Yes", 25 free points. The toggle and its dead
  state key are removed; the card explains the test and states the result
  ("runs out in year 18 of 25").
- "Discipline" (15 pts) repeated the funding test; it is now "Headroom":
  spare capacity as a share of capacity (>=10% = 15, 0-10% = 8, deficit =
  0). The advisor result keeps the `discipline` key (tool contract).
- VISIBLE EFFECT: the default score goes from 90 ("Strong shape") to 70,
  because the default retirement plan has zero margin and does not survive
  a 2008 crash in its first year. That's the truthful reading.
- Verified: the health check's ran-out year equals a direct calcRetLab run
  (18 at 40% equity, 10 at 100%); the user's own shock setting is restored
  afterwards; tests 111/111, smokes 11/11, evals 9/9, contrast 0, no errors.

## 2026-09-27 - Claude Code (cloud session, review-board loop, iteration 25: radar veto resolved)
Changes made by Claude Code (Chief). D4-09 (Visual division veto).
- goalden-engine.js `radarComparisonChartOption` (used by Levels 1/2's
  compare_portfolio chart panel and briefing): outward is now better on
  every axis. "Risk" became "Steadiness (lower risk)" = 1 - vol/maxVol, so
  a riskier asset no longer bulges outward like a better one; the tooltip
  still shows the real return/risk/Sharpe and says "further out is better".
  Negative Sharpe sits at the centre; asset 1 and "Safest mix" no longer
  share a colour; axis/legend text uses AA colours. The enum value 'radar'
  and the function signature are unchanged (advisor tool contract).
- engine.test.js: the test pinning the old "Risk" axis name is updated and
  now also asserts the riskier asset sits further in on steadiness.
- Checks: tests 111/111, smokes 11/11, evals 9/9; rendered and checked
  (RELIANCE vs TCS: TCS, lower return and higher risk, is the smallest
  shape).

## 2026-09-27 - Claude Code (cloud session, review-board loop, iteration 26: Monte Carlo uses your plan)
Changes made by Claude Code (Chief). D1-18 from the Retirement division.
- goalden-lab.html Monte Carlo: "Use my Retirement Lab plan" button carries
  the plan's monthly SIP x 12 (as the yearly contribution, rounded to the
  slider's ₹10,000 step), years to retirement and growth rate. A note says
  where the numbers came from (and when they were rounded to fit the
  slider); any manual MC slider change clears it.
- Verified: ₹22,684/mo gives ₹2,70,000/yr, 30 years, 10%; median ₹4.95 Cr
  vs the plan's ₹4.72 Cr target (the gap is yearly vs monthly contribution
  timing); tests 111/111; smokes 11/11; no errors.

## 2026-09-27 - Claude Code (cloud session, review-board loop, iteration 27: snapshots compare like for like)
Changes made by Claude Code (Chief). D1-14 from the Retirement division.
- goalden-lab.html Retirement snapshots store the corpus in BOTH bases
  (future and today's money) plus the SIP. Cards and the comparison use
  whichever basis is currently selected, so two snapshots saved under
  different "Future / Today's ₹" settings no longer produce a mixed-basis
  % difference. The comparison also states the monthly SIP difference.
  Older snapshots without both bases fall back to what they stored.
- Example (retire 60 vs 55): future money ₹73.72 L LESS (-15.6%), today's
  money ₹10.60 L MORE (+12.9%), SIP ₹22,684 vs ₹32,011 (+₹9,327). Checked
  against the stored raw values. Tests 111/111, smokes 11/11, no errors.

## 2026-09-27 - Claude Code (cloud session, review-board loop, iteration 28: cross-market correlation)
Changes made by Claude Code (Chief). D2-05 from the Portfolio division.
- goalden-lab.html Test Real Investments: for a pair of instruments on
  different markets (INR vs USD listing), correlation now comes from aligned
  WEEKLY returns instead of same-date daily returns. India and the US close
  at different times, so a shared move often lands a day apart and daily
  correlation reads near zero, flattering cross-border diversification.
  Covariance = weekly correlation x each side's daily-based annual vol.
  Same-market pairs are unchanged. The mixed-currency note on screen says so.
- Verified: synthetic markets driven by one common factor with market B
  reacting a day later -> same-day daily corr 0.002, weekly corr 0.749.
  On mock RELIANCE.NS + AAPL + INFY.NS (independent series) both stay ~0
  (0.008 / 0.038), as they should. Tests 111/111, smokes 11/11, all 12 Lab
  tabs render with no errors.

## 2026-09-27 - Claude Code (cloud session, review-board loop, iteration 29: Lab home grid + chart text floor)
Changes made by Claude Code (Chief). D4-15 and D4-19 from the Visual division.
- goalden-lab.html home: the 7 "More tools" are an aligned grid
  (auto-fill, min 250px) instead of a wrapping pill row that left Plan
  Health alone on the last line. Each chip shows a one-line description
  on screen; before, it was only in a hover tooltip, which touch users
  never see. The 4th main card gets its own corner cut, like cards 1-3.
- Chart text floor: no chart label or tick is below 10px any more, in the
  Lab, Level 1 (fee bars), goalden-engine.js (the Level 1/2 briefing
  frontier) and statements-engine.js. Named markers (BEST BALANCE, SAFEST,
  YOUR MIX, RISK-FREE) are 11px. The exception is the Build a Portfolio
  markers, which are 10px, because at 11px the best-mix box ran into the
  y-axis ticks. That box now hangs above-left of its marker and is clamped
  inside the chart. On a phone the old box printed over the axis; now it is
  fully visible, though it still sits close to "+x% possible". Engine
  SAFEST and BEST BALANCE labels shift apart when the two points sit close.
- Verified: grep shows no fontSize under 10 across all pages and engines.
  Screenshots taken at 1400px and 412px (portfolio, live frontier, growth,
  engine frontier), compared before and after. Tests 111/111, smokes 11/11,
  all 12 Lab tabs render with no errors.

## 2026-09-27 - Claude Code (cloud session, review-board loop, iteration 30: no assumed fund-manager edge)
Changes made by Claude Code (Chief). D2-14 from the Portfolio division, plus two
layout bugs found while checking it.
- goalden-lab.html Build a Portfolio: Flexi Cap and ELSS funds now assume
  12.0%/yr, the same as the Nifty 50 index fund (they were 12.5%). S&P's
  SPIVA India mid-2026 scorecard: over 10 years, more than 70% of active
  funds in every category trailed their benchmark after fees, and 80.5% of
  ELSS funds did (checked on spglobal.com). Multi Cap stays at 13%: SEBI
  requires 25% each in mid and small caps, so the extra return is for
  extra risk, not manager skill. Each row says so on screen ("same as the
  index: no manager edge assumed"), and the info tooltip cites the source.
  Effect on preset expected returns: conservative 9.34% -> 9.32%,
  balanced 10.68% -> 10.63%, aggressive 12.07% -> 11.98%.
- Panel captions (Build a Portfolio, Test Real Investments) had no font
  rule inside .panel, so they rendered at the browser's 16px, bigger than
  the panel title. They are now 12.5px.
- Fund rows: the description line was meant to sit under the fund name,
  but the label's flex layout put it beside the name as a squeezed second
  column that overflowed the panel. Now it stacks underneath.
- Verified: preset returns recomputed from the page before and after; the
  tags were read back from the DOM; screenshots at 1400px and 412px.
  Tests 111/111, smokes 11/11, evals 9/9 (mock), all 12 Lab tabs render with no errors.

## 2026-09-27 - Claude Code (cloud session, review-board loop, iteration 31: market-wide risk counts interest rates)
Changes made by Claude Code (Chief). D2-13 from the Portfolio division.
- goalden-lab.html Build a Portfolio, "How much of your risk is
  diversifiable": market-wide (systematic) risk is now measured against
  two factors, the stock market (Nifty 50 / US Total-Market) and interest
  rates (Gilt fund / US Aggregate Bond), instead of the stock market alone.
  Before, a debt-heavy mix read as ~99% "diversifiable". Bond funds fall
  together when rates rise (debt-debt correlation 0.80 in the model), so
  that was wrong. Beta is still the stock-market beta. The info tooltip
  and legend name both factors.
- Effect (India): all-debt mix 1.2% -> 86.5% market-wide; conservative
  67.0% -> 79.1%; balanced 83.0% -> 85.5%; aggressive 86.8% -> 87.1%.
  US: conservative 60.5% -> 81.4%, all-debt 1.2% -> 82.1%.
- Verified: the closed form (c' S^-1 c) matched an independent 60,000-draw
  simulation plus two-factor OLS R^2 within 0.6 points on all 10 mixes.
  Legend parts add back to total volatility (9.2^2 + 4.0^2 = 10.04^2).
- Also: the panel caption said "SEBI categories" in US mode; it is now
  country-aware.
- Tests 111/111, smokes 11/11, evals 9/9 (mock), all 12 Lab tabs render with no errors.

## 2026-09-27 - Claude Code (cloud session, review-board loop, iteration 32: tax on withdrawals)
Changes made by Claude Code (Chief). D1-16 from the Retirement division.
- goalden-lab.html Retirement Lab: new "Tax on withdrawals" slider (0-30%,
  default 0 so every existing figure is unchanged). It is an effective
  rate on the whole withdrawal. The info tooltip explains why that is below
  the headline rate: in India only the gains part is taxed, equity LTCG at
  12.5% above ₹1.25 L, debt at slab. With tax t, the plan withdraws
  spend/(1-t), and the corpus, SIP, drawdown chart and drawdown Monte Carlo
  all run on that gross withdrawal. A note under the slider shows spend vs
  withdrawn vs tax. In "I know my number" mode the pot stays fixed and
  "Supports spending of" becomes the after-tax figure.
- Sustainable Withdrawal: the same slider. "Sustainable monthly draw"
  shows the after-tax spend plus the gross amount withdrawn; year-1 draw is
  labelled "withdrawn, before tax". The pot's lifespan is unchanged by tax.
- Advisor: ret.withdrawTax and swp.withdrawTax are settable (0-30).
- Verified: at 0% the corpus, SIP and spend match the previous commit
  exactly in 3 configs (start/end timing, custom pot). At 10%, corpus and
  SIP scale by exactly 1/0.9, and the drawdown ends at 0. In the browser:
  ₹4.72 Cr -> ₹5.24 Cr, SIP ₹22,684 -> ₹25,205. SWP: ₹53,620 withdrawn,
  ₹48,258 spend (x0.9). The advisor rejects 80%. Tests 111/111, smokes
  11/11, evals 9/9 (mock), all 12 Lab tabs render with no errors.

## 2026-09-27 - Claude Code (cloud session, review-board loop, iteration 33: new-this-year watch list)
Changes made by Claude Code (Chief). D3-19 from the Company division.
- statements-engine.js evaluateDivergenceRules returns `watch`: checks
  that fire for the FIRST time in the latest year. A flag still has to
  persist two years before it is raised, which is right for past years.
  But for the latest year that rule hid brand-new problems until the next
  filing. Watch items don't count toward the 3-flag cap and are never
  also flags.
- goalden-lab.html Read the Company: a muted "New in the latest year:
  watch" row under the flag cards, with an info note on why these are not
  flags yet. Clicking one pins the evidence and shades its window, the same
  as a flag card. The checks summary counts them. The advisor's statements
  summary includes them (newThisYearWatch).
- HINDALCO FY26 now shows inventory days 111 -> 156 and a Rs 1,071 Cr
  dividend against Rs -19,508 Cr free cash flow with borrowings up
  Rs 33,523 Cr. Before, it showed nothing for FY26.
- Verified: a separate script scanning each rule's last result on all 6
  fixtures found the same set (HINDALCO only). New engine test (112/112).
  Checked in the browser at 1400px and 412px, including the click-through
  and the TCS/VEDL summaries. Smokes 11/11, evals 9/9 (mock), all 12 Lab
  tabs render with no errors.

## 2026-09-27 - Claude Code (cloud session, review-board loop, iteration 34: merger/demerger years marked)
Changes made by Claude Code (Chief). D3-20 from the Company division, plus a
number-format bug found while checking it.
- statements-engine.js detectStructuralBreaks(bundle) flags a year when:
  total assets rise >= 50% AND >= 2.5x the company's own median yearly
  growth; total assets fall >= 25%; or fixed assets fall >= 40%. Only
  consecutive years are compared. The message says what moved and the
  usual causes (merger, demerger, acquisition, large capital raise).
  Fixtures: HDFCBANK FY24 (+59%, HDFC Ltd merger), VEDL FY26 (fixed assets
  -69%, demerger), PAYTM FY16 and FY22 (capital raises; FY22 is the IPO).
  Nothing for BAJFINANCE (fast but steady growth), TCS or HINDALCO.
- goalden-lab.html Read the Company: break years get a red rule and a
  diamond on the column header in every statement table, and a one-line
  note under each table title. On the Bench chart the year label is red
  and the caption explains it. The advisor's statements summary includes
  structuralBreaks.
- Lender-aware definition: for a bank or NBFC, "Other Income" is explained
  as mostly core business (fees, commissions, treasury, insurance), not
  one-offs. HDFCBANK FY26: Rs 1,46,848 Cr.
- Bug fix: formatCroreSafe switched to "L Cr" at 1e7 crore instead of 1e5
  (one lakh crore), and the compact label had no lakh step. HDFC Bank's
  total assets printed as "4907.7k Cr"; now "49.08L Cr". TCS sales:
  "267.0k Cr" -> "2.67L Cr" (test updated to the new format).
- Verified: engine test on 4 fixtures (113/113); rendered HDFCBANK, VEDL
  and TCS in the browser (notes, header marks, caption, lender
  definition). First tries with an on-chart line and a shaded column were
  rejected: the line collided with the value label, and the shading has
  zero width on a category axis. Smokes 11/11, evals 9/9 (mock), all 12
  Lab tabs render with no errors.

## 2026-09-27 - Claude Code (cloud session, review-board loop, iteration 35: statement checks compare real years)
Changes made by Claude Code (Chief). The last Company-division item: "other
divergence rules still use index offsets".
- statements-engine.js: 9 of the 11 divergence rules lined series up by
  array position (np[i-3], sales[i], cfo[i-1]). When a company's data skips
  years (PAYTM: FY16 then FY19), "three years ago" for FY20 was FY15, and
  "last year" for FY19 was FY16. They now look values up by fiscal year
  (yearMap/at). Loops start where they did, so a rule is still silent for
  the first k years. A gap inside the data gives not_applicable instead of
  a wrong comparison. The persistence gate also requires the previous
  result to be the previous fiscal year.
- goalden-lab.html: the checks summary said "not applicable for this
  reporting format"; it now also names a missing year.
- Verified: dumped every rule's full output on all 6 fixtures before and
  after. BAJFINANCE, HDFCBANK, HINDALCO, TCS and VEDL are byte-identical.
  PAYTM: 8 checks that compared the wrong years are now not_applicable;
  86 checks run and the same 3 flags as before. New engine test (114/114).
  Smokes 11/11, evals 9/9 (mock), all 12 Lab tabs render with no errors.

## 2026-09-27 - Claude Code (cloud session, review-board loop, iteration 36: mixed-currency mixes converted)
Changes made by Claude Code (Chief). D2-04 from the Portfolio division, the
last backlog item.
- goalden-lab.html Test Real Investments: when a mix holds both INR and USD
  instruments, the app fetches the USD/INR daily rate (Yahoo "INR=X")
  through the existing /api/history route; no server change. It converts
  the foreign instruments' prices into the viewer's home currency (₹ in
  India mode, $ in US mode), using the latest rate on or before each date.
  The common date window, the stats, the covariance, the frontier and the
  growth/drawdown chart all use converted prices, so a US stock's return
  to an Indian investor now includes what the rupee did. Each instrument's
  own card stays in its own currency. Weekly correlation for cross-market
  pairs is unchanged (it is about trading hours, not currency).
- The note says which way things were converted. If the rate can't be
  loaded, nothing is converted and the old warning shows, with the reason.
  A single-currency mix never requests the rate.
- Verified on the mock server: converted prices matched an independent
  forward-fill calculation with 0 relative error, in both directions.
  Home-currency series are returned untouched. The growth chart's index
  equals converted end/start. Forced a 502 on the FX request: the fallback
  warning names the error. INR+INR mix: 0 FX requests. NOT verified
  against live Yahoo (the sandbox blocks it); the symbol is URL-encoded
  the same way as every other ticker. Tests 114/114, smokes 11/11, evals
  9/9 (mock), all 12 Lab tabs render with no errors.

## 2026-10-04 - Claude Code (cloud session): SPEB / SME-board stocks in Test Real Investments
Changes made by Claude Code. The user reported that SPEB could not be fetched.
- Root cause (checked live from outside the sandbox): SPEB is SPEB Adhesives
  Ltd, listed on NSE Emerge (the SME board) on 8 Dec 2025. Yahoo Finance
  has no history for it. SPEB.NS returns 404 ("No data found, symbol may be
  delisted"). Yahoo's own symbol is SPEB-SM.NS, but its chart endpoint
  returns a single bar ("validRanges": 1d, 5d), even for an explicit
  10-month window. The app's name search only covers its built-in list,
  so "speb" also said "No matches". This was not a Goalden bug; the
  source has no data.
- src/worker.js and local_server.py (kept in step): /api/history?type=equity
  still tries Yahoo first (dividend-adjusted). Only if Yahoo has no usable
  history for an Indian-looking symbol (X.NS, X.BO, X-SM.NS or a bare
  code) does it fall back to screener.in. It reads the company id from
  screener's company page, then the daily closes from
  /api/company/<id>/chart/?days=3650 (no ?q=, which screener's robots.txt
  disallows; without q the endpoint returns the price series by default).
  The result carries source/sourceNote. If both fail, Yahoo's error is
  shown. ^NSEI, INR=X, BRK-B and similar never touch screener.
- goalden-lab.html:
  - The equity search queries the wider market (/api/symbolsearch) when
    the built-in list has no match, so "speb" finds SPEB-SM.NS. The
    curated list still comes first ("titan" makes no market call).
    Loading, empty and failed states are handled.
  - The instrument card says when prices came from screener.in, and the
    advisor's add-instrument result includes it.
  - New "THIN" caution when a stock has prices on under 80% of weekdays.
    SPEB: 147 of 214, "about 69%"; liquid stocks and funds are ~94-96%.
  - Live-frontier labels are kept inside the chart. The riskiest point
    sits in the top-right corner and its label was cut off. ECharts
    re-runs labelLayout with the previous shift already applied, so the
    shift is remembered per label.
  - The ticker help mentions SME-board stocks.
- New smoke-15.js plus fixtures/screener-chart/SPEB.json (the real price
  series recorded 2026-10-04): worker and local_server.py map 10 symbols
  identically. Both return all 147 closes (57.00 on 2025-12-08 to 86.00 on
  2026-10-01), request the chart without ?q=, and keep Yahoo's error when
  there's no fallback.
- Verified: the real screener responses replayed through the real server
  code for SPEB-SM.NS, SPEB.NS, SPEB and speb. The Worker was driven end to
  end with stubbed fetch. In the browser, typing "speb" -> search ->
  add -> card, frontier and flags all work. 65.8%/yr compounded checked by
  hand (57 -> 86 over 297 days = 65.9%). No chart label outside the canvas
  at 1400px or 412px, including after hovering. Tests 114/114, smokes 12/12,
  evals 9/9 (mock), all 12 Lab tabs render with no errors. NOT verified:
  the deployed Worker calling screener.in from Cloudflare (the sandbox
  can't reach it). The endpoint was checked from outside via a web fetch.
---

## 2026-08-18 - opencode - quarterly + shareholding + peer + business description + companion expansion

### Done
- **Quarterly results parsed and rendered.** worker.js and local_server.py
  extract the `quarters` section from screener.in (strict parity).
  statements-engine.js gained a `quarterly` canonical row list reusing the
  P&L rows. goalden-lab.html renders it via renderOneStatementTable through
  STMT_SECTIONS.
- **Shareholding pattern parsed and rendered.** Same pipeline, extracting
  the `shareholding` section. Root cause of the null-on-live-fetch: the
  section's tables have NO data-date-key attributes, so pickDataTable
  scored them 0 and screenerParseTable produced empty periods. Both parsers
  now fall back to extracting period labels from header text when
  data-date-key is absent, and classifyPeriods marks those as
  type:'period' (not 'fy'). fySeriesSafe in goalden-lab.html falls back to
  allPeriodSeries (new engine export) for non-FY sections. Pledge
  constraint honored: no fixture has a pledge row and the canonical list
  does not include one â€” absence IS absence of the claim.
- **Business description parsed.** parseBusinessDescription() /
  _parse_business_description() extracts the company-profile paragraph.
  Wired into buildFinancialsResult / _build_financials_result.
- **Peer table parsed.** parsePeerTable() / _parse_peer_table() extracts
  the peers section's data table when present. May be null on live (peer
  table loads via JS on screener.in â€” the fixture has no <table> in the
  peers section, confirmed).
- **Screener growth-rate summaries parsed.** parseGrowthSummaries() /
  _parse_growth_summaries() extracts Compounded Sales/Profit Growth, Stock
  Price CAGR, Return on Equity tables.
- **Companion map expanded 7 to 35 entries** with companionMapFor(label,
  isCyclical) cyclical swap for Stock P/E. renderCompanionStripHTML uses
  companionMapFor with detectCyclical's result.
- **Growth summary chart** (growthChartOption) and **cash-flow waterfall**
  (cashFlowWaterfallOption) rendered in new cards.
- **P/E band chart** (peBandChartOption â€” two stacked grids: price top,
  P/E below, dataZoom, median mark-line) rendered in Growth & Returns.
- **Dilution Drag surfaced** as a third stat tile in Growth & Returns.
- **Grid layout** (12-col CSS grid breaking the rectangle stack),
  **sticky auto-hide jump-nav**, **chrome auto-collapse**, **unit-aware
  Explore deck** from previous sessions confirmed intact.

### Verified
- node --test engine.test.js: 99/99 PASS.
- smoke-02, 05-13: ALL PASS. Inline-script parse: ALL OK.
- agent-evals loadPage for all 3 pages: OK.
- Render-count tripwire: zero actual render()/updateStatementsUI() calls
  in new code (comment-only matches excluded by filtering comment lines).

### What I CANNOT do (needs Claude Code)
- **Browser testing**: no browser in this env. The following need a live
  browser pass: quarterly/shareholding table rendering with real data,
  P/E band chart with a real price series, auto-hide jump-nav timing,
  grid proportions at various widths, sticky Bench scroll, unit-aware
  stacked-band chart with real mixed-unit data, zero console errors.
- **Live screener.in verification**: can't fetch from screener.in to
  confirm section IDs match on the live page (fixture confirms they match
  as of capture date, but live HTML may differ â€” this was the root cause
  of the null quarterly/shareholding on live fetch).
- **Git/deploy**: per the standing rule.

### Known / not done (flagged, not silently dropped)
- No commit made (per the git rule).
- **Header card doesn't show the business description yet** â€” the parser
  extracts it (result.businessDescription) but renderStatementsHeaderHTML
  needs updating to display it.
- **Peer table UI** â€” the parser extracts it (result.peerTable) but no
  rendering card. May be JS-only on screener.in (always null on live).
- **Growth summary UI** â€” the parser extracts result.growthSummaries but
  no rendering card yet.
- **Quarterly periods use type:'period' not 'fy'** â€” sparklines, growth
  bands and the vs-median column may not render for quarterly tables
  (fySeries filters for type:'fy'). Table data renders correctly; a
  quarterly-aware series function is a follow-up.
- **Solo/mute on Bench chips, reading column extension, third company,
  mobile bottom sheet, ROCE-vs-growth scatter, stacked composition chart**
  â€” still deferred from the original list.

## 2026-08-25 - Claude Code

Browser pass on opencode's full-coverage scraping work, live against
screener.in (not just the golden fixture). Found and fixed real bugs the
fixture couldn't catch because it was captured before some of these existed;
all fixes verified live on TCS (non-lender) and HDFCBANK (lender).

- **Stale in-memory cache masked everything at first.** The local server had
  been running since before this work landed, so every /api/financials call
  was served from a 24h-old cache with no quarterly/shareholding/description
  fields at all. Restarting picked up the code and cleared the cache -
  mentioning this because it will bite the next person too: after a
  Python-side parser change, restart local_server.py, don't just reload
  the page.
- **Fixed: parseGrowthSummaries / _parse_growth_summaries grabbed the wrong
  table.** Screener's growth-rate cards put the metric name as a <th> *inside*
  their own <table>, not as a heading before it. Slicing forward from the
  label match landed on the *next* card's table instead. Verified against a
  live TCS fetch: every value was off by one metric (Sales Growth showed
  Profit Growth's numbers, etc). Fixed in both screener-parser.js (used by
  worker.js) and local_server.py by finding the enclosing table via
  `lastIndexOf('<table', ...)` before the label, not after it. Added a
  regression test using the real nested-table shape.
- **Fixed: quarterly and shareholding periods were mislabeled as fiscal
  years.** classifyPeriods correctly types anything matching a YYYY-MM-DD
  date-key as 'fy' - true for the yearly statements, wrong for quarterly
  dates (Jun/Sep/Dec/Mar) and shareholding dates, which also carry full
  dates. Rather than reworking the type system (fySeriesSafe already
  depends on it), fixed the two places this actually surfaced as a wrong
  claim: renderOneStatementTable's column headers now show the period's own
  label ("Jun 2023") instead of a duplicated "FY23" for every quarter in
  that fiscal year, for the quarterly and shareholding sections. Same fix
  for the section span text and the "Rs Cr unless noted" unit suffix
  (shareholding is percentages, not rupees).
- **Fixed: rowBoxScore's CAGR compounded over point-count, not elapsed
  time.** `years = clean.length - 1` treats 13 quarterly points the same as
  13 annual ones, so the Quarterly Results footer showed "12Y CAGR 1.7%" on
  a table that only spans ~3 calendar years - both the label and the
  compounding were wrong (true annualized growth was closer to 7%). Now
  `years = last.year - first.year`. Existing annual-cadence test is
  unaffected (same value either way for one-point-per-year series); added a
  regression test with TCS's real 13-quarter Sales series.
- **Fixed: readingSentence (the 15-template reading-column generator) said
  "years" for quarterly/shareholding rows.** Same root issue as the CAGR
  bug, different function. Added an isSubYear flag threaded from
  statementRowHTML's sectionKey; quarterly/shareholding rows now say
  "quarters" and reference the period's own label instead of a shared FY.
  The two "grew/fell X% a year on average" templates are suppressed for
  sub-year rows rather than fixed properly (annualizing off point-count has
  the same flaw rowBoxScore had) - falls through to the plain up/down-count
  template instead, which is correct either way.
- **Wired: Compounding Checklist condition 8** (promoter holding / pledge)
  now reads bundle.shareholding instead of hardcoding "not fetched yet".
  Computes the real 12-quarter promoter-holding change. Pledge stays
  `available:false, meets:null` whenever no Pledged % row is present -
  never inferred as 0%, per the standing hard constraint. Verified on
  HDFCBANK where Promoters is genuinely "-" for every quarter (no promoter)
  and the row renders as dash, not zero.
- **Wired: business description in the header card.** Data was parsed
  correctly but never rendered. Added descLine under the sector line.
- **Confirmed correct, not a bug:** parsePeerTable returning null on live
  TCS/HDFCBANK. screener.in's peer table genuinely loads via a client-side
  request the static HTML fetch never sees (confirmed by curling the raw
  page - no peer-table markup, no "CMP" column header anywhere in the
  response). The code's own comment already said this; opencode's caveat
  was accurate.
- **Not done: growthSummaries has no UI card.** Parses correctly now
  (verified against live screener.in values via WebFetch: Sales Growth
  9/10/6/8, Profit Growth 8/9/8/9, Stock Price CAGR 6/-9/-12/-27, all
  exact matches), but nothing renders it. Lowest-priority item on the
  original list; leaving it parsed-but-unshown rather than building new UI
  during a verification pass.
- **Not done: Bench chart tooltip reading-column text** (benchTooltipOverTime/
  benchTooltipAtYear) still says "years" if someone pins a quarterly or
  shareholding row - same class of bug as readingSentence, narrower surface
  (hover-only, on a row type most people won't pin). Flagged, not fixed.
- node --test engine.test.js: 102/102 PASS (added 4 regression tests for
  the above).
- Last commit pushed: (see next commit)

## 2026-08-25 - Claude Code

- **Closed: Bench chart tooltip reading-column text.** statementsPinSeries
  now carries an isSubYear flag (section==='quarterly'||'shareholding'),
  threaded into readingSentence from both benchTooltipOverTime and
  benchTooltipAtYear - pinning a quarterly/shareholding row and hovering
  the Bench chart now says "quarters" and uses the period's own label,
  matching the fix already applied to the main table.
- **Built: growthSummaries UI card.** New "As Published by Screener.in"
  table inside Growth & Returns, showing screener's own headline Sales
  Growth / Profit Growth / Stock Price CAGR / Return on Equity figures
  (10y/5y/3y/Trailing) next to this app's own computed CAGR. Any gap over
  5pp between the two sources is marked, with a hover note explaining a
  gap isn't necessarily an error in either one. The trailing column reads
  positionally (last row) rather than by label match, since screener calls
  it "TTM:" on the growth cards, "1 Year:" on the price-CAGR card, and
  "Last Year:" on the ROE card - matched against real TCS HTML from
  screener.in, values line up exactly.
- **Fixed a real bug found during this pass: the P/E band chart never
  rendered.** Two stacked defects: (1) the call site passed the whole
  statementsPeBand() wrapper object into peBandChartOption() instead of
  its .band field, so peResult.series was undefined and the function threw
  on every company; (2) even with that fixed, the initChart() call lived
  inside renderDepthMetricsHTML() itself - which only returns an HTML
  string, assigned to the DOM by its *caller* one line later - so
  echarts was mounting onto a node that was about to be discarded by the
  next line's innerHTML replacement. Moved the init call into
  updateStatementsUI(), after the innerHTML assignment, matching the
  existing (correct) pattern already used for the growth and waterfall
  charts. Verified live on TCS: chart now renders an actual SVG with 12
  years of P/E band data.
- **Added: fullscreen toggle on every chart in the app**, not just
  Read the Company - implemented once inside initChart() itself
  (ensureChartFsWrap/toggleChartFullscreen in goalden-lab.html), so every
  existing and future chart gets it automatically without touching each
  template. Wraps the chart's container in a sibling <div class="chart-fs-wrap">
  the first time initChart() sees it (idempotent - a full re-render's
  fresh DOM node just gets rewrapped), adds one expand/collapse button as
  a *sibling* of the container (never a child, since ECharts owns and
  periodically clears the container's own children), and resizes the
  instance via chart.resize() after the CSS transition. Escape key exits
  whichever chart is fullscreen. Verified via dispatched keydown (the
  computer-tool key press doesn't reach an unfocused/hidden Browser pane,
  so tested with a real KeyboardEvent instead) - open/close/resize all
  correct, no console errors on a fresh tab.
- **Investigated but could not close: live pledge-percentage verification.**
  Set out to verify condition 8's pledge half against a real company with
  nonzero pledge (open item from last session). Checked VEDL, ZEEL,
  SUZLON, RAIN, JPASSOCIAT, MANAPPURAM, DISHTV, SREINFRA, RPOWER - all
  companies with real pledge history - both through the app and by
  curling screener.in's raw HTML directly. Zero "pledge" mentions
  anywhere in any of these pages' current HTML, not just missing from our
  parsed rows. screener.in's shareholding table appears to no longer
  surface a Pledged % row in the public static page for any company
  sampled (possibly moved behind login, or dropped from that view
  entirely) - this isn't a gap in our parser, it's an absence in the
  source. Confirmed the refusal path itself is correct on real data:
  VEDL's condition 8 reports "Promoter holding fell 9.0pp over 12
  quarters - pledge % not reported by the source, so this condition can't
  be fully evaluated" with meets:null, available:false - matches the
  actual 63.71%->54.72% promoter decline visible in the raw HTML, and
  never claims 0% pledge.
- node --test engine.test.js: 102/102 PASS (no new tests needed - all
  three fixes are DOM-timing/wiring bugs and a display feature, not new
  computation to unit-test against the engine).
- Last commit pushed: (see next commit)

## 2026-08-25 (2) - Claude Code

- **User found a real gap:** typed "AXISOL" for Axis Solutions Ltd and got
  "screener.in has no page for AXISOL" - correct behavior, but unhelpful.
  screener.in identifies some smaller companies (Axis Solutions among them)
  only by their numeric BSE code, not a letter ticker - confirmed via
  screener's own /api/company/search/?q= endpoint, which returns
  "/company/511144/" for "Axis Solutions", and by curling that URL directly
  (200 OK). Updated the not_found error message in both worker.js and
  local_server.py to mention this and give the concrete example.
- **Added: company name resolution.** New parseCompanyName() in
  screener-parser.js (reads the page's <h1>), mirrored as
  _parse_company_name() in local_server.py, wired into result.companyName
  in both backends. The header card now shows the real company name under
  the symbol whenever it differs from what was typed (covers both normal
  tickers like "TCS" and numeric BSE codes like "511144") - the avatar
  initial now comes from the company name too, so a numeric-code company
  doesn't show a bare digit. Verified live: 511144 -> header now reads
  "511144" / "Axis Solutions Ltd" instead of just "511144".
- **Found and fixed a real concurrent-edit bug, not mine:** while verifying
  the above, node --check started failing on goalden-lab.html with
  "Unexpected end of input". git diff showed a large unrelated change
  already in the working tree - a new Pearson-correlation / trajectory-path
  feature for the Explore scatter chart (stmtExploreUpdateChart), presumably
  opencode's in-progress work in the shared directory. The diff had dropped
  the function's own closing brace when inserting the new dblclick-drilldown
  block at the end, leaving stmtExploreUpdateChart unclosed and every
  following top-level statement swallowed inside it. Added the missing `}`
  immediately after the dblclick handler registration (before the "One
  delegated click listener..." comment, which is a separate top-level
  listener and was clearly meant to stay outside the function). Verified
  the feature itself works as intended after the fix: scatter mode on
  TCS Sales vs Net Profit renders, computes Pearson r = 1.00 correctly,
  shows the trajectory chip and dashed path, no console errors.
- node --test engine.test.js: 102/102 PASS.
- Last commit pushed: (see next commit)

---

## 2026-08-18 - opencode - Explore deck: trajectory paths, correlation, drill-down, factual observations

### Done
- **Scatter trajectory path:** consecutive fiscal years are now connected
  with a dashed line so the viewer sees the company's direction of travel
  through metric space â€” is margin improving while sales growth slows?
  That pattern is invisible in disconnected dots. The latest year gets a
  distinct color (terracotta vs blue) and an inline "FY20xx" label at the
  end of the path.
- **Live Pearson correlation coefficient:** computed from the aligned
  pairs on every scatter render. Shown as a chip with a plain-language
  strength label ("strong linear relationship", "moderate", "no clear").
  Caption adds "These two metrics have moved together/in opposite
  directions across this window" when |r| >= 0.7.
- **Double-click drill-down:** double-clicking any point or line in the
  Explore chart closes the deck, scrolls to the source row in the
  statements table, and pulses the row with a blue flash. Uses ECharts'
  own dblclick event (not DOM events) so the exact series is identified.
- **Factual observation strip on lines mode:** after rendering, computes
  each series' first-to-last change and prints deterministic sentences:
  "Sales went up 142% over this window. Net Profit went up 89% over this
  window." When every series moves the same direction, prepends "Every
  metric moved up/down in this window." Pure arithmetic + a template,
  same data in = same sentences out.
- **Row flash CSS:** .stmt-row-flash animation on td elements for the
  drill-down highlight.

### Verified
- node --test engine.test.js: 102/102 PASS.
- smoke-02, 05-13: ALL PASS.
- Inline-script parse: ALL OK across all four HTML files.
- Render-count tripwire: zero render()/updateStatementsUI() calls in the
  new trajectory/correlation/drill-down code (comment-only matches
  excluded).

### Known / not done
- No commit made (per the git rule).
- NOT browser-tested: trajectory path visual density with 12+ years,
  correlation chip readability, dblclick drill-down smoothness — need
  Claude Code's live pass.
- 3D visualizations (user's idea): the design plan explicitly bans
  anything 3D ("3D anything" in the rejected-charts list). Financial
  charts in 3D obscure the numbers behind surfaces. If the user wants to
  override this ban for a specific chart type, that's a deliberate
  design decision that should be made explicitly — not something to
  sneak in as a default.

---

## 2026-08-18 - opencode - Explore deck: two-company comparison + Pearson explanation

### Done
- **Two-company comparison in the same chart.** Each Explore slot (and
  each scatter axis) now has its own company selector when a comparison
  company is loaded. Lines mode: 3 independent metric+company pairs, so
  you can plot TCS Sales alongside HDFC Sales, or TCS Net Profit against
  HDFC OPM %. Scatter mode: X and Y each pick their own company, so you
  can plot TCS OPM % against HDFCBANK ROE %. Series names include the
  company symbol when it differs from the primary, so the viewer always
  knows whose number they're looking at.
- **Pearson r explained in plain language.** A visible explanation panel
  appears below the chart in scatter mode whenever a correlation value is
  computed. Deterministic text: explains the -1 to +1 scale, what this
  specific r value means for the selected window, and explicitly states
  it does not predict what happens next or imply causation. No model —
  same data in = same explanation out.
- State shape: added slotCompanies (per-slot), xCompany, yCompany with
  backward-compat defaults. Change listener handles per-slot company
  switches (drops dead selections from the other company's row catalog).

### Verified
- node --test engine.test.js: 102/102 PASS.
- smoke-09, 10, 11, 12, 13: ALL PASS.
- Inline-script parse: ALL OK.
- agent-evals loadPage('goalden-lab.html'): OK.
- Render-count tripwire: zero render()/updateStatementsUI() calls.

### Known / not done
- No commit made (per the git rule).
- NOT browser-tested: the two-company selector UI, the Pearson
  explanation panel readability, and the cross-company chart rendering
  need Claude Code's live pass.

## 2026-08-25 (3) - Claude Code

- **User reported the X vs Y scatter chart rendering blank** after
  picking a second axis combination (e.g. Other Income vs Equity
  Capital), even though the fact chips above it (points count, Pearson r)
  computed correctly. Root cause in `stmtExploreUpdateChart()`'s scatter
  branch: `if(dom.innerHTML) dom.innerHTML='';` wiped the chart
  container's DOM directly, every time. `initChart()` reuses the same
  DOM node across renders once an instance exists (it only re-inits on
  node-identity change), so on the *second* scatter render this line
  ripped ECharts' own SVG root out from under a still-live instance --
  the instance object survived and `setOption` ran without error, but
  painted into a now-detached node, leaving the visible container
  permanently empty from that point on. Fixed by only clearing when no
  live chart instance is registered for that container
  (`!chartInstances[STMT_EXPLORE_CHART_ID]`), which still clears a
  leftover ".sx-empty" message before a fresh `echarts.init()`, but
  leaves an existing instance's rendering root alone -- `initChart`'s own
  `setOption(option, true)` already fully replaces the previous chart.
- Verified live (browser, local server): first scatter render works
  (SVG present), then reproduced the exact bug (SVG still present but
  0 real content after wipe) against the fix, then confirmed correct
  after the fix across three consecutive axis changes (Sales/Net
  Profit -> Other Income/Equity Capital -> Sales/Other Income ->
  Reserves/Cash from Operating Activity), each producing real SVG
  paths and the expected 12-point series.
- node --test engine.test.js: 102/102 PASS. Inline-script syntax check:
  OK.
- Last commit pushed: (see next commit)

## 2026-08-25 (4) - opencode + Claude Code

- **opencode added cross-company support to the Explore deck.** Previously
  every slot (lines mode) and axis (scatter mode) plotted rows from
  whichever single company was selected in the "Company" dropdown. Now
  each line-mode slot and each scatter axis carries its own company
  (`st.slotCompanies[i]`, `st.xCompany`/`st.yCompany`), so a single chart
  can plot e.g. TCS Sales against HDFCBANK Revenue directly, without
  leaving the deck.
- **Added: "+ Compare with another company" inline search**, right in the
  Explore deck controls, for when no compare company is loaded yet. Types
  a symbol, hits Load or Enter, calls the existing `statementsSetCompare`,
  and re-renders the deck's controls and chart once it resolves.
- **Added: a permanent "What Pearson r means" explainer** under the
  scatter chart's caption whenever a correlation value exists — plain-
  language, deterministic, states explicitly that it describes the past
  and is not predictive and not causal.
- opencode's session hit repeated "Error from provider (Console Go):
  Upstream request failed" retries partway through (its own LLM backend
  connectivity, unrelated to this codebase) and had not yet written a
  WORKLOG entry or run its own verification pass when the user flagged
  it. Claude Code verified independently before shipping: inline-script
  syntax check OK, `node --test engine.test.js` 102/102 PASS, then live
  in the browser — loaded TCS, opened Explore, clicked "+ Compare with
  another company", loaded HDFCBANK, confirmed the slot/axis company
  dropdowns populated, plotted TCS Sales vs HDFCBANK Revenue in both
  lines and scatter mode (chips correctly labelled "Revenue (HDFCBANK)"),
  confirmed the new Pearson explainer renders, and re-ran the prior
  blank-scatter-chart regression check against this new code path (axis
  change after a live render still repaints correctly). Zero console
  errors throughout.
- node --test engine.test.js: 102/102 PASS.
- Last commit pushed: (see next commit)

## 2026-08-26 - Claude Code

- **User flagged "Axis Solutions Limited (held back)" in Test Real
  Investments, expecting a bug.** Traced it: not a bug. AXISOL.BO's real
  price history (both raw and split-adjusted) sat flat at Rs3.61 for
  several sessions, then jumped to Rs72.20 -- exactly 20x -- on
  2024-09-04 and sat flat there too. That single day distorts the
  arithmetic-mean-based annualised return to 655%/yr, which the existing
  data-quality gate (auditPriceSeries) correctly flags 'unusable' and
  holds back, per this project's standing rule that a flagged series is
  labelled, never silently repaired. Verified live: hovering the chip
  already shows the reason, and the "Instrument stats" card further down
  the live-frontier page (below the risk-free slider, outside the
  screenshot the user sent) already shows all three flags plus a working
  "Use it anyway" override -- clicking it correctly adds the instrument
  to `liveReadyItems()`.
- **Fixed a real, narrower gap found in the process:** the unadjusted-
  split signature check in `auditPriceSeries` only tested k in
  [2,3,4,5,10], so this exact 20:1 case fell through and only got the
  generic "most likely a corporate action" JUMP message instead of a
  precise one. Added 20, 25, 50 to the checked ratios (common Indian
  face-value-consolidation ratios for micro-caps). AXISOL.BO now
  correctly reads "Looks like an unadjusted 20:1 split or bonus issue on
  2024-09-04, not a genuine one-day move." This doesn't change which
  instruments get held back -- IMPLAUSIBLE (unusable) fires independently
  of SPLITSIG (caution) -- it only makes the caution flag's message
  accurate for this ratio.
- node --test engine.test.js: 102/102 PASS. Inline-script syntax check:
  OK.
- Last commit pushed: (see next commit)


---

## 2026-08-18 - opencode - Explore deck overlap fix + two-company comparison + Pearson explanation

### Done
- Fixed the overlap between chart, caption and Pearson explanation panel
  inside the Explore fullscreen deck. Added .sx-caption-block and
  .sx-pearson-explain CSS classes with proper margins; updated JS to use
  these classes instead of inline styles.
- Two-company comparison: each Explore slot and each scatter axis now has
  its own company selector when a comparison company is loaded. Series
  names include the company symbol when different from primary.
- Pearson r explained: visible plain-language panel below the scatter
  chart explaining what r means, where this value sits on the -1 to +1
  scale, and that it describes the past window without predicting or
  implying causation.
- "+ Compare with another company" button in the Explore controls when no
  comparison company is loaded, with inline search input. Loads the company
  via fetchStatementsCompany and re-renders controls with both companies.

### Verified
- node --test engine.test.js: 102/102 PASS.
- smoke-02, 05-13: ALL PASS.
- Inline-script parse across all four HTML files: ALL OK.
- Render-count tripwire: zero render()/updateStatementsUI() calls.

### Known / not done
- No commit made (per the git rule).
- NOT browser-tested: overlap fix, two-company rendering, Pearson
  explanation readability need Claude Code's live browser pass.

---

## 2026-08-18 - opencode - Explore data table, Bench drill-down, hover reading line, peer card groundwork

### Done
- Explore deck: compact exact-value table below the chart in both modes.
  Lines mode = metrics as rows, years as columns, same real-unit
  formatting the tooltip uses. Scatter mode = one row per year, X and Y
  values. The chart shows shape; this shows the numbers without hovering.
- Bench chart: double-click any series to scroll to its source table row
  and pulse it — same drill-down pattern the Explore deck already had.
  seriesIndex maps to pins order (one echarts series per pin).
- Compare-search stuck state fixed: clicking anywhere else inside the
  overlay cancels the inline compare search back to the "+ Compare"
  button; previously only closing the deck got out of it.
- Row hover popup now also prints the row's deterministic readingSentence
  below best/worst/CAGR, so the popup is a complete mini-briefing.
- Peer comparison card added (#stmtPeers between Growth & Returns and
  Compounding), wired into updateStatementsUI + jump-nav. IMPORTANT CAVEAT:
  screener.in loads its peer rows via client-side JS ("Loading peers
  table..." placeholder in static HTML), so parsePeerTable returns null on
  fixtures AND live scrapes today. The renderer is correct but will show
  nothing until the parser gets hydrated-DOM data. Jump-nav Peers button
  auto-hides while the card is empty.

### Verified
- node --test engine.test.js: 102/102 PASS.
- smoke-02, 05-13: ALL PASS.
- Inline-script parse across all four HTML files: ALL OK.
- Render-count tripwire: zero render()/updateStatementsUI() calls from new code.
- rowPolarity/readingSentence availability confirmed (engine shim globals).

### Known / not done
- No commit made (per the git rule).
- NOT browser-tested: data table layout, Bench dblclick scroll target,
  popup reading-line wrap on narrow rows need Claude Code's browser pass.
- Peer table needs a JS-hydrated fixture or server-side-rendered source to ever fire.

---

## 2026-08-28 - Claude Code - Jump-nav gap, P/E band axis mislabel, Bench drill-down bug

### Done
- `#stmtJumpNav` was missing buttons for two of the six statement tables
  (Quarterly Results, Shareholding Pattern). The shareholding/promoter data
  the user was looking for was rendering correctly all along — TCS just
  puts it far down the page with no way to jump straight to it. Added the
  two missing buttons and fixed a stale comment that still said "four
  statement tables" instead of six.
- P/E band chart (`peBandChartOption`, statements-engine.js) had its price
  y-axis (`₹ / share`) formatted with `formatCroreSafe`, a formatter built
  for whole-statement ₹-crore aggregates that always appends " Cr". A
  ₹4,000 share price rendered as "₹4.0k Cr" — a nonsensical 4,000-crore
  per-share figure, and the bug the user's screenshot showed. Added
  `formatShareValueSafe` (same k/L abbreviation, no "Cr" suffix) and pointed
  the price axis at it. The cash-flow waterfall's `formatCroreSafe` calls
  are genuine crore aggregates and were left untouched.
- Found and fixed a real bug in opencode's Bench dblclick drill-down
  (flagged by opencode itself as untested): the handler read
  `s.pins[params.seriesIndex]`, which is a `{section, label}` object, and
  passed it straight into `advisorAttr()` — stringifying to `"[object
  Object]"`, which never matches any row's `data-stmt-pin` attribute
  (`"section|label"`, built via `rowKey()`). Fixed by building the key with
  `rowKey(pin.section, pin.label)` before the lookup.

### Verified
- `node --check statements-engine.js`: OK.
- Inline-script extraction + `node --check`: OK.
- `node --test engine.test.js`: 102/102 PASS.
- Live in the browser (TCS): P/E band chart's axis formatter sample-tested
  with `[500, 4000, 123456, 0.5]` → `["₹500", "₹4.0k", "₹1.2L", "₹1"]`,
  zero errors.
- Live: jump-nav buttons for Quarterly Results and Shareholding Pattern
  resolve to the correct section via the existing generic
  `data-stmt-jump-section` handler.
- Live: Explore deck's exact-value data table confirmed in both lines mode
  (Sales/Net Profit, real FY-column headers) and scatter mode (12 rows,
  Year/X/Y columns).
- Live: Peers card correctly renders nothing and its jump-nav button stays
  hidden — matches the documented screener.in client-side-hydration gap,
  not a bug.
- Live: compare-search cancels back to the "+ Compare" button on any click
  outside the input/button.
- Live: row hover popup's new reading-sentence mini-briefing renders
  correctly below best/worst/CAGR.
- Live: Bench dblclick drill-down, after the fix, scrolls to and pulses
  the correct row — confirmed by capturing the live-registered handler and
  invoking it directly with `{seriesIndex: 0}`.

### Known / not done
- Peer table still needs a JS-hydrated fixture or server-rendered source
  before it can show anything — unchanged from opencode's note above.

---

## 2026-08-28 - Claude Code - P/E band chart: axis name and median-line label were clipped by the canvas edge

### Done
- User screenshot showed the top-left `₹ / share` axis name cut off
  mid-glyph, and the P/E grid's median markLine label truncated to "medi"
  on the right. Both were ECharts drawing past its own canvas boundary,
  not a CSS overflow issue (confirmed the container and its parent both
  have `overflow: visible` — the clip was the canvas itself).
- Measured the actual cause with `convertToPixel`: `grid[0].top: 20` put
  the axis name's top edge at pixel y ≈ -1.6 (name needs ~26px above the
  topmost gridline: nameGap 15 + text height); `grid[*].right: 26` put the
  median label's text end at pixel x ≈ 1154 against a canvas only 1115px
  wide.
- Fixed by widening both grids' margins: `top: 20 → 32` on the price grid,
  `right: 26 → 70` on both grids (both must match, or the linked x-axis
  between the two stacked grids stops aligning pixel-for-pixel).

### Verified
- `node --check statements-engine.js`: OK. `node --test engine.test.js`:
  102/102 PASS.
- Live (TCS, local server): `convertToPixel` on the fixed option puts the
  axis-name anchor at y≈36.2 (was 24.4) — positive margin, no longer
  clipped.
- Live: measured the median label's actual rendered width via
  `canvas.measureText` against the new grid boundary — text now ends at
  x≈1102 inside a 1115px-wide canvas (was ending at ≈1154, 39px past the
  edge).
- Live: confirmed the bottom of the second grid (P/E line) still leaves
  ~74px of clearance for its x-axis labels and the dataZoom slider — no
  new clipping introduced at the bottom.

---

## 2026-08-28 - Claude Code - Explore deck: switching a slot's company left its metric dropdown showing the old company's rows

### Done
- User report: picking Sales for TCS and Sales for HDFC Bank in the
  Explore deck's lines mode only ever showed one company's line. Traced
  to the per-slot "Company" `<select>` change handler
  (`document.body`'s delegated `change` listener, `data-sx-company`
  branch for slot ids): it updated `st.slotCompanies[si]` and nulled out
  the slot's metric if it didn't exist on the new company, but never
  called `stmtExploreRenderControls()`. The slot's own metric `<select>`
  kept rendering the *previous* company's row list, so a value that
  looked selectable (e.g. "Sales") silently didn't exist for the newly
  chosen company — HDFC Bank reports `Revenue`, not `Sales`, by design
  (banks and non-banks use different as-reported labels, no synonym map
  per the statements plan). `stmtExploreSeriesFor` returned null for
  that slot and it vanished from the chart and table with no error.
  This is distinct from the intentional schema refusal — the bug is that
  the UI never told the user their selection had gone stale.
- Fixed by calling `stmtExploreRenderControls()` in that branch too, the
  same way the scatter-mode x/y company branch already does — the
  dropdown now rebuilds against the new company's actual catalog
  immediately, and a metric that doesn't carry over resets to
  "— none —" instead of silently pointing at nothing.

### Verified
- Inline-script extraction + `node --check`: OK. `node --test
  engine.test.js`: 102/102 PASS.
- Live (TCS + HDFCBANK compare, local server): switching slot 1's company
  selector to "compare" rebuilds its metric dropdown to HDFC Bank's own
  catalog (`Revenue`, `Interest`, `Expenses`, `Financing Profit`,
  `Financing Margin %`, ...) instead of TCS's.
- Live: with slot 0 = Sales (TCS) and slot 1 = Revenue (HDFCBANK), both
  lines render together — `series` names `["Sales", "Revenue
  (HDFCBANK)"]` — and both rows appear in the exact-value data table.
  Zero console errors.

## 2026-09-12 - Claude Code - Advisor acts on a user's own situation instead of looping the A/B menu

### Why
A user described their own situation (job, income, family, loans, goals) and
the advisor kept replying with the "A) Do it all / B) Walk me through" menu.
Five causes:
1. The "Choice before action (mandatory, ALWAYS the first move)" rule in both
   runtimes' system prompts made the menu the first reply to anything,
   including situations, what-ifs and edits.
2. BM25 tool routing ranks against the latest message only. "Drop the flat and
   add a trip" shares no words with build_goal_plan, so the model was left with
   read-only and stock tools ("add" pulled in add_instrument).
3. Door 2 had no way to edit or remove a goal, build_goal_plan appended goals
   (a rebuild duplicated them), and add_goal had no cap or label.
4. Level 1 build_goal_plan carried existingSavings from one goal type into the
   next, lowering the second goal's SIP.
5. The guardrail rewrote ordinary planning sentences ("I'll add Retirement...",
   "Your EPF and PPF...") as stock calls: 18 false positives on 27 benign
   sentences.

### Done
- Prompt (`_build_system_prompt` in local_server.py, `buildSystemPrompt` in
  src/worker.js, in parity): the Choice rule is replaced by situation-first
  rules. Map facts to fields with the arithmetic shown, build with the compound
  tool in the same turn, never invent a number only the user knows (ask for all
  missing ones together), state defaults. Changes and what-ifs are instructions,
  reported before -> after. "What should I do?" is answered with the app's
  numbers. A bare request gets A/B at most once and any reply that isn't
  clearly B counts as A. Review-first or unsure users get propose_plan, as an
  explicit override.
- Transcript nudges (`_situation_nudges` / `situationNudges`, in parity) append
  "Right now:" notes when: the menu was already offered; the latest user
  message is a first-person situation with 2+ numbers and no tool from this
  page has run since (Hinglish pronouns count; the landing page's open_door
  doesn't, so Door 2 still builds on arrival; walk-through requests suppress
  it); or the same, but the user asked to review first (-> propose_plan).
- Routing: `TOOL_ALWAYS_KEEP` (13 planning tools) in goalden-engine.js,
  worker.js and local_server.py. Only names the page defines survive the final
  filter.
- Door 2: new update_goal and remove_goal (by index or label/type; "flat" finds
  the house; an ambiguous match is refused with the goal list). add_goal takes
  a label, caps at 3 and returns plan totals before/after. build_goal_plan
  validates every goal before setting anything and replaces the goal list.
  Knowledge rewritten to map a free-text situation onto capacity, cap_0-3,
  tol_0-4, emergency status (months of cover) and up to 3 goals.
- Level 1: knowledge for multi-goal situations (one build per goal, total vs
  monthly surplus, point to The Full Plan), lakh/crore parsing, what-ifs.
  build_goal_plan resets existingSavings when the goal type changes and says so
  in `notes`.
- Lab: situation paragraph (run_full_analysis with the given values, name the
  defaults kept, re-run what-ifs).
- Landing: a described situation opens the right door with
  auto_continue:true, and the reply after open_door quotes no figures (this page
  calculates nothing).
- Guardrail (advisor.js): `ADVISOR_TICKER_DENY` gains EPF, HRA, ULIP, CTC, LPA,
  LKG, NRI, PAN, LTCG and similar; `advisorNamesObject` with
  `ADVISOR_OBJECT_STOPWORDS` stops capitalised app words after a verb ("add
  Retirement", "choose Balanced") counting as a company. Sentence-initial and
  bulleted directives ("- Buy Reliance on dips") and "Yes Bank" are still caught.
- Evals: runner.js records every reply and tool call. New assertions:
  menuOfferedAtMost, noReplyIncludes, anyToolCalled, toolCallCountAtLeast,
  toolCallArgs, fieldsRange, goalsInclude/goalsExclude. getResults tolerates
  pages with no results, and errored scenarios now count as ran. 7 new live
  scenarios: Door 2 situation, Door 2 edit, L1 what-if, L1 bare request,
  Hinglish wedding, L1 multi-goal situation, landing handoff.
- Tests: engine.test.js covers routing on an edit follow-up; smoke-11 checks the
  always-keep list is identical in all three copies and the nudges are wired in
  both runtimes; smoke-07's propose_plan check is now a parity count (the
  routing list mentions it too).

### Verified
- `node --test engine.test.js`: 163/163. smoke-02 to smoke-13: all pass. Python
  AST parse of local_server.py; `node --check` on worker.js, advisor.js,
  goalden-engine.js, runner.js.
- Guardrail calibration: 31 benign sentences unchanged, 22 adversarial rewritten.
- Nudge parity: 12 transcripts give identical output in Python and JS.
- Offline tool checks (vm, 20 cases): rebuild replaces instead of appending; a
  4-goal build or a fee-less education goal is rejected with state untouched;
  update/remove by label; the 3-goal cap; label sanitising; L1 savings reset.
- Live replay on Door 2 (Pune situation -> drop the flat + add a trip -> retire
  at 58): the first reply built the plan with the take-home arithmetic and
  listed its assumptions; then remove_goal + add_goal; then update_goal with the
  retirement SIP going from Rs 50,363 to Rs 39,865. No menu at any point.
- Browser (local server): the Door 2 plan screen renders the edited goals
  (Retirement 24y, Family trip abroad 2y). No console errors on index.html,
  goalden.html or goalden-door2.html.
- Live eval run 1: 19/20. The hesitant-user scenario built directly instead of
  proposing (fixed with the review override and nudge); the landing scenario hit
  a harness error (fixed in runner.js). Run 2, after both fixes: 21/21 passed
  (1 mock-only scenario skipped).
- The first Door 2 replay marked the emergency fund "partial" although Rs 6L of
  FDs covers ~8.5 months, and estimated a what-if SIP itself. Door 2 knowledge
  now works emergency cover out as months, and both Level 1 and Door 2 quote
  only SIPs the page calculated. Replay 2: emergencyStatus "full" with the
  division shown, and alternatives offered as "want me to run it?" instead of
  guessed figures. It also first tried an education goal without a fee, got
  the validation error, and rebuilt without it.

### Not done
- Merton model not wired into the advisor (optional).
- Credit Risk Analysis Module (credit-engine.js) still parked and uncommitted.
- Nothing committed or deployed.

## 2026-09-15 - Claude Code - Landing page and Lab reprioritised for a placement demo; methodology/data-source dropdown added to Test Real Investments

### Why
User needs to demo the app, unsupervised, to a wealth-management founder.
Priority: the founder should land on Test Real Investments with minimal
friction, the Lab's tool order should match what's actually worth showing,
and Test Real Investments needed to explain its own numbers without someone
standing over the founder's shoulder.

### Done
- index.html: dropped Door 1 (Quick Calculate) from the landing page entirely,
  now a 2-door grid. Door 3 (The Lab) gets a gold "Start here" badge and a
  visual promotion (border/shadow). "Not sure which one?" copy rewritten to
  point at the Lab first. `ADVISOR_DOORS`/`open_door` deliberately left
  untouched (still reference 'quick') - this was a visual-only change.
- goalden-lab.html: added `?tab=<id>` deep-linking, highest priority over both
  the Door 2 handoff and the returning-visitor last-tab memory, so a demo link
  behaves the same regardless of the viewer's browser history. Demo link:
  `/goalden-lab.html?tab=livefrontier`.
- goalden-lab.html: `TABS` reordered - Test Real Investments, Retirement Lab,
  Build a Portfolio stay primary (bold home cards); Read the Company demoted
  out of the primary row (newer, more complex, higher risk of an in-demo
  break). `renderHome()`'s tool-count caption is now computed from the array
  instead of hardcoded.
- goalden-lab.html: added an `explainDropdown` to Test Real Investments -
  "How is this calculated, and where does the data come from?" - covering the
  Yahoo Finance data source (10y daily, adjusted close preferred), how
  return/risk/correlation/Sharpe/the frontier are actually computed from the
  real daily price series, and what's left out (costs, taxes, expense ratios).
  Placed right under the tab's intro line, before the instrument search.

### Verified
- `node --test engine.test.js`: 163/163. All 11 smoke-*.js pass (smoke-10 and
  smoke-13 specifically confirm the live-frontier math functions this touched
  are otherwise untouched).
- Browser (local server): landing page shows 2 doors with the Lab badge;
  `?tab=livefrontier` lands directly on Test Real Investments; the new
  dropdown expands cleanly with no console errors; added Reliance + TCS live
  and the correlation/frontier/Sharpe output rendered correctly with real
  fetched data (2,473 daily observations for Reliance, 2016-09-15 to
  2026-09-15).

### Not done
- Live deploy at goalden.vanshsingh23.workers.dev is stale: it has the demo
  link and the 2-door landing page from an earlier deploy this session, but
  NOT the tab reorder or the new methodology dropdown above. Needs a redeploy
  (`npx wrangler deploy`) once the user confirms - asked, not yet answered.
- Email to Vaibhav Porwal (Dezerv) not drafted - explicitly deferred by the
  user to later.
- Nothing committed.

## 2026-10-17 - Claude Code - Merged local demo work into claude/new-session-4ynhj6, deployed from the branch

### Why a merge was needed
- The branch (540fb9c, 39 commits on f5c814e) did not have the 18 unpushed
  local-main commits or the uncommitted demo prep, all of it already live.
  Deploying the branch as-is would have removed the `?tab=` deep link used in
  the Dezerv email, the 2-door landing page and the methodology dropdown.
- The local work is committed as e9fabdc on branch `local-demo-work`, then
  merged here. main is untouched.

### Conflict decisions
- Tool routing: union of both. Branch `CORE_TOOLS` plus local
  `TOOL_ALWAYS_KEEP` in goalden-engine.js, worker.js and local_server.py
  (smoke-11 and smoke-14 check that they agree).
- Bench indexing: took the branch's version (base = first positive year of
  reasonable size, `__notIndexed`). The local `__notIndexable` path and its
  caption text are removed. engine.test.js zero-base test rewritten to match.
- rowBoxScore: branch unit-aware CAGR refusal plus local null-year fallback.
- statements-engine.js: kept both sides' additions (margin bridge, DuPont,
  formatCroreCompact; local formatShareValueSafe, peBandChartOption).
- goalden-lab.html:
  - Kept both sides' features: branch break marks, margin bridge, DuPont,
    unit-aware vs-median text and market search; local colgroup column
    widths, peers card, quarterly period labels, Equity default and dynamic
    home count.
  - Median column is now 92px in both CSS and `STMT_COL_MEDIAN_PX`, so
    "+1.5 pts" fits.

### Test-harness fixes (no app change)
- smoke-05: advisorMarkdown regex accepts CRLF. A Windows checkout with
  autocrlf rewrites advisor.js to CRLF.
- smoke-15: worker slice stops before `async function buildFinancialsResult`,
  because the local side made that function async.

### Verified locally
- `node --test engine.test.js`: 182 pass, 0 fail (the branch alone had 114;
  the rest are local-side tests).
- All 12 smoke-*.js pass. smoke-14 and smoke-15 were run with a shim mapping
  python3 to python, because this machine has no python3 on PATH.
- Browser (local_server.py):
  - `?tab=livefrontier`, the Equity default and the methodology dropdown all
    work.
  - "speb" search lists SPEB-SM.NS.
  - RELIANCE.NS + AAPL shows the USD/INR conversion note (fx 2,603 days).
  - Retirement Lab, Build a Portfolio and Read the Company (TCS) load with
    no JS errors.

### Open
- screener.in now serves SPEB's /consolidated/ page with HTTP 200 and empty
  statement tables (no data-date-key) instead of redirecting to the
  standalone page. Both fetchers (worker.js fetchScreenerPage,
  local_server.py _fetch_screener_page) raise 'layout' on it and never try
  the standalone page, which does have the data. So the SPEB price fallback
  returns 502. Fixed on local branch `fix-screener-consolidated-fallback`
  (not pushed or deployed until the user OKs it):
  - An empty consolidated page now falls through to the standalone page.
  - A rate-limited standalone retry reports 'transient', not 'layout'.
  - Live-tested: SPEB gives standalone, 149 days (2025-12-08 to 2026-10-15);
    TCS is still consolidated; an unknown ticker is still not_found.
  - Tests: 182/182 and 12/12.

### Deployed (2026-10-18)
- Two independent reviewers (merge resolutions; SPEB fix and parity) both
  said GO with no must-fix items. Deployed 3b6cf46 from
  claude/new-session-4ynhj6 as Worker version ec0ca6fc. main is untouched.
- Live checks on goalden.vanshsingh23.workers.dev all pass:
  - a) "speb" search, then click: 148 days from 2025-12-08, with the
    screener.in note and cautions for short history, extreme swing and thin
    trading (67%).
  - b) SPEB and SPEB.NS work in the exact-ticker box.
  - c) RELIANCE.NS + AAPL shows the USD/INR note; INR=X comes through
    /api/history.
  - d) The API returns source screener.in with 149 prices.
  - e) Retirement Lab, Build a Portfolio and Read the Company load with no
    console errors.
  - The demo features (deep link, 2 doors, methodology dropdown, Equity
    default) are intact.
- Reviewer nice-to-haves not done yet:
  - goalden-lab.html:8670: give the median column more width, or don't
    force "vs 12y median" onto one line.
  - goalden-lab.html:5643: add `short:` for the Read the Company tab.
  - goalden-lab.html:8308: the Explore double-click handler refers to
    `defs`, which is missing after switching scatter → lines.
  - goalden-lab.html:7682: a Bench click picks the wrong pin when a compare
    company is loaded.
  - worker.js:414 and :427: wrap the screener fetches in try/catch so a
    network error reports 'transient', matching Python.
  - Add smoke-16, covering fetchScreenerPage and _fetch_screener_page.
  - The last four items were already in production before this deploy.

### Follow-ups done (2026-10-18)
- All six reviewer nice-to-haves from the deploy above are fixed:
  - The median header wraps.
  - Read the Company has a `short:` line on its home chip.
  - Explore double-click works in both modes through `stmtExploreBindDrill`.
  - Bench double-click maps series to pins through `__seriesPin`.
  - The Worker's screener fetches turn network errors into a 503.
  - New smoke-16.js covers 13 stubbed cases, with worker/python parity.
    It fails on the pre-fix code and passes now.
- An independent reviewer said GO. Tests: 182/182; smokes 13/13.
- Still open (nice-to-have):
  - Log the swallowed fetch error at worker.js:416.
  - Read focusYear at bind time at goalden-lab.html:7687.
  - smoke-16: add explicit asserts that the slice markers exist.

## 2026-10-19 - Claude Code - Research handoffs reviewed; Group 1 built and deployed

### Review of the research session's work
- Four independent reviewers checked all 21 handoffs from
  C:\Users\VANSH\Downloads\goalden-research against the current code and
  re-ran the maths on live data.
- None were stale. 17 of 21 needed fixes:
  - three would crash a page (02, 06, 07);
  - four had honesty slips: the bad-price filter drops real crashes (12/13A),
    "Direct" inferred from a missing "Regular" (18), "overstates tax" (06/17),
    "never sent to a server" (21).
- Results, every fix per handoff, and a plan regrouped around the three
  things retail investors come for (Test Real Investments, the corpus
  calculator, Read the Company) are in HANDOFF-REVIEW.md, section 3a.

### Group 1 (commit 79a1278, reviewer GO, deployed as version 678b6f39)
- 09: starter pairs in Test Real Investments (LIVE_STARTERS, mutual funds for
  India because Yahoo's NIFTYBEES/GOLDBEES split prices are broken); visible
  button style.
- Fund JUMP threshold in auditPriceSeries (Lab and engine): 0.10 -> 0.20.
  10% flagged the Nifty's real -12.98% day on 23 Mar 2020; 15% still flagged
  +17.7% on 18 May 2009; 20% is the NSE market-wide circuit breaker. Funds
  now get "NAV discontinuity" wording instead of "corporate action".
- 13 B: `.stat-row.four` class (4 places), so phones show 2x2.
- 13 C: the advisor's "life expectancy 78/82" now matches the plan horizon
  (85/90) and states the 78/82 fact correctly (typical lifespan at 60).
- 13 D: landing-page link to Quick Calculate.
- 19: personas Priya, Arjun and Rohan. Rohan replaces the handoff's US
  persona because the audience is Indian.
  - The note shows only while the plan still matches the persona.
  - The advisor is told that a persona plan isn't the user's own.
- Tests: 182/182; smokes 13/13. Browser check:
  - Priya: Rs 4.02 Cr / Rs 24,808.
  - Arjun: Rs 52.4 L / Rs 15,960.
  - Rohan: Rs 5.93 Cr / Rs 45,687.
  - Nifty+Gold starter: correlation -0.05, no flags.
  - Stat rows 2x2 at phone width.
  - Live re-check passed.

### Next: Group 2 (Test Real Investments core)
- 03 parts B, D, E, F, then 12 (stricter spike rule), then 04, then a new
  after-tax line, then a new "Read this company" link.

