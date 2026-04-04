# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.2] - 2026-04-05
### Added
- Multi-provider model support with explicit provider capabilities and routing for Ollama, LM Studio, llama.cpp, and additional providers ( vLLM, LocalAI, KoboldCPP).
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

[0.6.2]: (https://github.com/Shishir435/ollama-client/compare/0.6.0...0.6.2)

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

[0.6.2]: https://github.com/Shishir435/ollama-client/compare/v0.6.0...v0.6.2
[0.6.0]: https://github.com/Shishir435/ollama-client/releases/tag/v0.6.0
