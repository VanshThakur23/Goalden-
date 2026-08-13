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
