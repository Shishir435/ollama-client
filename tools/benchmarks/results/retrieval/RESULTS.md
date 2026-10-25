# Retrieval and browser measurements

Baseline: `21cd8c1c` (`release/0.15.0`). This is the checkout supplied for this
change, including the recent storage-accounting, bounded top-K, ingestion and
index-fence fixes. Comparing against an older implementation would incorrectly
credit this change for fixes it did not make.

## Reproduction

Use Node 24.18.0 and the frozen pnpm lockfile. Build model assets once; subsequent
runs use the hash-verified `.cache/bundled-embeddings` files and packaged runtime.
The browser never downloads a model, tokenizer or executable asset.

```sh
pnpm install --frozen-lockfile
pnpm benchmark:build
pnpm benchmark:retrieval --label=working-tree --output=artifacts/retrieval/after.json
pnpm benchmark:retrieval:quality
pnpm exec playwright test --project=chromium-persistence
```

To reproduce the comparison, create a separate checkout of `21cd8c1c`, install
its frozen dependencies, and copy only `src/entrypoints/persistence-verify/retrieval-{benchmark,quality}.ts` plus the
`retrievalBenchmark`/`retrievalQuality` hook additions in
`src/entrypoints/persistence-verify/main.ts` into it. No production retrieval,
provider, storage or indexing code is patched in that checkout. Build it with
`pnpm benchmark:build`, then run the current runner with
`--build=/absolute/baseline/build/chrome-mv3-benchmark --label=21cd8c1c`.
Use the same machine/browser, close other workloads, and run baseline and changed
build sequentially. Raw reports include the fixture SHA-256, browser identity,
timestamp, source label and all samples. The runner's `revision` is its own
checkout's HEAD, while `sourceLabel` identifies the separately built input.

The local comparison used a Git archive of that revision with existing frozen
node_modules and verified model assets shared from this checkout. Both builds
used the identical benchmark source. Build-time asset setup is excluded from
query timings. The baseline also consumes the amended verification harness;
this is instrumentation, not a production-code change.

## Method and limits

Each corpus starts with 1,000 or 5,000 synthetic rows, 384 dimensions, original
and normalized vectors, and approximately 1.9K characters of content per row.
Graph level sampling uses an LCG seeded with 731 (restored after build).
The exact reference is read again after admission so it sees the identical graph
corpus; admission vectors are antipodal to the query, avoiding tied top-10 slots.
There are 100 file scopes; the measured scope holds 10 or 50 rows. Fifteen
quota-aware admissions follow the exact-search samples, so the later graph has
1,015 or 5,015 elements. Results are capped at ten; the search-result cache is
cleared before every timed sample. Exact and scoped paths are warmed once;
settings and the browser process are warm. Timings include real IndexedDB reads,
filtering and production search, but exclude embedding inference. Quality
fixtures separately exercise real bundled inference.

Median and nearest-rank p95 come from 15 samples per query/admission/statistics
operation. Seed, index build, deletion and quota eviction are one sample per
size: useful counts and observations, not robust statistical estimates.
Quota admission uses a 100 MiB limit and a 1,000-row per-file limit; eviction
then reduces the maintained total to 1 MiB. Byte totals are the production
estimator (UTF-8 content/metadata, float32 vector payloads and row allowance),
not browser disk allocation. Storage estimates do not include all IDB overhead.

`usedJSHeapSize` is sampled in the extension page without forced GC. It is a
browser JS heap observation, not peak memory, retained size, WASM linear memory,
offscreen-worker memory or process RSS. Graph `memorySizeMB` counts float32
vector payload only, excluding graph edges and JS overhead. Keyword memory is
also a heuristic, excluding MiniSearch internals. No Node/fake-indexeddb timing
or heap value is substituted for these browser measurements. Graph construction
and generation-triggered keyword rebuilding still materialize corpus data;
the change bounds query retention and hydrates graph candidate rows only.

HNSW has no scope predicate before top-K. Scoped searches therefore use the
indexed exact cursor. Unscoped graph search hydrates only bounded candidates;
a missing or foreign embedding-partition candidate forces exact filtering.
Production RAG supplies explicit embedding model/provider partitions, which
currently disable HNSW eligibility. These graph timings exercise the supported
unscoped default-embedding search seam; they do not claim that bundled RAG
queries use HNSW. Recall against exact top-10 is recorded for the synthetic query, not claimed
for arbitrary corpora or semantic relevance. Fallback backend statistics now
say `bruteforce` when that is the algorithm actually used.

The quality record checks answer-bearing evidence, source isolation, an
unanswerable question with its answer seeded only in the excluded set, a positive
control proving that answer is retrievable there, and the abstention instruction, a corrected
canonical user preference, long-message tail indexing, assistant attribution
as unverified, deleted content, original-scope replay and refusal after source
deletion. It does not evaluate generated-answer correctness or prove that a
model will abstain. The provider-wire test verifies actual received prompt
bytes against the accepted receipt, using a deterministic loopback provider.

Streaming measurements count assistant UPDATE statements using a temporary
SQLite trigger in the sole production OPFS owner. They are not physical VFS
write counts. Delivery bytes are UTF-8 JSON received by one real runtime-port
observer, excluding IPC framing and any other listeners. Finalization lag uses
the trigger timestamp relative to the last received stream content event;
provider-end-to-completed timing includes polling and RPC overhead.

The large-history fixture carries 36 synthetic 1.5 MiB image attachments through
the real repository/messaging/OPFS path and backup export/import, then opens the
side panel and verifies its message is visible. It tests transport and chat
opening; the synthetic bytes do not establish valid-image decoding performance.

## Validation environment

Local Chromium uses a packaged benchmark build loaded as an unpacked extension,
the production sqlite-wasm worker/OPFS owner and real extension messaging. The
quality embedding route uses the offscreen worker and typed embedding RPC.
Firefox production/benchmark builds and both bundle checks are run locally.
Local Firefox WebDriver execution is blocked: system Firefox 157.0.1 exits with
status 1 during launch; the installed Playwright Firefox times out reading the
Marionette port. No local Firefox runtime results are claimed. The maintained
Firefox CI OPFS runner now executes the same retrieval and large-backup seams;
its hosted run passed on the same production code; see the evidence below.

## Recorded results

Raw browser reports: [baseline](baseline.json), [changed](after.json). Both use
fixture SHA-256 `4411e9994c3e0408388afc6544be3628dd743fa947b9c07280ae456b3017ad97`.
These sizes represent approximately 5 and 25 MiB of estimated vector storage,
within the default 100 MiB quota; they do not establish behavior at 100K rows.

All times are milliseconds; arrows mean baseline → changed.

| Operation | 1,000 rows | 5,000 rows |
| --- | ---: | ---: |
| Exact search median | 33.3 → 18.7 | 308.3 → 143.8 |
| Exact search p95 | 41.2 → 22.4 | 325.6 → 170.8 |
| Indexed scoped exact median | 0.7 → 0.7 | 2.4 → 2.0 |
| Unscoped HNSW median | 19.0 → 4.0 | 90.7 → 13.0 |
| Unscoped HNSW p95 | 25.7 → 4.4 | 117.7 → 14.5 |
| Scoped query with HNSW enabled, median | 1.1 → 0.7 | 1.9 → 2.0 |
| Quota-aware admission median | 0.6 → 0.6 | 0.9 → 0.6 |
| Maintained statistics median | 0.0 → 0.1 | 0.1 → 0.1 |
| Scoped keyword search median | 0.4 → 0.5 | 2.4 → 2.2 |
| Scoped hybrid search median | 1.5 → 1.5 | 4.4 → 5.1 |
| Keyword build (one sample) | 91.2 → 81.6 | 482.4 → 526.8 |
| HNSW build (one sample) | 4011.6 → 4007.0 | 22447.2 → 23088.6 |
| File deletion (one sample) | 24.2 → 6.2 | 86.2 → 9.0 |
| Quota eviction (one sample) | 64.3 → 62.2 | 403.6 → 478.1 |

Unscoped graph recall@10 remains 0.9 at 1K and 1 at 5K. Scoped recall@10 improves
from 0.1 to 1.0 at both sizes: the baseline graph returns one in-scope row
after global top-K; the changed implementation returns the exact ten scoped
rows. This is a correctness improvement, not merely a faster approximate query.
The measured graph backend is `ts-hnsw` in both builds. Retained results are ten.

| Browser JS heap sample | 1,000 rows (MiB) | 5,000 rows (MiB) |
| --- | ---: | ---: |
| Before seeding | 12.0 → 12.2 | 48.7 → 52.8 |
| After seeding | 28.4 → 28.4 | 105.3 → 123.4 |
| After indexes and queries | 33.2 → 36.1 | 123.7 → 181.6 |

The changed post-index heap sample is **higher**, especially at 5K. These
non-GC-controlled observations do not establish a retained-memory or peak-memory
improvement. Query code no longer retains a corpus-sized array, but index
construction still does, and GC timing prevents attributing these heap samples
to that change alone. No WASM/process-memory improvement is claimed. Keyword
build, hybrid queries and quota eviction are not consistently faster; their
full measurements are retained rather than omitted.

At 1,000 rows the estimator reports 5,231,683 bytes, including 3,072,000 bytes of float32 vector payload. File deletion removes 10 rows; counts change 1015 → 1005. Eviction leaves 205 rows at 1,043,616 estimated bytes.

At 5,000 rows the estimator reports 26,167,283 bytes, including 15,360,000 bytes of float32 vector payload. File deletion removes 50 rows; counts change 5015 → 4965. Eviction leaves 205 rows at 1,043,995 estimated bytes.

## Eager page budgets

The same AST-based static-import walk was used on baseline and changed builds.
It includes HTML, emitted entry scripts, transitive static imports/re-exports,
stylesheets and explicit modulepreloads, deduplicating each file per page. It
excludes `import()` edges and icons. Gzip totals sum each resource separately.
All existing ceilings remain unchanged.

| Target/page | Baseline gzip bytes | Changed gzip bytes | Ceiling | Headroom |
| --- | ---: | ---: | ---: | ---: |
| chrome Side panel | 716,138 | 630,073 | 650,000 | 19,927 |
| chrome Options | 473,736 | 364,270 | 440,000 | 75,730 |
| firefox Side panel | 703,017 | 620,268 | 650,000 | 29,732 |
| firefox Options | 462,603 | 358,463 | 440,000 | 81,537 |

Chrome: total 49,055,773 bytes; ZIP 23,628,793 bytes.
Firefox: total 50,507,846 bytes; ZIP 24,367,049 bytes.

Markdown parsing/image controls now load when chat content is rendered; escaped
plain text is the loading fallback. Advanced prompt editing loads when its
settings section is mounted. Registry explanations remain in development/tests
and source, while production keeps routing scopes without descriptor prose.
The Vite manifest range is aligned with the existing pinned override/lockfile
(8.1.6); no installed dependency version changes.


## Production persistence evidence

[Quality](quality.json): all 19 checks pass, including a one-row real bundled
migration preserving maintained counts/bytes. This is a migration seam check,
not a large-corpus migration throughput claim.

[Streaming](streaming.json), three samples of 1,000 provider tokens / 16,000
characters: each produces 10 assistant UPDATE statements, 1,001 observer events
and 82,973 JSON bytes. Trigger-measured finalization lag is 5.0–7.0 ms;
provider-end-to-observed completion is 17–30 ms. Every accepted source excerpt
is present in the actual captured provider request. The local provider is
deterministic and does not measure any real provider's inference throughput.

[Large history/backup](images.json): 56,623,104 image attachment bytes produce a
57,073,664-byte backup, restore successfully, and open in the side panel.
The measured round trip is 5,279 ms; opening the chat is 3,383 ms. These are
single observations, not medians. [Worker recovery](worker-recovery.json)
passes all three gates, including killing the original MV3 service worker and
observing exactly one recovery in its replacement. The critical browser suite
also passes cancellation/reconnect, approval checkpoint restart, source
isolation and migration/backup integrity scenarios (11 tests).

Validation passed locally: typecheck, lint, formatting, full unit/integration
suite, focused scope/accounting tests, both production builds/packages and
bundle checks, both benchmark builds, browser manifest/CSP smoke, the retrieval
commands, existing Node CPU and historical persistence benchmark commands, and
the Chromium persistence/service-worker gates. Node benchmark results are not
used as evidence for production persistence or browser memory. Firefox runtime
launch remains blocked as documented above; hosted Firefox evidence is recorded below.


## Hosted Firefox evidence

[Firefox CI report](firefox-ci.json) records the successful packaged MV2/OPFS
run on [the hosted job](https://github.com/Shishir435/ollama-client/actions/runs/40202671076/job/121197303790).
It passed the original 18 quality checks, measured both 1K and 5K corpora with
scoped recall@10 of 1.0, and restored 56,623,104 attachment bytes from a
60,272,640-byte backup. Its page-heap fields are null because that browser does
not expose `usedJSHeapSize`; no replacement memory metric is inferred.
This precedes the extra excluded-answer positive control, which is included
in the separate, locally verified 19-check quality record.
