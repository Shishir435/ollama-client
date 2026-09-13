# Agent evaluation

Measured results for the supervised browser agent. Every number here came out
of a run; none is a target, a projection or an estimate. Where something is
not known, it says so.

Regenerate with:

```bash
pnpm build && pnpm exec playwright test --project=chromium-agent-benchmark
pnpm exec playwright test --project=chromium-agent-benchmark-dom
```

Both write JSON and a markdown table to `artifacts/e2e/benchmark/`.

## What is measured

Thirty tasks across ten families, frozen: read-and-extract, single-action,
form-preparation, editors, delayed-save, frames, shadow-roots,
canvas-and-visual, multi-tab, dialogs-and-recovery.

Every scorer reads the page. Nothing in the suite scores a task on the run's
own completion summary alone.

Each task declares the page it runs against, the decisions a scripted model
makes, the status it expects to finish in, and — the part a gate does not
have — a predicate that scores it independently of what the run claimed. That
predicate is why false completion can be counted at all: the run's own verdict
cannot be the scorer.

For a task with an effect, the predicate reads the page: the field holds the
value, the document says saved, the status appeared. For a reading task the
deliverable *is* the answer, so the predicate requires the page to state a
fact and the run's answer to carry it — both halves, so a drifted fixture
fails rather than passing vacuously.

The first version of this suite scored several tasks as `Boolean(run.result)`,
which is the model's own completion summary: an accepted completion produced
one by construction, so the scorer agreed with the run every time and could
not have detected the thing it exists to detect. Re-measuring with grounded
predicates did not move any number below — but before the fix, those numbers
were not evidence.

One task had no honest scorer available at all, because its page had no
controls and so nothing it did could be observed. It was rewritten rather
than scored loosely: the run now asks which account, and then has to click
the one it was told, which the page records. Asking is only half the
behaviour worth measuring; acting on the answer is the half that leaves a
mark.

The suite runs twice. Once with the debugger attached, which is the native
input backend, and once against a build with the `debugger` permission
stripped, which is the browser Firefox gives us. The comparison is the point;
neither pass is the reference.

| column | meaning |
| --- | --- |
| completed | the run reported the goal met |
| goal met | the task's own predicate confirmed it from the page |
| false completions | reported complete, predicate says otherwise |
| missed completions | predicate says met, the run never claimed it |

## Results — scripted model, 2026-09-12

One attempt per task per backend. A scripted model is deterministic, so
repetition measures nothing here; `AGENT_BENCHMARK_ATTEMPTS` exists for a live
model, where it does.

| family | n | completed (cdp / dom) | goal met (cdp / dom) | false | missed | median ms (cdp / dom) |
| --- | --- | --- | --- | --- | --- | --- |
| canvas-and-visual | 3 | 3 / 1 | 3 / 1 | 0 / 0 | 0 / 0 | 3981 / 32576 |
| delayed-save | 3 | 3 / 3 | 3 / 3 | 0 / 0 | 0 / 0 | 5874 / 5670 |
| dialogs-and-recovery | 3 | 3 / 2 | 3 / 2 | 0 / 0 | 0 / 0 | 7950 / 3052 |
| editors | 3 | 3 / 3 | 3 / 3 | 0 / 0 | 0 / 0 | 3148 / 3084 |
| form-preparation | 3 | 3 / 3 | 3 / 3 | 0 / 0 | 0 / 0 | 3192 / 3267 |
| frames | 3 | 2 / 2 | 3 / 3 | 0 / 0 | 0 / 0 | 3954 / 3118 |
| multi-tab | 3 | 3 / 3 | 3 / 3 | 0 / 0 | 0 / 0 | 5853 / 3074 |
| read-and-extract | 3 | 3 / 3 | 3 / 3 | 0 / 0 | 0 / 0 | 2837 / 3368 |
| shadow-roots | 3 | 3 / 3 | 3 / 3 | 0 / 0 | 0 / 0 | 3584 / 3201 |
| single-action | 3 | 3 / 3 | 3 / 3 | 0 / 0 | 0 / 0 | 3596 / 3139 |

Totals include the additional report task:

- **native backend** — 30 of 31 attempts reported completion, 31 met the predicate, **0 false completions**, 0 missed.
- **DOM backend** — 27 of 31 attempts reported completion, 28 met the predicate, **0 false completions**, 0 missed.

Source reports:
- `agent-benchmark-1789225000995.json` — cdp, 2026-09-12T14:56:40.987Z.
- `agent-benchmark-1789225227277.json` — dom, 2026-09-12T15:00:27.271Z.

The intentional `srcdoc` permission question meets its predicate without
reporting completion. It is counted as a correct pause, not a missed completion.

## Remaining limits

The native backend met every predicate in this fixture pass. This establishes
coverage of these tasks, not general browser-agent reliability. Delayed-save
completion and native-confirm handling now pass: completion waits only for
readable evidence, and debugger-held dialogs interrupt the renderer wait.

Three DOM-backend tasks remain unmet:

- `canvas-and-visual/click-a-point` and `zoom-then-click` need a screenshot.
  Without a debugger, the visible-tab fallback requires a foreground tab;
  these background fixtures cannot provide one. The run pauses unresolved.
- `dialogs-and-recovery/native-confirm` needs debugger dialog state. The DOM
  backend cannot observe or answer a native dialog that blocks its renderer.

Closed shadow roots and origin-less child frames remain unavailable. The
`srcdoc-cannot-be-read` task deliberately asks the user rather than entering an
unreadable frame. No permission or verification gate was relaxed to improve
these counts.

## Live model sample — 2026-09-12

The seven useful-workflow gates also ran against the existing local
`qwen3.5:latest` model through native Ollama. These are a separate sample from
the thirty frozen benchmark tasks above. One attempt per workflow; no success
rate is inferred from this sample.

Reproduce with a running Ollama server and the model already available:

```bash
pnpm build
AGENT_HOSTED_MODEL=qwen3.5:latest \
AGENT_HOSTED_BASE_URL=http://127.0.0.1:11434 \
AGENT_HOSTED_WIRE=ollama \
pnpm exec playwright test --project=chromium-agent agent-useful-workflows.spec.ts
```

| workflow | outcome | wall ms |
| --- | --- | --- |
| useful-composer-placeholder | passed | 120206 |
| useful-long-edit | passed | 107654 |
| useful-pane-scroll | failed | 214599 |
| useful-paginated-reading | passed | 117519 |
| useful-clarification | passed | 35943 |
| useful-delayed-completion | passed | 30116 |
| useful-native-dialog | passed | 129452 |

**6 of 7 workflows passed.** The pane-scroll attempt chose two coordinate
clicks instead of scrolling. The first was refused; the second produced no
verifiable activation and the run paused unresolved. It did not claim success.
The failure duration includes the harness waiting for expected completion.

Composer lookup, long editing, paginated reading, clarification, delayed saving
and native confirmation completed with independent page assertions. An earlier
six-workflow pass met five, with delayed saving failing on a missing wait
condition. Field-specific repair feedback fixed that case in this pass; the
pane case had passed earlier and failed here. This variation is why a scripted
pass cannot establish model reliability. Timings include browser setup and ran
alongside other validation; they are not a model-performance comparison.

## What is not measured yet

- **A full live-model benchmark.** The thirty frozen tasks have not all run
  against a real model in this revision. `AGENT_HOSTED_MODEL` and
  `AGENT_HOSTED_BASE_URL` select a provider for either benchmark project, and
  `AGENT_BENCHMARK_ATTEMPTS` repeats it. The seven-workflow sample above does
  not replace that evaluation or establish reliability across other models
  and real websites.
- **Tokens across the full benchmark.** Provider counts are recorded when
  available; scripted fixtures report none, so missing values are not zero.
- **Approval counts across backends.** Recorded per family in the JSON, not
  compared here; approval policy does not depend on the input backend.
- **Recovery is a separate gate.** `pnpm verify:sw-agent-recovery` passed all
  five checks after a real service-worker termination, including durable
  unresolved pause and no repeated effect. It is not part of this table.
