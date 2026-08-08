# Changelog

All notable changes from Chrome Web Store releases are documented in this file.
GitHub-only release-candidate changes are consolidated into the next version
published on the Chrome Web Store.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.12.8]

### Fixed

- Models you type in yourself now reach the model menu even when the provider
  has no model list to discover. A custom provider whose `/models` request
  failed had its manually added model IDs dropped along with the request, so the
  provider was absent from the menu entirely and nothing could be selected from
  it. The IDs are configuration, not discovery, and are now kept either way.
- Testing a provider that only implements chat — many hosted OpenAI-compatible
  routers do — no longer reports "Connection Failed". A server that answers the
  model-list request with "no such endpoint" is checked against the chat
  endpoint instead, using one of the model IDs you added and one token, and
  reported as working when a token comes back. A refused key, a rate limit, and
  a server error still fail as before. So do the two ways an address can answer
  without being a chat endpoint: one that takes the request and goes quiet is
  reported after twenty seconds, and one that replies without generating
  anything — what a proxy or a login page does — is reported as an address to
  check rather than counted as a reply.
- A mistyped base URL is now told apart from a provider that simply publishes
  no model list — both answer the same way — and reported as a base URL to
  check rather than as a working provider.
- A provider that returns HTTP 404 no longer reports "The provider
  configuration was not found", which described a different problem than the
  one you had. The provider's own message — which model or endpoint was missing,
  and what to check — is shown instead.
- The model menu now names providers that returned nothing, instead of leaving
  them silently absent from the list.
- Switching the theme in Firefox no longer leaves the extension sluggish. The
  saved preference was written back every time it arrived, and Firefox reports
  a write as a change whether or not anything moved, so one switch kept
  arriving and being rewritten for as long as the page stayed open. The
  preference is now applied only when it differs.

### Changed

- A provider with no model list is asked for one once, not on every refresh. A
  chat-only endpoint used to collect a failed request every few seconds — from
  the model menu and from the background connection check — for an answer that
  was never going to change. The answer is now remembered per provider on this
  device, and re-checked after a day, whenever the base URL, wire, or preset
  changes, and whenever you press Test.
- The background connection check runs once a minute instead of every ten
  seconds, and pauses while the settings page is in a hidden tab. Editing a
  provider still re-checks it immediately.
- A provider running on model IDs you declared is labelled as such rather than
  reported as a failed connection.
- Editing a provider's base URL no longer runs a connection test on every
  keystroke. Typing one URL fired one test per character — on a hosted
  provider, a real API call per keypress — and none of them told you anything,
  because the check reads saved configuration and you were still typing. The
  check now runs when a change is saved, and the status you see after saving
  describes the endpoint you just saved rather than the one before it.
- A support report no longer says "Provider reachable: no" for a provider that
  publishes no model list, and no longer says "yes" on the strength of a model
  list that the IDs you declared filled in on their own. It reports what was
  actually confirmed, and "not checked" when nothing was — a mistyped base URL
  and a working chat-only provider answer alike from there, and either guess
  sends whoever reads the report after the wrong thing.
- A provider that publishes no model list is marked "model IDs only" in both
  the provider grid and the panel header. Each read the model count on its own
  and showed a green connected dot for an endpoint the background check never
  contacted; the count comes from the IDs you declared. Testing the connection
  still reaches the endpoint and still reports what it found.

## [0.12.7]

### Changed

- The store listing now names the three verified providers in its title, so
  searching for LM Studio or llama.cpp can find the extension at all. The
  summary drops "Chrome extension" — which the store already knew, and which
  was wrong on Firefox, where the same text appears in the add-ons manager in
  every language — and names local RAG, web search, and page context instead.
- The README links the Firefox add-on. It has been published since 0.12.6 but
  the repository only offered a Chrome Web Store link.

No functional changes: this release is store metadata only.

## [0.12.6]

### Added

- The context sheet's tab list reports how many of the listed tabs are going
  into the prompt, and gains a select-all control scoped to whatever the search
  filter is showing — so a filtered selection never silently includes tabs you
  cannot see. Once every listed tab is selected, the same control clears them.
- Upgrading from an older chat-history format now verifies every kind of stored
  data — chats, messages, attachments, prompt templates, saved tool runs — and
  checks the imported database for damage before it becomes the one in use.
  Anything that does not arrive intact leaves your history on the previous
  store, untouched, rather than switching over to an incomplete copy. A
  half-finished upgrade interrupted by a browser restart is rolled back and
  retried from the original on the next launch.
- A support report from a device that went through that upgrade now says how it
  went — whether it succeeded, which check failed, and how many attempts it
  took. Row counts stay on your device; only how many rows a table came up short
  is included, and a device that never had an older store says nothing at all.
  Nothing is sent anywhere unless you open a report yourself.

### Changed

- Model parameter sizes now come from whatever each server actually reports, and
  are shown on one scale. LM Studio models read their size from the model id,
  since no LM Studio endpoint reports a size of any kind; OpenAI-compatible
  servers (vLLM, LocalAI, KoboldCPP, llama-swap) do the same, so a self-hosted
  `Qwen3-8B` no longer shows a blank badge next to sizes from Ollama and
  llama.cpp. Ids that do not state a size unambiguously stay blank rather than
  having one guessed for them.
- Ollama models stored as safetensors or MLX now show their family, size, and
  quantization instead of blank fields. `/api/tags` omits those for non-GGUF
  models, so they are filled in from `/api/show` for exactly the models missing
  them, with the result cached per model file.
- LM Studio models that report tool support in their catalog entry now have tool
  calling detected from that report rather than inferred from a provider
  default.
- The capability sheet now describes what your provider reported for *this*
  model — everything, some of it, or nothing — instead of a fixed claim about
  the provider. **Detect** runs its checks one at a time, so a local server
  loading a model no longer spends the other checks' timeouts waiting behind it,
  and a check that could not finish is now named as unfinished instead of shown
  as an unsupported capability.
- Context sheet rows carry one stable label each ("Page & tab context", "Search
  uploaded files", "Web search"); the checkmark alone shows whether a row is on.
  Labels no longer change wording when you enable them.
- The context summary moved under the sheet's title, where it stays visible in
  every view, and screenshot capture joined the upload row — both stage an
  attachment for the next message. Permissions & privacy and Attachments now
  show a chevron, which is the sheet's only navigation affordance.
- Dense side-panel rows across the model menu and context sheet share one
  spacing scale. Leading edges had drifted to 8/16/18/26 pixels within a single
  sheet, the model menu reserved about 33 pixels of unusable space on the right
  of every row, and the tab list was capped at a height that clipped a row
  mid-way while leaving the rest of the sheet empty.
- Model icons are matched on name tokens. "dolphin-llama3" is no longer given
  the Phi icon because its name contains "phi", "codellama" reaches the code
  icon, and embedding models are recognized as embedding models before their
  family is considered. Added icons for starcoder, mixtral, qwen, and deepseek.
- Bumped package version to `0.12.6`.

### Fixed

- Chat-history storage now fills in any table it is missing when it opens.
  Profiles first created on 0.6.0–0.9.x never got the retrieval-feedback table
  added in 0.10.0, because the schema was only applied to a database that had no
  chats yet — so on those profiles anything writing to it failed silently.
- A reply that finishes without any answer now says so and offers a retry.
  Providers report a model unloaded mid-turn — or a conversation with no room
  left to answer in — as a successful, empty response, which used to leave a
  blank assistant bubble with nothing to read and no way to retry.
- Every message on the send path is now translated: the "no model selected" and
  provider-selection warnings, the failures for creating a chat and saving a
  message, the context-preparation failure, the grounded-only refusal, the
  context-trimmed notice, and the retrieval warning. All of these previously
  appeared in English regardless of the selected language.
- YouTube transcripts now come from the video you are watching. YouTube changes
  videos without reloading the page, so the transcript could be read from
  whichever video the tab opened on, with nothing to indicate the mismatch.
  Captions also prefer your browser's language when the video offers them, with
  English as the fallback; timestamps are still included on every line.
- A cancelled model-list request now reports the cancellation instead of
  returning a partial catalog assembled from whatever finished first.
- The capability sheet no longer credits a provider's catalog for a capability
  that was actually taken from the provider default.
- Reasoning support is no longer reported as definitively absent for LM Studio
  models. Their catalog does not describe reasoning at all, so a reasoning model
  could be marked as not supporting it; it is now left for a probe or your
  override to settle.
- Repeated model lists no longer re-request the same model details on every
  refresh.
- Staged images in the attachments view now fill the sheet's width instead of
  sitting as small fixed tiles in an otherwise empty panel.
- Restoring a backup made by version 0.6.3 or earlier now says that its chats are
  in a format the extension no longer reads, instead of reporting the archive as
  missing a database file. Its settings, embeddings, and knowledge sets still
  restore.

### Development

- Chat-database worker failures now report their cause — message and source
  location, including for a worker that fails to load — rather than "worker
  crashed", and a message the worker cannot clone no longer leaves its caller
  waiting forever. That reporting immediately identified a development-only
  failure where the dev server's origin was missing from `worker-src`, so
  durable chat history could never migrate to OPFS under `pnpm dev`. Packaged
  builds are byte-identical, and a test asserts a dev origin cannot reach a
  packaged manifest.
- The selection overlay reads its state from a context instead of forwarding 32
  props through five components, so adding a control is one edit rather than
  four.
- The chat context sheet is split by job: settings, tab-list reconciliation,
  summary composition, and views each own a module, leaving the sheet itself at
  about 205 lines.
- Icons are imported from `lucide-react` directly; the re-export barrel bought
  no bundle savings and enforced nothing, and it split the convention across 116
  files.
- Removed components with no caller outside their own layer, and fixed component
  name suffixes to describe what each one renders.
- Split the settings search/deep-link registry into one module per options tab
  while preserving its existing public API and ordering.
- Added a policy registry for retained runtime messages and ports, plus source
  contracts that keep chat history behind its repository facade, SQLite
  internals out of feature/UI code, and feature stores out of the root store
  directory.
- Extracted the tab-context picker from the chat context menu so tab browsing
  and preview behavior can evolve independently from attachment and model
  context controls.
- Stopped generating the obsolete all-languages TypeScript catalog. App
  translations remain source JSON files loaded as one lazy chunk per language;
  generation now produces only extension metadata and the small selection
  overlay catalogs.
- Resource generation no longer runs on `pnpm install`. Every build script
  already runs it, the committed extension locales do not depend on it, and CI
  keeps its own generated-drift and translation gates.
- Aligned local verification with CI's dead-code and translation-completeness
  gates, and extended browser smoke checks to enforce lazy locale packaging for
  both browser targets.

### Documentation

- `AGENTS.md` is organized around rules rather than history, and now documents
  capability detection, the per-server differences in what a model list reports,
  and the development-build facts that were previously only learned by
  rediscovering them.

## [0.12.5] - 2026-07-29

### Added

- Chrome and Firefox package budgets now cover unpacked size, ZIP size, the
  largest generated chunk, duplicate binary assets, and critical entry
  surfaces. Dead-code checks also run in CI.
- Two new diagnostic self-tests. **Local provider CORS rule** reports whether
  Chromium's request-header rule is installed and still matches the provider
  address you have configured — a rule left behind by an older address looks
  identical to an unreachable server otherwise, and those two are the most
  commonly reported failures. Firefox reports it as not applicable, since it
  asks you to configure the origin on the server instead.
- **Turn recovery checkpoints** self-test, which checks that an interrupted
  reply can still be recovered and that a turn waiting at a tool-approval
  prompt is not mistaken for an abandoned one.

### Changed

- Ordinary pages now load only a small selection detector. The React selection
  overlay, its active-locale catalog, page extraction, provider-model
  discovery, inactive settings tabs, and backup code load only when needed.
- Extension icons now use purpose-sized 16–128 pixel assets instead of shipping
  one oversized source image.
- Removed Mermaid runtime rendering and unused font subsets. Mermaid source can
  still be previewed as text, copied, and downloaded.
- Standardized typechecking on one TypeScript package.
- Release and documentation scripts now use the installed `tsx` executable
  instead of allowing `npx` to resolve or download a different version.
- Prompt templates are stored as individual database rows instead of one
  synced blob. Editing a template no longer rewrites the whole library, and a
  large collection can no longer fail to save because the sync-storage limit
  was reached. Existing templates move across on first use, import and export
  are unchanged, and anything that fails to convert is left in place rather
  than discarded.
- Settings now report an over-limit save with the setting that caused it,
  instead of the browser silently rejecting the write.
- Loaded-model details for LM Studio now show model family, size, and
  quantization instead of blank fields.
- Model information, loaded models, unload, warm-up, model-library search, and
  embedding-model checks all moved onto the internal typed request boundary
  introduced in 0.12.4, which validates both ends and keeps credentials and
  endpoints out of results.
- Bumped package version to `0.12.5`.

### Fixed

- Selection-overlay injection can recover from transient background injection,
  locale loading, and mount failures. The bootstrap waits for an explicit
  ready signal and releases its retry latch when startup does not complete.
- A duplicated provider entry is now collapsed to one, keeping whichever copy
  holds your API key or custom models. Previously both entries could persist,
  with the second invisible to everything that looked a provider up by name
  while still appearing in the provider list.
- Removed three provider actions that no code path could reach.

### Security

- Page, web-search, browser-history, selection, screenshot, and local-document
  tool results are marked as untrusted input. When one enters a turn, approval
  grants issued against earlier input no longer authorize later tool calls,
  and a tainted turn cannot create a persisted **Always allow** grant.

### Development

- CI now rejects generated-resource drift and incomplete translations
  explicitly, in addition to type, lint, dead-code, test, package, and bundle
  checks.
- Critical packaged-browser persistence tests cover Chromium owner restart,
  migration, rollback-blob integrity, and durability behavior.
- Added a machine-readable compatibility ledger with source-version,
  removal-gate, target-release, and recovery-path ownership for retained legacy
  behavior. The sql.js live fallback remains in `0.12.x`; removal is gated for
  `0.13.x`.

### Documentation

- Search engines are pointed at the 18 written guides rather than the 62
  auto-generated API reference pages, which had been outnumbering them more
  than three to one in the sitemap.
- Pages now publish a last-updated date, breadcrumb information, and a correct
  canonical address whether or not the address ends in a slash.
- Preview deployments of the documentation site now refuse indexing outright
  instead of relying on the hosting platform's default.
- The AI-entrypoint files (`llms.txt`, `ai.txt`) take their page order from the
  same source as the sidebar, so the two can no longer disagree, and a page
  missing a description fails the build instead of silently advertising the
  site's generic one.

## [0.12.4] - 2026-07-24

### Added

- Chat errors now carry a stable support code, an incident ID, and the failure
  phase, and a failed turn is styled as a failure rather than as model output.
- Recovery actions on the failed message itself: re-enable a switched-off
  provider and re-run the turn, wait out a rate limit, or jump straight to the
  setting involved.
- Failure details are saved with the message, so a report survives reopening the
  side panel or restarting the browser.
- **Copy diagnostics** beside **Open an issue**, with a matching empty code block
  in the draft to paste into. Generated locally; nothing is uploaded on its own.
- A reference for every error code the extension can show, under Docs → Guides →
  Troubleshooting → Error reports.
- A post-uninstall feedback page. It receives only the extension version and
  interface language — no identifier, no usage data, no chat content.

### Changed

- Reduced the packaged extension size by dropping a duplicate SQLite WASM binary
  and a redundant bundled PDF worker (Chrome package about 6.3 MB down to about
  4.3 MB), with no change to features or behavior.
- Selected the persistence owner for each browser at build time so a build ships
  only its own owner path — the Chromium offscreen document or the Firefox
  background page — instead of carrying both.
- Raised the minimum supported Chrome version to 116, the real floor for the
  OPFS SQLite persistence backend, so the requirement is stated honestly.
- Consolidated provider HTTP error handling into one shared path for consistent
  status codes, retry hints, and user-facing messages across providers.
- Every bug-report draft now carries the same environment details, paste block,
  privacy note, and length safeguards, wherever it was started from.
- One report action per failed turn instead of two with different detail.
- Recovery buttons stop being offered once a failure is over an hour old, so
  scrolling back cannot re-run an old turn or change a provider setting by
  accident. The link to the relevant setting stays.
- Diagnostic self-tests are shared briefly between requests, so viewing several
  failed messages no longer repeats the same provider checks. **Run self-tests**
  always measures fresh.
- Bumped package version to `0.12.4`.

### Fixed

- Provider errors now identify the provider, model, sanitized base URL, and HTTP
  status, while keeping credentials and raw upstream responses private.
- Disabled providers can no longer serve chat, selection-action, RAG
  reformulation, or model-warmup requests from a stale model selection.
- Provider adapters recognize missing or unloaded models, context limits,
  unsupported input, memory exhaustion, rate limits, overload, and interrupted
  streams without exposing raw responses. Filesystem-shaped model IDs redact
  local account names in drafts.
- Reports read the provider's on/off state instead of inferring it, and label a
  duration measured against an unreachable provider as time-to-failure.

## [0.12.3] - 2026-07-23

### Added

- Added OpenRouter support and normalized remote-provider handling, including
  durable replay of provider reasoning metadata across tool calls and restarts.
- Added a versioned, validated provider RPC boundary for configuration,
  connection tests, and model discovery, with authorization, safe errors,
  timeouts, and end-to-end cancellation.
- Added a provider-neutral onboarding flow and local diagnostics for connection,
  storage, permissions, and browser compatibility.
- Added a single-owner OPFS SQLite persistence backend with verified migration
  and packaged-browser persistence benchmarks for Chrome and Firefox.
- Added durable SQLite checkpoints for native and prompt-based tool loops, with
  same-request recovery after MV3 service-worker restarts.
- Added native Anthropic Messages API support for user-added providers,
  including streaming, images, tool calls, and manual model IDs.
- Added session tags, explicit message forks, and a local-data inventory with
  backup and wipe controls.

### Changed

- Rebuilt the settings and maintenance experience with intent-based navigation,
  searchable settings, consistent controls, improved responsive layouts, and
  clearer status and recovery feedback.
- Centralized provider capability detection and model routing so saved mappings
  and runtime evidence remain the source of truth.
- Marked custom provider setup as Beta to reflect its first public release and
  distinguish it from verified built-in providers.
- Limited verified built-in provider profiles to Ollama, LM Studio, and
  llama.cpp; other compatible endpoints now use the custom-provider flow.
- Unified composer context controls and RAG chunking, simplified message edits,
  and disabled chat-memory indexing by default for new profiles.
- Added Ollama model capability overrides and made model refresh invalidate
  cached capability details.
- Adopted the TypeScript 7 compiler and reduced build and test times.
- Bumped package version to `0.12.3`.

### Fixed

- Fixed provider state races involving saves, model refreshes, tool probes,
  provider switching, and stale RPC responses.
- Fixed provider removal confirmation remaining open and retargeting another
  provider after a successful removal.
- Fixed backup import and reset flows for encoded settings, open database
  handles, and loading-state recovery.
- Fixed interrupted chat persistence, atomic message saves, provider error
  attribution, alternating tool-result roles, and native llama.cpp tool loops.
- Fixed provider lifecycle requests using inconsistent base URLs, failed model
  details being cached as successful empty data, and invalid runtime payloads
  leaving message channels open.

### Security

- Upgraded PostCSS to `8.5.16`, removing the vulnerable docs-build dependency
  path reported in `GHSA-6g55-p6wh-862q`.
- Kept provider API keys and other private provider state in device-local
  storage and excluded them from backups.
- Redacted private values from diagnostics and restricted runtime messages to
  authorized extension surfaces.
- Sanitized print and PDF export content and bound sensitive browser-tool grants
  to their approved origin.

## [0.11.27] - 2026-07-01

### Added

- Unified chat search across session titles and message content, with localized
  empty and clear-search states.
- S4 vector durability smoke coverage: persist a chunk, reload the module graph,
  and verify similarity search still finds it.
- Competitor comparison pages for the documentation site.
- OpenAI-compatible provider round-trip smoke coverage:
  stream a response, persist the assistant reply, reload the SQLite facade, and
  assert the reply survives.
- SEO foundation docs: quick start, privacy, FAQ, and Ollama CORS troubleshooting
  pages, with FAQPage structured data and higher-signal homepage retrieval copy.
- An always-visible context-state pill and pre-send context preview covering page tabs, attached files, local knowledge, and web search.
- A live model-tools inventory in Privacy & permissions showing family and browser-permission availability.
- An in-panel provider setup flow for first-run connection failures and empty model lists.
- Optional, permission-gated tools for recently closed tabs/windows and synced-device sessions. Session reads honor unreadable and never-read URL exclusions.
- Automated 0.10.3 provider-storage upgrade contracts and a `verify:release` gate.
- A guarded `tabCapture`/offscreen feasibility contract documenting browser and product blockers before capture UI ships.
- Permissions & privacy panel (Options + chat popover) with optional, on-demand browser permissions and feature-flag gating.
- Global keyboard shortcut and omnibox (`olc`) quick-ask to open and send to the side panel.
- Notifications and reminders.
- Page screenshot into vision chats, with optional auto-attach for vision models.
- Browser knowledge: optional RAG over bookmarks/history that honors exclusion scope.
- Per-site content-extraction profiles and tab-group workflows.
- Artifact previews (canvas) with per-artifact downloads.
- Prompt template variables.
- Model-callable tools `save_artifact` (write generated text to disk) and `capture_screenshot`, plus a multimodal tool-result path.
- Per-model and per-family tool governance.
- Session count badge in the chat-sessions sheet header.

### Changed

- Updated shadcn tooling and added restrained scroll fades plus live-status
  shimmer to existing chat and settings surfaces.
- AI-readable docs now remove MDX `export const` data and SEO-only FAQ markup
  while preserving the rendered documentation prose.
- Polished the prompt sheet, options tab naming, sources icon, and compact
  scroll-to-bottom control.
- Bumped package version to `0.11.27`.
- Local OpenAI-compatible `401`/`403` failures now point users at CORS/origin
  setup instead of misleading API-key guidance when the provider URL is local.
- Docs site upgraded to Astro 7 and Starlight 0.41, with the Mermaid markdown
  hook moved to Astro's current markdown processor API.
- RAG, page/tab context, and web results now share one grouped Sources sheet per answer.
- Settings navigation is grouped by user intent while preserving existing tab ids, deep links, and persisted storage keys.
- Technical labels now use plain-language names such as Knowledge & web, Knowledge storage, Page & tabs, and Data & backup.
- Privacy is a first-class settings group with an explicit local-storage overview.
- Streaming follows output without restarting smooth-scroll animations, and returning to the bottom no longer waits 300 ms.
- Queued assistant replies use a stable message-shaped loading skeleton.
- Optional-permission switches now react immediately when access is granted or revoked from browser extension settings.
- Chrome-only manifest permissions are omitted from Firefox builds at generation time.
- Chat header, session selector, semantic search, provider status, embedding status, and export controls use a quieter compact icon treatment.
- The per-session export shortcut no longer occupies the chat header.
- Long-running model/embedding fetches now time out instead of hanging.
- RAG and background memory context capped to the configured character budget.
- Message-router payloads centrally parsed and validated.
- Alarms permission made optional; removed the unbuilt prompt-chaining flag.

### Fixed

- Selection Actions now preserve configured model system instructions and
  requested output language instead of biasing extraction results toward English.
- Message footers use explicit export and delete actions instead of ambiguous
  ellipsis menus, and chat-memory sources use a primary-colored user icon.
- Session titles now truncate through CSS without clipping focus rings, chat
  search resets cleanly, and the scroll-to-bottom button hides near the end.
- Browser smoke verification no longer calls the deleted Firefox manifest post-processing script.
- Browser automation now serializes TSX callbacks safely, waits for fonts before screenshots, and completes live Chromium/Firefox chat checks.
- Firefox builds declare no extension data collection and no longer emit the missing declaration warning.
- SQLite durability hardened: foreign keys on (cascade deletes) and an explicit flush path on unload/restart.
- HNSW vector index reloads on service-worker restart and tolerates duplicate ids; vector deletes reconciled across stores.
- "Reset" now wipes provider API keys and no longer skips string-keyed modules.
- Content extraction restores patched `fetch`/XHR instead of leaving the host page rewrapped.
- Streaming: error path keeps the message id, and abort is keyed per-stream so concurrent chats don't cancel each other.
- Scoped the per-token re-render storm to the active session.
- Message delete now asks for confirmation.

## [0.10.3] - 2026-06-20

### Added

- i18n-backed settings search index that searches translated labels, descriptions, and visible child strings instead of only hand-written headings.
- Ranked settings search with case/diacritic/punctuation normalization, partial-token matching, and typo-tolerant fuzzy matching for common misses like `provder`, `ollma`, and partial queries like `prese`.
- Search coverage for provider controls, prompt templates, keyboard shortcuts, guides, reset modules, reset danger zone, embedding storage stats, semantic search, cache, ANN, and advanced embedding search controls.
- Cmd/Ctrl+K shortcut on the options page to focus settings search, plus compact placeholder-based search hints for smaller screens.

### Changed

- Settings search results now show the matching translated child text with parent context, then deep-link to the owning tab and focus/highlight the concrete control where possible.
- `useChat` now delegates turn lifecycle work to `useChatTurnController`, keeping the public hook focused on wiring state into the chat UI.
- Chat composer attachment handling, file-upload pipeline work, and provider settings panels were split into smaller focused modules without changing storage keys or public behavior.

### Fixed

- Settings search now finds presets, browser settings, base URL/API key provider controls, prompt/shortcut/guide text, and embedding search internals that were previously missed.
- Search deep links no longer stop at the right tab for many controls; focus IDs were added across settings cards, fields, reset rows, guide rows, shortcut rows, and provider controls.
- Duplicate `search-limit-topk` focus targets between Context and Embeddings were separated so highlights land on the intended control.

## [0.10.2] - 2026-06-16

### Added

- Provider-agnostic web search tool (`web_search`) for tool-capable models, gated behind device-local settings and exposed as one model-visible tool regardless of backend. Initial backends are SearXNG, Brave Search, and Tavily.
- Local SearXNG Docker Compose setup under `searxng/` for private development/testing with JSON search enabled.
- Web search settings in the Context tab: enable toggle, provider selector, API key/endpoint fields, safe-search, result count, SearXNG page count, beta badge, provider base URL transparency, and test search.
- Chat composer globe toggle for enabling/disabling web search without leaving the chat.
- Settings registry, settings search, per-section reset, preset previews, and one-click presets for common configuration profiles.
- Lenient chat import salvage path that keeps recoverable sessions and reports per-session diagnostics instead of dropping whole imports.

### Changed

- Documentation domain moved to `https://www.ollamaclient.in/`.
- Documentation updated for image input, browser-context tools, and model capability gating.
- Tool guidance now tells models to use `web_search` for current/time-sensitive facts, include the current date in search planning, and cite returned URLs.
- Web-search results are normalized, capped, and treated as untrusted snippets before being returned to the model.
- Web-search sources now split used and unused results, show richer metadata, and keep source identity stable when multiple tool runs return the same URL.
- Web-search backends now support time-range filtering where available and dedupe normalized URLs before result caps are applied.

### Fixed

- Thinking-only tool responses now surface as the visible assistant answer instead of falling through to the generic "no final answer" fallback.
- Ollama and LM Studio provider capability docs now report tool-calling support correctly; Ollama model-level tools still require the model's reported `tools` tag.
- Settings batch writes now fail fast if scalar and field-level writes are mixed for the same storage key instead of silently dropping one write.
- Settings `focus` URL params are cleaned up after use so tab changes do not retry stale highlights.

## [0.10.1] - 2026-06-13

### Added

- Tool calling runtime (foundation): tool-capable models can call internal tools mid-conversation, with the calls and results round-tripped through both provider adapters (Ollama native `tools` + `tool`-role results; OpenAI-compatible `tools`/`tool_calls`). Gated on the model's resolved `toolCalling` capability — non-tool models are completely unaffected.
- Provider-agnostic, MCP-ready architecture: a `ToolSource` abstraction with a `ToolRegistry` that aggregates sources and routes calls by name. Internal tools are the first source; a future MCP server registers as another source with no change to the adapters, the tool loop, or the UI.
- Internal tools, all running locally: `rag_search` (past-conversation memory), `file_search` (uploaded/indexed documents), `current_tab` (active tab's readable text, incl. YouTube transcript), `list_tabs` + `read_tab` (enumerate and read any open tab by id or title/URL — answer about any tab without adding it through the tab-context UI), and `selected_text` (most recent page selection). Tab tools inject the content script on demand, so tabs opened before the extension load are read without a refresh. They honor the user's excluded-URL settings and explain gracefully when a tab is a browser-internal page (chrome://, web store) rather than failing.
- Transparency: the chain-of-thought reasoning trace now shows each tool run live (name, running/done/error status, and the sources it looked at), so it is always visible what the extension is doing on the user's behalf.
- Image / vision input: attach images to a chat message for vision-capable models. Drag-and-drop, file picker, and clipboard paste are supported; staged images appear in the composer's attachment sheet (reusing the file-attachment UI) and as click-to-enlarge thumbnails in sent messages.
- Image attach is gated on the selected model's resolved `vision` capability — non-vision models show a clear blocked state pointing at the model-menu capability override.
- Provider adapters send images in each provider's native format: Ollama `images` (base64), OpenAI-compatible `image_url` content parts.
- Images persist with the chat (reused `files` table, no schema migration) and reopen with previews.
- Configurable per-image size cap on the options page (default 10MB). Supported formats are PNG, JPEG, and WebP; HEIC/HEIF shows a specific "export as JPEG/PNG" message. Strings translated into all supported locales.
- Model capability detection foundation: a normalized `ModelCapabilities` layer (`text`, `vision`, `tool calling`, `reasoning`, `context length`) resolved per model with a `source` and `confidence`, layered as **user override → model metadata → provider default**.
- Capability detection across all providers: Ollama `/api/show` capability tags (high confidence), LM Studio model `type` (`vlm`/`embeddings`, medium confidence), and provider defaults elsewhere. Unknown capabilities resolve to off — never enabled on a guess.
- Per-model capability badges in the model menu (completion, vision, tools, thinking, embeddings) with tooltips, fetched only while the menu is open and cached.
- Manual capability overrides: a Model Capabilities sheet for models whose provider can't self-report, to declare vision/tools/etc. by hand. Overrides persist per model and are sync-safe. Translated into all supported locales.

### Changed

- Tool calls are now inspectable in the reasoning trace: each tool step shows its name, status, the input arguments the model passed, and a preview of the output (or the error / sources / "trimmed" note). The panel auto-expands while a tool is running and collapses once the answer streams.
- Reasoning ("thinking") is now shown inline and live instead of behind a click-to-open popover. It auto-expands while the model is thinking — so on reasoning models like qwen3, where the long thinking phase used to look frozen with the answer appearing all at once, the live reasoning is now visible and scrolls as it streams; it collapses once the answer starts and can be toggled anytime.
- When tools are offered to a model, the system prompt now names them and tells the model to call them for "current page / this video / my files / open tabs / selected text" questions. Without this, capable models sometimes replied "I can't access your tabs" instead of calling the tool. (Reasoning-distill models such as deepseek-r1 still tag `tools` but call them unreliably — prefer qwen3 / llama3.x for tool use.)
- Tool results are now trimmed to a configurable per-result character cap (default 10,000) before the model reads them, so a long page, transcript, or document dump no longer balloons the prompt and stalls generation on a laptop. When a result is trimmed it is shown in the reasoning trace ("result trimmed — change limit in Settings → Context") and the limit is adjustable on the options page.
- Model tool-capability is cached per session instead of re-fetched (`/api/show`) on every message, cutting pre-stream latency and request churn.
- Each tool call has a 60s timeout; a hung tool degrades to an error result instead of blocking the chat.
- Browser tab access now defaults to **on** so tab context and the tab tools work out of the box (still toggleable from context settings / options).
- Sending a message now shows the "Thinking…" state immediately. Previously the indicator only appeared after pre-stream work (RAG embedding, vector search) finished, so a slow context build looked like nothing was happening.
- `read_tab` now treats a stale tab id as recoverable: it refreshes readable tabs and falls back to the active readable tab when possible, instead of surfacing a hard tool error.
- Tool-call status icons and labels were tightened so provider health, embedding health, exports, context controls, stop generation, and session drawer actions read correctly at a glance.
- Provider errors now surface a clean, human-readable message in chat instead of the raw provider response body (the raw text is kept for diagnostics only).
- OpenAI-compatible providers no longer default to `https://api.openai.com/v1`; a blank base URL falls back to a local endpoint so a misconfigured provider never silently sends data to a cloud API.

### Notes

- The tool exchange is ephemeral, mirroring RAG context injection: only the final answer and the tool-run trace persist — no schema migration and no new message rows.
- Architecture is MCP-ready: a future MCP server registers as another tool source with no change to the adapters, loop, or UI.

### Fixed

- Image attach no longer false-blocks on the first try while the selected model's vision capability is still being detected.
- Capability override sheet: an external (Chrome-sync) update no longer overwrites unsaved edits, and a failed save keeps the sheet open and surfaces the error instead of failing silently.
- Per-model capability overrides are written through a serialized queue so two rapid saves can't drop one another.
- Reranking no longer silently drops documents that lack an embedding; they keep a neutral score instead of being removed from results.

## [0.8.0] - 2026-06-10

### Added

- Selection Actions: selected page text now opens a local AI action toolbar with Summarize, Rewrite, Shorten, Fix Grammar, Explain, Extract Action Items, Translate to English, and Custom Prompt actions.
- Floating result panel with streaming output, retry/cancel, copy, Open in Chat, and preview-first Replace/Insert controls.
- Safe page editing helpers for `input`, `textarea`, and simple single-block `contenteditable` selections. Generated output is inserted as plain text only so page UI and heading/list structure are preserved.
- Selection Actions settings for enablement, minimum selected characters, and enabled action list.
- Thinking/reasoning model support in the selection overlay: live "Reasoning…" section with animated pulse indicator auto-expands during streaming and collapses when done.
- Inline model selector in the panel header (same row as title); filters out embedding models; syncs with sidebar model selection.
- Dev-only Theme Lab for tuning sidebar, chat, composer, message, and control tokens live during local development.
- Context preview sheets for selected tabs, RAG sources, and attached files with searchable tab context and scrollable extracted text previews.
- Tab count badge on the context menu icon shows how many tabs are active in the current context.
- Copy button on each RAG source and tab context chunk (inside the sources sheet) for quick content copying.
- Copy button on expanded file attachment previews in the composer attachment sheet.
- Markdown rendering in the selection overlay thinking/reasoning panel during streaming.

### Changed

- Selection overlay fully rewritten as a React component (`SelectionOverlayApp`) mounted inside the shadow DOM, replacing the prior imperative content-script logic. State is managed by a `useReducer` state machine; stream lifecycle is handled imperatively to avoid declarative/imperative conflicts.
- Selection overlay panel split into focused sub-components: `PanelHeader`, `PanelThinking`, `PanelFooter`, `SelectionPanel`, `SelectionToolbar`.
- Panel uses shadcn `Card` and `buttonVariants` for design-system consistency with the rest of the extension.
- Shadow DOM CSS extracted to `overlay-shadow-styles.ts`; stream chunk/done/error logic extracted to `overlay-stream.ts`; content script reduced from 966 to ~530 lines.
- `SourceAccordionItem` renamed to generic `AccordionCard` with an optional `metadata` prop — reusable outside the RAG/source context.
- `MessageSourcesSheet` now uses `PreviewSheet` as its structural shell, eliminating the duplicated sheet/header layout.
- `PreviewSheet` body wrapped in a bounded flex scroll container so content always scrolls within the sheet height rather than overflowing it.
- Accordion item content areas (RAG chunks, tab context) capped at `min(16rem, 40vh)` with vertical scroll, matching the attachment preview behaviour.
- Sidebar, chat transcript, composer, message footer, run details, and session metrics now use the token-driven compact UI system.
- Chat action buttons now render from shared tooltip/action primitives with smaller icon sizing and compact overflow behaviour.
- Session metrics moved into the chat header as a compact metric trigger with a short popover summary.
- File attachments in the composer now sit in a compact horizontal rail; attachment list and prompt selector dialogs replaced with right-side sheets.
- `IconBadge` component extracted to deduplicate the icon + count badge pattern used across context buttons.
- Icon sizes standardised to `icon-xs` for thumbs up/down feedback and source-chunk action buttons.
- Chat/session stores, content scripts, provider settings, and selection-action UI split into smaller focused modules.
- Magic-number timeouts extracted into named constants.

### Fixed

- Selection toolbar not reappearing after closing the overlay and re-highlighting text on the same page.
- Shorten, Cancel, and more-menu actions broken in the selection overlay due to a stream lifecycle conflict between a declarative `useEffect` controller and imperative `setTimeout(startStream)` calls. Resolved by removing the `useEffect` controller entirely.
- Selected text now included in the message when opening a selection result in chat, with a separator between the quoted text and the action output.
- Streaming renders in the selection overlay throttled to prevent layout thrash on fast-arriving chunks.
- Shadow DOM CSS variables now isolated from host-page design tokens by pinning all tokens with concrete OKLCH values on the container element.
- Tailwind rem-based sizing fixed on pages with non-standard root font-size (e.g. YouTube) by overriding spacing, text, and radius with absolute `px` values.
- Toolbar/panel placement corrected for pages that apply CSS `transform` to ancestor elements.
- Reasoning trace state now distinguishes thinking from answering and avoids duplicate streaming indicators.
- Context injection now respects selected page/RAG state instead of leaking stale context across conversations.
- Chat history now uses the SQLite facade only; the Dexie chat-history fallback has been removed.
- Left border removed from PDF message export cards.
- Extra padding on guides page and prompt list.
- Session metric now centred in the chat header.
- File chip sizing and composer attachment rail layout.
- Embedding models filtered from the panel model selector using the same `isEmbeddingModel` check as the sidebar.
- Shadow DOM CSS variables now isolated from host-page design tokens (YouTube, etc.) by pinning all tokens with concrete OKLCH values on the container element.
- Tailwind rem-based sizing (`h-7`, `size-*`, `gap-*`) fixed on pages with non-standard root font-size (e.g. YouTube `html{font-size:62.5%}`) by overriding `--spacing`, `--text-xs`, and `--radius` with absolute `px` values.
- All remaining `rem` values in shadow DOM custom CSS replaced with `px` so sizing is consistent across all host pages.
- Toolbar/panel placement corrected for pages that apply CSS `transform` to ancestor elements (creates a shifted fixed-positioning context); drift is measured and compensated after initial placement.
- Tooltip dark mode background uses card colour instead of foreground in shadow DOM context.
- Tooltip arrow hidden in shadow DOM.

## [0.7.3] - 2026-06-02

### Added

- Standardized error handling across all background handlers, providers, and storage layers with typed error envelopes and centralized `error-handler.ts`.
- Improved user-facing error display with guidance text mapped to common failure modes (connection refused, model not found, auth errors, etc.).

### Fixed

- System prompt now autosaves on change;
- Astro docs BaseLayout: replaced invalid Tailwind v4 `supports-[backdrop-filter]` syntax with standard `supports-backdrop-filter`.
- Theme toggle button on mobile screens: switched from duplicate `id` attributes to `data-theme-toggle` + `querySelectorAll` so multiple toggle instances work correctly.

## [0.7.2] - 2026-06-01

### Fixed

- YouTube watch pages now extract only the video title and transcript instead of falling back to generic page content.
- YouTube transcript extraction now supports modern transcript panels, legacy segment renderers, and caption-track fallback data.
- Udemy lecture pages now try the transcript panel first and fall back to normal page extraction when no transcript is available.
- Removed stale provider configs, such as OpenAI entries no longer present in the provider UI, from saved provider settings.
- Restored the lockfile dependency resolution for frozen CI installs.

### Changed

- Tab-context retrieval now respects the configured maximum context budget during RAG retrieval.
- Local development logging defaults to debug level for easier extraction troubleshooting.

## [0.7.1] - 2026-05-30

### Added

- Zod runtime validation across all JSON.parse sites in provider, storage, and prompt-import paths.
- Structured logger (`src/lib/logger.ts`) replacing ad-hoc `console.*` calls throughout the background, provider, and storage layers.
- `pnpm verify` convenience script: `pnpm typecheck && pnpm lint:check && pnpm test:run`.

### Changed

- Provider factory: replaced `if/else if` chain with `Record<ProviderId, ProviderConstructor>` lookup.
- Docs synced: README, AGENTS.md, and docs-src version/LOC references updated for 0.7.1.

### Fixed

- Removed catch-and-silence patterns in provider error handling — all catch blocks now log through the structured logger.

## [0.7.0]

### Added

- Chrome extension package localization metadata (`default_locale`, manifest `__MSG_*` substitutions, and `_locales` messages) so Chrome Web Store can detect supported languages.
- 0.7.0 frontend foundation: app-owned layout, form, settings, and feedback primitives that sit above shadcn/Base UI so preset refreshes do not own product behavior.
- Data-display primitives for repeated provider, model, source, file, metadata, context preview, command item, and info-list patterns.
- React Hook Form-safe controlled wrappers for number inputs, sliders, text inputs, textareas, selects, and switches.
- Internal frontend design-system documentation and visual-smoke screenshot capture for options/sidepanel light, dark, and long-locale checks.
- Selection button overlay that captures selected text and delivers it to the side panel chat via the background port.
- Composer context preview showing selected text before sending.
- `src/i18n/resources.ts` is now build-generated from `src/locales/` by `tools/generate-i18n-resources.ts`. It is `.gitignored` and regenerated by `pnpm prepare` (so a fresh install produces it) and by `pnpm dev`/`build`/`package` (which chain `pnpm generate:resources &&` first).
- `.husky/pre-push` running the full `pnpm test:run`; `pre-commit` no longer runs the full suite, only `test:related` via lint-staged. Commits got faster, the safety net moves to push.

### Changed

- Embedding test tools split into two standalone `SettingsCard` components (`EmbeddingTestGeneration`, `EmbeddingTestSearch`) with `modelExists` guard internalized.
- Fixed uneven card gap in embedding settings by removing stray spacer text nodes.
- Bumped package version to `0.7.0`.
- Chrome Web Store locale metadata is now generated from `src/locales/<lang>/translation.json` extension blocks, making `src/locales` the single source of truth for app translations and extension package localization.
- Newly synced locale keys now have localized copy across supported languages instead of English fallback text.
- Migrated high-churn settings surfaces to shared layout/settings primitives, including model parameters, context settings, RAG retrieval controls, text splitting, embedding search/limits/generation, storage stats, database management, and search empty states.
- Moved control-density sizing and slider cursor behavior out of global CSS fallbacks and into tokenized utilities / component-level classes.
- Removed dead code: `src/lib/rag/core/` (browser-RAG interface scaffolding never wired up), the orphan `src/stores/speech-store.ts` (live store is `src/features/chat/stores/speech-store.ts`), `src/contents/selection-button.tsx`, `src/background/migrations/rag-quality-migration.ts`, `src/components/ui/sidebar.tsx`, `src/scripts/verify-rag.ts`, `src/contents/i18n-lite.ts` (had zero importers; the live selection-button content script carries its own inline translations), and an unregistered provider stub that was never wired into the factory, default providers, or registry.
- Pruned 29 unused shadcn primitives from `src/components/ui/` and removed the corresponding npm deps (`embla-carousel-react`, `input-otp`, `react-resizable-panels`, `recharts`, `sonner`, `vaul`) — install tree drops by 39 packages.
- Removed the blanket `src/components/ui/**` lint override in `biome.json`; remaining vendored-shadcn a11y exceptions are now per-line `// 
` comments inside the offending files.
- Manifest (CSP, host permissions, web-accessible resources, gecko settings) is no longer duplicated in `package.json`; `wxt.config.ts` is the single source of truth.
- Migrations consolidated under `src/lib/migration/` (moved `embedding-dimension-migration.ts` over from `src/background/migrations/`, which is now gone).
- `MESSAGE_KEYS.OLLAMA` map trimmed to keys whose string value *actually* differs from `MESSAGE_KEYS.PROVIDER` (8 entries instead of 17). The dispatcher in `src/background/index.ts` shed the now-dead duplicate `case` arms — those compiled to the same string and were unreachable.
- Provider factory: replaced the `if/else if` chain that picked OpenAI-compatible subclasses with a `Record<ProviderId, ProviderConstructor>` lookup; collapsed `getProvider` and `getProviderWithConfig` to share one `instantiate(config)` helper.
- TypeScript target bumped to ES2022; surfaced a real latent class-field initialization bug in 5 OpenAI-compatible provider subclasses (`override capabilities = { ...this.capabilities, ... }` read the child's uninitialized slot under `useDefineForClassFields`). Each capability merge moved into the subclass constructor.
- `src/types/index.ts` (568 lines) split into six domain files (`chat`, `model`, `messaging`, `errors`, `content-extraction`, `ui-state`); `index.ts` is now a re-export barrel so the 98 existing `@/types` importers keep working.

### Removed

- `*.tsx`, `types.ts`, `index.ts` from `vitest.config.ts` coverage `exclude`. Coverage reports were hiding every UI component, type file, and barrel. They now reflect reality.

### Docs

- AGENTS.md, README, and CHANGELOG synced to reflect the actual repo layout and provider list.

## [0.6.5] - 2026-05-20

### Added

- Settings deep-links so other surfaces can open the options page at a specific section.
- Grounding mode plus configurable per-conversation context limits.
- Tab-content extraction wired into chat context.
- Tab-extraction inspector for debugging page content capture.
- Cross-browser verification automation (`pnpm verify:browser-smoke`, `pnpm verify:browser-automation`) covering CSP, manifest permissions, and an optional Ollama connectivity check.

### Changed

- Migrated shadcn primitives to the `base-mira` preset on Tailwind v4 across sidepanel and options for consistent design tokens.
- Trimmed unused dependencies as part of the shadcn preset migration.
- Standardized status styling and replaced ad-hoc emoji status indicators with shared status components.
- Aligned options and sidepanel UI on shared shadcn preset tokens.
- Expanded extension CSP to allow remote provider endpoints and added in-UI connection-troubleshooting hints.
- Hardened streaming-message updates against partial-state races.
- Extracted-tab content viewer is now a scrollable modal; extracted HTML is sanitized before display.

### Fixed

- Chat-stream now handles unexpected runtime-port disconnects without leaving the UI in a stuck loading state.
- Slider behavior and several lint violations introduced during the shadcn migration.
- i18n strings added for the extracted-tab context popup and the context-settings screen.

## [0.6.2] - 2026-04-05

### Added

- Multi-provider model support with explicit provider capabilities and routing for Ollama, LM Studio, llama.cpp, and additional providers (vLLM, LocalAI, KoboldCPP).
- Full backup/export and restore flows with manifest versioning, partial failure reporting, and ZIP-based data migration.
- Enhanced RAG pipeline features: hybrid search, reranking, quality filtering, feedback blending, recency boosting, and memory-aware retrieval.
- Embedding health and rebuild tooling, including progress feedback, dimension health checks, and model status indicators.
- Search UI enhancements with scoped tabs, result grouping, and dedicated search components.
- Print/PDF export entrypoint and improved export flows.
- Expanded i18n coverage across settings, prompts, feedback, and embedding/RAG controls.
- New welcome screen layout with modular hero/status/features components and refreshed onboarding.

### Changed

- Embedding strategy and storage now track provider/model metadata, support provider-aware fallbacks, and filter search results by embedding model/provider/dimension.
- Model selection and provider settings refactored with SelectedModelRef, provider migrations, and capability-aware UI.
- Chat UI and input UX refined (message bubbles, toolbar, scroll behavior, loading states, and context menus).
- File upload and extraction pipeline simplified for local PDF/DOCX processing.
- UI system migrated/refined with updated shadcn/base components, Tailwind v4 upgrades, and layout/styling polish.
- Settings layout reorganized with better navigation, more granular controls, and migration tooling.
- Storage migrations updated (provider mappings, embeddings, feedback) with clearer diagnostics and safer defaults.

### Fixed

- Embedding model detection, download, and fallback flows with improved status checks and timeouts.
- RAG pipeline edge cases (full mode, empty results) and search ranking inconsistencies.
- Context menu and background handler stability issues.
- Chat streaming jitter, scroll flicker, and race conditions around message updates.
- Tests updated for new provider and embedding metadata.

## [0.6.0] - 2026-02-08

### Added

- Multi-provider support with routing and provider settings (Ollama, LM Studio, llama.cpp).
- Internationalization for provider settings and related UI text.
- RAG enhancements: hybrid search, reranking, quality filtering, async retrieval, and sources UX.
- File attachment viewer in chat.
- Multi-browser build targets via WXT for Chrome MV3 and Firefox MV2.

### Changed

- Settings page layout with sidebar navigation, standardized form fields, and improved UI consistency.
- Embedding strategy updates with provider-aware embeddings and enforced fallbacks.
- Model management cleanup, including removal of model pull and embedding download UI.
- Chat streaming and handler refactors for improved behavior and clarity.
- Provider display tweaks (full version labels, model name truncation cleanup).

### Fixed

- Embedding model name normalization and more robust model checks.
- Legacy Ollama base URL synchronization for provider detection.
- Branch navigation logic in chat message footer.
- Minor i18n text cleanup and translation updates.

### Documentation

- Comprehensive docs refresh for v0.6.0, including RAG and WXT migration updates.

[Unreleased]: https://github.com/Shishir435/ollama-client/compare/0.12.8...HEAD
[0.12.8]: https://github.com/Shishir435/ollama-client/compare/0.12.7...0.12.8
[0.12.7]: https://github.com/Shishir435/ollama-client/compare/0.12.6...0.12.7
[0.12.6]: https://github.com/Shishir435/ollama-client/compare/0.12.5...0.12.6
[0.12.5]: https://github.com/Shishir435/ollama-client/compare/0.12.4...0.12.5
[0.12.4]: https://github.com/Shishir435/ollama-client/compare/0.12.3...0.12.4
[0.12.3]: https://github.com/Shishir435/ollama-client/compare/0.11.27...0.12.3
[0.11.27]: https://github.com/Shishir435/ollama-client/compare/v0.10.3...0.11.27
[0.10.3]: https://github.com/Shishir435/ollama-client/compare/v0.10.2...v0.10.3
[0.10.2]: https://github.com/Shishir435/ollama-client/compare/v0.10.1...v0.10.2
[0.10.1]: https://github.com/Shishir435/ollama-client/compare/v0.8.0...v0.10.1
[0.8.0]: https://github.com/Shishir435/ollama-client/compare/v0.7.3...v0.8.0
[0.7.3]: https://github.com/Shishir435/ollama-client/compare/v0.7.2...v0.7.3
[0.7.2]: https://github.com/Shishir435/ollama-client/compare/v0.7.1...v0.7.2
[0.7.1]: https://github.com/Shishir435/ollama-client/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/Shishir435/ollama-client/compare/v0.6.5...v0.7.0
[0.6.5]: https://github.com/Shishir435/ollama-client/compare/v0.6.2...v0.6.5
[0.6.2]: https://github.com/Shishir435/ollama-client/compare/v0.6.0...v0.6.2
[0.6.0]: https://github.com/Shishir435/ollama-client/releases/tag/v0.6.0
