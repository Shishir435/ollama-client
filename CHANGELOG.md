# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[Unreleased]: https://github.com/Shishir435/ollama-client/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/Shishir435/ollama-client/releases/tag/v0.6.0
