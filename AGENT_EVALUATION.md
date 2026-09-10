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

## Results — scripted model, 2026-09-10

One attempt per task per backend. A scripted model is deterministic, so
repetition measures nothing here; `AGENT_BENCHMARK_ATTEMPTS` exists for a live
model, where it does.

| family | n | completed (cdp / dom) | goal met (cdp / dom) | false | missed | median ms (cdp / dom) |
| --- | --- | --- | --- | --- | --- | --- |
| canvas-and-visual | 3 | 3 / 1 | 3 / 1 | 0 / 0 | 0 / 0 | 2887 / 32454 |
| delayed-save | 3 | 2 / 2 | 3 / 3 | 0 / 0 | 1 / 1 | 6448 / 6394 |
| dialogs-and-recovery | 3 | 2 / 2 | 2 / 2 | 0 / 0 | 0 / 0 | 2959 / 2911 |
| editors | 3 | 3 / 3 | 3 / 3 | 0 / 0 | 0 / 0 | 2920 / 2934 |
| form-preparation | 3 | 3 / 3 | 3 / 3 | 0 / 0 | 0 / 0 | 2908 / 2938 |
| frames | 3 | 2 / 2 | 3 / 3 | 0 / 0 | 0 / 0 | 2887 / 2942 |
| multi-tab | 3 | 3 / 3 | 3 / 3 | 0 / 0 | 0 / 0 | 2933 / 2954 |
| read-and-extract | 3 | 3 / 3 | 3 / 3 | 0 / 0 | 0 / 0 | 2903 / 2691 |
| shadow-roots | 3 | 3 / 3 | 3 / 3 | 0 / 0 | 0 / 0 | 2936 / 2918 |
| single-action | 3 | 3 / 3 | 3 / 3 | 0 / 0 | 0 / 0 | 2911 / 2906 |

Totals, including the task that writes the report:

- **native backend** — 28 of 31 attempts reported completion, 30 met the
  predicate, **0 false completions**, 1 missed.
- **DOM backend** — 26 of 31 reported completion, 28 met the predicate,
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

One earlier entry is gone: `multi-tab/go-back` failed with
`verification_failed` on both backends and is fixed. A tab commits
`about:blank` before its first page, so backing to the start of a run's own
history reached the destination parser as a non-HTTP URL and threw an error
the resolution mapper has no case for — the run died labelled with a code
about page effects, for a command that never touched the page. Such an entry
is now refused as an unreadable destination, in the same terms an unknown one
is. The history itself still records every entry the browser does: it is
walked by index, and dropping one would leave the run predicting one page
while the browser went to another.

1. **A click that opens a native dialog cannot be settled.** Still open.
   `dialogs-and-recovery/native-confirm` pauses with `unresolved_effect` on
   both backends. The click's own handler calls `confirm()`, which blocks the
   renderer, so the action can neither finish nor be asked what it delivered,
   and the run pauses before it ever sees the dialog it caused.

   The diagnosis is sharper than it was, and it rules out the obvious fix.
   Recording the dialog on the receipt after the action — the way a file
   chooser is recorded — cannot work: the control port has no timeout, so the
   page-side call that follows a native click waits forever on a renderer
   blocked in `confirm()`, and nothing after it runs. The step burns its full
   budget there. Any fix has to stop waiting on the page once a dialog is
   known to be holding it, which means the executor learning about the dialog
   from the debugger rather than from the document — the same principle the
   observation path already follows, where a blocked page is observed as
   blocked rather than asked. That is not attempted here, and no partial
   machinery for it is shipped.
2. **An over-claiming run can exhaust its budget instead of recovering.**
   `delayed-save/claims-before-it-lands` claims completion the moment Save is
   pressed. The claim is correctly refused every time — 0 false completions is
   the whole point — but the run spends its no-progress budget repeating it and
   fails, on a page that did save. It is counted as a missed completion, which
   is the honest label: the opposite error to a false one, and a real failure.

## What is not measured yet

- **A live model.** Every number above is from a scripted model, so it
  measures the runtime and not model capability. `AGENT_HOSTED_MODEL` and
  `AGENT_HOSTED_BASE_URL` point the same suite at a real provider and
  `AGENT_BENCHMARK_ATTEMPTS` repeats it. That path is exercised — one task run
  against `qwen3.5:latest` through Ollama completed and scored, taking 3.6
  minutes where the scripted model takes 2.7 seconds — but no live table is
  published here. At that rate a full pass is hours, and mixing measured
  runtime numbers with a partial capability sample would make the table say
  less than it appears to.
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
