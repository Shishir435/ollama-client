# Release Checklist — `0.11.x` Browser-Native Series

One tracked checklist for the whole `0.11.x` series (FEATURE_ROADMAP §5 item 8).
Baseline is `0.11.0` (groundwork). Every `0.11.x` patch is one roadmap item and
must clear the **per-release gates** below before it is tagged.

This is the scope-freeze contract: the features in the roadmap version table are
in; everything else is parked (see Parking Lot). "Great idea" goes to the parking
lot, not into an in-flight release.

---

## Per-release gates (every `0.11.x`)

Before tagging any release in this series:

- [ ] **Acceptance criteria met** — the roadmap epic's stated behavior works end to end.
- [ ] **Green gates** — all pass locally and in CI:
  - [ ] `pnpm typecheck`
  - [ ] `pnpm lint:check`
  - [ ] `pnpm test:run`
  - [ ] `pnpm check:generated` (i18n resources regenerated, no diff)
  - [ ] `pnpm check:i18n` (no NEW drift; warn-mode until backlog cleared — see below)
- [ ] **Both browsers build** — `pnpm build` (Chrome MV3) **and** `pnpm build:firefox`.
- [ ] **Cross-browser degrade check** — feature is gated through `browser-api.ts`
      capability gates; on a browser that lacks the API it degrades, not throws.
- [ ] **Privacy review** (see checklist below) — mandatory for any 🟡 feature.
- [ ] **Migration / rollback notes** — recorded in the tag message (see below).
- [ ] **Docs/changelog owner** — the release author writes the annotated tag message.
- [ ] **Roadmap status flipped** — set the row's Status to ✅ in `FEATURE_ROADMAP.md`.

## Privacy review (mandatory for 🟡 features; quick-pass for 🟢)

- [ ] No new data path leaves the device (no telemetry, no cloud inference).
- [ ] Any sensitive source (history, bookmarks, page archive) is **opt-in**, scoped,
      and requested via `src/lib/permissions.ts` from a user gesture.
- [ ] The capability appears in the **Permissions & privacy** panel with a working
      revoke/delete control.
- [ ] Host access policy unchanged: `<all_urls>` stays standing (FEATURE_ROADMAP §0.4);
      only discrete **API** permissions are optional.
- [ ] Per-site rules (E3) are honored where applicable (a "never read" site stays off).

## Migration / rollback

- [ ] In-progress features merge **dark** behind a `feature-flags` toggle (default off);
      rollback for an unstable feature is flipping its flag off, not reverting code.
- [ ] Any storage-shape change registers its key in `storage-key-registry.ts`
      (sync-safe vs device-local) — enforced by test.
- [ ] Note any non-reversible data migration in the tag message.

---

## Changelog & tagging convention

This repo has **no `CHANGELOG.md`**; the changelog *is* the annotated git tag.
Match the existing convention exactly:

- Tag name: **no `v` prefix** — `0.11.1`, `0.11.2`, … (existing tags: `0.10.0`, `0.9.1`).
- Annotated tag with a one-line summary, same shape as history
  (`Release 0.10.0: tool calling runtime foundation`):
  ```bash
  git tag -a 0.11.1 -m "Release 0.11.1: global command hotkeys"
  ```
- Tag the commit that bumped `package.json` to that version.
- Then flip the row's Status to ✅ in `FEATURE_ROADMAP.md`.

---

## Scope freeze — what is IN `0.11.x`

The roadmap version table (`FEATURE_ROADMAP.md` §5): F1–F4 + E1–E10, in the listed
order. If the series runs long, the Phase C/D differentiators (E2, E3, E10) may be
promoted to a `0.12.0` minor rather than stretching `0.11.x`.

## Parking Lot — explicitly OUT of `0.11.x`

These are deferred on purpose (FEATURE_ROADMAP §6 candidates not chosen, §7 deferred):

- Frontier / cloud model support — later era, opt-in.
- Side-by-side multi-model diff/eval — needs ~24–36 GB RAM; revisit on hardware shift.
- Cloud sync / shared chats — conflicts with privacy stance unless fully user-hosted.
- `offscreen` documents — CSP-blocked, parked.
- Cross-encoder reranking — CSP-blocked, cosine stands in.
- C4 Local Workflow Macros — defer until E8/E10 primitives exist.
- C2/C3 (Page Archive, Rich Context Menus) — candidates; pull in only by explicit
  decision, at most one or two, never auto-appended.

---

## `0.11.0` baseline — done

Groundwork shipped (FEATURE_ROADMAP §5 items 1–8):

- [x] Branch + version bump to `0.11.0`
- [x] `optional_permissions` manifest scaffold (API perms only; host access retained)
- [x] `src/lib/permissions.ts` — typed optional-permission request/revoke + tests
- [x] `browser-api.ts` capability gates (offscreen parked → false)
- [x] `src/stores/feature-flags.ts` — dark-ship flag store + tests
- [x] `tools/check-i18n-drift.ts` + `check:i18n` (warn now, `--strict` post-backfill)
- [x] **Permissions & privacy** panel — Options tab + context popover Sheet
- [x] This release checklist + changelog/tag convention

> i18n backlog: 8 non-`en` locales are ~93% translated (77 missing keys each).
> `check:i18n` runs in warn mode until backfilled, then wire `--strict` into CI.
