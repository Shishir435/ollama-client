# `0.13.0` release evidence

Recorded for the H8 gate in `RELEASE_ROADMAP.md`. Two halves: automated gates,
which run here and are reproducible, and `preview` soak, which needs a browser
and a person driving it.

Nothing in this file is a claim about behavior that was not observed. A row
that was not run says so.

## Automated gates

Run on `release/0.13.x` at `4e191b6f`, 2026-08-11, macOS 15 (darwin 25.6.0),
Node via pnpm, Chromium via Playwright.

| Gate | Result |
| --- | --- |
| `pnpm typecheck` | pass |
| `pnpm lint:check` | pass |
| `pnpm check:dead` | pass |
| `pnpm check:i18n` | pass (9 locales, 0 missing of 1451) |
| `pnpm test:run` | pass (341 files, 2852 tests) |
| `pnpm check:generated` | pass |
| `pnpm check:compatibility` | pass (8 ledger entries valid) |
| `pnpm docs:build` | pass (82 pages) |
| `pnpm build` | pass (chrome-mv3-prod) |
| `pnpm build:firefox` | pass (firefox-mv2-prod) |
| `pnpm bundle:check` | pass |
| `pnpm bundle:check:firefox` | pass |
| `pnpm verify:opfs-migration` | pass |
| `pnpm verify:firefox-opfs-migration` | pass |
| `pnpm e2e:chromium:critical` | pass |

The two migration verifiers are the ones that matter most for this release:
they are what proves official sqlite-wasm reads a database the retired sql.js
engine wrote. See "Engine change" below.

## Preview soak — NOT YET RUN

Every row below is unverified until someone records a result. Load the
unpacked `build/chrome-mv3-prod` (and `build/firefox-mv2-prod`) and work
through them.

### Chromium

| # | Scenario | How to drive it | What must hold | Result |
| --- | --- | --- | --- | --- |
| 1 | Cold start | Reload the extension, open the side panel | Panel paints, model list loads, no unhandled rejection in the worker console | |
| 2 | Worker termination mid-stream | Start a long answer, then stop the service worker from `chrome://extensions` | On reconnect the assistant text resumes from where it was, not from empty; no duplicate provider request | |
| 3 | Stop during stream | Press stop mid-answer | Bubble settles as stopped; after a reload the turn is `cancelled`, not offered as a retry | |
| 4 | Stop during tool loop | Ask something that calls a tool, stop mid-loop | Same as 3, and the tool loop does not resume on the next boot | |
| 5 | Approval wait | Trigger a tool needing approval, kill the worker while the prompt is open | The prompt is still there after restart and approving still completes the turn | |
| 6 | Owner recreation | Close the offscreen document from `chrome://extensions` (or wait for churn), then send a message | The request completes; at most one retry; no 30s hang | |
| 7 | Backup import interruption | Start a large backup import, reload the extension mid-import | Recovery either completes or rolls back; history is never partially replaced | |
| 8 | Catalog-less provider | Add a chat-only OpenAI-compatible endpoint with a declared model id | Model appears in the menu; the catalog endpoint is requested once, not per turn | |

### Firefox MV2

| # | Scenario | What must hold | Result |
| --- | --- | --- | --- |
| 9 | Persistent-background ownership | Chat works with the background page as owner; no second writer | |
| 10 | Migration fallback | A profile that fails verification serves from the legacy blob rather than erroring | |
| 11 | Restart recovery | Interrupted turns resume after a browser restart | |
| 12 | Cancellation | Stop is durable across a restart | |
| 13 | Import/export | Backup round-trips | |

### Cross-cutting, watch throughout

| Condition | Where it would show | Result |
| --- | --- | --- |
| No duplicate provider call | Provider logs / network panel during 2, 6 | |
| No terminal-state regression | A completed turn never returns to generating | |
| No stuck transaction | Diagnostics `chat_repository` keeps passing | |
| Bounded turn-row growth | Diagnostics `turn_retention`: `uncompactedTerminalRuns` is 0 | |
| No raw sensitive logging | Console shows no SQL text, no API key, no page/file body | |
| No unauthorized persistence request | No "Persistence request forbidden" from a legitimate context | |

### Diagnostics bundle

Copy a bundle and confirm it records owner startup, migration, durable
recovery and compaction evidence, and that it contains no chat, page or file
content and no credentials.

| Check | Result |
| --- | --- |
| Records the four evidence areas | |
| Contains no content or credentials | |

## Engine change: sql.js retired

`0.13.x` removed sql.js from the shipped bundle. Worth stating precisely,
because it is easy to confuse with a different decision that is still gated.

**What changed:** the legacy blob is now read by official sqlite-wasm instead
of sql.js. One engine, one writer.

**What did not change:** whether history may be served from the blob at all.
That is `legacy-blob-live-fallback` in `compatibility-ledger.json`, whose
evidence window opened 2026-07-31 and runs 2-3 months, targeting `0.14.x`. It
is still open, and `0.13.0` does not close it — the fallback still ships, the
source blob is still retained untouched, and `persistence_legacy_override_v1`
still serves history from it on demand.

So the wait applies to removing the fallback, not to this release. The risk
`0.13.0` does carry is narrower: sqlite-wasm reading a file sql.js wrote. Both
write the same on-disk format, a damaged image is served read-only rather than
migrated, and the two migration verifiers exercise old-topology fixtures — which
is the one job sql.js is still kept as a devDependency to do.

## Promotion

`release/0.13.x` → `preview` → `main`. Promote only when every soak row above
has a recorded result and the 9+/10 criteria in `RELEASE_ROADMAP.md` hold.
