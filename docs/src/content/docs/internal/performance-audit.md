---
title: Performance Audit
description: Evidence plan for extension startup, streaming, search-cache retention, and embedding-batch latency.
---

This audit is evidence-first. The extension does not collect performance
telemetry. Measurements are isolated benchmark or automated test output, or
manually captured browser traces. The reports contain no prompts, responses,
page content, files, or credentials.

## Current scope

| Item | Question | Current decision |
| --- | --- | --- |
| PERF-07 | Does per-token stream reduction or session-state publication create measurable cost? | Keep reducer/session-state ownership unchanged; retain the benchmark evidence without an unsupported refactor. |
| PERF-02 | Can search results survive page/worker recreation without stale results? | Keep results in memory; retain them with bounded insertion order until a vector-generation invalidation contract exists. |
| PERF-10 | Does the fixed inter-batch wait materially delay ingestion or retrieval? | Yield between batches with no fixed wall-clock delay; provider adapters remain responsible for throttling. |
| PERF-11 | Does the packaged MV3 side panel paint promptly, and can it complete a chat efficiently? | Measure three fresh-profile startups and three deterministic mocked chats on every critical Chromium run; keep the 10-second smoke ceilings and build an environment-matched baseline from 20 CI runs. |

## Reproduce

Run:

```bash
pnpm benchmark:performance
pnpm benchmark:performance:check
```

The diagnostic command reports reducer CPU timing, cache-pruning timing, and
the modeled inter-batch wait for representative batch sizes. The pre-commit
check repeats the CPU measurements and enforces broad p95 tripwires for
processing 10,000 stream events and pruning 1,000 stale cache entries. Those
Node timings catch large local regressions; they are not browser frame-time,
startup, memory, or user telemetry measurements. Use the browser benchmark for
browser and IndexedDB measurements.

The production install-and-boot browser test launches three isolated fresh
profiles and records First Contentful Paint (FCP), DOMContentLoaded, load-event
completion, first rendered app root, Long Task Timing, and packaged JavaScript
size. In each profile it configures a local deterministic Ollama-compatible
server, sends a chat from the extension UI, and measures time to the first
rendered token and to the complete response. The mock sends the same three
chunks with fixed short gaps; it measures browser and extension overhead without
provider or network variability. The report stores the three raw samples and
medians as a Playwright annotation in the existing per-shard `results.json`.
CI retains those artifacts for 30 days and adds no job or browser install.

The 10-second startup and mocked-chat ceilings remain gross hang tripwires. A
relative gate activates when
`tools/benchmarks/extension-performance-baseline.json` is committed. To build
that file, download the `e2e-timings-shard-*` artifacts from 20 distinct successful
CI workflow runs, extract them into one directory, then run:

```bash
pnpm benchmark:extension:performance:baseline -- \
  --output tools/benchmarks/extension-performance-baseline.json \
  artifacts/extension-performance-history
```

The collector deduplicates by workflow run ID, rejects mixed browser/runner
environments, and uses the median and median absolute deviation (MAD) across
run-level medians. The gate permits the largest of 20%, three MADs, or 25 ms
above the baseline median for FCP, app mount, first-token latency, and
complete mocked-chat latency. Until 20 comparable runs are available, measurements stay
report-only; this avoids promoting a local or guessed timing into a CI target.
A browser-major or runner change also returns to report-only until its baseline
is refreshed.

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

The benchmark does not tune behavior automatically. When changing one of the
measured paths, attach repeated diagnostic output and relevant browser traces
to the performance PR or issue.
