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

## Pending, not yet started: AI-agent feature

The user wants to add an AI layer to the app to demo — hasn't committed to
scope yet. Two options were scoped out with a Claude Code session on
2026-08-13/14, not yet built:

1. **Voice-nav agent** (recommended as the first, smaller piece): browser's
   built-in Web Speech API for STT/TTS (free, no key, works in
   Chrome/Edge/Safari, not Firefox) + one LLM call per utterance with a
   `navigate(screen)` tool constrained to an enum built from `flow()` at
   request time, so it can't hallucinate a destination. Validate the
   returned screen name is actually in `flow()` before doing
   `S.si = flow().indexOf(screen); render();`. Needs a backend proxy for the
   LLM key — `src/worker.js` already exists and already proxies market data,
   so add an `/api/chat` route there with the key as a Worker secret, don't
   build new infrastructure. DeepSeek's current model (~$0.14/M input,
   ~$0.28/M output) is the cheapest option and has an OpenAI-compatible
   function-calling schema; GPT-5-mini or Gemini 2.5 Flash are fine
   alternatives if DeepSeek doesn't work out. Cost at demo scale
   (50-200 people, a few turns each) is well under a dollar regardless of
   provider — not the constraint.

2. **Portfolio-rebalancing advisor**: bigger scope, stronger multi-step
   "agentic" demo since it reuses `goalden-lab.html`'s existing efficient-
   frontier/live-data code instead of bolting on something new. Give the
   model tools like `get_current_prices()`, `compute_drift_from_target()`,
   `simulate_trade()` and let it iterate — check drift, propose a trade,
   recompute, explain. Scope this out properly before starting; it's a
   real week+ of work, not a weekend add-on like option 1.

Recommendation given at the time: build the voice-nav agent first (small,
fast, directly demoable), then decide whether the rebalancing advisor is
worth the extra time.

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
