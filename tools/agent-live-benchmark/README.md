# Agent live benchmark

Drives the **built extension** with a **real model** and scores each task by
reading the page, not by believing the run.

This is the gate the scripted Playwright benchmark cannot be. That suite
answers "does the runtime do what it says" with a decision table, so it cannot
fail on model behaviour and its medians are the fixture's latency. Everything
these two scripts found — a completion judge refusing verified work, a form
fingerprint that moved whenever a search widget repainted, a proxy that
answered every request `503` after one cancelled turn — is invisible to it.

## Running

```bash
pnpm build                                   # the scripts load build/chrome-mv3-prod
AUDIT_UPSTREAM=http://127.0.0.1:8087 \
AUDIT_MODEL=opencode/muse-spark-1.3-contributor-free \
  node tools/agent-live-benchmark/synthetic.mjs

AUDIT_UPSTREAM=http://127.0.0.1:8087 \
  node tools/agent-live-benchmark/real-sites.mjs
```

| variable | meaning |
| --- | --- |
| `AUDIT_UPSTREAM` | OpenAI-compatible endpoint to forward to; an olc proxy (`pnpm exec tsx packages/olc/src/cli.ts -b opencode --port 8087`). Default `http://127.0.0.1:8084`. |
| `AUDIT_MODEL` | Model id as that endpoint lists it. |
| `AUDIT_REASONING_EFFORT` | Sets `reasoning_effort` (for example `medium`) on every chat completion forwarded upstream, overriding what the extension sent. |
| `AUDIT_API_KEY` | Sent as a bearer token upstream, for a hosted endpoint such as OpenRouter (`AUDIT_UPSTREAM=https://openrouter.ai/api`). Never written to the evidence. |

Each run writes `artifacts/agent-live-benchmark/<suite>/<model>/`: one
`benchmark-results.json`, and per task an `evidence.json` holding the row, every
panel snapshot, the full model wire (request envelope and streamed response) and
the worker's trace, plus a screenshot of the page as it was left. `artifacts/`
is gitignored, so a result worth keeping goes in the pull request that earned
it.

## What each suite is for

**`synthetic.mjs`** — 18 one-line pages served from the same ephemeral origin as
the model wire: click, form, details, read, select, checkbox, uncheck, scroll,
menu, modal, delayed, stale, ambiguous, spaform, keypress, redirect, open_tab,
memory. Deterministic, fast, and every failure is attributable. `spaform` is the
single-page form whose `submit` handler calls `preventDefault`; `delayed` lands
its effect 1.2s after the click; `ambiguous` is expected to pause.

**`real-sites.mjs`** — six tasks against Wikipedia, Hacker News, GitHub and
DuckDuckGo. Slower, occasionally flaky, and the only thing here that observes a
page nobody wrote for the test: pages with four to five hundred controls, live
widgets that repaint while the model is deciding, and real latency.

## Reading a result

`success` is the task's own predicate over the page or the answer — never
`Boolean(run.result)`, which is the model's own summary and exists whenever a
completion was accepted. A row can be `status: "completed"` and `success:
false`; that is a false completion and it is the most important thing either
script can tell you.

Each row also carries `verdict` (`achieved`, `false_completed`,
`safely_paused`, `missed`, `invalid`, `site_blocked`) and `predicate` (which check produced `success`).
Completion and correctness never share one headline score: the ambiguous
synthetic task is `success: true` with verdict `safely_paused`, and a
completed run with a wrong answer is `false_completed`, not a miss. Other
pauses are `missed`; a generic user, question, or browser-disconnection pause
is not evidence that the run stopped safely. A case the harness could not give
a fresh chat is `invalid`: the model never received it, so it counts in no
rate. A run that paused to ask the user past a captcha the site showed, or
ended failed on one, is `site_blocked`, and is left out of the rates for the
same reason; a run that completed on one is still judged.

Answer tasks match whole values, case-insensitively, and need the value in a
page this turn read — a `current_tab`/`read_tab` result, or the page a
completed browser task observed — never the reply alone or the browser task's
own report. A browser task's reads count only on the fixture's own origin.
`memory` needs both codes from those reads: the status code is only on the
details page, so reading it proves Details was opened, in whichever tab and
wherever the run ended.

Predicate notes: real-site `__inbody__` tasks require a multi-word verbatim
span minus page-chrome boilerplate (`score-answer.mjs:INBODY_RULES`), so
"Hacker News" cannot pass as a story title; `wiki_search` additionally
requires landing on the Firefox article. Synthetic action tasks assert the
effect counter and page state, navigation tasks assert the landed URL, and
`open_tab` asserts the new tab — never just the answer text. Pinned by
`node --test tools/agent-live-benchmark/__tests__/score-answer.test.mjs`.

Both scripts approve every approval request automatically, so they measure the
loop rather than the consent UI. A task that ends `awaiting_takeover` is
reporting that the policy floor asked for a human, which is a result, not an
error.
