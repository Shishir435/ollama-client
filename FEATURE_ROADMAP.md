# Feature Roadmap: Browser-Native, Privacy-First

This roadmap is about one idea: **use the browser to its fullest while keeping
every byte on-device.** The extension is already a mature local LLM client
(Ollama + OpenAI-compatible local providers, RAG, memory, knowledge sets, vision
input, fork/branch chat, export/import). What it is _not_ yet doing is exercising
the full browser API surface. Roughly half the relevant WebExtension APIs are
unused. Each unused API is a feature the product is leaving on the table.

This document grounds every proposal in the current code, marks its privacy
posture, and orders the work so the load-bearing foundation lands before the
flashy features that depend on it.

**Legend (self-contained for review):**

- Privacy: 🟢 stays on-device · 🟡 on-device but reads sensitive sources, gated by
  explicit consent/scope · 🔴 leaves the device (none proposed here).
- Effort: S / M / L — relative implementation size, not calendar time.
- "**needs verification**" / "grounded" — claims tagged _grounded_ were confirmed
  against the code during the audit (file refs in the Appendix). Items tagged
  _needs verification_ are hypotheses to confirm **before** writing code.

---

## 0. Privacy Invariants (apply to everything below)

These are non-negotiable and gate every feature:

1. **No data leaves the device** unless the user explicitly configures a remote
   endpoint (their own remote Ollama, their own SearXNG, etc.). No telemetry, no
   cloud inference.
2. **Frontier / cloud models are out of scope for now.** Optional support may
   land later behind an explicit opt-in; nothing in this roadmap assumes them.
3. **High-sensitivity sources (history, bookmarks, page archive) are opt-in,
   scoped, and locally indexed only.** They flow into the _existing_ on-device
   vector store, never to a network.
4. **Broad host access (`<all_urls>`) is retained and justified — not scoped down.**
   Users configure arbitrary remote provider endpoints (e.g. a remote Ollama on
   their own network). The extension cannot predict those origins, and the browser
   blocks cross-origin requests to hosts not covered by host permissions.
   Requesting an optional host permission per user-entered URL is fragile and a
   poor first-run experience, so `<all_urls>` stays. Content features (selection
   actions, tab-context extraction) rely on it too. The privacy work here is to
   **document and surface** this access (Permissions tab, C1), not remove it.
   Optional-permission gating below applies to discrete **API** permissions
   (`bookmarks`, `history`, `notifications`, `downloads`) — **not** to host access.

---

## 1. Browser API Coverage — Where We Are

**Currently wired:** `storage`, `sidePanel`, `tabs`, `scripting`,
`declarativeNetRequest` (CORS for localhost providers, Chromium only),
`contextMenus` (single "Ask Local LLM" item), `runtime` ports + messages,
`windows` (Firefox sidepanel fallback), Web Speech API (`speechSynthesis`).

**Untapped — each row is a feature opportunity:**

| API                        | Status | Unlocks                                                                                              |
| -------------------------- | ------ | ---------------------------------------------------------------------------------------------------- |
| `commands`                 | absent | Global hotkeys (open panel, new chat, summarize tab) — today's shortcuts are in-page JS keydown only |
| `tabs.captureVisibleTab`   | absent | Screenshot → vision model on live pages (vision input already supported)                             |
| `alarms`                   | absent | Durable scheduled jobs (re-embed, cleanup, watches) that survive SW suspension                       |
| `notifications`            | absent | "Long job done" (embed rebuild, backfill, big summary) — silent today                                |
| `offscreen` (Chromium)     | parked | Tried for heavy WASM/embedding work; CSP blocked the approach, so not a planned dependency           |
| `bookmarks`                | absent | Local RAG over saved pages                                                                           |
| `history`                  | absent | Local RAG / recall over browsing history                                                             |
| `omnibox`                  | absent | Address-bar keyword → local model, no panel                                                          |
| `webNavigation`            | absent | Refresh tab context on SPA route change, not just full load                                          |
| `idle`                     | absent | Pause/resume background work by user presence                                                        |
| `tabGroups`                | absent | "Summarize this group", multi-tab compare                                                            |
| `downloads` (programmatic) | absent | One-click save of generated artifacts (export/import exists at session level)                        |

---

## 2. Foundation Work (do this first — features depend on it)

These are not glamorous, but several headline features are unsafe or impossible
without them. They also fix real bugs surfaced during the codebase audit.

### F1. MV3 Service-Worker Lifecycle Hardening — `v0.11.3`

**Problem (grounded):**

- Model pull and install-time embedding download have **no timeout** and can hang
  for hours (`handle-model-pull.ts`, `handle-embedding-download.ts`).
- The abort-controller registry is **in-memory** and is lost when the service
  worker suspends (~5 min idle) — a resumed port can't find its controller.

**Plan:**

- Adopt `browser.alarms` for any job that must survive suspension (periodic
  cleanup, scheduled re-embed, watches). Replace `setTimeout`-based retransmit
  (`message-router.ts` ~500ms selection retransmit) where it risks loss.
- Add hard timeouts + user-visible failure on model pull / embedding download.
- Keep long jobs (embedding, HNSW build) on the existing port-streaming +
  AbortController model, but make them **resumable**: persist enough job state
  (cursor, batch index) so a suspended job can be re-driven on reconnect rather
  than silently dying.

**Not using `offscreen` documents.** An offscreen document to host embedding/HNSW
work was tried and the extension CSP kept blocking it. It is **parked, not
planned** — see §7. F1 therefore hardens the _current_ execution model
(alarms + timeouts + resumable jobs) rather than relocating work off the worker.

**Privacy:** 🟢 internal only.
**Why first:** bookmarks/history indexing, scheduled watches, and notifications
all assume durable background execution.

### F2. `commands` — Real Browser-Level Hotkeys — `v0.11.1`

**Problem:** all shortcuts today are in-page `keydown` listeners
(`src/stores/shortcut-store.ts`, `src/hooks/use-keyboard-shortcuts.ts`). They only
fire when an extension surface is focused. There is no way to open the panel or
start a chat from an arbitrary page.

**Plan:**

- Add a `commands` block to the manifest for a small set of global actions:
  open side panel, new chat, summarize active tab, toggle voice.
- Bridge `browser.commands.onCommand` in the background to the existing action
  handlers. Keep the in-page shortcut system for surface-local actions; the two
  coexist (browser commands for "reach the extension", in-page for "drive it").
- Surface the browser-managed bindings in the existing Shortcuts settings tab
  (read-only link to `chrome://extensions/shortcuts`, since the browser owns them).

**Privacy:** 🟢.
**Effort:** small. **Highest daily-value-per-line in the roadmap.**

### F3. Typed Message Map — `v0.11.2`

**Problem:** runtime messages are dispatched via hand-written guards
(`isModelPayload`, `parseEmbeddingModelPayload`) and `as unknown as` casts; only
~10 of ~25 message types are in `RuntimeMessageMap`. Streaming over ports is
untyped. Every new feature below adds message types — the current pattern scales
badly and hides bugs.

**Plan:** introduce a single discriminated-union message map (type → payload →
response) with one parse boundary; migrate handlers incrementally behind it.

**Privacy:** 🟢. **Why early:** every feature epic adds messages.

### F4. Wire Background Memory Context Size Caps — `v0.11.4`

**Problem (grounded):** a prompt-budget ceiling already exists in the options UI
(`PromptContextLimitsSettings` / `settings.prompt_context_limits.*`, registry ids
`max-tab-context-chars`, `max-rag-context-chars`, `max-tool-result-chars`). The
main UI RAG path reads those settings through `use-chat-config.ts` and clamps
tab/RAG context in `build-rag-context.ts`. Tool results also read
`MAX_TOOL_RESULT_CHARS` in `handle-chat-with-model.ts`.

The remaining gap is **background memory injection** in
`handle-chat-with-model.ts`: it calls `retrieveContextEnhanced()` and
`formatEnhancedResults(enhancedResults)` without passing a budget or clamping the
formatted context before appending it to the system prompt. Many memory matches
can still blow the model context window even though the settings UI implies a
global cap.

**Plan:**

1. Read `STORAGE_KEYS.CHAT.MAX_RAG_CONTEXT_CHARS` inside
   `handle-chat-with-model.ts` for the background memory-injection path.
2. Apply the existing budget as a hard char ceiling to the formatted memory
   context before appending it to `contextHeader`. Preserve deterministic
   ordering from `retrieveContextEnhanced()` (score/re-rank first) and append a
   truncation note when clamped.
3. Add a handler regression test with oversized memory results proving the final
   system prompt respects `MAX_RAG_CONTEXT_CHARS`.
4. Keep the tool-result cap separate (`MAX_TOOL_RESULT_CHARS`) so web-search and
   future browser-tool outputs do not share the memory cap by accident.

**Privacy:** 🟢.

---

## 3. Feature Epics

Each epic notes the browser APIs it needs, its privacy posture, what existing
code it builds on, and a rough effort. Effort is relative (S/M/L), not calendar.

### E1. Screenshot → Vision (live-page multimodal) — 🟢 `v0.11.5`

**What:** Capture the visible tab (or a user-selected region) and send the image
to a vision-capable local model. "What does this chart say?", "Explain this
error dialog", "Read this image of text".

**APIs:** `tabs.captureVisibleTab` (Chromium + Firefox), region crop in a content
script overlay (reuse the selection-overlay shadow-DOM infra from
`selection-button.content.tsx`).

**Builds on:** image input is already first-class — `ImageAttachment`
(`src/types/chat.ts`), `use-image-attachments.ts`, vision capability detection
(`capability-meta.ts`). A screenshot is just another `ImageAttachment` whose bytes
come from `captureVisibleTab` instead of a file picker.

**Privacy:** 🟢 — bytes go only to the configured local model. Gate the action on
vision-capable model being selected (capability flag already exists).

**Effort:** M. **Value:** high — turns the existing vision plumbing into a live
browser feature with little new surface.

### E2. Local Knowledge over Bookmarks & History — 🟡 (opt-in) `v0.11.8`

**What:** Let users index their bookmarks and/or browsing history into a knowledge
set and chat with it. "When did I read about X?", "Summarize what I've been
researching this week." This is a feature **frontier cloud clients structurally
cannot offer** — the data never leaves the machine. It is the signature
privacy-first capability.

**APIs:** `bookmarks`, `history` (both as **optional permissions**, requested on
first use), `alarms` for incremental sync. No `offscreen` dependency; F1 makes
the current worker/port execution model resumable instead.

**Builds on:** the ingestion pipeline is already pluggable. The vector schema
(`VectorDocument.metadata`) already carries `type` and a `url` field, with
`"webpage"` reserved for exactly this. The clean entry point is the
`fromDocuments()` vector-store facade (`src/lib/embeddings/vector-store.ts`,
implemented in `storage.ts`). New browser-source processors should live near the
knowledge ingestion feature (not under the file-upload-only processor folder),
produce `Document[]`, and reuse the existing chunk → embed → store →
hybrid-search path with a new `type` discriminator. **No schema change.**

**Privacy:** 🟡 — high-sensitivity source. Mandatory guardrails:

- Opt-in per source, with a clear scope picker (date range, folders, domain
  allow/deny list).
- Local-only; never leaves the vector store.
- First-class delete: "forget history index" wipes those vectors
  (`clearAllVectors(type)` already exists).
- Aggressive cleanup policy (history can be huge; IndexedDB quota is finite).

**Effort:** M–L (mostly the scope/consent UI + cleanup, not the pipeline).
**Value:** very high; strongest differentiator.

### E3. Per-Site Auto-Context Profiles — 🟡 `v0.11.9`

**What (user-requested):** rules that auto-attach context based on the current
site. "On github.com always include the diff", "on this docs site always ground
to the page", "on mail.\* never read the tab." A profile bundles: tab-context
on/off, grounding mode, selection-action defaults, optional preset.

**APIs:** `webNavigation` (detect SPA route changes so the active profile updates
without a full reload — fixes a known staleness gap in tab context), `tabs`,
`storage`.

**Builds on:** multi-tab context capture (`use-tab-contents.ts`, with content-hash
SPA detection already partially present), grounding modes
(`context-settings.tsx`), presets (settings registry). A profile is a small rule
object matched against the active tab's URL that flips existing toggles.

**Privacy:** 🟢 — rules are local config; they _reduce_ data exposure (e.g.
"never read mail tabs") more than they add it.

**Effort:** M. **Value:** high; directly requested.

### E4. Tab-Group & Multi-Tab Workflows — 🟡 `v0.11.10`

**What:** "Summarize these 5 tabs", "compare these two articles", "answer using
this whole tab group as context."

**APIs:** `tabGroups`, `tabs`. Multi-tab capture already exists (selectedTabIds is
an array, contents concatenated) — this is mostly a selection UX + grouping layer
on top.

**Privacy:** 🟡 — reads multiple tabs; gated by explicit selection and the E3
per-site rules (a "never read" site is excluded even inside a group).

**Effort:** M.

### E5. Background Notifications & Scheduled Jobs — 🟢 `v0.11.6`

**What:** Notify when long jobs finish (embedding rebuild, history backfill, large
summarize). Optionally schedule recurring local maintenance (nightly re-embed of
changed bookmarks, periodic cleanup).

**APIs:** `notifications`, `alarms` (depends on F1), `idle` (don't run heavy jobs
while the user is actively typing).

**Builds on:** existing long jobs that currently run silently
(`handle-embed-chunks.ts` port streaming, backfill). Add completion notifications
and an alarm-driven scheduler.

**Privacy:** 🟢.
**Effort:** S–M (after F1).

### E6. Omnibox Quick-Ask — 🟢 `v0.11.7`

**What:** Type a keyword (e.g. `ol `) in the address bar followed by a question;
get a quick local-model answer in a new tab or the panel, without opening the UI
first.

**APIs:** `omnibox`.

**Builds on:** the provider/chat path; this is a thin new entry point into an
existing flow.

**Privacy:** 🟢 (local model). Note: omnibox input is visible to the extension
only after the keyword; no passive capture.

**Effort:** S.

### E7. Artifacts / Output Canvas — 🟢 `v0.11.11`

**What:** When the model outputs runnable/renderable content (HTML, SVG, mermaid,
a code block), render it in a sandboxed preview pane alongside the chat instead of
as raw text.

**APIs:** none new — sandboxed iframe within the existing CSP (`'self'` +
`wasm-unsafe-eval`; no external loads, which the CSP already forbids — good for
safety).

**Builds on:** chat rendering. Pairs naturally with E1 (screenshot a page, get
back a rebuilt component, preview it).

**Privacy:** 🟢 — sandboxed, no network egress (CSP blocks it).
**Effort:** M.

### E8. Prompt Template Variables & Chaining — 🟢 `v0.11.12`

**What:** Templates today are static strings (`use-prompt-templates.ts`, no `{{}}`
support). Add variable interpolation (`{{selection}}`, `{{tab}}`, `{{clipboard}}`,
user-defined fields) and optional multi-step chaining.

**APIs:** none new (clipboard read is user-gesture-gated).
**Builds on:** existing template CRUD + selection-actions + tab context.
**Privacy:** 🟢.
**Effort:** M.

### E9. Downloads for Generated Artifacts — 🟢 `v0.11.13`

**What:** One-click "save this code/diagram/answer to a file" using the
`downloads` API, distinct from the existing whole-session export/import.

**APIs:** `downloads`.
**Builds on:** export modules (`use-export-chat.ts`) already serialize content;
this is a per-artifact save.
**Privacy:** 🟢.
**Effort:** S.

### E10. Browser Actions as Local Tools (model-fired + manual fallback) — 🟡 `v0.11.14`

**What:** Expose the browser-native capabilities from the epics above as **local
tools the model can call itself** — `current_tab`, `capture_screenshot`,
`search_local_knowledge`, `search_history` (E2, opt-in), `list_tabs`,
`web_search` (already exists). A tool-capable model decides when to fire them; the
extension executes locally and feeds the result back. This is the cross-cutting
layer that turns E1/E2/E4/E6 from buttons into agentic capabilities.

**Critical UX — manual fallback for non-tool-calling models.** Many local models
lack tool-calling, and capability detection already tells us which
(`ModelCapabilities.toolCalling`, source override→metadata→default). The design
must degrade cleanly:

- **Model supports tool-calling:** tools are offered to the model; it fires them.
- **Model does not:** the _same_ actions are exposed as **manual buttons /
  slash-commands / selection-actions** the user triggers, and the extension runs
  the action and injects the result. Same capability, different trigger. No model
  is left unable to use a feature just because it can't emit a tool call.
- A user setting can also **force** a manual action even on a tool-capable model
  (e.g. "always attach the active tab"), independent of whether the model would
  have asked.

**Tool-capable plan — what can become a tool.** A feature is tool-capable when it
can be expressed as a bounded local function: JSON input → local browser/storage
read or reversible action → capped text/sources back to the model. Anything that
changes permissions, deletes data, writes files, or schedules recurring jobs must
stay user-confirmed/manual, even if the model can suggest it.

| Capability | Tool name | Status | Model may call? | Guardrails / fallback |
|------------|-----------|--------|-----------------|-----------------------|
| Current tab read | `current_tab` | exists | yes | E3 "never read" rules, tab access checks, manual "attach current tab" fallback |
| Specific open tab read | `read_tab` + `list_tabs` | exists | yes | list readable tabs first, respect excluded/internal pages, manual tab picker fallback |
| Selected text | `selected_text` | exists | yes | reads last explicit selection only, manual selection action fallback |
| Uploaded/local docs search | `file_search` | exists | yes | local vector store only, capped output, manual file search fallback |
| Chat memory / knowledge search | `rag_search` | exists | yes | local vector store only, `MAX_RAG_CONTEXT_CHARS`, manual semantic search fallback |
| Web search | `web_search` | exists | yes, if enabled | uses user-configured backend, result cap, URL citations, manual web-search toggle fallback |
| Screenshot capture | `capture_screenshot` | planned with E1 | yes, after user enables screenshot tools | capture visible tab/region only, vision model required, manual screenshot button fallback |
| Bookmark/history search | `search_browser_history`, `search_bookmarks` | planned with E2 | yes, after source opt-in | optional permissions, scope/date/domain filters, Permissions tab revoke/delete |
| Page archive save | `save_page_to_knowledge` | candidate C2 | no by default; suggest + confirm | writes local index, needs explicit user confirmation |
| Tab-group context | `list_tab_groups`, `read_tab_group` | planned with E4 | yes, if supported | E3 excludes sites, manual group picker fallback |
| Artifact save | `save_artifact` | planned with E9 | no by default; suggest + confirm | writes to downloads, explicit file action/permission |
| Notifications/schedules | `schedule_local_job`, `notify_when_done` | planned with E5 | no by default; suggest + confirm | recurring work and notifications stay user-controlled |
| Permissions toggles | none | planned with C1 | no | model can explain needed permission, but user toggles in Permissions tab |

**Tool implementation plan:**
1. Keep existing internal tool registry as the seam (`ToolDefinition`,
   `ToolSource`, `ToolResult`, run trace).
2. Add a `tool-capability` entry to each roadmap epic before implementation:
   tool name, schema, risk, required permission, manual fallback, max result size.
3. Add a Permissions-tab toggle for each medium/high-risk tool family
   (`browser`, `history/bookmarks`, `downloads`, `network`).
4. Add per-tool tests: schema validation, permission denied, excluded page/site,
   output cap, abort/timeout, run-trace visibility.
5. Keep non-tool models first-class: every tool must have a manual button,
   slash-command, command, or selection-action path.

**APIs:** none new — this is an orchestration layer over E1/E2/E4/E6 plus the
existing web-search tool.

**Builds on:** tool-calling is already present end-to-end — normalized `ToolCall`
(`src/lib/tools/types.ts`), the background tool loop, run-trace UI
(`run-details.tsx`), and the verified Ollama tool wire format (whole-chunk vs
OpenAI fragment differences are documented). The web-search tool is the existing
template for a new local tool. New browser tools register into the same registry;
the manual-trigger path reuses selection-actions / command plumbing.

**Privacy:** 🟡 — tools can read tabs/history, so they inherit the consent gates of
the underlying epic (E2 history is opt-in + scoped; per-site E3 rules apply: a
"never read" site is off-limits to `current_tab` whether the model or the user
fires it). Tool execution must be **visible and revocable** in the run trace.

**Effort:** M (registry + manual-fallback wiring); each individual tool is S once
its underlying epic exists.
**Depends on:** F3 (typed messages), and whichever action epics it wraps.

---

## 4. Code-Quality Threads (parallel, ongoing)

- **Typed messaging (F3)** — central discriminated union; retire per-handler casts.
- **MV3 lifecycle (F1)** — alarms + resumable job state; timeouts on all long jobs.
- **`flushSync` debt** — already tracked; selection overlay content script. Clear
  before it spreads.
- **`<all_urls>` justification + transparency** — `<all_urls>` is retained (remote
  provider URLs are unpredictable; see §0.4). The work is documenting the
  justification for store review and surfacing the granted access in the
  Permissions tab (C1) — **not** removing it. Optional gating covers discrete API
  permissions only.
- **i18n drift CI** — 9 locales, non-`en` incomplete (found during the settings
  search work). Add a missing-key report per locale to CI; pairs with the
  settings-search `searchKeys` validation already planned.
- **Background/content-script test coverage** — handlers and content scripts are
  the thinnest-tested layer (190 test files overall, but concentrated in features
  and lib). Add handler-level tests as F1/F3 refactors touch them.

---

## 5. Version Plan

**Base: `v0.11.0`** — the development baseline branched after `v0.10.3` (settings
search). `v0.11.0` ships no user-facing roadmap feature, but it is **not empty**:
it carries the groundwork below that unblocks the whole `0.11.x` series. Do this
first. Each improvement after it is one patch release. Versions follow intended
**ship order**, which respects dependencies (foundation before the features that
need it). Numbers are sequencing, not commitments — reorder freely, but keep
dependency arrows intact.

### `v0.11.0` Groundwork (do before `v0.11.1`)

Non-feature prep. Each item is shared infrastructure that more than one later
release depends on; building it once here avoids re-deriving it per feature.

1. **Branch + version mechanics.** Branch from `main` at `0.10.3`; bump
   `package.json` to `0.11.0`. Confirm the release flow (`pnpm generate:resources`
   when locales change; existing `typecheck` / `lint:check` / `test:run` gates).
   Decide changelog conventions for the series.
2. **Manifest permission strategy — decide required vs optional now.** Several
   epics need manifest keys or permissions (`commands`, `notifications`,
   `downloads`, `bookmarks`, `history`, `tabGroups`). The privacy stance (§0.4)
   says: keep standing `permissions` minimal and put sensitive/feature-scoped
   permissions in **`optional_permissions`** only where Chrome/Firefox both allow
   runtime requests. `commands` is a manifest key, not a permission; `tabGroups`
   and other browser-specific permissions need a support check before promising
   optional runtime enablement. Add the permission policy/scaffold to
   `wxt.config.ts` and document which future epic requests what. **No behavior
   yet — just the policy + scaffold.** Host access (`<all_urls>`) is explicitly
   retained per §0.4 — there is no host-permission migration; optional gating
   covers API permissions only.
3. **Reusable permission request/revoke helper.** Extend `src/lib/browser-api.ts`
   with a small `requestPermission(perm)` / `hasPermission(perm)` /
   `removePermission(perm)` wrapper around `browser.permissions.*`, plus a tiny
   consent-prompt UI primitive. E2 (history/bookmarks), E5 (notifications), E9
   (downloads), and any future optional API permission reuse this. Build once.
4. **Cross-browser capability gates.** `isChromiumBased()` exists; formalize
   per-capability gates (e.g. `supportsTabGroups`, `supportsSidePanel`,
   `supportsDNR`) in one place so each feature degrades predictably on Firefox
   instead of throwing. Several epics are Chromium-stronger (tabGroups, DNR);
   `commands`, `captureVisibleTab`, `omnibox`, `bookmarks`, `history` work on both.
5. **Feature-flag / dark-ship scaffold.** A simple settings-backed flag map so a
   half-built `0.11.x` feature can merge disabled and flip on when ready. Keeps the
   big-PR cadence from blocking the series on all-or-nothing merges.
6. **i18n drift CI gate.** Add the missing-key-per-locale check now (9 locales,
   non-`en` incomplete — found during the settings-search work). Landing it at
   `0.11.0` means every subsequent feature's new strings are validated as they
   arrive, not retrofitted. Pairs with the settings-search `searchKeys` validation
   already planned.
7. **Permissions tab shell.** Add a dedicated Options tab for privacy,
   permissions, and local data visibility. It can start as a shell in
   `0.11.0` with static permission status + links, then grow as E2/E3/E5/E9 land.
   This keeps consent and revocation in one predictable place instead of scattering
   toggles across feature settings.
8. **Scope-freeze + release-readiness checklist.** Before feature work starts,
   create one tracked checklist for `0.11.x`: acceptance criteria, privacy review,
   migration/rollback notes, Chrome + Firefox build gates, docs/changelog owner,
   and which candidate features are explicitly out. This release is large enough
   that "great idea" needs a parking lot, not automatic inclusion.

**Explicitly NOT in `0.11.0`:** the typed message map (F3, `v0.11.2`) and
lifecycle hardening (F1, `v0.11.3`) are foundation _code_ and ship as their own
releases — they involve real refactors and tests, not just scaffolding. Keeping
them out of `0.11.0` keeps the baseline a clean, low-risk branch point.

| Status | Version    | Item                                                                                                                                                               | Phase              | Privacy | Depends on      |
| ------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ | ------- | --------------- |
| 🚧     | `v0.11.0`  | **Base + groundwork** — branch, manifest/optional-perms scaffold, permission + capability-gate helpers, Permissions tab shell, feature flags, i18n CI (see above) | —                  | 🟢      | —               |
| ☐      | `v0.11.1`  | F2 — `commands` global hotkeys                                                                                                                                     | A · quick win      | 🟢      | —               |
| ☐      | `v0.11.2`  | F3 — typed message map                                                                                                                                             | A · foundation     | 🟢      | —               |
| ☐      | `v0.11.3`  | F1 — MV3 lifecycle hardening (alarms, timeouts, resumable)                                                                                                         | A · foundation     | 🟢      | —               |
| ☐      | `v0.11.4`  | F4 — wire background memory context size cap                                                                                                                       | A · foundation     | 🟢      | F3              |
| ☐      | `v0.11.5`  | E1 — screenshot → vision                                                                                                                                           | B · headline       | 🟢      | F3              |
| ☐      | `v0.11.6`  | E5 — notifications + scheduled jobs                                                                                                                                | B · headline       | 🟢      | F1              |
| ☐      | `v0.11.7`  | E6 — omnibox quick-ask                                                                                                                                             | B · headline       | 🟢      | F3              |
| ☐      | `v0.11.8`  | E2 — bookmarks/history local RAG                                                                                                                                   | C · differentiator | 🟡      | F1, consent UI  |
| ☐      | `v0.11.9`  | E3 — per-site auto-context profiles                                                                                                                                | C · differentiator | 🟡      | —               |
| ☐      | `v0.11.10` | E4 — tab-group / multi-tab workflows                                                                                                                               | D · depth          | 🟡      | E3              |
| ☐      | `v0.11.11` | E7 — artifacts / output canvas                                                                                                                                     | D · depth          | 🟢      | —               |
| ☐      | `v0.11.12` | E8 — prompt template variables + chaining                                                                                                                          | D · depth          | 🟢      | —               |
| ☐      | `v0.11.13` | E9 — downloads for generated artifacts                                                                                                                             | D · depth          | 🟢      | —               |
| ☐      | `v0.11.14` | E10 — browser actions as local tools + manual fallback                                                                                                             | D · agentic        | 🟡      | F3, E1/E2/E4/E6 |

**Status + done-tagging convention:** ☐ planned · 🚧 in progress · ✅ done. When a
row ships: (1) flip its Status cell to ✅, (2) bump `package.json`, (3) tag the
release commit using the **repo convention — no `v` prefix** (`git tag 0.11.1`,
matching existing tags like `0.10.0`). The `v0.11.x` labels in this doc are
shorthand; the actual git tag drops the `v`.

**Notes on ordering:**

- F2 leads (`v0.11.1`) as the cheapest visible win; it has no hard dependency on
  F3, so it can ship while the typed-message substrate lands underneath.
- E10 is intentionally last in the series — it wraps the action epics (E1, E2, E4,
  E6) as model-callable tools, so those must exist first. Each individual tool is
  small once its underlying epic has shipped.
- The **code-quality threads in §4** (flushSync debt, `<all_urls>` justification +
  transparency, i18n drift CI, background test coverage) are not separate versions.
  They ride along with whichever release touches that code — e.g. the i18n CI check
  pairs with the settings-search `searchKeys` work already in flight.
- If the `0.11.x` series runs long, promoting the Phase C/D differentiators (E2,
  E3, E10) to a `0.12.0` minor is reasonable — they are large enough to headline a
  minor bump rather than a patch.

---

## 6. Feature Candidates To Add Before Freezing Scope

These are good gaps in the current feature set. Do **not** blindly append all of
them to `0.11.x`; pick at most one or two, then freeze.

### C1. Permissions Tab — 🟢

**What:** a dedicated Options tab that shows enabled browser permissions, optional
permissions, site rules, local indexes (chat/files/bookmarks/history), vector
counts, last sync time, and one-click toggle/delete/revoke actions. Users should
be able to turn each optional capability on/off from this tab:
bookmarks/history indexing, notifications, downloads, tab-group access where
supported, optional host access, page archive, and future browser tools.

**Why add:** transparency is the product promise. Every big feature in this
roadmap asks users to trust local access to sensitive browser data; a dedicated
tab makes that access visible, reversible, and understandable instead of hiding
permission state inside feature-specific settings. It also reduces store-review
risk.

**Builds on:** storage stats, permission helper, `clearAllVectors(type)`, E2
consent UI, E3 site rules, backup/export surfaces.

**Recommendation:** promote into `0.11.0` as a shell and expand it with each
permissioned feature. This is not just nice-to-have; it is the trust surface for
the release.

### C2. Page Archive / Read-Later Knowledge — 🟡

**What:** explicit "save this page to local knowledge" action that snapshots the
current page text/metadata into a user-owned knowledge set. Unlike browsing
history indexing, this is deliberate capture.

**Why add:** lower-risk sibling of E2 with very high user value. Users get durable
local research memory without granting broad history access.

**Builds on:** current tab extraction, knowledge sets, vector ingestion,
context-menu/selection-action plumbing.

**Recommendation:** strong candidate for first release if E2 feels too large.

### C3. Rich Context Menu Actions — 🟢

**What:** expand the single "Ask Local LLM" context menu into focused actions:
summarize selection, explain selection, save page to knowledge, ask about image,
capture screenshot.

**Why add:** low effort, high daily discoverability. It exposes existing
selection-actions and future E1/C2 features without forcing users into settings.

**Recommendation:** add only if it can reuse existing action plumbing cleanly; do
not create a parallel prompt system.

### C4. Local Workflow Macros — 🟢

**What:** user-defined chains of manual actions (read tab → search local
knowledge → draft answer → save artifact). This is E8 plus E10, but user-triggered
and deterministic before model-fired tools become reliable.

**Why add:** bridges prompt templates and browser tools for models without good
tool-calling.

**Recommendation:** defer until after E8/E10 primitives exist.

---

## 7. Explicitly Deferred (not now)

- **Frontier / cloud model support** — optional, opt-in, a later era. Nothing
  above depends on it.
- **Side-by-side multi-model diff/eval** — desirable, but running two strong local
  models concurrently needs ~24–36 GB unified RAM, which most users lack. Revisit
  when hardware assumptions change; design the chat path to not preclude it (the
  fork/branch tree is already a natural substrate for "same prompt, two models").
- **Cloud sync / shared chats** — conflicts with the privacy stance unless fully
  user-hosted; out of scope.
- **`offscreen` documents** — tried; the extension CSP kept blocking the
  offscreen approach for embedding / HNSW work. **Parked, not planned.** F1
  hardens the current execution model instead (alarms, timeouts, resumable jobs).
  Revisit in future if the CSP situation changes.
- **Cross-encoder reranking** — currently blocked by MV3 CSP (transformers.js /
  onnxruntime-web). Cosine reranking stands in. Same `offscreen`/CSP blocker as
  above; revisit only if a WASM reranker fits inside `'wasm-unsafe-eval'`.

---

## Appendix: Key Code Anchors

- Manifest / permissions: `wxt.config.ts`
- Background routing: `src/background/message-router.ts`, `port-router.ts`,
  `startup.ts`
- Long jobs at risk: `src/background/handlers/handle-model-pull.ts`,
  `handle-embedding-download.ts`, `handle-embed-chunks.ts`
- In-page shortcuts (to complement, not replace, with `commands`):
  `src/stores/shortcut-store.ts`, `src/hooks/use-keyboard-shortcuts.ts`
- Vision input: `src/types/chat.ts` (`ImageAttachment`),
  `src/features/chat/hooks/use-image-attachments.ts`,
  `src/features/model/components/model-capabilities/capability-meta.ts`
- Fork/branch tree: `src/features/sessions/lib/message-tree.ts`,
  `src/features/sessions/stores/chat-session-message-actions.ts`
- Export/import: `src/features/sessions/hooks/use-export-chat.ts`,
  `use-import-chat.ts`
- Tab context: `src/features/tabs/hooks/use-tab-contents.ts`
- Ingestion entry point (for bookmarks/history): `fromDocuments()` via
  `src/lib/embeddings/vector-store.ts` (implementation in `storage.ts`);
  current file-upload processors live in `src/features/file-upload/processors/`
- RAG pipeline: `src/features/chat/rag/rag-pipeline.ts`, `rag-retriever.ts`
- RAG context injection (background memory cap gap): `handle-chat-with-model.ts`
- CORS DNR (Chromium only): `src/background/lib/dnr.ts`
