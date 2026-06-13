# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- Documentation updated for image input, browser-context tools, and model capability gating.

## [0.10.0] - 2026-06-13
### Added
- Tool calling runtime (foundation): tool-capable models can call internal tools mid-conversation, with the calls and results round-tripped through both provider adapters (Ollama native `tools` + `tool`-role results; OpenAI-compatible `tools`/`tool_calls`). Gated on the model's resolved `toolCalling` capability — non-tool models are completely unaffected.
- Provider-agnostic, MCP-ready architecture: a `ToolSource` abstraction with a `ToolRegistry` that aggregates sources and routes calls by name. Internal tools are the first source; a future MCP server registers as another source with no change to the adapters, the tool loop, or the UI.
- Internal tools, all running locally: `rag_search` (past-conversation memory), `file_search` (uploaded/indexed documents), `current_tab` (active tab's readable text, incl. YouTube transcript), `list_tabs` + `read_tab` (enumerate and read any open tab by id or title/URL — answer about any tab without adding it through the tab-context UI), and `selected_text` (most recent page selection). Tab tools inject the content script on demand, so tabs opened before the extension load are read without a refresh. They honor the user's excluded-URL settings and explain gracefully when a tab is a browser-internal page (chrome://, web store) rather than failing.
- Transparency: the chain-of-thought reasoning trace now shows each tool run live (name, running/done/error status, and the sources it looked at), so it is always visible what the extension is doing on the user's behalf.

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

### Notes
- The tool exchange is ephemeral, mirroring RAG context injection: only the final answer and the tool-run trace persist — no schema migration and no new message rows.
- Architecture is MCP-ready: a future MCP server registers as another tool source with no change to the adapters, loop, or UI.

## [0.9.1] - 2026-06-13
### Added
- Image / vision input: attach images to a chat message for vision-capable models. Drag-and-drop, file picker, and clipboard paste are supported; staged images appear in the composer's attachment sheet (reusing the file-attachment UI) and as click-to-enlarge thumbnails in sent messages.
- Image attach is gated on the selected model's resolved `vision` capability — non-vision models show a clear blocked state pointing at the model-menu capability override.
- Provider adapters send images in each provider's native format: Ollama `images` (base64), OpenAI-compatible `image_url` content parts.
- Images persist with the chat (reused `files` table, no schema migration) and reopen with previews.
- Configurable per-image size cap on the options page (default 10MB). Supported formats are PNG, JPEG, and WebP; HEIC/HEIF shows a specific "export as JPEG/PNG" message. Strings translated into all supported locales.

### Changed
- Provider errors now surface a clean, human-readable message in chat instead of the raw provider response body (the raw text is kept for diagnostics only).

### Fixed
- Image attach no longer false-blocks on the first try while the selected model's vision capability is still being detected.
- Capability override sheet: an external (Chrome-sync) update no longer overwrites unsaved edits, and a failed save keeps the sheet open and surfaces the error instead of failing silently.
- Per-model capability overrides are written through a serialized queue so two rapid saves can't drop one another.

## [0.9.0] - 2026-06-13
### Added
- Model capability detection foundation: a normalized `ModelCapabilities` layer (`text`, `vision`, `tool calling`, `reasoning`, `context length`) resolved per model with a `source` and `confidence`, layered as **user override → model metadata → provider default**.
- Capability detection across all providers: Ollama `/api/show` capability tags (high confidence), LM Studio model `type` (`vlm`/`embeddings`, medium confidence), and provider defaults elsewhere. Unknown capabilities resolve to off — never enabled on a guess.
- Per-model capability badges in the model menu (completion, vision, tools, thinking, embeddings) with tooltips, fetched only while the menu is open and cached.
- Manual capability overrides: a Model Capabilities sheet for models whose provider can't self-report, to declare vision/tools/etc. by hand. Overrides persist per model and are sync-safe. Translated into all supported locales.

### Changed
- OpenAI-compatible providers no longer default to `https://api.openai.com/v1`; a blank base URL falls back to a local endpoint so a misconfigured provider never silently sends data to a cloud API.

### Fixed
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

### Fixed
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
- Removed the blanket `src/components/ui/**` lint override in `biome.json`; remaining vendored-shadcn a11y exceptions are now per-line `// biome-ignore` comments inside the offending files.
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

### Changed
- Migrated shadcn primitives to the `base-mira` preset on Tailwind v4 across sidepanel and options for consistent design tokens.
- Trimmed unused dependencies as part of the shadcn preset migration.

### Fixed
- Chat-stream now handles unexpected runtime-port disconnects without leaving the UI in a stuck loading state.
- Slider behavior and several lint violations introduced during the shadcn migration.

## [0.6.4] - 2026-05
### Added
- Grounding mode plus configurable per-conversation context limits.
- Tab-content extraction wired into chat context.

### Changed
- Standardized status styling and replaced ad-hoc emoji status indicators with shared status components.
- Aligned options and sidepanel UI on shared shadcn preset tokens.

### Fixed
- i18n strings added for the extracted-tab context popup and the context-settings screen.

## [0.6.3] - 2026-05
### Added
- Tab-extraction inspector for debugging page content capture.
- Cross-browser verification automation (`pnpm verify:browser-smoke`, `pnpm verify:browser-automation`) covering CSP, manifest permissions, and an optional Ollama connectivity check.

### Changed
- Expanded extension CSP to allow remote provider endpoints and added in-UI connection-troubleshooting hints.
- Hardened streaming-message updates against partial-state races.
- Extracted-tab content viewer is now a scrollable modal; extracted HTML is sanitized before display.

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

[Unreleased]: https://github.com/Shishir435/ollama-client/compare/v0.8.0...HEAD
[0.8.0]: https://github.com/Shishir435/ollama-client/compare/v0.7.3...v0.8.0
[0.7.3]: https://github.com/Shishir435/ollama-client/compare/v0.7.2...v0.7.3
[0.7.2]: https://github.com/Shishir435/ollama-client/compare/v0.7.1...v0.7.2
[0.7.1]: https://github.com/Shishir435/ollama-client/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/Shishir435/ollama-client/compare/v0.6.5...v0.7.0
[0.6.5]: https://github.com/Shishir435/ollama-client/compare/v0.6.4...v0.6.5
[0.6.4]: https://github.com/Shishir435/ollama-client/compare/v0.6.3...v0.6.4
[0.6.3]: https://github.com/Shishir435/ollama-client/compare/v0.6.2...v0.6.3
[0.6.2]: https://github.com/Shishir435/ollama-client/compare/v0.6.0...v0.6.2
[0.6.0]: https://github.com/Shishir435/ollama-client/releases/tag/v0.6.0
