# End-to-End Testing Plan

## Purpose

This plan turns the repository's existing browser-verification scripts into a
small, deterministic release gate. Initial scope protects the critical
`0.12.5` storage cutover. Coverage expands in `0.12.6` to every historical
storage generation that still has active users.

This is an execution plan for the testing findings in
`FROM_SCRATCH_ARCHITECTURE_AUDIT.md`. The audit owns the architectural
requirement; this document owns fixtures, suites, rollout, and exit criteria.

## Current status

- `0.12.4` is the current store release.
- The `0.12.5` preparation branch was reported merged into `preview`, but the
  fetched remote ref did not yet contain its head when implementation started.
- The next implementation branch should start from the latest `preview`.
- The repository already has:
  - packaged Chromium OPFS migration automation;
  - packaged Firefox OPFS migration automation through Selenium/geckodriver;
  - Chromium extension UI and provider automation;
  - MV3 service-worker termination spikes;
  - manifest/CSP smoke checks;
  - Vitest coverage for repository and migration internals.
- Real-browser tests are standalone scripts and are not part of normal CI or
  release publication.

### Implementation status — 2026-07-28

- Work started on `feature/e2e-critical-path` from the exact `0.12.5`
  preparation head (`e879d390`).
- Remote `preview` was still at `9ae347b6` and did not contain that head when
  the branch was created. Rebase onto `preview` after its remote ref catches
  up.
- Playwright Test runner and restartable Chromium extension fixture are in
  place.
- Store production build install/boot is covered.
- Fresh OPFS restart durability is covered.
- Current sql.js-to-OPFS migration, idempotence, post-migration writes, backup
  export, and rollback-blob SHA-256 preservation are covered.
- Existing Chromium and Firefox migration verifiers now enforce rollback-blob
  SHA-256 preservation instead of checking byte length alone.
- Next implementation slice: committed fixture manifest and expanded durable
  relationship assertions, followed by CI integration.

## Outcome

Before `0.12.5` reaches the stores, one command should prove:

```text
build production extension
  -> install it in a clean browser profile
  -> load representative existing sql.js data
  -> migrate into OPFS
  -> verify complete durable data
  -> restart browser
  -> verify data again
  -> write through the normal repository
  -> restart browser
  -> verify old and new data
  -> export a valid backup
```

For `0.12.6`, the same gate should cover historical Dexie-only and mixed-source
profiles.

## Guiding decisions

1. Use real production builds, not a test-only application substitute.
2. Use Playwright Test as the Chromium runner.
3. Keep Selenium/geckodriver for real Firefox extension installation.
4. Keep Vitest for fast domain, schema, repository, and UI tests.
5. Use local deterministic fixture servers; normal CI must not require Ollama,
   external providers, live websites, or secrets.
6. Verify user-visible outcomes and durable data. Inspect internal state only
   where migration correctness cannot otherwise be proven.
7. Test storage generations, not every published version.
8. Preserve historical source stores after migration and after failed tests.
9. Build once, test that exact output, then package that exact output.
10. Start with a small blocking suite. Add breadth only after it stays reliable.

## Non-goals for the first E2E branch

- Full settings-page coverage.
- Every locale and theme.
- Pixel-perfect visual regression.
- Every provider implementation.
- Live Ollama as a required CI dependency.
- Browser permission-dialog automation.
- Browser-agent click/type workflows.
- Complete Firefox UI parity.
- Replacing Vitest tests with browser tests.
- Refactoring persistence production code unless a test exposes a release
  blocker.
- Supporting historical Dexie migration in `0.12.5`; that production change
  remains `0.12.6` work.

## Branch preparation

Do this only when ready to start implementation:

```bash
git fetch origin
git checkout preview
git pull --ff-only origin preview
git checkout -b feature/e2e-critical-path
```

Before switching, preserve any uncommitted audit or plan files. Do not mix
unrelated product changes into the E2E branch.

Record the base commit in the first E2E pull request description. All fixtures
must be reproducible from committed source or documented historical tags.

## Test layers

### Layer 1: fast tests

Runner: Vitest.

Keep responsibility for:

- schema migration functions;
- source detector decisions;
- deterministic merge rules;
- repository behavior;
- validation and safe error contracts;
- React component behavior;
- mocked permission branches;
- malformed record handling.

These tests run on every pull request.

### Layer 2: build-contract smoke

Runner: existing `tools/verify-browser-smoke.ts`.

Keep responsibility for:

- correct Chrome and Firefox manifest versions;
- required extension pages;
- content-script declarations;
- background entrypoints;
- CSP tokens;
- expected permissions;
- required packaged assets.

This should run on every pull request after both production builds.

### Layer 3: Chromium packaged-extension E2E

Runner: Playwright Test using bundled Chromium and a persistent context.

Responsibility:

- actual extension installation;
- MV3 service-worker startup;
- extension-page mounting;
- content-script injection on local fixture pages;
- real IndexedDB and OPFS behavior;
- sql.js-to-OPFS migration;
- browser restart and service-worker restart;
- runtime messaging and repository access;
- backup export.

This is the main blocking browser suite.

### Layer 4: Firefox packaged-extension E2E

Runner: Selenium WebDriver with geckodriver and a temporary installed XPI.

Responsibility:

- real Firefox MV2 installation;
- background-page owner behavior;
- real IndexedDB and OPFS behavior;
- sql.js-to-OPFS migration;
- full browser restart with the same profile;
- backup export.

Firefox should remain a separate adapter. Do not pretend a Playwright-served
HTML page is a Firefox extension test.

### Layer 5: optional environment integration

Runner: Playwright/Selenium, manual or scheduled.

Responsibility:

- real Ollama connectivity;
- one real streaming response;
- selected platform-specific behavior;
- longer lifecycle and performance checks.

Failure here should not block ordinary pull requests until the environment is
fully controlled.

## Proposed repository layout

```text
e2e/
  chromium/
    fixtures/
      extension.ts
      extension-profile.ts
      historical-storage.ts
      provider-server.ts
    critical/
      install-and-boot.spec.ts
      current-migration.spec.ts
      restart-durability.spec.ts
      backup-export.spec.ts
    content/
      selection-sentinel.spec.ts
    lifecycle/
      worker-restart.spec.ts
  firefox/
    critical/
      current-migration.ts
      restart-durability.ts
      backup-export.ts
    support/
      driver.ts
      profile.ts
  fixtures/
    pages/
      basic.html
      iframe-host.html
      hostile-css.html
    providers/
      ollama-models.json
      ollama-stream.ndjson
    storage/
      manifest.json
      sqljs/
      dexie/
      mixed/
  support/
    assertions/
      migration-invariants.ts
    artifacts/
      write-test-report.ts
playwright.config.ts
```

The exact layout may shrink during implementation. Keep shared migration
assertions browser-neutral.

## Test fixtures

### Fixture principles

Every storage fixture must include:

- source product version or storage generation;
- source schema version;
- source kind: Dexie, sql.js, OPFS, or mixed;
- deterministic IDs and timestamps;
- expected sessions, messages, files, and relationships;
- expected migration outcome;
- fixture-generation instructions;
- checksum of committed binary assets;
- no real user content, endpoint, credential, or API key.

Store expected data as readable JSON beside binary IndexedDB/SQLite material.
Assertions should compare against the JSON manifest rather than unexplained
hard-coded row counts.

### `0.12.5` required fixtures

1. Fresh profile with no historical data.
2. Empty legacy sql.js blob.
3. Representative pre-OPFS sql.js database.
4. sql.js database containing:
   - multiple sessions;
   - ordered user and assistant messages;
   - branching parent/current-leaf relationships;
   - file attachments;
   - pinned state;
   - per-session system prompt;
   - tags;
   - thinking and reasoning replay data where supported;
   - prompt templates and tool-loop rows where supported.
5. Profile already marked and populated as OPFS.
6. Legacy blob plus completed OPFS marker, proving no second import.

The existing section-9.8 legacy fixture can seed the first implementation, but
its expected-data manifest must be expanded beyond session/message counts.

### `0.12.6` required fixtures

1. `0.5.3` Dexie-only `ChatDatabase`.
2. Interrupted `0.6.0` Dexie-to-sql.js migration.
3. `0.10.3` sql.js database.
4. `0.11.27` sql.js database.
5. `0.12.3` sql.js state.
6. `0.12.3` or later already migrated OPFS state.
7. Dexie and sql.js both populated with disjoint records.
8. Dexie and sql.js containing overlapping records.
9. Malformed legacy records.
10. Corrupt SQLite bytes.
11. Simulated quota/write failure.
12. Browser restart during migration.

Do not make unsupported `0.12.5` Dexie behavior a blocking success test. Add
that fixture when the `0.12.6` detector and migration-only reader exist.

## Migration invariants

A successful migration must prove:

- every expected session exists exactly once;
- every expected message exists exactly once;
- message ordering is preserved;
- session-to-message relationships are preserved;
- parent-message and current-leaf references resolve;
- attachment metadata and bytes are preserved;
- pinned state, tags, and system prompts are preserved;
- replay artifacts remain opaque and unchanged;
- tool-loop rows preserve request and approval boundaries;
- prompt templates and other durable source tables are handled intentionally;
- destination schema reaches expected `user_version`;
- `PRAGMA integrity_check` returns `ok`;
- `PRAGMA foreign_key_check` returns no rows;
- migration receipt matches detected sources and verified counts;
- OPFS marker is written only after verification succeeds;
- source databases remain untouched;
- second startup performs no duplicate import;
- normal writes use OPFS after completion;
- backup export is valid SQLite and contains the verified result.

A failed migration must prove:

- OPFS completion marker is absent;
- source database still exists and retains its checksum;
- no source overwrite or deletion occurred;
- next startup can retry;
- diagnostics expose a safe error code and stage;
- no credentials or chat content appear in logs or artifacts.

## Critical Chromium suite for `0.12.5`

### C1. Install and boot

1. Build Chrome MV3 production output.
2. Launch bundled Chromium with a new persistent profile.
3. Load only the production extension directory.
4. Resolve extension ID from its service worker.
5. Open options and sidepanel extension pages.
6. Assert both mount without uncaught errors.
7. Assert persistence owner becomes reachable.

### C2. Fresh profile

1. Start with empty browser profile.
2. Open persistence through normal repository facade.
3. Assert OPFS becomes active.
4. Write one session and message.
5. Restart browser with same profile.
6. Assert data remains.

### C3. Current sql.js migration

1. Start with clean profile.
2. Seed representative legacy sql.js IndexedDB blob.
3. Start production extension.
4. Wait for migration completion through a stable test contract.
5. Assert every migration invariant.
6. Close browser completely.
7. Relaunch with same profile.
8. Assert every invariant again.

### C4. Idempotence and post-migration writes

1. Relaunch already migrated profile.
2. Assert no duplicate rows.
3. Add a new chat through repository or minimal UI flow.
4. Force required persistence boundary.
5. Restart browser.
6. Assert historical and new records coexist exactly once.
7. Assert legacy blob checksum did not change.

### C5. Backup export

1. Export through production backup path.
2. Open bytes with an independent SQLite reader.
3. Assert valid header and expected schema.
4. Run integrity and relationship assertions.

### C6. MV3 restart

1. Begin from migrated OPFS profile.
2. Terminate or allow suspension of service worker.
3. Reconnect through normal extension client.
4. Assert repository remains reachable.
5. Assert no fallback to legacy sql.js writes.

## Critical Firefox suite for `0.12.5`

Reuse the same fixture manifest and invariant library:

1. Package Firefox MV2 production output.
2. Install XPI temporarily through geckodriver.
3. Use stable extension ID from manifest.
4. Seed legacy sql.js data in the real extension origin.
5. Restart Firefox with the same explicit profile.
6. Verify migration, idempotence, new writes, and backup export.

Run Firefox tests sequentially. Profile reuse and extension installation are
global browser state and should not be parallelized prematurely.

## Deterministic provider server

Provider E2E is secondary to storage for the first branch, but foundation
should avoid real Ollama.

Local fixture server should implement only:

```text
GET  /api/tags
POST /api/chat
GET  /v1/models
POST /v1/chat/completions
```

Responses should:

- stream in fixed chunks;
- support abort;
- return deterministic model IDs;
- record sanitized request metadata;
- support controlled timeout and HTTP failure cases.

Initial chat smoke:

```text
configure fixture Ollama endpoint
  -> discover model
  -> send one message
  -> receive deterministic stream
  -> persist assistant message
  -> restart browser
  -> verify conversation
```

This becomes blocking only after stable storage gates pass.

## Stable test contracts

Avoid arbitrary `waitForTimeout` as the primary synchronization method.

Prefer:

- service-worker and page lifecycle events;
- explicit persistence-owner readiness;
- migration status/receipt query;
- repository read-after-write;
- browser restart with same profile;
- UI role/label assertions;
- deterministic fixture-server request events.

Test-only entrypoints must not ship in production. If a migration status probe
is needed, expose a safe diagnostics contract useful to real support workflows,
or build the probe only in a dedicated verification mode with a manifest test
that proves its absence from release output.

## Playwright Test configuration

Add `@playwright/test` at the same version as `playwright`, then consolidate on
one package if practical.

Recommended initial configuration:

```text
workers: 1 for extension-profile tests
retries: 0 locally, 1 in CI
trace: retain-on-failure
screenshot: only-on-failure
video: retain-on-failure for critical UI flows
timeout: explicit per lifecycle test
output: artifacts/e2e/
```

Persistent extension profiles must be unique per test. Never reuse a developer
profile or a path outside a test-created temporary directory.

## Commands

Target command surface:

```bash
pnpm e2e:build
pnpm e2e:chromium
pnpm e2e:chromium:critical
pnpm e2e:firefox
pnpm e2e:migration
pnpm e2e:headed
pnpm e2e:report
pnpm verify:release-candidate
```

`verify:release-candidate` should eventually:

```text
typecheck
lint
format check
unit/integration tests
generated-file drift check
Chrome production build
Firefox production build
manifest/CSP smoke
critical Chromium E2E
critical Firefox migration E2E
package already verified outputs
```

## CI rollout

### Pull requests

Blocking:

- typecheck, lint, format;
- Vitest;
- Chrome and Firefox builds;
- manifest/CSP smoke;
- Chromium install/boot;
- Chromium critical migration fixture.

Initially non-blocking or path-filtered:

- Firefox real-browser migration;
- MV3 long-idle suspension;
- large fixture;
- real Ollama integration.

### `preview`

Blocking:

- complete Chromium critical suite;
- Firefox current-migration suite;
- restart/idempotence;
- backup export;
- generated-file drift;
- package-size inspection.

### Scheduled

- complete Chrome/Firefox lifecycle matrix;
- repeated migration runs;
- large histories;
- controlled failures;
- optional real Ollama;
- content-script hostile-page fixtures.

### Release

Release job must consume verified build artifacts or run the same gate before
packaging. It must not verify one build and publish a separately rebuilt output.

## Failure artifacts

Every failed browser test should retain:

- Playwright trace where applicable;
- screenshot;
- sanitized browser console;
- extension service-worker console;
- test step and browser version;
- source fixture name and checksum;
- safe migration receipt/status;
- destination integrity results;
- sanitized fixture-server log;
- final manifest and build identifier.

Never upload:

- provider keys;
- real endpoints containing credentials;
- real user databases;
- raw replay artifacts;
- chat content outside committed synthetic fixtures.

## Flake policy

A test is not ready to block release if retries are hiding an unknown race.

Rules:

1. One CI retry may collect evidence; retry success does not erase flaky status.
2. Track flaky tests explicitly.
3. Remove arbitrary sleeps where an observable state exists.
4. Run each new blocking test at least ten consecutive times locally.
5. Run the full critical suite repeatedly on `preview` before store submission.
6. Quarantine only with an issue, owner, reason, and expiry.
7. Never weaken migration assertions to make timing failures disappear.

## Implementation slices

### Slice 0: synchronize and protect scope

Estimated effort: half day.

- Sync `preview`.
- Create `feature/e2e-critical-path`.
- Record base commit.
- Confirm clean production builds.
- Preserve current standalone scripts as baseline.

Exit: branch builds exactly what `preview` builds.

### Slice 1: runner and Chromium fixture

Estimated effort: one to two days.

- Add Playwright Test.
- Create extension persistent-context fixture.
- Resolve extension ID deterministically.
- Capture console and trace artifacts.
- Convert install/options/sidepanel mount checks.

Exit: `pnpm e2e:chromium:critical` loads production extension and produces a
normal Playwright report.

### Slice 2: fixture manifest and shared invariants

Estimated effort: one to two days.

- Formalize existing sql.js fixture.
- Add readable expected-data manifest.
- Add checksums.
- Extract shared migration assertions.
- Verify tables, relationships, integrity, and source preservation.

Exit: fixture meaning is reviewable without reading binary bytes.

### Slice 3: Chromium migration lifecycle

Estimated effort: two to three days.

- Port fresh-profile test.
- Port real legacy migration.
- Add full browser restart.
- Add idempotence.
- Add post-migration write.
- Port backup export.

Exit: complete `0.12.5` Chromium storage promise is one blocking suite.

### Slice 4: Firefox migration lifecycle

Estimated effort: two to four days.

- Reuse existing geckodriver harness.
- Reuse fixture manifest and assertions.
- Stabilize profile restart.
- Add artifact output.
- Keep execution sequential.

Exit: same `0.12.5` migration promise passes in packaged Firefox.

### Slice 5: CI and release artifact flow

Estimated effort: two to three days.

- Add browser binaries/dependencies to CI.
- Cache only safe immutable dependencies.
- Upload failure artifacts.
- Add PR and `preview` jobs.
- Ensure package step uses verified output.
- Document local reproduction.

Exit: red migration gate prevents release candidate publication.

### Slice 6: deterministic chat smoke

Estimated effort: one to two days.

- Add fixture provider.
- Run one real extension streaming turn.
- Restart and verify persistence.
- Keep live Ollama optional.

Exit: one user-level chat round trip is covered without external services.

## Three-week schedule

### Week 1

- Slice 0.
- Slice 1.
- Slice 2.
- Begin Chromium lifecycle conversion.

Deliverable: production extension installs under Playwright Test and consumes a
documented historical fixture.

### Week 2

- Finish Slice 3.
- Implement Slice 4.
- Run repeated local stability checks.
- Fix release-blocking storage defects only.

Deliverable: Chrome and Firefox prove current sql.js-to-OPFS migration,
restart, idempotence, and backup.

### Week 3

- Slice 5.
- Slice 6 if migration suite is stable.
- Run repeated `preview` matrix.
- Document failures and deferred cases.

Deliverable: critical suite runs automatically and produces actionable failure
artifacts.

## Pull-request strategy

Prefer small reviewable pull requests:

1. Runner, fixtures, and install/boot only.
2. Chromium migration and restart assertions.
3. Firefox migration parity.
4. CI/release integration.
5. Deterministic chat smoke.

If release timing requires one branch, keep commits in these slices and avoid
mixing production refactors into harness commits.

## `0.12.5` definition of done

- Production Chrome and Firefox outputs build.
- Chromium extension installs and boots in a fresh profile.
- Firefox extension installs and boots in a fresh profile.
- Representative legacy sql.js data migrates in both browsers.
- Full browser restart preserves data.
- Second startup does not duplicate data.
- New OPFS write survives another restart.
- Legacy source remains unchanged.
- Exported backup is valid and complete.
- Critical Chromium suite runs in CI.
- Firefox migration passes on `preview` and before store submission.
- Failures retain safe, useful artifacts.
- No test depends on live Ollama, live websites, or secrets.

## `0.12.6` expansion

After production adds historical detection and the migration-only Dexie reader:

- add Dexie-only fixtures;
- add interrupted mixed-source fixtures;
- verify deterministic merging;
- add corrupt/quota/restart-during-migration recovery;
- require Chrome and Firefox historical matrices before release;
- keep source stores untouched;
- persist and verify migration receipts;
- make direct upgrade from every supported storage generation a blocking gate.

## Future backlog

Add only after critical storage suite is stable:

- content-script injection and exclusion behavior;
- top-frame selection UI with child-frame sentinels;
- hostile page CSS and DOM fixtures;
- optional permission grant/revoke;
- provider configuration and discovery;
- tool approval and checkpoint recovery;
- file-ingestion resume;
- sidepanel close/reopen during streaming;
- locale overflow screenshots;
- content-script startup and bundle budgets;
- browser-agent observe/act/verify workflows.

## Plan completion criteria

This plan is complete when:

1. critical commands exist and are documented;
2. committed fixtures cover the declared storage floor;
3. migration invariants are shared across browsers;
4. CI runs the agreed blocking matrix;
5. release publishes the exact verified artifacts;
6. failed runs leave enough evidence for local reproduction;
7. deferred coverage has an explicit release target.
