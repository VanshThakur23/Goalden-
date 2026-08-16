# Goalden — Work Log

**Rule for all agents (Claude Code and opencode both):** Write a brief entry
here at the end of every session. One block, a few bullet points, done.
No prose — bullets only. The other agent reads this first to catch up fast.
Keep it short enough that even after 20 sessions it's still scannable.

Format:
```
## YYYY-MM-DD — <agent name>
- What was built or fixed (one line each)
- Any known issue or broken state left behind
- What's pending / what to do next
- Last commit pushed: <hash> <message>
```

---

## 2026-08-14 — Claude Code

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
- Pending: Full conversational AI advisor (see AGENTS.md — big feature, not
  started; discuss scope with user before beginning)
- Last commits pushed: cc712b6, 47794c8, a565e47

---

## 2026-08-14 — opencode

- Started the conversational AI advisor (the big pending feature). Scope agreed:
  DeepSeek as LLM, type-first (voice later), local mock mode + env key.
- `src/worker.js`: added POST `/api/chat` — builds system prompt (Goalden intro,
  current page, current state, tool list, adapt-to-literacy instruction) and
  calls DeepSeek (`deepseek-chat`, key from `DEEPSEEK_API_KEY` Worker secret).
  Returns the assistant message incl. any `tool_calls`. CORS now allows POST.
- `local_server.py`: added matching POST `/api/chat`. Uses `DEEPSEEK_API_KEY`
  env var when present; otherwise returns a deterministic mock that drives the
  same tool loop (ask goal -> get_results -> plain-text) with no key/network.
- `goalden.html`: added floating advisor button + chat panel (outside #stage so
  it survives render()), plus the full tool loop. Tools: `navigate` (validated
  via `flow().indexOf`), `set_value` (canonical field enum built from S/C/RISK),
  `get_state`, `get_results`, `explain`. Model never mutates S directly — every
  action goes through `executeAdvisorTool`.
- Ported the advisor to the other three files:
  - `goalden-door2.html` (state `G`): fields for country, monthly expense/capacity,
    emergency status/prioritize, cap_0-3 & tol_0-4 scores; plus `add_goal` tool
    (retirement/education/house/generic); `get_results` = scoreBuckets + buildPlan.
  - `goalden-lab.html` (state `L`): `navigate` across TABS (+home); `set_value`
    with dotted fields (ret.*, step.*, swp.*, fx.*, joint.*, mc.*, health.*);
    auto-switches to the field's tab; `get_results` = calcRetLab / calcHealthScore
    for those tabs, input summary + note for the others.
  - `index.html`: navigate-only — `open_door` (quick/full/lab) redirects via
    window.location; `get_state` + `explain`; no set_value/get_results.
- Added the "knowledge layer" so the AI actually understands the app, not just
  a one-line intro. Each file now defines `ADVISOR_KNOWLEDGE` (purpose, screens/
  tools, assumptions per country, data sources) and sends it with every
  `/api/chat` call; both worker.js and local_server.py inject it into the
  system prompt ("answer from the knowledge above; if not covered, say so
  rather than guessing").
- Added voice (free browser Web Speech API, no key): mic button (STT) that
  fills the input and auto-sends, and a 🔊 toggle (TTS) that speaks replies.
  Feature-detected — Firefox (no Web Speech) hides the mic and stays text-only.
  Wired identically in all 4 files.
- Verified: `local_server.py` compiles; mock `/api/chat` round-trips and the
  system prompt now includes the knowledge block. Frontend JS reviewed manually
  (no Node/browser in this env, so still not browser-tested).
- Known: NOT browser-tested — needs a manual pass in Chrome/Edge. Voice only
  works on Chrome/Edge/Safari (not Firefox) by browser design. No LLM key set,
  so real DeepSeek path is unverified.
- Pending: browser-test all four pages (cache-bust URLs, e.g. `goalden.html?v=2`);
  user sets `DEEPSEEK_API_KEY` (Worker secret + local env); later, the separate
  "portfolio advisor" persona.
- Last commit pushed: none by opencode (git/GitHub is Claude Code's job)

---

## 2026-08-14 (later) — opencode

### Part A — finish & harden the advisor (all 4 files unless noted)
- A1 security: `/api/chat` now origin-allowlisted (Worker's own origin +
  localhost:8000/8080), per-IP in-memory rate limit (20/min on
  CF-Connecting-IP), body cap (40 messages / 100KB). Market-data GETs keep `*`.
- A2 conversation survives navigation: `advisor.messages` + panel open state
  persisted to sessionStorage (`goalden_advisor_v1`), rehydrated + re-rendered
  on load, a system-role "[navigation] now on <page>" note appended on arrival,
  history trimmed to 24 messages (first user message preserved).
- A3 get_results real for all Lab tabs (stepup/swp/fx/joint/mc/portfolio/
  livefrontier/instruments) — reuses solveStepUpSIP, swpWithdrawal, fxCompare,
  solveJointEducationCorpus, monteCarloAccumulation, computePortfolioDerived,
  liveComputeMulti, etc. No new math.
- A4 thinking "…" bubble; A5 min/max bounds on every ADVISOR_FIELDS entry;
  A6 explain keyword map deleted, replaced with highlight(element) tool;
  A7 voice lang follows country + currency/markdown stripped in TTS only;
  A8 role=log/aria-live, mobile fullscreen <480px, Escape closes, focus mgmt;
  A9 friendly "advisor isn't switched on" message for missing key.
- A10 (recommendation, see below).

### Part B — Portfolio Advisor (goalden-lab.html only)
- B1 tools: set_weights / apply_preset / analyze_portfolio / frontier_gap /
  list_assets — all wrap computePortfolioDerived, portfolioRatios,
  portfolioTailRisk, frontierGap, generateFrontier, roundPercentsTo100,
  PORTFOLIO_PRESETS. B2 tools: search_instruments / add_instrument /
  remove_instrument / compare_live (2-asset closed-form + 3+ liveComputeMulti
  tangency via bestSharpePoint); async tools return promises and advisorLoop
  now awaits them. B3 tools: run_monte_carlo / stress_test (calcRetLab with a
  temporary shock). B4 advice guardrail added to the system prompt (worker +
  local_server) + a one-line disclaimer under the Lab panel header. B5 Lab
  knowledge expanded with frontier/correlation/tangency/CAL/risk-free/
  diversification semantics.

### Part C — Results Canvas (goalden.html, goalden-door2.html, goalden-lab.html)
- C1 #resultCanvas: non-modal floating panel, opposite corner from the chat,
  header (title + minimize pill + close), body reuses the page's OWN chart/card
  builders. C2 show_result(kind) with a per-file enum (goalden: summary/delay/
  retire/fd/alloc; door2: summary/goals/alloc/profile; lab: summary). C3 each
  page's ADVISOR_KNOWLEDGE now tells the model to prefer show_result on
  results/plan screens. C4 Escape minimizes (not closes), reduced-motion +
  mobile handled.

### A10 — the duplication question (recommendation)
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
  convention explicitly warned about. My vote is to extract — the cost of
  drift now outweighs the cost of a shared file — but the user must decide.

### Known / not done
- NOT browser-tested (no Node/browser in this env). The mock path in
  local_server.py now exercises get_results on every page (not just Door 1).
- Part A11 (full browser pass) still pending on the user: cache-bust URLs,
  mic/voice in Chrome vs Firefox, cross-page conversation, both countries.
- Lab canvas is minimal (summary kind only) — flagged as "optional" in the
  brief.
- No commit made (per the git rule).

---

## 2026-08-14 (evening) — opencode

### Part D — Lab results canvas + mobile stacking (goalden-lab.html only)
- D1: ADVISOR_RESULT_KINDS expanded from 1 ('summary') to 9 — retirement,
  portfolio, livefrontier, mc, stepup, swp, fx, joint, health. Each build()
  re-invokes the tab's OWN chart function with a canvas-scoped chartId
  (cv-*): mountainChart/drawdownChart, frontierChart + computePortfolioFrontierData,
  liveFrontierChart (2-asset) / frontierChart (3+), fanChart, twinFatesChart,
  drawdownChart, fxCompare stat cards, jointTimelineChart, and the Plan Health
  score dial. No new chart code. build() now returns {ok, html|error} so a
  missing-input case (e.g. livefrontier with <2 instruments) returns a
  "ask the user for X first" error the model can read, instead of rendering
  an empty chart.
- D2: mobile fullscreen arbitration — added isMobile() + advisorMinimizeToFab();
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
  runs — but this is unverified in a real browser and worth a specific check.
- No commit made (per the git rule).

---

## 2026-08-14 (night) — opencode

### Part E0 — extracted the advisor to a shared advisor.js (approved in A10)
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
  index.html). Behavior is byte-for-byte identical — no new features in this
  step beyond the shared file. Index has no results canvas (never did).
- The D2 mobile fullscreen arbitration (isMobile/advisorMinimizeToFab) moved
  into advisor.js, so it now applies to every page uniformly (was Lab-only).

### Part E1 — bigger chat + a real speech caption + better voice (in advisor.js)
- E1a: #advisorPanel now 460px wide, up to min(75vh,720px); message text
  15.5px / 1.55 line-height (was 13.5px / 1.45).
- E1b: advisorSpeak() now also shows the reply's text in a large top caption
  bar (#advisorCaption, 21px, high contrast, z-index 2000), tied to the spoken
  moment — hidden when 🔊 is off, dismissed on tap / on speech end (+2.5s) /
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

## 2026-08-14 (night 2) — opencode — V2 Batch 1 (F0 + F1 + F2 + F4)

### F0 — BLOCKING payload bug (advisor dead on Test Real Investments)
- Root cause: advisor.js sent the whole `L` object as `state`, including
  `L.live.data`'s raw daily price arrays. Measured (2 instruments, ~1,238 bars
  each): **121,088 bytes BEFORE** vs **807 bytes AFTER** the fix (99.3% smaller).
  The 100KB Worker cap rejected it before the model ever saw it.
- Layer 1 — `stateForAdvisor()` hook: advisor.js now calls it when present
  (Lab supplies it), falling back to `state`. The Lab projection keeps derived
  facts per live instrument (symbol, label, currency, annualised return, vol,
  geoAnnual/cagr, n, date range, quality level) and drops prices + stats.returns
  + snapshot currency bloat.
- Layer 2 — pull-tools (Lab): `get_price_history(symbol, granularity)` (daily
  last-260 or ~60 downsampled points), `get_instrument_stats(symbol)`,
  `get_detail(path)` (dotted path into the COMPACT state, so raw prices are
  unreachable by construction). Nothing became invisible; the model just pulls
  detail on demand.
- Layer 3 — client-side guard in advisor.js `advisorBuildBody()`: if serialised
  body > 60KB, drop state to a skeleton + tell the model which pull-tools to use.
- Layer 4 — honest failure: "Request is too large" now maps to "try asking about
  one instrument or one tool at a time", byte size logged to console.
- Also fixed `get_state` in the Lab to return the compact projection (it was
  also serialising full L).

### F1 — caption gone, panel docks (advisor.js only)
- F1a: deleted `#advisorCaption` + advisorShowCaption/HideCaption/captionEl/
  captionTimer. Speaking is now a subtle `.adv-msg.bot.speaking` left-border +
  glow on the bubble being spoken. `advisorSpeechId` kept (still guards stale
  callbacks) via new `advisorUnmarkSpeaking()`.
- F1b: three panel modes — `fab` / `dock` (right edge, 400px, full height;
  `body.advisor-docked { padding-right:400px }` ≥900px so content shifts, NO
  transform) / `focus` (centred 680px, 90vh via left/right+margin auto, no
  transform). Header `#advisorMode` button cycles dock⇄focus; close/Escape →
  fab; FAB → dock. Mode persisted in sessionStorage with `open`. Tool calls call
  `advisorEnterDock()` so the panel docks as the AI acts. <900px dock = overlay
  (no body shift); <480px existing fullscreen + canvas mutual-exclusion kept.

### F2 — actions visible and legible
- F2a: each page supplies `describeTool(name,args)` → human sentence ("Setting
  retirement age to 55", "Running 1,000 simulations"), rendered as a quiet
  `.adv-step` row with a tick; falls back to raw only if absent.
- F2b: advisorLoop awaits ~350ms between consecutive tool calls (skipped when
  reduced-motion), so N actions read as N steps.
- F2c: advisorSetValue now returns a `touched` selector (Lab: exact
  `input[data-k=...][data-tab=...]`; door1/door2: `#stage .screen`), which
  advisorFlash pulses + scrolls into view after the change.
- F2d: `scroll_to(element)` added as a first-class tool on all four pages
  (aliases the existing scroll+pulse highlight).

### F4 — taught the model the new behaviour
- Rewrote the "Behavior note" in all four pages' ADVISOR_KNOWLEDGE: prefer
  driving the real interface (navigate → set values → scroll result into view →
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

## 2026-08-14 (night 3) — opencode — V2 Batch 2 (F7 + F3)

### F7 — "explain this graph on my screen"
- F7a: `read_current_chart()` + `read_current_result()` tools on the Lab,
  goalden and door2. The Lab version returns a per-tab structured description
  (chart title, axis meaning, notable points with real values, correlations,
  date range/sample size) built from the existing calc functions
  (calcRetLab, computePortfolioFrontierData, liveReadyItems,
  monteCarloAccumulation, etc.) — never fabricated, never read out of pixels.
  The doors return a simple result/plan description. `read_current_result` =
  the existing `advisorGetResults`.
- F7b: Lab ADVISOR_KNOWLEDGE now instructs the model to call read_current_chart
  first and ground every sentence in the user's actual numbers, referencing
  points by name; "a textbook definition of the efficient frontier is a failure
  state."
- F7c: chart-feature highlight targets added (frontier / fan / drawdown /
  mountain / timeline / twinfates), so the model can point at the real chart as
  it describes it. Point-level ECharts annotation (pulse the tangency dot) is
  NOT done — limited to pulsing the chart container.

### F3 — the Briefing (full-page composed document)
- New `#briefing` fullscreen surface in advisor.js (scrollable, title + close +
  print, `@media print` rule, Escape closes, chat collapses to FAB on open).
- `compose_briefing(title, sections, intro)` tool: the AI is the editor (picks
  sections, writes intro prose — HTML-escaped); the app is the renderer (every
  number/chart comes from the page's section builders, `{ok,html}` or
  `{ok:false,error}` so a missing-input section degrades to an honest "tell me
  X first"). Dispatched in advisorLoop, not the page.
- Lab section builders (14): headline, retirement, drawdown (SWP), montecarlo,
  stress, allocation, frontier, live, stepup, fx, joint, health, assumptions,
  next — reuse the existing resultCanvas* chart builders + a few new compact
  builders. F3b satisfied: a retirement briefing can include Monte Carlo +
  drawdown + step-up regardless of the current tab (sections call calc/chart
  functions against current state).
- goalden sections (3): headline, assumptions, next. door2 sections (5):
  headline, goals, allocation, assumptions, next.
- F3e partial: footer has a "Back to the app" button + print button; "open this
  in the Lab" and per-section "explain this" affordances not wired (deferred —
  the chip mechanism is Batch 3).

### F3g — retired the single-scenario kinds (recorded)
- Lab: all 9 old kinds became Briefing sections — retirement→retirement,
  portfolio→frontier, livefrontier→live, mc→montecarlo, stepup→stepup,
  swp→drawdown, fx→fx, joint→joint, health→health.
- goalden: 5 kinds (summary/delay/retire/fd/alloc) CUT — "show a chart already
  on screen" is replaced by F7 "scroll to it and explain it"; only
  headline/assumptions/next kept as sections.
- door2: 4 kinds (summary/goals/alloc/profile) CUT/merged — summary→headline,
  goals→goals, alloc→allocation, profile dropped (folded into headline);
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
  F3e's per-section explain/open-in-lab are deferred to Batch 3 — they reuse
  the F5 chip mechanism which lands there.
- Batch 3 (F5 chips + F6 portfolio/live understanding tools) not started.
- No commit made (per the git rule).

---

## 2026-08-14 (night 4) — opencode — V2 Batch 3 (F5 + F6)

### F5 — suggestion chips (discoverability)
- advisor.js: `advisorAsk(text)` (open dock + set textarea + call the real
  `advisorSend()`), a single delegated `document` click listener on
  `[data-advisor-ask]`, and `.advisor-chips/.advisor-chip/.advisor-ask-link`
  CSS. Chips are inert until clicked — zero API cost on render.
- Lab: `advisorChipsHTML(tab)` renders 2-3 tab-specific chips under each tool
  header (9 tabs). Live chips are conditional — with <2 instruments it shows a
  single "help me pick two" chip instead of the compare set. Questions are
  grounded in what each tool actually shows (e.g. "Stress-test this plan against
  2008", "What does this correlation actually mean?").
- Inline "Ask the advisor →" links next to key numbers: retirement corpus,
  portfolio Sharpe ratio, live correlation (`advisorAskLink(q)`).
- goalden.html: one contextual chip on the results screen (wording varies by
  goal type). goalden-door2.html: one chip on the plan screen. Both reuse the
  same `[data-advisor-ask]` path via their own `advisorChipsHTML()`.

### F6 — portfolio / live-market depth (goalden-lab.html)
- `explain_metric(metric)` — sharpe, volatility, beta, correlation, cagr,
  max_drawdown. Anchored to the user's actual current value (advisorPortfolioData
  for sharpe/vol/beta; live instrument stats for correlation/cagr/max_drawdown).
  Returns {ok:false, error} with an honest reason when not computable.
- `optimize_for(objective)` — max_sharpe | min_volatility | target_return |
  target_risk. Reuses bestSharpePoint / frontier sweep, then APPLIES the weights
  via the existing advisorSetWeights path so the sliders move and the user
  watches it; returns before/after return + risk.
- `compare_scenarios(a, b)` — two weight sets, measured via a temporary swap of
  L.portfolio.weights (the calcRetireAgeCompare pattern), rendered as a new
  `comparison` Briefing section through composeBriefing, deltas called out.
- `why_this_weight(asset)` — cluster's actual current weight + what it does for
  the mix, grounded in the live portfolio return/vol.
- `explain_instrument(symbol)` — live tab only; return/vol/cagr/max-drawdown +
  correlation with other loaded instruments, all from L.live.data (never new
  fetches, never invented fundamentals).
- Note: `maxDrawdownFromPrices` is one small NEW helper (peak-to-trough from
  prices) — the only genuinely new computation, added because the app had no
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
  were not added (they'd reuse the same advisorAsk path — small follow-up).
- No commit made (per the git rule).

---

## 2026-08-16 — opencode — Phase 0: demo resilience (6 fixes)

### 1. Persist + Resume (goalden.html, goalden-door2.html)
- S and G were page-memory only — refresh/Back/tab-discard lost the whole
  plan/questionnaire. Both now save state to localStorage on every render()
  (`goaldenD1State` / `goaldenD2State`, Lab's try/catch pattern).
- On load (boot IIFE replacing the bare `render()`): if a save exists AND
  si > 0, an explicit "Pick up where you left off?" overlay offers
  Resume / Start fresh — never silently restores. Restore clamps si to
  flow().length so it can't land on a blank screen. Decline clears the key.
- "Start over" (rb) needs no extra wiring: its render() re-persists si:0.

### 2. Mock / fallback mode (local_server.py, src/worker.js)
- `_mock_chat` was: any state → always get_results → dump 400 chars of raw
  JSON. Replaced with a scripted decision tree (all page-agnostic — reads
  each page's tool schemas from the request body):
  - term question / bare term ("what is a sip", "sip?") → canned
    plain-language answer (9 terms: risk profile, SIP, corpus, inflation,
    frontier, Sharpe, Monte Carlo, diversification, compounding);
  - build request with no state → the exact A/B choice the system prompt
    teaches the real model; picking B → walk-through reply;
  - build request (or picking A) with tools available → ONE batched turn of
    real calls: set_value country=IN (enum-valid on all 3 doors) →
    navigate (prefers results/plan/home; reads screen-vs-tab arg name) →
    get_results; then narration + get_results; then a formatted summary
    parsed from the tool JSON (camelCase/snake keys prettified, floats
    rounded, ok:false errors surfaced as "The app says: …") + a real
    compose_briefing call (sections picked from the page's enum); then a
    wrap-up. Demo now shows step rows, navigation, the calc, and the
  briefing page with zero key/network.
- Worker: missing DEEPSEEK_API_KEY no longer hard-502s — returns 200 with
  a friendly "not switched on for conversations on this deployment… the
  rest of Goalden works normally" assistant message + console.log.

### 3. Timeouts + friendly errors (advisor.js, src/worker.js, local_server.py)
- AbortSignal.timeout(25000) on the client /api/chat fetch AND the Worker's
  DeepSeek fetch; local_server's urlopen timeout 60s → 25s (mirror).
- Worker catch no longer leaks e.message verbatim: friendlyChatError()
  maps 429/5xx/timeout/other to four plain sentences, real error to
  console.log. local_server mirrors it (_friendly_chat_error, imported
  `re`), and do_POST's catch uses it too.
- Client error branch adds a Timeout/Abort case ("took too long — try
  again").

### 4. Lab country bug (goalden-lab.html advisorSetValue)
- Every value was parseInt/parseFloat'd, so set_value('country','IN')
  became NaN ("must be a number") — the advisor could never switch the
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
  advisorEscapeHtml() — hallucinated markup in a field name can't execute.

### Verification
- `node --check` on advisor.js, worker.js and every inline script in all 4
  HTML files: ALL OK (script: temp/opencode/check_phase0.py).
- local_server.py: py_compile OK.
- Mock decision tree: 17/17 scenario tests pass (term/bare-term/A-B/pick-A
  batched sequence/navigate arg names/summary formatting/briefing sections/
  honest ok:false error/walk-through/greeting/all 4 friendly-error classes)
  — temp/opencode/test_mock.py. Plus a live HTTP round-trip on :8071.
- friendlyChatError regexes reviewed against callDeepSeek's thrown shapes.
- Still NOT browser-tested (no browser in this env) — manual pass wanted
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

## 2026-08-17 — Claude Code — Phase 0 verification + fix, ROADMAP.md added

- Live-verified opencode's Phase 0 in the Browser pane against local_server.py
  (no key set, so mock mode exercised naturally): resume-on-refresh, browser
  Back walking screens, the Lab country `set_value` fix, and the mock demo
  flow (term question, "do it all" batched sequence, briefing render) — all
  confirmed working, zero console errors.
- **Found and fixed a real bug during verification**: `goalden-door2.html`'s
  resume feature was completely dead on normal page load. The `boot()` IIFE
  (the resume-prompt logic) had been pasted *inside* the plan-file-import
  handler's `try` block — between `G.si=f.indexOf('plan');` and its `catch`
  — instead of at top level. It only would have run if a user imported a
  plan file. The original unconditional `render();` was still sitting at the
  bottom of the file, so every page load skipped the resume check entirely
  and silently reset saved state to blank. `goalden.html`'s `boot()` was
  structured correctly and unaffected. Fixed by moving the IIFE to where the
  bare `render();` was and restoring the import handler's original
  `render();`/`catch` structure. Re-verified live: resume overlay now
  appears and restores correctly on door2.
- Added `ROADMAP.md` (repo root) — the multi-phase agentic roadmap opencode
  should read alongside this file each session. Phase 0 marked done there.
- Added Phase 0.5 (response format) to the roadmap after finding
  `advisorAddMsg` uses `div.textContent` (`advisor.js:234`) — the chat UI
  renders no markdown at all, so the model's own `**bold**` syntax shows as
  literal asterisks. Confirmed live in an earlier session's transcript. Folds
  in the standing critique that one rigid 5-row/100-word format is forced
  onto every reply type regardless of content.
- Committed and pushed Phase 0 (opencode's 6 fixes + my structural fix) and
  ROADMAP.md.
- Next: hand opencode the Phase 0.5 (response format) prompt.
- Last commit pushed: see git log.
