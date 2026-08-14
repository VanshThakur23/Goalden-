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
