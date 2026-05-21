<!--
Thanks for the PR! A few minutes spent on this template saves the
reviewer a lot of guessing. Trim sections that genuinely don't apply.
-->

## Summary

<!-- What does this change do, and why? One short paragraph. -->

Fixes #<issue-number>

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor / cleanup (no behavior change)
- [ ] Performance
- [ ] Docs
- [ ] Build / tooling / CI
- [ ] Breaking change (storage format, message protocol, manifest permissions, public API)

## Quality gates

All of these run in the pre-commit / pre-push hooks; tick them after
they pass locally:

- [ ] `pnpm typecheck`
- [ ] `pnpm lint:check`
- [ ] `pnpm format:check`
- [ ] `pnpm test:run` (full suite)
- [ ] `pnpm build` (Chrome MV3)
- [ ] `pnpm build:firefox` (Firefox MV2)

Required only when relevant:

- [ ] Manual smoke in **Chrome** (load unpacked from `build/chrome-mv3-prod`)
- [ ] Manual smoke in **Firefox** (load `build/firefox-mv2-prod` via `about:debugging`)
- [ ] `pnpm verify:browser-smoke` (manifest / CSP / permissions changed)
- [ ] `pnpm generate:resources` ran (locale strings changed)

## Surface area / risk

<!-- Pick what applies. -->

- [ ] Touches **chat history persistence** (`src/lib/repositories/chat-history.ts`, `dexie-chat-history.ts`, `sqlite-chat-history.ts`, the Dexie→SQLite migration)
- [ ] Touches **the content script** (`src/contents/`) — runs on every webpage
- [ ] Touches **the background worker** message routing
- [ ] Touches a **provider implementation** (`src/lib/providers/`)
- [ ] Touches **CSP / manifest / permissions** (`wxt.config.ts`, `host_permissions`, web-accessible resources)
- [ ] Adds a **new dependency** (please justify in Notes)

## Privacy / local-first

<!-- If your change adds any network call, telemetry hook, or
     non-user-configured endpoint, call it out here so it's easy to
     review. If not, just write "no change". -->

## Screenshots / GIFs

<!-- Required for UI changes. Drag-and-drop into the comment box. -->

## Notes

<!-- Anything else the reviewer needs to know: known follow-ups,
     deliberate trade-offs, why you skipped a checkbox, etc. -->
