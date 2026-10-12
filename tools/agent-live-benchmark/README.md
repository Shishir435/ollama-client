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

**`synthetic.mjs`** — 19 one-line pages served from the same ephemeral origin as
the model wire: click, form, details, read, select, checkbox, uncheck, scroll,
menu, modal, delayed, stale, ambiguous, spaform, keypress, redirect, open_tab,
memory, canvas. Deterministic, fast, and every failure is attributable. `spaform` is the
single-page form whose `submit` handler calls `preventDefault`; `delayed` lands
its effect 1.2s after the click; `ambiguous` is expected to pause.

The canvas predicate requires an image-bearing agent decision message with
the fixture's `Rendered` observation. Its row records the content-free
`renderedCanvasScreenshot` signal; a `look` request alone does not count.

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
"Hacker News" cannot pass as a story title; `wiki_read` requires the final URL
to remain on the Chromium article and its infobox Release row to contain the
year;
`wiki_search` additionally requires landing on the Firefox article, and
`google_search` is judged by landing on Google's results for the query and the
answer giving the complete rendered first result title, alone or in a short
sentence about the first result. Synthetic action tasks assert the effect counter
and page state,
navigation tasks assert the landed URL, and `open_tab` asserts the new tab —
never just the answer text. Pinned by
`node --test tools/agent-live-benchmark/__tests__/score-answer.test.mjs`.

Both scripts approve every approval request automatically, so they measure the
loop rather than the consent UI. A task that ends `awaiting_takeover` is
reporting that the policy floor asked for a human, which is a result, not an
error.

## Current-head baseline (PR 1)

Run each existing suite with `AUDIT_ATTEMPTS=3` (the default), the designated
capable `AUDIT_MODEL`, and a fixed `AUDIT_REASONING_EFFORT`. `AUDIT_ONLY` selects
comma-separated case names and rejects unknown names. Each pass uses a new
output directory, preserving historical runs. Build the candidate first;
`inputs.dirty` distinguishes worktree validation from a clean candidate run.
`inputs.artifactHash` fingerprints the actual built extension when present.

`baseline.json` contains pinned candidate/corpus/config inputs and one
content-free outcome per declared attempt, even when setup or an individual
case throws. `baseline.md` is generated from those rows. To regenerate it,
read `baseline.json`, recompute `summary` with `summarizeBaseline(attempts)`,
and call `renderBaseline`; both functions are in `report.mjs`. Neither
function calls a provider or copies headline scores from old reports.

Verdicts distinguish achieved, false completion, partial (including
interruption and fulfilled-but-unsettled work), safe handoff, unresolved
effect, admission failure, provider failure, infrastructure failure, and
site blockage. End-to-end counts include every declared attempt. The
infrastructure-qualified denominator excludes **only infrastructure failures**;
provider, admission and site failures remain visible. Ranked failures are
computed from the recorded outcomes, with codes when available.

The wire records direct chat, page-reading tools, delegation admission,
planning and runtime execution separately. Token counts are included only
when a provider reports usage. No price configuration is currently defined,
so no cost is estimated. Active/wait times are observed intervals, and
scripted/automatic approvals do not measure a human's decision latency.

Detailed page text and model evidence require `AUDIT_DEBUG_EVIDENCE=1`; this
writes private `local-debug/evidence.json` files inside ignored artifacts.
Do not share these files. Image payloads and credential fields are redacted;
screenshots are not saved. By default only the content-free baseline is saved.
This supersedes the unconditional evidence/screenshot output described above.

The Playwright benchmark retains its existing report format and adds the same
baseline inputs, verdict summary, denominators and failure ranking. Legacy
saved reports remain readable; merging different current candidate/corpus
inputs marks a pass incomplete. Setup failures are recorded by the task's
`afterEach` hook even when its verification callback was never reached.

Validation: `node --test tools/agent-live-benchmark/__tests__/*.test.mjs`, the
repository checks, and the existing Playwright benchmark. A fixture pass is
execution coverage; only the three real-model attempts establish a live baseline.

## Workflow qualification (PR11)

`qualification.mjs` reuses the synthetic runner's **ordinary chat → browser_task
→ production controller** path. It freezes 60 controlled application workflows
in `qualification-corpus.mjs`: 40 development and 20 held-out cases. Each family
has six variants, with its last two held out: research/comparison, multi-page
forms, rich editors, authorized widgets (including a canvas requiring coordinate
input), multi-tab evidence, repeated rows, delayed saves, injection, origin
boundaries and lifecycle faults. The long-history task has four reports behind
four intermediate pages each, exceeding the twelve-step recent-history window.
All mutations affect disposable fixture state; no live accounts or production
records are needed. The independent scorer reads actual entered values, effect
requests, exact record keys, remaining tabs, source facts and the final answer.
The model's verdict and semantic reviewer are never its source of truth.

Freeze prompts/recovery and candidate **before** selecting held-out tasks. The
held-out split is public, operationally separated, not a secret blind test. Do
not tune on its results; change the corpus version and declare a new hold-out
if it is used for tuning. Changing fixtures, tasks or predicates changes the
recorded corpus hash. The baseline also pins the build hash, candidate, policy
source, reasoning effort, automatic-approval policy and time ceilings.

```bash
pnpm build
# Tune on development only; defaults are 3 attempts and the development split.
AUDIT_MODEL=<designated-vision-and-tools-model> AUDIT_REASONING_EFFORT=medium \
  pnpm benchmark:agent:qualification
# After freezing the candidate/configuration, run every task and keep failures.
AUDIT_MODEL=<designated-vision-and-tools-model> AUDIT_REASONING_EFFORT=medium \
  AUDIT_SPLIT=all AUDIT_ATTEMPTS=3 pnpm benchmark:agent:qualification
# Repeat the same candidate/configuration with a distinct second capable model.
AUDIT_MODEL=<second-vision-and-tools-model> AUDIT_REASONING_EFFORT=medium \
  AUDIT_SPLIT=all AUDIT_ATTEMPTS=3 pnpm benchmark:agent:qualification
pnpm benchmark:agent:qualification:matrix <first/qualification.json> <second/qualification.json>
```

Use `AUDIT_ONLY` with exact task IDs for diagnosis; an ID outside the selected
split is rejected. Filtered passes cannot satisfy full-suite evidence coverage.
`qualification.json` retains every declared attempt, including setup failure,
site blockage, admission failure, provider refusal and safe handoff. It reports
both splits, exact missing/duplicate attempt keys, externally adjudicated false
completions, required approvals, unexpected interventions, duplicate effects,
text-canary/egress disclosure and faults that were never exercised. It does not
report a readiness percentage. A fault that was never injected is not a safety
pass. A consent request alone is not a failure. Boundary tasks prohibit accessing
external private content; frame grants outside the task's authorized origins are
not automatically approved. Only the cross-origin widget task authorizes that
second controlled origin.

Run the existing synthetic capability suite and the scripted native-input,
frame-vision, supervision and lifecycle regressions alongside this workflow
suite. Those establish broader operation coverage; this workflow corpus does
not replace them. `node --test tools/agent-live-benchmark/__tests__/*.test.mjs e2e/chromium/benchmark/__tests__/qualification.test.mjs`
checks fixture construction, scorer counterexamples and report integrity in CI.
These **unit results** do not execute the browser agent. The Playwright benchmark
is **scripted browser** coverage; only a real-provider qualification pass is
**live model** evidence. Missing Chromium, unavailable providers and setup faults
remain explicitly invalid attempts. Do not publish unit results as live success.

The matrix command requires two distinct models, three attempts per task, the
whole corpus, clean candidates and a built artifact. It distinguishes matched
settings from best-configured product evidence. It refuses incomplete/unsafe
records; its evidence-completeness result is not the PR12 rollout decision.
Competitor harnesses must run the same task declarations, fixtures and scorer,
retain every attempted task and record their own exact configuration. Do not
compare these workflows to the older thirty-task Nanobrowser report as if the
corpora were matched. A competitor adapter has not been added here.

Limits: text canaries and the controlled external sink detect the specified
cross-origin text/egress violations. They cannot adjudicate pixels inside a
model screenshot; the existing frame masking/vision regressions cover that
boundary separately. No new live-site account suite or unattended execution is
introduced. Retain private debug evidence locally when manually investigating a
false completion; share only the task/attempt, predicate and adjudication label.

## Reliability release process (PR12)

Status: **experimental preview; live qualification pending**. Freeze the exact
clean candidate, corpus and recommended model configuration before examining
held-out results. The predeclared correctness target is at least 90% independently
correct outcomes across three attempts, with development and held-out splits
also required to meet that target. Safe, independently satisfied handoffs count;
provider, admission, site and infrastructure failures remain in the denominator.
Zero observed false completions, duplicate consequential effects and unauthorized
disclosures are required on this finite suite, together with exercised lifecycle
faults. This is not a guarantee about production traffic.

1. Run `pnpm verify`, the CI benchmark/scorer tests, `pnpm docs:build`, both
   production builds and bundle checks. Require CI's critical browser,
   frame-vision and real worker termination gates at this exact commit.
2. On a controlled machine with Chromium and explicitly authorized provider
   credentials, set `AUDIT_SPLIT=all AUDIT_ATTEMPTS=3` and run the qualification
   command above for two distinct tools-and-vision models. Keep all 360 declared
   attempts, including failures; never overwrite a failed pass with a summary.
   Existing per-run token/time ceilings bound inference. Supervise runs and stop
   the process if the provider's separately configured spend budget is reached.
3. Run `pnpm benchmark:agent:release <exact-40-character-SHA> <first/qualification.json>
   <second/qualification.json>`. Save its content-free JSON with the underlying
   reports. It recomputes correctness and p50/p95 active latency from attempt
   rows, validates two-model evidence and rejects another candidate's records.
   A nonzero exit means promotion remains blocked; this does not block an
   explicitly experimental preview package.
4. Review independent false-success and adversarial/fault results. Investigate
   with local private evidence, publishing only content-free adjudication. Do
   not change held-out cases or predicates to make a failure pass. Narrow the
   published supported scope or make a separate fix PR when targets are missed.
5. Before promotion, predeclare latency and dollar budgets, configure explicit
   provider prices and complete usage accounting, and collect a matched PR1
   intervention baseline. Current reports have no configured cost estimate or
   matched workflow baseline, so the command deliberately reports these two
   unresolved blockers even for otherwise correct results. Approvals are not
   unexpected interventions. Neither unknown prices nor unmatched older
   thirty-task results can satisfy these targets.

Continue the existing `release/0.14.0` → willing `preview` testers → `main`
process; keep experimental opt-in. Do not tag or submit stores as part of this
qualification command. The existing release workflow retains its exact-commit
CI/artifact requirements. Publish qualified models/settings and supported
workflows only with reproducible report records. Until then the preview guide
labels supported candidates and pending qualification honestly.

Invite a small willing cohort; let testers explicitly choose whether to share
reports. No new automatic collection is introduced. Stop active runs and disable
Agent to withdraw runtime access. Preserve receipts and unresolved effects;
rollback behavior with a forward-compatible fix, not storage deletion or a
migration-breaking downgrade. This PR changes no persistence schema.
