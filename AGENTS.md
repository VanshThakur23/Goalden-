# Goalden — agent notes

Static, no-build-step financial planning app. Four independent, self-contained
HTML files — each has its own inline CSS/JS, no shared imports. **Never
assume two of them are identical** just because they look similar; check
before porting a fix from one to another.

- `index.html` — the 3-door landing page (Quick Calculate / The Full Plan / The Lab)
- `goalden.html` — Level 1, Quick Calculate
- `goalden-door2.html` — Level 2, The Full Plan (risk-profiling questionnaire)
- `goalden-lab.html` — Level 3, The Lab (full assumption control, live market-data portfolio testing)

`local_server.py` (port 8080) stands in locally for the Cloudflare Worker
(`src/worker.js`) that proxies Yahoo Finance / MFAPI in production. Run it
and test against `localhost:8080` — the app calls `/api/*` for live market
data, which needs the proxy either way.

## Conventions already established in this codebase

- No CDN dependencies beyond Google Fonts. No frameworks, no build step.
- Comments explain *why*, not what — this project leans on comments to
  record non-obvious constraints (CSS gotchas, a specific bug's root cause,
  a deliberately-rejected simpler approach). Read them before changing
  something that looks over-engineered; it's usually load-bearing.
- When testing in a browser tool, cache-bust the URL (`?v=whatever`) after
  editing an HTML file — plain re-navigation can serve a stale cached copy.
- `flow()` + a single index (`S.si` / `G.si` / `L.si`) drives screen
  navigation in all three door files; `jumpEdit()`/`go()`/`render()` always
  resolve position via `flow().indexOf(name)`, never a cached numeric index.

## Pending: Full conversational AI advisor (the main AI feature)

**Decided scope (2026-08-14):** Not just voice navigation — a full
conversational financial advisor accessible from every screen. The user can
speak or type; the AI talks back in plain language, runs real calculations
behind the scenes, and navigates the app to the right screen automatically.
Works for both financially-literate and novice users. Goal: a person with no
finance background can just talk to it, and it figures out which level/tool
is right for them and gets them there.

### What it does (user-visible)
- Floating chat/voice button visible on all 4 pages
- User asks anything: "How much do I need to save?", "What does risk profile
  mean?", "Show me what happens if I retire at 55 instead of 60"
- AI answers in plain language AND takes action: fills a slider, navigates to
  a screen, triggers a calculation, surfaces a result
- Maintains conversation history within the session (context carries across
  screens)
- STT/TTS via browser Web Speech API (free, no key; Chrome/Edge/Safari only,
  not Firefox) — user can also just type if preferred
- Adapter language: AI detects from the conversation whether the user is a
  novice or expert and adjusts terminology accordingly

### Tools the AI has (function-calling)
These are the actions the AI can take — the backend returns a tool call,
the frontend executes it, then feeds the result back:
- `navigate(screen)` — go to a named screen; enum is built from `flow()` at
  call time so the AI cannot hallucinate a destination
- `set_value(field, value)` — set a slider or input (e.g. age=28, retireAge=55)
- `get_state()` — return current S/G/L object (all user inputs so far) so the
  AI knows what's already been entered
- `get_results()` — return the current calculated output (corpus, SIP, etc.)
- `explain(concept)` — surface a tooltip or highlight an element on screen

The AI MUST validate `navigate` targets against `flow()` before applying —
never trust the model's string directly without the indexOf check.

### Backend architecture
- `src/worker.js` already exists and proxies Yahoo Finance / MFAPI.
  Add an `/api/chat` route to the same Worker. **Never put the LLM API key
  in client-side JS** — store it as a Cloudflare Worker secret
  (`wrangler secret put OPENAI_API_KEY` or equivalent).
- POST body: `{ messages: [...], tools: [...], state: {...} }` where `state`
  is the current S/G/L snapshot and `tools` is the dynamic function list
  built from `flow()`.
- LLM: DeepSeek (~$0.14/M input, OpenAI-compatible schema) is cheapest.
  GPT-4o-mini or Gemini 2.5 Flash are fine alternatives. At demo scale
  (50-200 people, a few turns each) total cost is well under $1.
- System prompt must include: what Goalden is, current page, current state,
  the tool list with descriptions, and the instruction to adapt language to
  the user's apparent literacy level.

### Implementation order (do this file-by-file, prove it in one then port)
1. Start in `goalden.html` (simplest state object `S`). Add the advisor
   overlay UI + Worker route + tool loop. Get it fully working.
2. Port to `goalden-door2.html` (state object `G`), then `goalden-lab.html`
   (state object `L`), then `index.html` (no state, just navigate to a door).
3. Each file is independent — copy the advisor block, update the state
   reference (S vs G vs L), and update the tool enum.

### API key logistics
- The LLM key lives in the Cloudflare Worker as a secret — the user needs to
  set it once via the Cloudflare dashboard or `wrangler secret put`.
- The client-side code only ever calls `/api/chat` on the same Worker origin
  that already serves the app — no key ever touches the browser.
- opencode: do NOT hardcode any API key into the HTML files. If you need to
  test LLM calls locally, add a `OPENAI_API_KEY` env var to `local_server.py`
  and proxy it the same way.

### Work log
Write what you built/changed in WORKLOG.md at end of each session.

## Recent work (for context on what's already been through several rounds)

Test Real Investments (in the Lab): destination cards, degenerate-frontier
fix, risk-free rate labeling on the CAL chart, diversification-benefit box,
tangency-vs-minimum-variance edge case surfaced in the UI. Retirement Lab:
Monte Carlo drawdown now responds to the historical-shock selector (it
didn't before — real bug, now fixed). Levels 1 and 2: screen count cut via
merging trivially-adjacent single-input screens and batching profiling
questions, results/plan screens default-collapse secondary content behind
toggles, screen-transition CSS animation fixed (was silently never firing).
Full detail is in `git log` — commit messages are the actual record, this
file is only for things a fresh session can't get from the code or history.
