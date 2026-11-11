# Engineering reference: persistence

Start with [AGENTS.md](../../AGENTS.md). Preserve ownership, delivery evidence
and user-data compatibility when changing persistence.

## Storage ownership

| Data | Owner |
|---|---|
| Chats, sessions, messages, files, prompts, per-model preferences, durable jobs | SQLite through `src/lib/repositories/chat-history.ts` |
| Vectors, keyword-index source rows, knowledge sets, chunk feedback | Dexie / IndexedDB |
| Settings, provider config/mappings, grants and migration markers | Scoped `chrome.storage` descriptors |
| UI drafts, progress and navigation | Zustand; theme and shortcuts are the documented durable-backed exceptions |

Chat history has one engine and writer: official sqlite-wasm in the persistence
host's worker. `lib/sqlite/db.ts` is an RPC client, not a database handle.
Concrete implementation is in `sqlite-chat-history.ts`; application callers use
the facade. sql.js is measurement-only, never a second shipped engine.
The engine remains separate from the Worker wrapper so tests can drive it in-process.

- Add session metadata through forward-only migrations. Message-subtree deletion
  discovers descendants, repairs the session leaf and deletes rows atomically.
  Clean Dexie vectors afterward using returned ids, idempotently.
- Use `plasmoSyncStorage`, `plasmoDeviceStorage`, or registry-routed accessors.
  Every storage key has a descriptor, scope and reason; runtime message keys
  are not storage keys. Do not restore the ambiguous `plasmoGlobalStorage` handle.
- Application/background services own durable workflows. Components submit intent.
  Never duplicate an owned durable value in another database or UI store.

## Database transport and durability

Whole-database import/export uses raw byte frames and one pre-sized receive
buffer, not a single base64 string. Keep `MAX_DATABASE_BYTES` and the separate
`MAX_INLINE_DATABASE_BYTES` bound for JSON-carried content.

On OPFS, committed statements are durable and `flushSave()` is a no-op. On the
legacy blob backend it forces the debounced image write. Callers flush at unload,
migration and export boundaries without depending on the backend.
A legacy image failing integrity checks stays read-only: preserve reads, backup
and diagnostics; never migrate it or write it back over the rollback artifact.

`space-reclaim.ts` applies startup VACUUM when its free-space thresholds are met.
Do not replace it with repeated `incremental_vacuum` persistence-RPC calls.

## Host startup and write delivery

The Chromium offscreen document / Firefox background page owns the worker.
Report worker error/messageerror causes. Development worker origins are allowed
in CSP only during serve, never in packaged builds.

The host alone selects the backend and rejects client `setBackend` calls.
Failed migration verification resolves onto legacy storage; failure to start
an owner rejects. Owner readiness requires a successful ping, not merely a
resolved `createDocument()`. Cache successful readiness per owner, never failure.

Startup order is lifecycle flags → owner readiness → sequential data-shape
recovery → bounded durable-workflow recovery. DB work awaits the shared readiness
promise and is skipped for that boot if it rejects. Each startup task accepts an
AbortSignal, checks it at mutations, and settles before its successor starts.
Supervisor abort leaves user work resumable, not cancelled.

Retry writes only when the operation is explicitly idempotent (`RETRYABLE_OPS`)
or delivery failed before any bytes were sent (`PersistenceNotDeliveredError`).
Do not claim non-execution after a timeout or lost response. Only the host's
pre-worker startup failure can label its fast path not-delivered; errors from
`callWorker` onward and client-wrapped errors stay owner-error.

`PersistenceError` owns operation, reason, retryability and safe user text.
SQLite's original message travels privately as detail, never as user-facing text.
Keep detail/cause non-enumerable and covered by `PRIVATE_ERROR_KEYS` redaction;
logging follows cause as well as enumerable properties.
Preserve the opt-in sensitivity symbol for values whose provenance, rather than
property name, makes them private.

## Durable rows and lifecycle

Decode durable job rows with Zod and `decodeRow`/`decodeRows`; do not assert bags
of SQL values into typed row collections. `DurableTable` owns table names.
Log only failing paths/codes and row ids, never stored values or Zod messages.

Decode failures are deliberate: turn rows quarantine and permit id-only settlement;
tool-loop rows raise during resume; ingestion and model-pull recovery drop/log
bad rows without denying recovery to the rest. Preserve the real-engine
`durable-row-contract.smoke.test.ts` writer/schema agreement check.

- Every turn status transition uses SQL compare-and-set against
  `TURN_STATUS_PREDECESSORS`. A failed update means no provider work.
- Persist cancelling before aborting. Startup finalizes interrupted cancellation
  without reissuing generation and safely fails undecodable requests.
- Live and recovery execution share a worker-local claim held through cleanup;
  a generating→generating restart CAS alone does not prevent duplicate ownership.
- Terminal status writes compact the resumable request in the same statement,
  including cancellation and quarantine. `getTurnRun` returns no request;
  incomplete-row reads validate it and quarantine prematurely compacted rows.
- Prune terminal receipts by status, not age alone. Retain interrupted user work.
  The `turn_retention` diagnostic reports counts/bytes only; nonzero
  `uncompactedTerminalRuns` needs investigation.
- Preserve structured `AppFailure` from generation through durable state,
  reconnect and UI; do not rebuild it from generic Error text.
- Tool loops checkpoint at model/tool/approval boundaries and force-flush before
  approval waits. Reconnect uses the same request id after worker loss.
- Opaque signed thinking and reasoning_details stay in versioned, size-capped
  replay artifacts, separate from display thinking. Preserve order, validate
  provider/model ownership, and never render or log opaque contents.

OPFS behavior needs `pnpm verify:opfs-migration`; unit tests exercise the legacy
backend in-process. Browser lifetime and worker termination need their packaged
browser gates, not a mocked Worker claim.
