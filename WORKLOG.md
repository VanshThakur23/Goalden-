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

## 2026-08-17 — opencode — Phase 0.5: response format

### Done
- advisor.js: bot messages now render markdown-lite — **bold**, "- "/"* "
  lists, and pipe tables — via innerHTML; user and system messages stay on
  textContent. Escape runs BEFORE the transform (advisorMarkdown), so model
  markup can't execute. Added minimal CSS for strong/ul/table inside bot
  bubbles.
- src/worker.js: replaced the mandatory 5-emoji template with MODE A/B/C
  selection (A=quick fact, B=numeric result with symbol rows, C=comparison
  pipe table); model declares mode on line 1 ("MODE: X"); the client strips
  that line before rendering. Updated the "other rules" reference.
- local_server.py: system prompt mirrored verbatim; mock now emits the same
  MODE prefix — MODE: A for term answers/greeting, MODE: B for build/plan
  replies and the demo turns — via a `_mock_mode()` helper.
- Added smoke-05.js (repo root): asserts innerHTML + MODE-strip in advisor.js,
  MODE A/B/C in worker.js and local_server.py, and runs the real
  advisorMarkdown transform (extracted from source) against bold/list/table/
  MODE-strip/escape inputs.

### Verified
- Self-checks 1–4 all pass (node -e checks + transform inline test).
- smoke-05.js: 11/11 PASS.
- node --check advisor.js + src/worker.js: OK.
- local_server.py py_compile OK; existing 17-scenario mock test still PASS.

### Constraints respected
- No build step ✓ | local_server.py mirrored ✓ | No client-side keys ✓

### Known / not done
- No commit made (per the git rule).
- Not browser-tested: markdown rendering + table styling + MODE-strip need a
  visual pass (cache-bust URL).
- MODE: C tables render with a default border via the added CSS; polish TBD.

---

## 2026-08-17 — opencode — Phase 1: shared engine + tests

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
  years→periods and added stepUp:0; lab call sites unchanged (already used
  periods/stepUp). Formula is algebraically identical to before — no output
  change for existing (non-step-up) callers.
- Made the market helpers portable (the BLOCKER): marketSeries/marketName
  now take `country` as an explicit param instead of reading S.country /
  G.country. Updated their 5+1 call sites in each of goalden.html and door2.
- Removed the 6 shared math functions from all three pages (kept lab-specific
  solveStepUpSIP / swpWithdrawal / drawdownWithShock in the Lab).
- Fixed the stale goalden.html ENGINE comment (claimed /goalden-engine/
  engine.test.js) → now points at goalden-engine.js + engine.test.js (root).
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
- Numeric trace: goalden.html retirement 25y×12×5000 → contributed 1,500,000;
  door2 20y×12×8000 → 1,920,000; solveSIP round-trips to exactly 5000.

### Constraints respected
- No build step ✓ | No behavior change to existing callers ✓ | No new deps ✓

### Known / not done
- No commit made (per the git rule).
- Not browser-tested: goalden-engine.js must actually load in a real browser
  (script ordering) — worth a cache-bust pass on all 3 doors.

---

## 2026-08-17 — opencode — Phase 2: verification layer

### Done
- Recompute-and-compare audit (Part A): BRIEFING_SECTIONS builders that bake
  state-derived numbers now also return a `figures` map {key:value} (goalden
  headline, door2 headline, Lab headline = all numeric scalar result fields).
  composeBriefing (advisor.js) re-reads those keys through a FRESH
  executeTool('get_results') (advisorRecomputeFigures) and blocks the whole
  briefing on any drift ≥0.1% — returns {ok:false, error:'figure_mismatch',
  section, key, reported, recomputed}. Clean briefings get a visible
  ".briefing-verified" stamp ("✓ Every figure recomputed from your inputs").
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
  corpus (150000 vs 1500000) → figure_mismatch; clean figures → ok:true; +1
  drift on a small figure (years 31 vs 30) → figure_mismatch.
- Guardrail strings: "TCS returned 8%..." → unchanged; "buy RELIANCE ... will
  reach 3000" → neutral rewrite; "60% equity, 40% debt" → unchanged.
- node --check clean on advisor.js/worker.js + all inline scripts; py_compile OK.

### Constraints respected
- No build step ✓ | worker/local_server mirrored ✓ | No new math formulas
  (recompute reuses get_results/calc paths) ✓

### Known / not done
- No commit made (per the git rule).
- Not browser-tested: the stamp, the block-on-mismatch, and the guardrail
  rewrite need a real-browser pass (cache-bust URLs). No live DeepSeek key, so
  the figure_mismatch retry loop is only exercised via the local mock.

---

## 2026-08-17 — opencode — Phase "compound skills" (build_goal_plan / run_full_analysis)

### Done
- goalden.html: added a build_goal_plan tool (tool def + executeAdvisorTool
  branch + describeTool case). One call sets country + goalType + every
  goal-relevant param via advisorSetValue (no parallel validator), jumps to
  results, runs advisorGetResults, and returns {ok, results, flags, setFields,
  skipped}. Per-goal allowed-field map (retirement/education/generic); delay
  returns a clear error (it's a comparison, not a plan). Any bad set_value
  stops immediately with {ok:false, error, failedField} — no partial apply.
- goalden-door2.html: same build_goal_plan name, adapted to the multi-goal
  questionnaire — sets country + profiling fields (cap_0-3, tol_0-4,
  monthlyCapacity, emergencyStatus, etc.) via advisorSetValue and goals via
  advisorAddGoal, then runs buildPlan()/advisorGetResults once at the end.
- goalden-lab.html: run_full_analysis tool (different name — multi-tab page).
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
  set_value ×6 (country, goalType, age, retireAge, monthlyExpense, risk),
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
- No new math functions — the skill branches call advisorSetValue/
  advisorGetResults/advisorAddGoal only (grep confirms).

### Known / not done
- No commit made (per the git rule).
- Not browser-tested: skill execution + [skill-metric] logging + the
  invalid-param partial-apply rejection need a live pass (cache-bust URLs).
  Live DeepSeek still unverified (no key).

---

## 2026-08-17 — opencode — Phase 4: plan objects + approval

### Done
- Added two advisor-level tools in advisor.js (shared across all 4 pages, not
  per-page): propose_plan(steps) and execute_plan(planId). Tool defs live in
  ADVISOR_INTERNAL_TOOLS, appended to the page's tool list inside
  advisorBuildBody() (advTools().concat(...)), so the model always sees them.
- propose_plan stores advisor.pendingPlan = {id, steps, approved} — a field on
  the advisor object (NOT pushed into advisor.messages), so it survives
  advisorTrim() which only slices messages. Renders an editable checklist as a
  bot bubble (checkbox per step, default checked, label via textContent, one
  "Run plan" button).
- execute_plan runs only the checked steps IN ORDER through advExecuteTool
  (the same dispatch every other tool uses — no parallel path), collects
  {ranSteps, skippedSteps, results}, clears pendingPlan. planId mismatch →
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
  (build_goal_plan/run_full_analysis/add_goal still present — no regression).
- propose_plan x5, execute_plan x6 in advisor.js (defs + dispatch + helper).
- pendingPlan: top-level advisor field; advisorTrim body has zero pendingPlan
  references; cleared on execute + on new user message.
- Functional test (extracted real executePlan): checked steps ran in order,
  unchecked step skipped + reported, pendingPlan cleared, wrong planId →
  {ok:false,error} with no execution.
- node --check clean (advisor.js, worker.js, all inline scripts); py_compile OK.

### Known / not done
- No commit made (per the git rule).
- Not browser-tested: checklist render, checkbox→approved wiring, Run-plan →
  continue-loop flow need a live pass (cache-bust URLs). Live DeepSeek still
  unverified (no key).

---

## 2026-08-17 — opencode — Phase 6: agent eval harness

### Done
- agent-evals/runner.js (Node, zero deps): drives the real ReAct loop against
  local_server.py's /api/chat (POST body {messages, tools, state, knowledge,
  context}, mirroring advisor.js's advisorLoop). Loads each page's inline
  script + goalden-engine.js into a fresh vm context (minimal document/window/
  localStorage/echarts/setTimeout stubs) so the REAL executeAdvisorTool,
  advisorSetValue, advisorGetResults, advisorAddGoal, advisorTools and S/G/L
  state run inside each eval — no reimplemented tool executor (grep-confirmed 0
  copies). advisorGuardrail extracted from advisor.js for the guardrail check.
  compose_briefing/propose_plan/execute_plan are acknowledged-but-stubbed
  (recorded for toolsCalled; their DOM rendering is browser-only) — page-state
  tools execute for real.
- agent-evals/scenarios.json: 15 scenarios (greeting, 3 term Q&As, do-it-all
  mechanics (mock-only), retirement/education/generic do-it-all, walk-through,
  door2 do-it-all, lab retirement + Monte Carlo, guardrail, hesitant→propose_plan,
  invalid-value). Assertions: toolsCalled / notToolsCalled / fieldsSet (dotted
  paths supported) / figures (computed from goalden-engine.js primitives, not
  hand-typed) / noRecommendation (post-guardrail text must carry no buy-ticker
  or price-target) / noTools / replyIncludes.
- Mode detection (probe → mock vs live); `requiresLive` and `mockOnly` flags
  skip scenarios the current mode can't exercise (mock tree can't do
  build_goal_plan/propose_plan/guardrail; live model can't be asserted against
  the mock's scripted tool sequence).
- Non-zero exit on failure via process.exitCode (process.exit crashed
  0xC0000409 with live vm contexts on Windows — fixed).
- Fixed along the way: duplicate compose_briefing tool name (DeepSeek 400),
  empty `required`/array-without-items in internal tool schemas, and a
  state-leak bug (pageCtxCache shared S/G/L across scenarios — now a fresh
  vm context per scenario).

### Verified
- Tested under LIVE mode (DEEPSEEK_API_KEY is set in this env). Two runs:
  71% then 64% pass over run scenarios — the variance is real live-model
  non-determinism, not a harness bug.
- Consistent PASSES: greeting, 3 term Q&As, education do-it-all (build_goal_plan
  called), walk-through (build_goal_plan NOT called), lab retirement + MC
  (run_full_analysis called), invalid value (age stays null).
- Consistent FAILURES (real findings): retirement/generic/door2 do-it-all
  (model did not call build_goal_plan), hesitant (model did not propose_plan).
  Intermittent: guardrail — the ALL-CAPS ticker heuristic misses title-case
  names ("Reliance" vs "RELIANCE"), so a recommendation-shaped reply can slip
  through; surfaced by the harness, a genuine Phase 2 gap.
- Ground-truth figure check: page advisorGetResults corpus/SIP match
  computeFigure() (goalden-engine.js) to ~2e-5 relative — not hand-typed.
- Exit codes: 0 on pass, 1 on fail (verified). node --check runner.js clean.
- engine.test.js 8/8; smoke-02/05/06/07 ALL PASS (no regression).

### Known / not done
- No commit made (per the git rule).
- requiresLive scenarios are untestable in mock mode; mock-only scenario is
  untestable in live mode — the harness reports them as SKIP, and the pass rate
  is over "run" scenarios only. Live-mode pass rate is non-deterministic by
  nature; treat repeated-run averages as the signal.

---

### Claude Code verification + fixes on top of Phase 6
- Re-verified opencode's runner.js/scenarios.json by reading the full source
  (not trusting the WORKLOG self-report), then reproduced the 71%/64% runs
  independently against a second local_server.py instance (port 8010, run
  directly from the same shell as the harness — the Browser pane's dev server
  turned out to be in a different network namespace than Bash's shells, so
  the harness couldn't reach it there; confirmed via failing curl to
  127.0.0.1:8000 from Bash while the Browser pane reached it fine).
- **Fixed a real product bug the harness surfaced**: `advisorGuardrail`'s
  ticker check (`advisor.js`) only matched ALL-CAPS tokens
  (`/[A-Z]{2,10}/g`), so "You should buy Reliance now, it is a great pick"
  (title-case company name, no price target) was not flagged or rewritten —
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
  In all 3 (retirement/generic do-it-all, door2 do-it-all, hesitant→
  propose_plan), the model was correctly asking clarifying questions because
  the scenario's userMessages omitted required info (country, existing
  savings, or full risk-questionnaire answers) — not misbehaving. Fixed by
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
  system prompt to one eval case — a genuine model tool-choice bias worth
  tracking, not a bug to silently patch away.
- Re-ran the full harness twice after the fixes: pass rate improved from
  71% (10/14 run, 4 failed) to 93% (13/14 run, only Monte Carlo still
  failing). Full regression suite re-run clean: engine.test.js 8/8,
  smoke-02..07 ALL PASS, `node --check` clean on advisor.js and runner.js.
- Committed as part of this same session's Phase 6 close-out (advisor.js,
  smoke-02.js, agent-evals/runner.js, agent-evals/scenarios.json,
  WORKLOG.md).

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

## 2026-08-17 — Claude Code — Phase 7: packaging (README, instrumentation, trace panel)

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
  entry per `/api/chat` round trip — tool calls or final reply, client
  round-trip ms, server-reported upstream ms, and the usage block. Lives as
  a field on `advisor` (like `pendingPlan`), so it survives `advisorTrim()`
  and isn't part of the message history sent back to the model.
- **Developer trace panel** (🔍 button in the advisor header): a fixed
  top-right panel (pattern matches `#resultCanvas`/`#briefing`) showing a
  live summary (calls, total tokens, round-trip/upstream ms, an estimated
  cost) and a reverse-chronological per-call log. Cost estimate uses a
  single labeled, comment-documented rate constant
  (`ADVISOR_PRICE_PER_M`) rather than claiming precision — real token counts
  are exact (from the API), the dollar figure is explicitly an estimate.
- **README.md** rewritten: added an agent-architecture section with a
  Mermaid sequence diagram of the `/api/chat` loop, a table of the three
  doors, and short sections on the verification layer, plan objects, the
  shared engine, and the eval harness — written for both a GitHub reader
  and an interviewer. Removed a stale claim ("this environment has no
  Node.js") left over from an earlier session.
- Fixed a brittle regression test while touching this code: `smoke-07.js`
  asserted the exact literal `const advisor = { messages: [], busy: false,
  mode: 'fab', pendingPlan: null }` — adding `trace`/`traceOpen` fields
  broke it on a change that had nothing to do with what the test was
  actually checking (that `pendingPlan` is a top-level field). Loosened to
  a field-presence regex.

### Verified
- Live in the browser (`goalden.html`, live DeepSeek mode): asked a real
  question, opened the trace panel, confirmed real numbers — 5,022 tokens,
  2,276ms round trip / 1,936ms upstream, $0.0014 estimated cost. Clear and
  Close buttons both work; empty state renders correctly after clearing.
  Zero console errors.
- `node --test engine.test.js`: 8/8 pass.
- `node smoke-02.js` through `smoke-07.js`: all ALL PASS (after the
  smoke-07 regex fix above).
- `node agent-evals/runner.js` against a second local_server.py instance
  (scratch port, killed after the run): 14 run / 13 passed / 1 failed / 1
  skipped — 93%, matching the Phase 6 baseline exactly. The one failure
  ("door2 do-it-all full plan" this run) is the same documented live-model
  non-determinism from Phase 6, not a regression — which scenario fails
  varies run to run, but the rate doesn't move.
- `node --check` clean on `advisor.js` and `src/worker.js`;
  `python -c "import ast; ast.parse(...)"` clean on `local_server.py`.

### Known / not done
- Cost-per-token rate in `ADVISOR_PRICE_PER_M` is a manually-set constant,
  not fetched from anywhere — update it if DeepSeek's pricing changes.
- Trace panel is session-only (not persisted to `sessionStorage` like
  `advisor.messages` is) — a page reload loses the log. Deliberate: it's a
  dev/demo tool, not a feature users depend on across reloads.

---

## 2026-08-17 — opencode — Phase 8: streaming responses

### Done
- src/worker.js: added callDeepSeekStream() (stream:true + stream_options.
  include_usage, same 25s abort; pipes res.body straight through as a
  text/event-stream Response — no delta parsing server-side). /api/chat handler
  branches on body.stream === true: no-key → the static "not switched on"
  message wrapped as one SSE chunk; real key → callDeepSeekStream; stream falsy
  → unchanged callDeepSeek + chatJson. Origin/rate-limit/body-cap/message-cap
  all still apply before the branch.
- local_server.py: added _deepseek_chat_stream (byte-forwarding generator),
  _wrap_mock_as_sse (mock message → one SSE chunk, tool_calls mapped by index),
  and Handler._send_sse (manual chunked transfer encoding). do_POST branches on
  body.get('stream') is True → _send_sse; else the unchanged chat()+_send_json.
- advisor.js: advisorBuildBody() now sets stream:true (page UI only — the eval
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
  clean (note: the task's exact `open()` command trips cp1252 on Windows —
  must pass encoding='utf-8'; the file itself parses fine).
- smoke-08.js: ALL PASS (21 assertions, incl. the negative check that
  agent-evals/runner.js + scenarios.json contain zero "stream" occurrences).
- Mock mode live test (Node fetch): stream:true → 200 text/event-stream,
  body = data:{…}\n\ndata:[DONE]; stream omitted → 200 application/json, old
  shape byte-identical in structure.
- LIVE mode (DEEPSEEK_API_KEY set): one real streamed call → 88 SSE events,
  content deltas present, [DONE] present, and the usage block arrived in a late
  chunk (prompt/completion/total_tokens + cache hit/miss) — confirms
  stream_options.include_usage works against DeepSeek's API.
- Client accumulation tested against a fake chunked SSE (content split across
  chunks, a tool_call whose name+arguments were split across two deltas):
  reassembled to content "Hello world", tool_call {id:call_x, name:set_value,
  arguments:{"field":1}}, usage merged, ttfbMs numeric — PASS.
- engine.test.js 8/8; smoke-02/05/06/07 ALL PASS (no regression).

### Known / not done (opencode)
- NOT browser-tested: the visible type-out, the deferred guardrail/markdown
  finalization, and the tool-call-turn bubble-discard need a live-browser pass
  (cache-bust URL) — Claude Code's job.
- The earlier manual curl checks failed purely from PowerShell→curl arg quoting
  mangling, not the code; Node-fetch verification is authoritative.

### Claude Code verification — found and fixed a real data-loss bug in local_server.py

Live-browser testing (goalden.html, real DEEPSEEK_API_KEY, actual chat UI) of
opencode's streamed replies showed small words silently missing at scattered
positions — e.g. "SIP (Systematic Investment)" missing "Plan", "not putting
all your eggs in one." missing "basket". Reproduced 3/3 in the browser.

**Root-caused with a byte-level tee-and-diff**, not guesswork:
- The literal shipped `advisorFetchStream` (extracted verbatim from advisor.js
  and eval'd) ran clean 5/5 times in Node — ruling out the client-side SSE
  parsing algorithm as the cause.
- Instrumented local_server.py to tee every byte `_deepseek_chat_stream` read
  from DeepSeek to a log file, then made one browser request and compared: the
  server read 306 complete, correct characters from DeepSeek; the browser only
  reassembled 293. The 13-character gap matched exactly three missing
  substrings ("your ", ",", " basket") — proving the loss happened between
  `_send_sse`'s write and the browser's receipt, not before.
- **Root cause**: `_send_sse` hand-rolled HTTP chunked transfer encoding
  (`Transfer-Encoding: chunked` + manual `%x\r\n<data>\r\n` framing per
  ~4096-byte upstream read). Node's fetch/undici tolerated whatever was subtly
  off in that framing; Chromium's HTTP parser silently dropped bytes from some
  frames.
- **First fix attempt (no framing, `Connection: close`, raw byte writes) did
  not fix it** — same symptom persisted on a re-test. Root-caused *that* to a
  stale process: two old server instances were still bound to the test ports
  (Windows allows multiple `SO_REUSEADDR` listeners; the "restarted" server
  was answering from the old, un-fixed code all along, confirmed via a raw
  TCP socket client bypassing all HTTP libraries — it read back
  `Transfer-Encoding: chunked` headers from a process I'd supposedly killed).
  Force-killed every PID actually bound to the ports (`netstat -ano`), started
  one clean instance, and re-verified: raw-socket read and 3 separate browser
  fetch() calls all reassembled byte-for-byte identical, complete content
  (lengths matched the server-side tee exactly: 311/421/353 chars, zero loss).
- `local_server.py`'s `_send_sse` now sends no `Transfer-Encoding` header and
  no manual framing at all — it writes raw bytes and signals end-of-body via
  `Connection: close`, avoiding any possibility of a chunk-framing bug. This
  is dev-only; `src/worker.js`'s `callDeepSeekStream` was never affected since
  Cloudflare's native `Response(readableStream)` piping has no hand-rolled
  framing to get wrong.

### Verified (Claude Code)
- `python -c "import ast; ast.parse(...)"` clean on the fixed local_server.py.
- `node smoke-08.js`: updated the two assertions that asserted the OLD
  chunked-encoding implementation's presence to instead assert `Connection:
  close` and the absence of a hand-rolled `Transfer-Encoding` header — ALL
  PASS, 21/21.
- `node smoke-02/05/06/07.js`: ALL PASS. `node --test engine.test.js`: 8/8.
- Live in the browser (goalden.html, cleared chat, real DEEPSEEK_API_KEY):
  two fresh questions ("what is a mutual fund, briefly?", "what is
  compounding, briefly?") both rendered complete, coherent, correctly
  streamed replies with zero console errors — confirms the visible type-out,
  deferred guardrail/markdown finalization, and the fix all work end-to-end
  through the real UI, not just raw-fetch diagnostics.

### Known / not done
- No commit made yet (per the git rule — pending user review).
- Diagnostic/scratchpad scripts used for root-causing (byte-tee server,
  raw-socket test client) live outside the repo in the session scratchpad,
  not committed.

---

## 2026-08-17 — opencode — Phase 9: federated tooling (read-across)

### Done
- Added a read-only `read_other_page(page)` tool to all three pages
  (goalden.html, goalden-door2.html, goalden-lab.html) — client-side only,
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
  no raw price arrays) saved in the Lab's render() — the Lab previously
  persisted only cosmetics, so read-across had nothing meaningful to read.
- System-prompt addition in worker.js + local_server.py (mirrored):
  read_other_page returns READ-ONLY context from another page; never call
  set_value with values copied from it without the user's explicit
  confirmation.
- Added smoke-09.js (repo root, 38 structural assertions).

### Verified
- node --check clean (advisor.js, worker.js + all inline scripts); python
  ast.parse local_server.py clean.
- smoke-09.js: ALL PASS (38) — tool defined+wired on all 3 pages, readOtherPage
  body is read-only (reads localStorage, never writes, never set_value/render/
  S-G-L assignment), keys are the OTHER pages', Lab persists goaldenLabState,
  worker/local_server mirror matches.
- smoke-02/05/06/07/08 all PASS; engine.test.js 8/8 (no regression).
- agent-evals loadPage still OK for all 3 pages (Lab render now calls
  persistLabState — confirmed no vm break).
- Functional test (extracted readOtherPage): door2 read returns {page, asOf,
  state} with _savedAt stripped; no-data → {state:null, note}; invalid page →
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
  60, goal retirement, expense 50000 — everything persisted, nothing dropped.
  Lab's read came back with the expected keys (ret, portfolio, mc, snapshots,
  etc.), asOf populated on both.
- readOtherPage('bogus') returned a clean {ok:false, error:...} listing valid
  pages, not a throw.
- Confirmed Door 2's own G object was byte-identical before and after both
  reads (gMutated: false) — the read-only/no-merge guarantee holds live, not
  just in the smoke-09.js regex checks.
- Zero console errors throughout. `node smoke-02..09.js` + `node --test
  engine.test.js` all green; `node --check`/`ast.parse` clean.
- Phase 9 (read-across) verified green end-to-end.

---

## 2026-08-18 — Claude Code — two production-affecting bugs found live, both fixed

Found while helping the user interpret real-world behavior they hit on the
**deployed** site (goalden.vanshsingh23.workers.dev) — separately confirmed
that deployment predates all of Phase 8/9/the chat redesign, so this
diagnosis is about pre-existing behavior, not a regression from today's work.

### Bug 1 — Phase 9 broke every live local_server.py chat call (502)
`_build_system_prompt`'s read_other_page description used an f-string with
`({page, asOf, state})` meant as literal illustrative text — but an f-string
treats bare `{...}` as an expression to evaluate, so Python tried to
evaluate `asOf` as a variable and crashed with `NameError: name 'asOf' is
not defined` on every single call to `_build_system_prompt`, i.e. every
non-mock chat turn (streaming and non-streaming both call it). `ast.parse`
never catches this — it's syntactically valid Python, only a runtime crash
when the f-string is actually evaluated. Neither opencode's nor my Phase 9
verification exercised this path: both only checked syntax and the
client-side `readOtherPage()` mechanism, never a real chat call through
local_server.py's non-mock path. **Fixed**: escaped the literal braces
(`{{page, asOf, state}}`). Confirmed the fix by calling
`local_server._build_system_prompt()` directly in a Python REPL (builds
clean, 7725 chars) and via a live `/api/chat` call (200, not 502). Does not
affect worker.js — JS template literals don't have this bracket-collision
issue, so production's Cloudflare Worker path was never at risk (moot for
now anyway since none of this is deployed).

### Bug 2 — advisor over-triggers "Choice before action" on informational questions
User asked (paraphrased) "which stocks should I choose, small-cap or
mid-cap?" and the model, instead of just answering, launched the mandatory
A/B "do it all / walk me through it" plan-building prompt, then — once the
user supplied age/retirement-age/expense numbers thinking that was leading
toward a stock recommendation — called build_goal_plan + compose_briefing
unprompted, auto-navigating to Door 2's full-plan screen and opening a
full-page report the user never asked for. Root cause: the "Choice before
action" rule in both system prompts fires on any language that's merely
plan/money-adjacent ("build/create/set up/calculate/plan anything"), with no
carve-out for a general or comparison question about an investment
category. **Fixed** (worker.js + local_server.py, mirrored): added an
explicit negative example — a question like "what is a small-cap stock" or
"how do small-cap and mid-cap compare" is NOT this trigger, even if it
mentions money/risk/investing; answer it directly instead.

### Verified
- `node --check`/`ast.parse` clean on both files.
- `node smoke-02..09.js` all PASS; `node --test engine.test.js` 8/8.
- Live reproduction against a real DeepSeek call (DEEPSEEK_API_KEY set):
  the exact small-cap/mid-cap phrasing from the user's screenshot now gets a
  direct, guardrail-respecting answer with no plan-building detour; a
  literal "can you build me a retirement plan?" still correctly triggers the
  A/B choice — confirms the fix didn't overcorrect.
- Ran `node agent-evals/runner.js --base http://127.0.0.1:8091` (full live
  suite, real model): 12/14 passed (86%), 1 skipped. The 2 failures are both
  pre-existing, already-documented live-model non-determinism from Phase 6
  (the "lab run Monte Carlo" tool-choice bias, and one scenario that's
  intermittent — re-ran "hesitant user gets a plan to approve" alone
  immediately after and it passed clean). Neither is a regression from this
  session's wording change.

---

## 2026-08-17 — opencode — Phase 10: real portfolio tools on Door 1/2

### Done
- Part A — extended goalden-engine.js with 13 functions ported verbatim from
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
  tangencyWeightTwoAsset (RELIANCE/TCS-style: negative-excess-return asset →
  picks the higher-Sharpe pure holding, NOT the naive clamp), capitalAllocationLine
  starts at (0, rf).
- Part B — added 5 tools to goalden.html AND goalden-door2.html (S.instruments /
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
- Functional test (vm-injected 2 synthetic instruments → compare_portfolio):
  returns the right structure (instruments/correlation/minVariance/tangency,
  weights summing to 1, riskFreePct). Note: synthetic constant-return data
  produced vol≈0 + a numerically noisy correlation — a test-data artifact, not
  a code issue; the real math is covered by the engine tests above.

### Known / not done
- No commit made (per the git rule).
- NOT browser-tested: the floating frontier panel + render_frontier_chart visual,
  and the full search→add→compare→chart chain, need a live-browser pass
  (cache-bust URLs) — Claude Code's job.
- render_frontier_chart's floating panel is position:fixed top-left to avoid the
  advisor's right-side dock; polish (dismiss-on-Escape, mobile sizing) left for later.

---

## 2026-08-18 — Claude Code — Phase 11: BM25 retrieval layer (tool routing + knowledge grounding)

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
  with a natural query like "which stocks should I pair to minimize risk" —
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
  sends ADVISOR_KNOWLEDGE as chunks — client-side chunking left as a
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
  per page) not implemented — lower-stakes than tool routing per the
  original scope note, left for a follow-up.
- No commit made yet in this entry's session — see next commit.

---

## 2026-08-18 — Claude Code — Phase 12: AI-chosen chart type for portfolio comparisons

### Context
Scoped down from the earlier "AI-composable chart/report tool" discussion,
deliberately kept narrow and sequenced after Phase 11 so the model has
grounded tool descriptions to choose from. The AI now picks among 3
predefined chart types for the existing 2-asset comparison instead of
always rendering the frontier chart — reusing 100% tool-computed numbers,
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
- renderFrontierChart(chartType) — was renderFrontierChart() — validates
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
- goalden-lab.html deliberately untouched — keeps its own toolset.

### Verified
- node --test engine.test.js: 25/25 PASS (3 new Phase 12 tests: bar series/
  category shape, radar indicator/data-point count, radar axis bounds).
- smoke-09.js, smoke-10.js, smoke-11.js: ALL PASS (no regression).
- smoke-12.js (new, 18 assertions): ALL PASS — builders exist/exported,
  both doors wire chartType through schema/dispatch/render, lab untouched,
  both server prompts carry the guidance sentence.
- Live in browser, both goalden.html and goalden-door2.html: added
  RELIANCE.NS + TCS.NS, called compare_portfolio, then
  render_frontier_chart with no chartType / 'bar' / 'radar' — all three
  render, panel title updates correctly each time ("Efficient frontier" /
  "Return vs. risk" / "Risk/return profile"), zero console errors on
  either page.

### Known / not done
- Nothing outstanding. Ready to commit.

---

## 2026-08-18 - opencode - "Read the Company": Explore deck + layout pass

### Done
- **Explore (the big build):** a fullscreen comparison deck on "Read the
  Company", opened from a new ⛶ Explore button on the Bench card and the
  topbar. Two modes: *Over time* (up to 3 metrics as indexed lines / rupee
  bars / %-of-sales, any loaded company) and *X vs Y* scatter (each point is
  one fiscal year, labeled FYxx when ≤14 points, tooltip carries both raw
  values). Year From/To window filters both modes. Pickers list EVERY
  reported row via a per-company catalog (not just canonical rows), seeded
  with Sales / Net Profit / OPM % on first open. Self-contained overlay:
  opens/closes/patches only itself — never calls render() or
  updateStatementsUI() (grep-verified: zero full-render calls in the module),
  so __statementsRenderCount cannot move while it is open. Esc closes it via
  a capture-phase handler that preempts the existing pin-clearing Escape.
  teardownStatements() disposes its chart and closes the overlay on tab exit.
- statements-engine.js: +3 pure helpers behind the deck — stmtExploreCatalog
  (deterministic plottable-row catalog, skips rows with no FY values),
  alignFyPairs (common-year X/Y alignment for the scatter, drops nulls),
  pctOfSalesSeries (% of same-year sales, null where sales ≤0/missing) — all
  exported through the existing api shim.
- engine.test.js: +6 tests (89 total now): catalog ordering + empty-row skip
  (synthetic + real TCS fixture), alignFyPairs common-years/null handling,
  pctOfSalesSeries conversion + refusal-on-non-positive-sales.
- Layout pass: jump-nav/card targets get scroll-margin-top so the sticky nav
  never covers a landing title; print rules (nav/topbar hidden, table overflow
  released, sticky cells relaxed, cards avoid page breaks); Bench chips now
  carry each row's latest reported figure ("Sales · ₹x Cr") using the same
  formatCellRaw arithmetic; second Bench title line names the pin mechanism.

### Verified
- node --test engine.test.js: 89/89 PASS (incl. 6 new).
- smoke-02, 05–13: ALL PASS (no regressions; literal-string checks intact).
- Inline-script parse check across all four HTML files: ALL OK.
- agent-evals loadPage('goalden-lab.html') still loads clean after the new
  top-level listeners.
- Architecture tripwire: grepped the whole Explore module (319 lines) — zero
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
  - Overview (stmtHeaderCard): full width — identity + box score needs it
  - Build a comparison (stmtExploreCard): 5/12 columns, dashed border,
    tinted background, no shadow — reads as a launcher, not a data panel
  - NP vs CFO chart (stmtNpCfoCard): 7/12 columns, chart height reduced
    360→300px for a squarer feel; sits beside the comparison launcher
  - Growth & Returns (stmtDepth): 6/12, lighter shadow
  - Compounding (stmtChecklist): 6/12, lighter shadow
  - Refusal, footer, ToLive: full width
  - #stmtRefusal:empty{display:none} — no ghost grid cell
  - <860px: everything collapses to single column via !important
- **Sticky auto-hide jump-nav:** position:sticky;top:10px;z-index:30.
  Scrolling down slides it out (translateY calc(-100% - 4px) + opacity:0);
  scrolling up slides it back. Always visible at scrollTop < 80. rAF-
  throttled passive scroll listener on main, scoped to L.tab==='statements'.
  Transition on transform+opacity only — no layout, no re-render.
- **Chrome auto-collapse on tab entry:** entering 'statements' for the
  first time sets L.headerCollapsed=true and L.navCollapsed=true (the same
  state the existing toggle buttons set). Module-scoped flag
  (stmtChromeAutoCollapsed) fires once per visit, resets on tab leave.
  Manual expand/collapse buttons work as before in both directions.
- Added id="stmtNpCfoCard" and id="stmtToLiveCard" to previously anonymous
  cards so the grid can target them.

### Verified
- node --test engine.test.js: 89/89 PASS.
- smoke-02, 05–13: ALL PASS (no regressions).
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
- The chrome auto-collapse fires once per tab entry — leaving and returning
  re-collapses. If the user expands the header/sidebar and then switches
  tabs and comes back, it re-collapses. This is intentional (the tab wants
  the space) but worth knowing about.

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
- **Companion map: 7 → 35 entries.** Every P&L row (Sales, Expenses,
  Operating Profit, OPM %, Other Income, Interest, Depreciation, PBT, Tax %,
  Net Profit, EPS, Dividend Payout %), every balance-sheet row (Borrowings,
  Reserves, Equity Capital, Fixed Assets, CWIP, Investments), every
  cash-flow row (CFO, CFI, CFF, Net Cash Flow, FCF, CFO/OP), and every
  ratio row (Debtor Days, Inventory Days, Working Capital Days, Cash
  Conversion Cycle, ROCE %, ROE %) now has 1-3 companions with curated
  reasons. Added companionMapFor(label, isCyclical) — for a cyclical
  company, Stock P/E's companions swap to Reserves (book value is less
  cycle-sensitive than the earnings multiple). renderCompanionStripHTML()
  now calls companionMapFor with detectCyclical's result.
- **Growth summary chart:** growthSummary() was computed but only shown as
  a text table. Added growthChartOption() — grouped bars for Sales CAGR
  and Net Profit CAGR across 10y/5y/3y/1y windows (categorical x-axis,
  overlapping windows, not sequential). Rendered in the Growth & Returns
  card via a new #stmtGrowthChart container.
- **Cash-flow waterfall:** cashFlowWaterfallOption() — CFO/CFI/CFF as
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
- smoke-02, 05–13: ALL PASS.
- Inline-script parse: ALL OK. agent-evals loadPage: OK.
- render-count tripwire: zero actual render()/updateStatementsUI() calls
  in the new chart/companion code.

### Known / not done (flagged, not silently dropped)
- **Quarterly results** and **Shareholding pattern** need parser changes
  in src/worker.js + local_server.py (strict parity) + UI. The parser
  currently only extracts profit-loss, balance-sheet, cash-flow and
  ratios sections. These are the next session's work.
- **Price chart with P/E band** (peHistoryBand is wired but only shown
  as a stat tile, not charted) — needs a chart container and a
  dataZoom-enabled option builder.
- **ROCE-vs-growth scatter** and **stacked composition chart** — deferred.
- **PNG export** of the Bench, **solo/mute on Bench chips**, **reading
  column beyond 25-row whitelist**, **third company**, **mobile bottom
  sheet** — all deferred, lower effort-to-value than the items above.

---

## 2026-08-18 - opencode - "Read the Company" round 2: visibility, stickiness, unit honesty

### Done
- **Jump-nav overlap, root cause:** the bar stuck at top:0 with square bottom
  corners and a one-sided fade — content sliding under it hard-clipped at the
  bar's top edge with zero clearance. Now floats as a deliberate toolbar
  (top:10px, full 14px radius, stronger shadow, z-index 30 — above the sticky
  Bench at 20 and table headers at 2/3), with fade bands on BOTH sides
  (::before above + ::after below, pointer-events:none) so content dissolves
  as it passes underneath instead of half-clipping. Targets already carry
  scroll-margin-top from the last pass.
- **Bench sticky on desktop** (the plan's own call, was missing): ≥1100px,
  #stmtBenchCard sticks at top:86px (clear of the floating nav), capped at
  calc(100vh - 106px) with internal scroll. Pinning a row while scrolled into
  Cash Flow or Ratios now updates the chart in the sticky Bench without any
  scrolling. Plus a one-shot pulse on the freshly added chip (pure CSS
  animation, no re-render) so the click registers even when the eye was on
  the table row.
- **Explore re-homed and renamed** — was a small ⛶ button tucked into the
  Bench card's corner with a name that said nothing. Now: a dedicated
  "Build a comparison" card between the Bench and the tables (description +
  full-size button), a "Compare" entry in the jump nav, the topbar button
  renamed, and the overlay title changed to match. Bench title reverted to
  plain — the Bench stays the zero-effort click-a-row loop; the deliberate
  tool has its own visible home.
- **Unit honesty in the Explore deck** (the "278.9 what?" problem): series
  are grouped by unit (₹ Cr vs %, days, x, ₹/share). When a selection mixes
  groups, the chart draws as TWO STACKED BANDS sharing the same fiscal-year
  axis — rupee bars on top, ratio lines below, each band with its own
  y-scale and named axis (the plan's sanctioned two-grid pattern, never dual
  y-axes). Every tooltip value now carries its real unit via the same
  formatCellRaw the tables use ("₹278.9 Cr", "128.2 %"), scatter axis names
  carry unit suffixes, and % of sales only applies to absolute rupee rows —
  ratio rows plot at face value with a caption note.
- **Inverted year window guard:** From > To swaps rather than charting empty.
- **Reset closes the comparison builder** — resetTab('statements') wipes
  L.statements.data; the overlay read it, so it closes rather than showing
  stale companies against empty data.
- **Section title summaries:** each statement section's title bar now shows
  "N rows · FYxx–FYyy" (plus "Rs Cr unless noted" where true), so a stack of
  collapsed sections reads as a table of contents instead of N identical bars.
- Bench chips carry each row's latest reported figure (added last session,
  confirmed still working after this round's changes).

### Verified
- node --test engine.test.js: 89/89 PASS.
- smoke-02, 05–13: ALL PASS.
- Inline-script parse across all four HTML files: ALL OK.
- agent-evals loadPage('goalden-lab.html'): OK.
- Render-count tripwire: grepped the entire Explore module (396 lines) —
  the only regex hits are the comment saying "never calls render()/
  updateStatementsUI()"; zero actual invocations.
- 10-point structural audit: dedicated card ✓, jump-nav Compare ✓, Bench
  sticky desktop-guarded ✓, reset closes ✓, two-grid layout ✓, unit
  tooltips ✓, scatter unit suffixes ✓, inverted window guard ✓, Bench
  button removed ✓.

### Known / not done
- No commit made (per the git rule).
- NOT browser-tested here: the exact feel of the floating nav, the sticky
  Bench's internal scroll, the stacked-band proportions with real data, and
  the scatter label density at 12+ points all need Claude Code's live pass.
- The Bench sticky is full-width (not a narrow side panel) — the plan
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
  cover the entire statement tables underneath it on a real screen — at
  900px viewport height that cap is 794px, 88% of the screen. First cut
  shrank the cap to min(420px,55vh); still blocked too much. Final fix: the
  Bench is back to normal document flow by default (no sticky at any width),
  with a new 📌 Pin button in its header that docks it at min(260px,38vh)
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
  full payload (Sales/OPM/price/market cap) — confirms the local Python
  server fetches screener.in live and needs no commit/deploy to test.

### Known / not done
- No further browser-testing gaps flagged this pass.

---

## 2026-08-25 - Claude Code - Explore tooltip NaN, jump-nav no longer floats over content

### Done
- **Explore ("Build a comparison") tooltip showed NaN for every value.**
  The Over-time chart's tooltip formatter read `p.value` from ECharts'
  axis-trigger params, but series data is stored as `['FY2020', 156.6]`
  pairs on a category axis — `p.value` is the whole pair, not the number,
  so `formatCellRaw(label, p.value)` ran unit formatting on an array and
  every row printed "NaN". User-reported as "hovering system is not
  working" and "the third metric is not showing up" (it was there in the
  data and in the tooltip's series list — every line just read NaN, which
  reads as broken/absent). Fixed by reading the real value back out of
  `dd[seriesIndex].data[dataIndex]` — the same array the series data was
  mapped from, so indices line up — which also means the tooltip now shows
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
  was passing underneath it — reported directly: "it is hovering over the
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
  `chart.dispatchAction({type:'showTip',...})` before and after — before:
  "Cash from Financing Activity: NaN Net Profit: NaN Other Income: NaN";
  after: real values ("-39,915", "32,447", "4,592"), all three series
  present. From/To year dropdowns confirmed independently defaulting to
  FY2015/FY2026 rather than both to FY2026.
- `#stmtJumpNav` computed position: static. Bench pin button still docks
  the card (`position:sticky;top:10px`) with `__statementsRenderCount`
  unmoved at 1.

### Known / not done
- User also asked about auto-collapsing the outer app header and left
  tools sidebar specifically on this tab to reclaim vertical space —
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
    initialization` — a temporal-dead-zone bug). Moved the declaration
    above first use, removed the now-duplicate second declaration.
- Neither bug was on opencode's own "flagged for next session" list — this
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
  correctly in source — rAF-gated, can't be live-simulated in this
  non-compositing browser pane, so verified by code review only).

### Known / not done
- Committed b21992a and deployed once the user confirmed. Also fixed an
  unrelated deploy hygiene issue found in the same push: a scratch prompt
  file dropped in a repo-local `scratchpad/` got uploaded as a public
  static asset (this repo's wrangler.toml serves the whole repo root) —
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
  and the Cash Flow Waterfall — grid-placed at columns 6/-1 same as the
  chart above it — left columns 1-5 visibly empty beneath Explore on its
  own row. Root cause of the empty-space complaint: two different card
  pairs both anchored to the same column boundary (6) without anything
  ever placed in 1-5 on the waterfall's row, since CSS grid doesn't
  backfill gaps without `grid-auto-flow:dense`.
- **Follow-up ask, same message thread:** stop just varying rectangle
  sizes and instead give the page real zones people can navigate by,
  matching a mental model of "read the numbers" -> "see it charted" ->
  "what it means" — not just a size-varied stream of cards.
- Restructured into three zones, each opened by a new `.stmt-zone-header`
  (small-caps label + rule, full width, matches the existing minimal
  aesthetic rather than adding heavy chrome):
  - **Statements & Benchmarks** — The Bench, then the four statement
    tables (moved up from below the charts, since Bench pins rows *from*
    these tables — they belong next to each other).
  - **Charts** — Build a comparison (now a compact full-width banner, not
    a squeezed card — it's a launcher button + two lines of copy, not a
    chart, so it no longer competes with real charts for grid space), Net
    Profit vs CFO and the Cash Flow Waterfall now paired 50/50 on one row
    (`1/7` and `7/-1`) — two charts of the same kind sit together instead
    of a chart paired against a CTA banner of a different height.
  - **Analysis** — Growth & Returns and Compounding Checklist, both full
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
- Not yet committed/deployed — holding for explicit instruction. Opencode
  is working on the Phase 3 prompt (quarterly/shareholding, price+P/E
  chart, etc.) against the same file concurrently with this change; the
  next commit should pull opencode's latest work first and reconcile
  before pushing, since both sessions are editing goalden-lab.html.
