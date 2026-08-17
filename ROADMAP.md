# Goalden — agentic AI roadmap

Working document for multi-session work. Read alongside `AGENTS.md`
(conventions) and `WORKLOG.md` (session history).

**Project goal:** this is a placement project. It must survive a live demo, hold
up in a technical interview, and read well on GitHub. It is *not* being deployed
at scale. Prioritise demo resilience, defensible architecture and measurable
results. Scale/abuse/compliance work is out of scope.

## Current agentic state

Already present: 51 tool definitions across four pages, a ReAct-style execution
loop (`advisor.js:585-664`), per-field validation (`advisorSetValue` on each
page), and an AI-curated report generator (`compose_briefing`, `advisor.js:728`).

Missing: planning/decomposition, self-verification, human-in-the-loop approval,
role specialisation, and any eval coverage of the agent itself.

## Phases

Each phase is one opencode session. Do not start a phase until the previous one
verifies green.

| # | Phase | Purpose |
|---|---|---|
| 0 | Demo resilience | Nothing visibly breaks in front of an evaluator |
| 1 | Shared engine + tests | Ground truth for everything after |
| 2 | Verification layer | The differentiating capability |
| 3 | Compound skills | Collapse 7–11 model round trips to 1–2 |
| 4 | Plan objects + approval | Planning and human-in-the-loop |
| 5 | Role split | Planner / executor / teacher — *only if Phase 3 shows latency headroom* |
| 6 | Agent eval harness | A measurable claim about agent behaviour |
| 7 | Packaging | README, architecture diagram, cost/latency instrumentation |

### Phase 0 — demo resilience

1. Persist `S`/`G` to `localStorage` in `render()` + explicit "Resume where you
   left off?" prompt. Pattern to reuse: `goalden-lab.html:4968-5016`.
2. Real mock/fallback mode — `local_server.py:299-321` and the missing-key branch
   at `src/worker.js:436-437`.
3. `AbortSignal.timeout(25000)` on `advisor.js:586` and `src/worker.js:331`;
   friendly error mapping in the Worker catch (`src/worker.js:441-443`).
4. Fix `goalden-lab.html:5463` — coerces every value numerically, so
   `set_value('country','IN')` becomes `NaN` and is rejected.
5. `pushState`/`popstate` for in-app Back.
6. Escape model-controlled step-row args (`advisor.js:606-608`).

### Phase 0.5 — response format (do this before Phase 1)

**Two verified problems, not one.**

1. **The chat UI doesn't render markdown at all.** `advisorAddMsg` sets
   `div.textContent = text` for every message (`advisor.js:234`). The system
   prompt's mandatory format instructs the model to write `**bold**` — the
   chat literally displays the asterisks. Confirmed live: a real "do it all"
   reply showed `📊 **What this shows:** your retirement plan...` verbatim,
   asterisks and all. This is worse than a formatting nitpick — it actively
   makes replies harder to read, the opposite of the visual/scannable goal
   the format was written for.
2. **One rigid template is forced onto every reply type.** `worker.js:288-303`
   mandates the same five labeled rows (📊📈📉🎯💡) and ~100-word cap whether
   the user asked "what is a SIP?" or asked for a 4-way scenario comparison.
   `compare_scenarios` (F6) has no way to express itself inside five rows.
   A term question doesn't need a chart-emoji row at all. The system prompt
   separately claims to "adapt to the user's literacy level" while imposing
   an identical structure on every reply — those two instructions contradict
   each other.

**Plan:**

- Add a small, safe markdown renderer in `advisor.js` for **bot messages
  only** (escape the text first via the existing `advisorEscapeHtml`, then
  transform `**bold**`, bullet lines, and simple `|a|b|` tables into HTML).
  User and system messages stay on `textContent` — no injection surface
  changes.
- Replace the single mandatory format in `worker.js`/`local_server.py` with
  2–3 lightweight response modes the model picks based on what's being
  answered, instead of one template for everything:
  - **Quick fact** (a term/definition question) — short prose, one bold key
    phrase, no forced rows.
  - **Numeric result** (a plan/calculation summary) — keep the scannable
    symbol-row instinct users respond well to, but let length scale with
    complexity instead of a flat ~100-word cap.
  - **Comparison** (2+ options, e.g. `compare_scenarios`) — a real markdown
    table instead of prose trying to hold multiple columns in five rows.
- Keep the visual/symbol instinct — that part of the original design is
  right — but stop forcing one shape onto every kind of answer.

### Phase 1 — shared engine

Extract `goalden-engine.js` as a plain `<script>` (precedent: `advisor.js`; no
build step). Blocker: engine functions read page globals (`S.country` vs
`G.country`) — pass the country code as an argument instead.

`accumulationSchedule` has drifted into three incompatible signatures
(`goalden.html:324`, `goalden-door2.html:373`, `goalden-lab.html:728`).
Reconcile to the superset before extracting.

Do **not** merge `cfg()`, `flow()`, `allocFromEquityPct`, `blendedRate` — these
are genuinely divergent per page.

Write `engine.test.js` (`node --test`, a dev-only tool). This also makes the
currently-false comment at `goalden.html:305` true.

### Phase 2 — verification layer

Field validation already exists. What's missing is cross-field sanity, output
verification, and mechanical guardrail enforcement:

- Cross-field rules: implied SIP vs stated capacity, corpus vs retirement-year
  expenses, expense magnitude plausible per country.
- **Recompute-and-compare audit** — before a briefing renders, re-run the engine
  from state and diff every figure the briefing asserts. Mismatch blocks the
  render and makes the agent re-ask.
- Enforce the advice guardrail (`src/worker.js:324-327`) in code, not prompt.
- Visible "every figure recomputed from your inputs ✓" stamp.

### Phase 8 — streaming responses

Today `/api/chat` is fully blocking: the client `await`s the entire DeepSeek
turn before anything appears. A multi-sentence MODE B/C reply renders all at
once after several seconds of silence — the single biggest perceived-latency
complaint. Stream the model's token output so text appears as it's generated.

- Opt-in `stream:true` flag on the request body. Server behavior is unchanged
  when it's absent — `agent-evals/runner.js` never sets it, so the eval
  harness keeps getting the old synchronous JSON response with zero changes
  required there.
- Worker/local_server become dumb byte-forwarders of DeepSeek's own SSE
  stream when `stream:true` — no server-side parsing of deltas, all
  accumulation logic lives once, client-side, in `advisor.js`.
- Client accumulates `content` and `tool_calls` deltas (by `index`, per
  OpenAI/DeepSeek streaming semantics), live-updates a plain-text bubble as
  content arrives, then applies `advisorGuardrail`/`advisorMarkdown` once
  on the complete text before finalizing — never mid-stream, so a
  half-formed sentence can't slip past the guardrail.
- Mock mode (no key) wraps its existing scripted reply as a single SSE chunk
  so the client only ever has one parsing code path.

### Phase 9 — federated tooling

Today the advisor only sees the page it's currently on — Door 1's advisor
can't read Door 2's goals or the Lab's portfolio. Federated tooling removes
that wall: one config object carrying all three pages' state and tools, so a
single conversation can span "take my Door 2 retirement goal and stress-test
it in the Lab." `advisor.js`'s loop itself doesn't change — it just gets a
bigger config to read from.

Real complexity is in ownership and verification, not the loop:

- Which page "owns" a field when two pages both define something with the
  same name (e.g. `country`) — needs an explicit source-of-truth per field,
  not last-write-wins.
- The Phase 2 recompute-and-compare audit has to diff figures against
  whichever page's engine call actually produced them — a briefing that
  blends Lab and Door 2 data needs to know which figures came from where.
- Scope this phase's first cut narrowly: read-across (the advisor can *read*
  another page's state/results) before write-across (the advisor can *act*
  on another page's fields) — read-across is most of the value with far
  less risk of one page corrupting another's invariants.

Not started until Phase 8 verifies green (standing rule: one phase per
opencode session, don't start the next until the last one is green).

### Briefing upgrade (folded into Phases 2–3)

The AI currently controls only title, intro prose, and which pre-built sections
to include. Every number is page-generated — a good safety property, keep it.
Extend by letting the agent author *per-section commentary* (escaped) while the
page keeps supplying every figure.

## Constraints

- No build step, no new runtime dependencies, no keys in client JS.
- Mirror every `src/worker.js` prompt/behaviour change into `local_server.py` —
  they are hand-synced and already whitespace-divergent.
- opencode edits files only. All git operations and all `wrangler deploy` runs go
  through Claude Code.
- No math edits without green engine tests.
