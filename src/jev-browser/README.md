# Jev Browser

A browser agent for pi. The user says what they want in plain language and the
agent works a real browser to get it.

```
/jev-browser find me the flights from zagreb to split on the next monday
```

## Pi interaction

`/jev-browser` submits a normal Pi turn requesting `jev_browser`; it no longer
runs a separate footer/notification workflow. The tool streams a compact inline
progress view, saves its result and diagnostic trace in the session, and returns
evidence for the assistant's answer. Expand the tool result to inspect the full
trace, timing tables, and final page text. Errors remain failed tool calls and
save their progress in a `jev-browser-error` session entry.

The parent Pi turn uses the normal conversation. The browser worker's planning
calls do not: they still receive only the worker's system prompt and one task/page
message, with no parent conversation or tools. Browsers default to headless.

## How it is put together

```
free-form request
      │
      ▼
reasoning model ....... interprets the request, keeps generic working memory,
                        sets the next subgoals, judges completion
      │
      ▼
controller ............ owns budgets, policy, and the loop in agent.ts
      │
      ▼
observe.ts ............ turns a playwright-cli aria snapshot into compact
                        semantic state: visible text + actionable controls
      │
      ▼
actions.ts ............ builds the finite set of atomic actions that are
                        executable right now, from live state only
      │
      ▼
Jev (System One) ...... picks one action, and independently reports whether the
                        subgoal looks done and whether progress is impossible
      │
      ▼
policy.ts ............. decides whether that choice may become a side effect
      │
      ▼
browser.ts ............ executes exactly one action through playwright-cli
      │
      ▼
controller ............ observes, verifies the effect, adapts or replans
```

Two rules hold the design together:

- **Models never emit selectors, coordinates, or code.** They choose between
  actions the application built and named. Ids come from `observe.ts` and are the
  only handle a model sees.
- **Nothing ends a run except evidence.** The reasoning model judges completion
  from the page; `planner.verify` checks it independently.

## Files

| File | Responsibility |
|---|---|
| `index.ts` | pi tool and `/jev-browser` command; wires model, credentials, browser |
| `agent.ts` | the controller loop: budgets, policy, verification, recovery |
| `observe.ts` | aria snapshot to `Observation`; who is actionable, what a control holds |
| `actions.ts` | candidate generation and risk classification |
| `jev.ts` | the System One decision: one action, two independent page reads |
| `planner.ts` | the reasoning model: plan, replan, verify |
| `browser.ts` | playwright-cli execution and target freshness |
| `policy.ts` | thresholds, budgets, cycle detection |
| `metrics.ts` | per-phase and per-step timing |
| `types.ts` | shared vocabulary |

## Rules that exist because of a real failure

Each of these replaced a plausible-looking design that broke in practice.

| Rule | What went wrong without it |
|---|---|
| An open choice list makes the list exclusive (`actions.ts`) | Typing while an autocomplete list was open dismissed the list and left the field unset, so the form could never be submitted; clicking elsewhere did the same |
| A value already held by a control is not offered again | A pre-filled origin was offered for the date field, because "already entered" was judged from the agent's history instead of from the page |
| Fill candidates pair one control with one value | Choosing a field and choosing its value in two separate questions let a model put an origin into a date field |
| A declined value does not blacklist the control (`agent.ts`) | A `NONE` answer withheld a valid field for the rest of the run, and the run then had nothing left to do |
| Dead ends are recorded, not fatal | The first unexpected answer ended the run |
| Freshness is about the target, not the page (`browser.ts`) | Pages with clocks or a spinner never stop changing, so every action looked stale and the agent starved |
| Actions that repeat a sequence are treated as a cycle (`policy.ts`) | `Search → pick date → confirm → Search` cycled for forty steps while the page looked different every time (prices) |
| A loading page is waited for (`browser.ts`) | The agent decided on half-rendered pages and clicked elements that belonged to the previous one |
| Low-risk actions are not confidence-gated (`policy.ts`) | Replanning instead of acting cost a reasoning call per step and learned nothing, and the run stalled at the replan budget |

## Timing

Every phase reports itself into `metrics.ts`, and `AgentResult.timings` holds the
table. A clean flight search costs about 50s: ~20s in the reasoning model, ~10s
in six clicks (playwright-cli's actionability wait, ~1.7s each), ~9s in page
reads, ~5s in System One decisions. Run the e2e test to see the current split:

```
JEV_E2E=1 bun test src/jev-browser/e2e.test.ts
```

`snapshot` is ~60ms; a `click` is ~1.3-2.1s. That is why the loop is built to
avoid wasting actions rather than to make each action fast.

## Tests

```
bun test                                  # unit tests, fast, no network
JEV_E2E=1 bun test src/jev-browser/e2e.test.ts   # real end-to-end run
JEV_E2E=1 JEV_E2E_MODEL=openai-codex/gpt-5.5 \
  bun test src/jev-browser/e2e.test.ts    # pin the reasoning model
```

The e2e test asks for flights from Zagreb to Split "on the next monday" on a real
site, and asserts that a real flight list with prices is visible, that the
relative date was resolved to an actual Monday, and that no consequential action
(booking, payment) ever reached the browser.
