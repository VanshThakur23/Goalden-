# Goalden Review Board

Working file for the `/loop` improvement cycle. It holds the reviewer
hierarchy, the ranked backlog and each item's status, so every loop
iteration starts from here instead of rediscovering the app. **Nothing here
is committed by the loop.** The user commits.

## Hierarchy (who listens to whom)

```
                         CHIEF PRODUCT OFFICER (final verdict)
          owns: priority order, scope, conflicts between divisions, what ships
                                      |
        +---------------+-------------+--------------+----------------+
        |               |             |              |                |
   D1 Retirement   D2 Portfolio   D3 Company     D4 Visual &      D5 AI Advisor
   & Planning      Construction   Analysis       Data-Viz         & Reliability
   (lead: CFP)     (lead: quant   (lead: equity  (lead: design    (lead: staff
                    PM)            analyst)       director)        engineer)
```

Each division lead chairs a panel of about 10 specialists (about 50 in
total). Specialists raise findings. The lead merges duplicates, rejects weak
ones and ranks the rest. The Chief takes the five division reports, resolves
conflicts and orders the backlog.

**Tie-break rules (Chief):**
1. Correctness beats everything. A wrong number in a finance tool outranks
   any visual issue.
2. Demo resilience comes next. Nothing may break in front of an evaluator
   (see ROADMAP.md).
3. Then retail-investor comprehension. If a novice can't read it, it doesn't
   count as shipped.
4. Visual polish comes last, but it's cheap, so it often ships in the same
   pass.
5. D4 (visual) can veto a chart change that hurts legibility. D1/D2/D3 can
   veto a visual change that misstates a number. D5 can veto anything that
   breaks the advisor's tool contract (field names, screen names, DOM ids
   the tools read).

**Panels:**
- **D1 Retirement & Planning:** Certified Financial Planner (lead), actuary,
  tax specialist (India), behavioural economist, Monte Carlo modeller, SWP
  and decumulation specialist, education-goal planner, inflation
  economist, novice-user advocate, UX writer.
- **D2 Portfolio Construction:** quant PM (lead), MPT/frontier specialist,
  risk manager (VaR/drawdown), MF research analyst, ETF specialist,
  correlation/diversification analyst, backtest-bias auditor, index
  investing advocate, rebalancing specialist, retail-investor advocate.
- **D3 Company Analysis:** equity research analyst (lead), forensic
  accountant, credit analyst, sector specialists (banks/NBFC, IT, metals),
  valuation specialist, CFA-level ratio specialist, governance/shareholding
  analyst, first-time stock-buyer advocate, financial journalist.
- **D4 Visual & Data-Viz:** design director (lead), data-viz specialist,
  chart typographer, colour and accessibility (WCAG) specialist, motion
  designer, mobile/responsive specialist, print specialist, information
  architect, interaction designer, brand designer.
- **D5 AI Advisor & Reliability:** staff engineer (lead), LLM tool-calling
  specialist, prompt engineer, eval engineer, security/injection
  specialist, performance engineer, QA lead, accessibility engineer
  (keyboard/screen reader), offline/demo-resilience engineer, observability
  engineer.

## Backlog

Status: `todo` · `doing` · `done` · `rejected (reason)`

See the iteration log in WORKLOG.md for what each loop pass changed.
