---
title: Performance Audit
description: Evidence plan for streaming, search-cache retention, and embedding-batch latency.
---

This audit is evidence-first. The extension does not collect performance
telemetry. Measurements are local benchmark output or manually captured
browser traces that contain no prompt, response, page, file, or credential
data.

## Current scope

| Item | Question | Current decision |
| --- | --- | --- |
| PERF-07 | Does per-token stream reduction or session-state publication create measurable cost? | Profile first; do not change session-state ownership from a hypothesis. |
| PERF-02 | Can search results survive page/worker recreation without stale results? | Keep the cache in memory until a vector-generation invalidation contract exists. |
| PERF-10 | Does the fixed inter-batch wait materially delay ingestion or retrieval? | Measure provider time, indexing time, and retrieval quality before changing the delay. |

## Reproduce

Run:

```bash
pnpm benchmark:performance
```

The command reports reducer CPU timing, cache-pruning timing, and the modeled
inter-batch wait for representative batch sizes. It is a guard against making
claims from a single trace; compare repeated runs on the same browser/runtime
and corpus shape.

## Measurement rules

- PERF-07 must compare first-token latency, token-to-token cadence, dropped or
  stale events, and terminal publication latency. A session-state refactor is
  justified only if it improves a measured bottleneck without weakening the
  durable turn or reconnect contract.
- PERF-02 must measure hit rate, retained-entry count, stale-result risk, and
  rehydration cost. Persisting entries without a vector-generation or index
  revision would make a fast stale answer possible, so no persistence change is
  included yet.
- PERF-10 must record provider batch duration, inter-batch wait, total ingest
  duration, retrieval latency, and retrieval-quality checks. A zero-delay or
  adaptive policy needs cancellation, rate-limit, and provider-failure tests.

The benchmark is intentionally diagnostic rather than an automatic tuning
loop. Results should be attached to the performance PR or issue that proposes
the behavior change.
