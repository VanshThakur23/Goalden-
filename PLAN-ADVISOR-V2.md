# Advisor V2 — from "chatbot in a box" to "the app drives itself"

Status: planned, not started. Supersedes the advisor UI decisions in
Parts C, D and E1b. Read this whole file before touching anything.

---

## The diagnosis

The advisor today is a **chat window that occasionally shows a tiny photocopy
of a chart the app already draws beautifully at full size.** Three things are
wrong, and they compound:

1. **The speech caption bar** (`#advisorCaption`, added in E1b) is a large
   floating slab across the top of the viewport that duplicates text already
   visible in the chat bubble. It covers content, it looks bad, and it
   solves a problem — "I can't read what's being spoken" — that was really a
   symptom of the panel being cramped, not a missing second display surface.

2. **The results canvas is a downgrade of the real thing.** `#resultCanvas`
   is 420px wide and re-renders a shrunken copy of a chart that exists, at
   full size and with all its explanatory cards, one click away on the actual
   tool page. A 420px mountain chart with no axis labels tells an investor
   nothing. We built a worse version of our own product and showed it instead
   of the product.

3. **The AI's actions are invisible.** `advisorLoop()` runs every tool call
   in one synchronous burst (advisor.js:376-384). If the model navigates to
   the Retirement Lab, sets four assumptions and computes a result, the
   entire thing happens between two animation frames — the user sees the page
   flicker once and a paragraph of text appear. The most impressive thing the
   advisor does is completely imperceptible, and worse, the chat panel is
   floating on top of the page covering the very result it just produced.

**The fix is one idea:** stop rendering miniature duplicates. The advisor
should *drive the real application* — navigate to the real tool, move the
real sliders, and let the real full-size page do the showing — narrating
what it's doing as it goes, with the chat docked to the side so the user can
actually watch it happen.

The canvas doesn't disappear. It gets promoted to a **workspace**: used only
when the thing being shown genuinely isn't on the current page (a side-by-side
comparison of two scenarios), and when it is used, it's big enough to matter.

---

## Part F0 — BLOCKING BUG: the advisor dies on the page it's needed most

*File: `advisor.js`, plus a `stateForAdvisor()` hook per page. Do this first.*

Reproduction: open **Test Real Investments**, load two instruments (e.g.
TCS.NS and RELIANCE.NS), ask *"can you explain this graph to me on my
screen"* → **"Could not reach the advisor: Request is too large."** Every
message after that fails too. The advisor is completely dead on the exact
screen where a user most wants help.

Cause: `advisorLoop()` sends `state: ADVISOR_CFG.state` (advisor.js:363),
which on the Lab is the **entire `L` object** — including `L.live.data`,
a map of `key -> {prices, stats, …}` where `prices` is the full daily price
series for each instrument (goalden-lab.html:1312-1314). Two instruments ×
~1,238 trading days of OHLC JSON is well over the Worker's 100KB body cap
(src/worker.js:337), so the request is rejected before it ever reaches the
model.

**The fix is architectural: switch from pushing state to letting the model
pull it.** This *increases* what the advisor can reach, it does not limit it.
Today we mail the entire database on every turn and the model still can't use
it — 1,238 raw daily closes are useless to a language model, while the
annualised return and correlation computed *from* them are exactly what it
needs. Nothing becomes invisible to the AI; it just asks for detail instead of
being buried in it.

Four layers, all of them:

1. **Send a summary, not the raw state.** Each page's config gains
   `stateForAdvisor()` returning a compact, model-useful projection. For the
   Lab: per live instrument, the *derived* facts — symbol, label, currency,
   annualised return, volatility, correlation matrix, date range, observation
   count — and **never the raw price array**. advisor.js calls
   `stateForAdvisor()` when present, falling back to `state` otherwise.

2. **Give the model pull-tools for anything omitted**, so no capability is
   lost. At minimum: `get_price_history(symbol, granularity)` returning a
   *downsampled* series (monthly closes, or ~60 evenly-spaced points — enough
   to discuss shape and trend, small enough to fit), `get_instrument_stats(symbol)`
   for the full statistics of one instrument, and `get_detail(path)` for a
   specific slice of state by dotted path. The model can now reach every
   number in the app, on demand, without any single request exceeding the cap.

3. **Guard client-side before sending.** Measure the serialised body; if it
   exceeds ~60KB, drop `state` to a minimal skeleton and tell the model in the
   payload that state was truncated and which pull-tools to use, rather than
   firing a request certain to 413.

4. **Make the failure honest if it ever happens again.** "Request is too
   large" means nothing to a user. Surface something actionable, and log the
   actual byte size to the console for us.

This is a prerequisite for F3 and F7 — neither the Briefing nor
"explain what's on my screen" can work until requests stop exceeding the cap.

---

## Part F1 — Kill the caption, dock the panel

*Files: `advisor.js` only. Small, safe, immediately visible.*

**F1a — Delete the caption bar entirely.** Remove the `#advisorCaption` CSS
rule (advisor.js:65), `advisorShowCaption`, `advisorHideCaption`,
`captionEl`, `captionTimer`, and the calls to them in `advisorSpeak`
(advisor.js:283-285) and `advisorStopSpeech` (advisor.js:216). Keep
`advisorSpeechId` — it still guards against a cancelled utterance's late
callbacks, which will matter for F1b.

Replace it with a **speaking indicator on the bubble itself**: while an
utterance is playing, the bot message being spoken gets a subtle animated
left border or a soft glow (`.adv-msg.bot.speaking`). Cheap, honest, covers
nothing. The text is already right there in the bubble.

**F1b — Three panel modes instead of one floating box.** The panel is
currently a fixed 460px box at bottom-right (advisor.js:37) that sits on top
of the page. Add a mode system:

- **`fab`** — collapsed to the floating button. Unchanged.
- **`dock`** (new, and the default when the advisor takes an action) — the
  panel docks to the right edge, full height, ~400px wide, and the page
  content **shifts left instead of being covered**: set
  `document.body.style.paddingRight` (or a `body.advisor-docked` class with
  a `padding-right` transition) so nothing important is ever behind the
  panel. This single change is what makes "the AI drives the page" legible —
  you can watch the sliders move while you read what it's saying.
- **`focus`** — a larger centred panel (~680px, up to 80vh) for pure
  conversation where no page interaction is happening: definitions,
  explanations, "what should I do next". Reachable by a expand control in
  the header.

A control in `#advisorHead` cycles dock ⇄ focus; the close button still
returns to `fab`. Persist the chosen mode in the same sessionStorage record
as `open` (advisor.js:139-144) so it survives navigation.

Below 900px viewport width, `dock` behaves like today's overlay (no body
padding — there isn't room to shift); below 480px, the existing fullscreen
behavior and mutual-exclusion with the canvas stay exactly as they are.

---

## Part F2 — Make the AI's actions visible and legible

*Files: `advisor.js` (loop + narration), all four pages (label maps).*

Right now every tool call dumps a raw line like `… set_value {"field":"ret.retireAge","value":55}`
into the chat (advisor.js:380). That's debug output shown to a customer.

**F2a — Human-readable action lines.** Each page's config gains an optional
`describeTool(name, args)` that returns a short human sentence — *"Setting
retirement age to 55"*, *"Opening the Retirement Lab"*, *"Running 1,000
simulations"*. advisor.js falls back to the current raw format only if the
page doesn't supply one. Render these as a distinct, quieter style than a
chat message — a small inline step row with a tick once complete, not a
`.adv-msg.sys` bubble.

**F2b — Sequence the actions so a human can follow.** In the tool-call loop
(advisor.js:376-384), `await` a short delay (~350ms, and only when there is
more than one call, and never when `prefers-reduced-motion` is set) between
consecutive tool executions. Four instant mutations become four visible
steps. This is a handful of lines and it is the difference between "the page
blinked" and "I watched it work."

**F2c — Flash what changed.** After a `set_value` succeeds, briefly highlight
the control that changed on the real page. The mechanism already exists —
`advisor-pulse` (advisor.js:62-63) and `advisorHighlight`
(goalden-lab.html:5489-5498) — it just isn't wired to value changes. Each
page's `advisorSetValue` should return the DOM id/selector it touched so
advisor.js can pulse it and scroll it into view.

**F2d — `scroll_to(element)` as a first-class tool** on every page, so after
a computation the advisor can bring the real chart into view rather than
describing a result the user has to go hunting for.

---

## Part F3 — The Briefing: a real composed page, not a popup

*Files: `advisor.js` (shell), `goalden-lab.html` + `goalden.html` +
`goalden-door2.html` (section builders).*

**Replace the 420px results canvas with a full document surface.** When a
user asks something that deserves a real answer — *"make me a retirement
plan"*, *"explain my portfolio"*, *"should I be worried about this"* — the
advisor composes and opens a **Briefing**: a scrollable, full-page,
multi-section document that reads like a report prepared for them. Think of
it as a new page assembled on demand inside the app, not a tooltip with a
chart in it.

**F3a — It behaves like a page.** Opens `full` (fullscreen overlay) by
default with the chat collapsed to its FAB; also supports `half` (beside the
docked chat) and `corner`. Scrollable, with a title, a section rail or
in-page anchors when long, and Print/Save reusing the Lab's existing print
styling. Charts inside render at full page size — never scaled-down
thumbnails. Escape and a close control return to the app with the underlying
page untouched.

**F3b — It can pull from anywhere in the app, from anywhere in the app.**
This is the key capability. A retirement Briefing may include a Monte Carlo
fan, a drawdown curve, a step-up SIP comparison and an allocation card —
even if the user is sitting on the home tab and has never opened those
tools. Sections call the app's existing calculation and chart functions
(`calcRetLab`, `monteCarloAccumulation`, `swpWithdrawal`, `solveStepUpSIP`,
`computePortfolioDerived`, `generateFrontier`, the chart builders) against
current state. No navigation required, no new math.

**F3c — The AI is the editor; the app is the renderer.** Add a
`compose_briefing(title, sections, intro)` tool. `sections` is an array drawn
from a **fixed enum of section builders** the page provides — the model
chooses *which* sections and writes the connective prose, and the app
computes and renders every number and chart. The model must never emit a
figure of its own into a Briefing. Each builder returns `{ok, html}` or
`{ok:false, error}` so a section lacking inputs degrades to an honest "tell
me your retirement age first" instead of an empty chart — the pattern D1
already established.

Section builders to provide (Lab; the two door files get a smaller set):
headline number · retirement projection · drawdown/longevity · Monte Carlo
outcome range · stress test vs a historical crash · portfolio allocation ·
efficient frontier · live-instrument comparison · step-up SIP · cross-border
FX · plan health · assumptions used · what-to-do-next.

**F3d — Comparison is a first-class section type.** Retire at 55 vs 60,
portfolio A vs B, with vs without a 2008-style shock — rendered side by side
with the deltas called out. The app has no other surface for this today and
it's one of the most useful things the advisor can produce.

**F3e — Every Briefing ends in actions, not a dead end.** Footer buttons:
*Open this in the Retirement Lab* (navigates and applies the state shown),
*Print / Save*, and *Ask about this* (returns to chat with that section in
context). Plus a per-section "explain this" affordance wired to F7.

**F3f — New charts are allowed here** where they genuinely help comprehension
and no existing chart covers it (e.g. a simple before/after bar for a
comparison). Match the existing ECharts conventions and palette; do not
introduce a new charting approach.

**F3g — Retire the nine single-scenario kinds** (goalden-lab.html:5654-5664).
They're replaced by Briefing sections. Anything that was only re-rendering a
chart already on screen becomes "scroll to it and explain it" (F7) instead.
Record in WORKLOG.md which kinds were cut, which became sections, and why.

---

## Part F4 — Teach the model the new behaviour

*Files: `src/worker.js`, `local_server.py`, `ADVISOR_KNOWLEDGE` in all four pages.*

The model currently does the wrong thing because **we told it to** — C3 added
"prefer `show_result` on results screens" to every page's knowledge block.
That instruction is now backwards and must be rewritten:

> Prefer driving the real interface: navigate to the right tool, set the
> values, scroll the result into view, then explain what the user is looking
> at in plain language. Use the workspace canvas only to compare two
> scenarios side by side, or to show something that is not on the current
> page. Never describe a number without putting it on screen.

Also add to the system prompt (worker + local_server, so both paths agree):
narrate before acting ("Let me set that up — watch the assumptions panel"),
and after a multi-step sequence, say what changed and what it means, not just
that it's done.

---

## Part F5 — Make the AI discoverable

*Files: all four pages; mostly `goalden-lab.html`.*

Nobody discovers a capability from a floating circle. Give each tool 2-3
tappable starter chips, rendered under the tool header, that pre-fill and
send a question:

- **Retirement Lab** — "What if I retire at 55?" · "Is 10% growth realistic?"
  · "Stress-test this against 2008"
- **Build a Portfolio** — "Explain my Sharpe ratio" · "Am I too concentrated?"
  · "Show me a safer mix with the same return"
- **Test Real Investments** — "Compare these two" · "What does this
  correlation actually mean?" · "Which mix is best and why?"
- **Level 1 / Level 2 results screens** — "Explain this number to me" ·
  "What if I start five years later?"

Zero API cost until tapped. Add one inline "Ask the advisor about this →"
link next to each major result block. These chips are how a first-time
visitor learns the advisor can do more than answer trivia.

---

## Part F6 — Real depth for the portfolio and live-market tools

*File: `goalden-lab.html`.*

The Portfolio-B and Live-B tool sets (set_weights, apply_preset,
analyze_portfolio, frontier_gap, list_assets, search_instruments,
add_instrument, remove_instrument, compare_live, run_monte_carlo,
stress_test) cover *actions* well but not *understanding*. Add:

- **`explain_metric(metric)`** — Sharpe, beta, volatility, correlation, max
  drawdown, tracking error — explained in plain language **using the user's
  own current number**, not a textbook definition.
- **`optimize_for(objective)`** — `max_sharpe` | `min_volatility` |
  `target_return` | `target_risk`. The math already exists
  (`bestSharpePoint`, `generateFrontier`, `computePortfolioDerived`) — this
  only exposes it conversationally, then *moves the real sliders* so the user
  watches the optimizer work.
- **`compare_scenarios(a, b)`** — two weight sets or two assumption sets,
  rendered side by side in the workspace. This is the canvas's flagship use.
- **`why_this_weight(asset)`** — why gold is at 10%: what it contributes to
  the mix (correlation, drawdown behaviour), grounded in the real numbers.
- **`explain_instrument(symbol)`** — for Test Real Investments: what this
  instrument is, what its own history shows, what adding it did to the mix.
  Use only data already fetched; do not invent fundamentals.

Guardrail unchanged and reinforced: explain and compare, never "buy this."
The existing disclaimer stays.

---

## Part F7 — "Explain this graph on my screen" (the flagship feature)

*Files: all four pages + `advisor.js`. Depends on F0.*

A real user typed *"can you explain this graph to me on my screen"* — that is
the single most valuable question this product can answer, and today it
returns an error. Getting this right matters more than anything else in this
plan. It must be **interactive and informative**, not a wall of text.

**F7a — `read_current_chart()`.** Returns a structured description of what is
visibly rendered right now: which tool, which chart, what the axes mean, the
notable points (each asset's own risk/return, the current mix, the best-Sharpe
point, the risk-free rate, where the frontier bends), and the date range and
sample size behind it. Built from the values the page already computed — never
fabricated, never read out of pixels. Pair it with `read_current_result()` for
the numeric side.

**F7b — Explain against the user's actual chart, not the concept.** The answer
must reference what is on their screen: *"That dot at the bottom-right labelled
TCS.NS is TCS on its own — 22% a year, but with 28% swings. The curve bending
up-left is every blend of TCS and Reliance; the point where it bends furthest
left is the mix with the least risk, and it's less risky than either stock
alone. That gap is diversification, and it's the whole reason to hold both."*
Textbook definitions of the efficient frontier are a failure state.

**F7c — Make it interactive: explain, then point.** As the advisor explains a
feature of the chart, **highlight that feature on the real chart** — the
mechanism from F2c generalises here. Explaining the risk-free rate pulses the
risk-free marker; explaining the tangency point pulses that point. The user
watches their own chart get annotated as it's described. This is the
"immersive" experience the whole plan is aiming at, and it is what makes an
AI explanation better than a paragraph of documentation.

**F7d — Layer it, don't dump it.** One tight paragraph answering the question
asked, then offer the next layer as tappable follow-ups rather than
pre-emptively explaining everything: *"Why is the curve bent?"* · *"What
should I do with this?"* · *"How would adding a third stock change it?"*
Reuses the F5 chip mechanism. Long unprompted explanations are exactly the
"too much text" problem in a new costume.

**F7e — Every chart in the app gets this.** A small "Explain this" affordance
on each major chart (Retirement mountain, drawdown fan, frontier, CAL,
Monte Carlo, step-up comparison, Level 1 and Level 2 results). One click,
no typing, no wondering whether the AI can help — the most direct possible
answer to "people don't realise the AI can do this."

---

## Order of work

Each phase is independently shippable and independently testable. Do them in
this order — F1 and F2 alone will change how the whole thing feels, and
they're the lowest-risk:

0. **F0** — payload bug. Blocking; the advisor is dead on Test Real
   Investments until this lands, and F7 depends on it.
1. **F1** — caption gone, panel docks. (advisor.js only)
2. **F2** — action narration, sequencing, flash-what-changed. (advisor.js + label maps)
3. **F4** — knowledge/prompt rewrite so the model stops preferring the canvas.
4. **F7** — explain-this-chart. Highest-value feature here; do it before the
   Briefing, because a good explanation of the real chart removes most of the
   reason to render a copy of it, and F3's per-section "explain this" reuses
   this machinery.
5. **F3** — the Briefing.
6. **F5** — suggestion chips.
7. **F6** — portfolio/live-market depth tools.

Batching for sessions: **Batch 1 = F0 + F1 + F2 + F4** (the bug and the feel).
**Batch 2 = F7 + F3** (explanation, then the Briefing). **Batch 3 = F5 + F6**
(discoverability and depth). Do not attempt all three in one session — the
Part D brace incident came out of exactly that.

## Constraints

- No new dependencies, no build step, no CDN.
- `advisor.js` is shared by all four pages — a syntax error breaks every page
  at once. Count braces on every nested object literal before finishing, the
  way Part D did.
- The four pages are still independent for everything except advisor.js;
  never assume a selector that exists in the Lab exists in Level 1.
- `position:sticky` breaks under a transformed ancestor — if the docked panel
  introduces a transform on any wrapper, the Lab's assumptions panel will
  silently stop sticking. Use padding/width, not transforms, for the dock
  shift.
- Preserve the existing mobile arbitration (<480px: chat and canvas never
  both occupy the fullscreen slot).
