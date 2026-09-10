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

Each task declares the page it runs against, the decisions a scripted model
makes, the status it expects to finish in, and — the part a gate does not
have — a predicate that reads the page afterwards to say whether the goal was
actually met. That predicate is why false completion can be counted at all:
the run's own verdict cannot be the scorer.

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

## Results — scripted model, 2026-09-10

One attempt per task per backend. A scripted model is deterministic, so
repetition measures nothing here; `AGENT_BENCHMARK_ATTEMPTS` exists for a live
model, where it does.

| family | n | completed (cdp / dom) | goal met (cdp / dom) | false | missed | median ms (cdp / dom) |
| --- | --- | --- | --- | --- | --- | --- |
| canvas-and-visual | 3 | 3 / 1 | 3 / 1 | 0 / 0 | 0 / 0 | 2879 / 32531 |
| delayed-save | 3 | 2 / 2 | 3 / 3 | 0 / 0 | 1 / 1 | 6441 / 6472 |
| dialogs-and-recovery | 3 | 2 / 2 | 2 / 2 | 0 / 0 | 0 / 0 | 2918 / 2904 |
| editors | 3 | 3 / 3 | 3 / 3 | 0 / 0 | 0 / 0 | 2913 / 2943 |
| form-preparation | 3 | 3 / 3 | 3 / 3 | 0 / 0 | 0 / 0 | 2923 / 2950 |
| frames | 3 | 2 / 2 | 3 / 3 | 0 / 0 | 0 / 0 | 2848 / 2970 |
| multi-tab | 3 | 2 / 2 | 2 / 2 | 0 / 0 | 0 / 0 | 4402 / 4330 |
| read-and-extract | 3 | 3 / 3 | 3 / 3 | 0 / 0 | 0 / 0 | 2654 / 2630 |
| shadow-roots | 3 | 3 / 3 | 3 / 3 | 0 / 0 | 0 / 0 | 2895 / 2941 |
| single-action | 3 | 3 / 3 | 3 / 3 | 0 / 0 | 0 / 0 | 2922 / 2945 |

Totals, including the task that writes the report:

- **native backend** — 27 of 31 attempts reported completion, 29 met the
  predicate, **0 false completions**, 1 missed.
- **DOM backend** — 25 of 31 reported completion, 27 met the predicate,
  **0 false completions**, 1 missed.

### The measured capability gain

`canvas-and-visual` is the only family the two backends disagree on: 3 of 3
with the debugger, 1 of 3 without, and a median that goes from 2.9 seconds to
32.5 seconds because the two failing attempts spend their time stalling. The
cause is direct — no debugger means no `Page.captureScreenshot`, the
visible-tab fallback needs the controlled tab to be frontmost and it is not,
so no picture travels, `click_point` and `zoom` are never offered, and a task
that can only be done visually cannot be done.

Nothing else differs. The other nine families use semantic targets, and a
semantic target resolves the same either way — which is the design working,
not a null result: native input exists for the gestures a page can tell
apart, and none of these tasks needs one.

## Remaining failures

Named rather than rounded away. Each is reproducible from the suite.

1. **A click that opens a native dialog cannot be settled.**
   `dialogs-and-recovery/native-confirm` pauses with `unresolved_effect` on
   both backends. The click's own handler calls `confirm()`, which blocks the
   renderer, so the action can neither finish nor be confirmed and the run
   pauses before it ever sees the dialog it caused. Dialogs the run finds
   already open are handled; one its own click raises is not. The
   file-chooser case has a receipt flag for exactly this shape
   (`AgentExecutionReceipt.fileChooser`) and a dialog needs the equivalent.
2. **`multi-tab/go-back` fails with `verification_failed` on both backends.**
   Not yet diagnosed. Recorded rather than guessed at.
3. **An over-claiming run can exhaust its budget instead of recovering.**
   `delayed-save/claims-before-it-lands` claims completion the moment Save is
   pressed. The claim is correctly refused every time — 0 false completions is
   the whole point — but the run spends its no-progress budget repeating it and
   fails, on a page that did save. It is counted as a missed completion, which
   is the honest label: the opposite error to a false one, and a real failure.

## What is not measured yet

- **A live model.** Every number above is from a scripted model, so it
  measures the runtime and not model capability. `AGENT_HOSTED_MODEL` and
  `AGENT_HOSTED_BASE_URL` point the same suite at a real provider, and
  `AGENT_BENCHMARK_ATTEMPTS` repeats it; no live pass has been published here.
- **Tokens.** Read from the provider's own counts when it reports them
  (`prompt_eval_count`, `eval_count`), which a scripted fixture does not, so
  the columns are empty above rather than zero. Nothing is estimated.
- **Approval counts across backends.** Recorded per family in the JSON, not
  yet compared; the two passes ask the same approvals because policy does not
  depend on the backend.
- **Recovery under real worker loss.** Covered by
  `pnpm verify:sw-agent-recovery`, which kills a service worker for real, and
  is a gate rather than a measurement — it belongs to the recovery gates, not
  to this table.
