> **Last Updated**: December 11, 2025  
> **Current Version**: 0.5.8

This roadmap outlines planned features and improvements for the Ollama Client Chrome extension. Priority levels and versions are subject to change based on user feedback and technical constraints.

---

## ✅ Recently Completed (v0.5.x)

### Refactoring & UI
- **Chat Component Refactoring**: Split monolithic Chat component into sub-components
- **Toast Notification System**: Added visible user feedback for errors and actions
- **Settings Refactoring**: Standardized Content Extraction settings
- **Structured Logger**: Configurable log levels and developer UI
- **Chat Export Refactor**: Modularized exporters (JSON, PDF, Markdown, Text) with i18n support
- **Error Boundaries**: Implemented top-level error catching with fallback UI and log export
- [x] Implement virtual scrolling for chat messages lists `react-virtuoso`
- [x] Implement chat history pagination (incremental loading) support
- **Large File Refactoring**: Decomposed Vector Store, Constants, Embedding Settings, and Prompt Manager into modular components
- **Database Schema Refactoring**: Normalized V2 schema with separate tables for sessions, messages, and files
- **Chat Pagination**: (Completed) Optimized message loading with virtual scrolling and deep linking.
- **Configuration Management**: (Completed) Split constants.ts into granular modules.
- **Message editing** - Edit previously sent messages (Completed)
- **Message deletion** - Delete individual messages (Completed)
- **Message search** - Search within current session (Completed)
- **Conversation Forking** - Branch conversations by editing messages (Completed)
- Export individual messages

---

## 🛠️ v0.5.x - Code Quality & Refactoring (Current Focus)

### Logic Extraction
- **Content Script** (`src/contents/index.ts` ~500 lines)
    - Move scraping logic to dedicated handlers

---

## 🚀 v0.6.0 - Database & Core Reliability (Q1 2025)

### 🔴 Critical Priority

---

### 🟡 High Priority

---

### 🟢 Medium Priority

#### Accessibility Improvements
- **Audit with axe DevTools**
- Add proper ARIA labels to interactive elements
- Improve keyboard navigation
- Test with screen readers
- Document keyboard shortcuts in help section

#### Bundle Optimization
- Analyze bundle size with webpack-bundle-analyzer
- Code splitting for large libraries (markdown-it, pdfjs)
- Tree-shake unused code
- Dynamic imports for heavy features
- Target: Reduce initial bundle by 30%

---

## 🌟 v0.7.0 - Feature Enhancements (Q3 2025)



---

### 🔌 Multi-Provider Support (New Priority)

#### Provider Abstraction Layer
- Create a `LLMProvider` interface to decouple app logic from Ollama
- Implement `OllamaProvider` (current default)
- **Goal**: Support OpenAI-compatible endpoints (LMStudio, Llama.cpp server, etc.)

#### Stats & Token Usage
- **Challenge**: Standard OpenAI API endpoints often do not return token usage/timing stats in the same format as Ollama.
- **Requirement**: Abstract stats handling. If provider doesn't support stats, UI should gracefully hide them or show estimates.
- **Backends**:
    - **Custom OpenAI-compatible** (User provides Base URL + Key if needed)
    - **Llama.cpp** (Server mode)
    - **LMStudio**

---

### Model Features

#### Model Comparison
- **Compare responses** from different models side-by-side
- Performance benchmarks display
- Model recommendation based on device specs
- Show model capabilities (vision, function calling, etc.)

#### Model Information
- Display model size before pulling
- Show download progress more accurately
- Estimated download time based on connection
- Model version changelog

---

### File Processing

#### OCR for Scanned PDFs
- **Note**: Previous attempt took 2-3 days, encountered CSP issues and parser problems
- Low priority due to complexity
- Potential libraries: Tesseract.js (with CSP adjustments)
- May require WASM worker

#### Additional Format Support
- **Excel files** (.xlsx, .xls) with spreadsheet analysis
- Audio transcription (Whisper.cpp integration)
- Video subtitle extraction
- PowerPoint (.pptx) presentations
- Markdown advanced parsing

---

### Vector Search & RAG

#### Index Persistence
- Persist HNSW index to IndexedDB
- Avoid rebuilding on browser restart
- Incremental index updates
- Background index optimization

#### Advanced Search Features
- **Relevance feedback** - Learn from user selections
- **Multi-file RAG** - Query across multiple file types simultaneously
- **Hybrid ranking** - Combine keyword + semantic + recency
- **Query expansion** - Suggest related searches
- Faceted search (by source, type, date)

#### RAG Improvements
- Adjustable retrieval parameters in UI
- Custom prompt templates for RAG
- Citation links to source documents
- Chunk preview in results

---

### Browser Integration

#### Browser Search Feature
- **Contextual search** within webpage content
- Semantic search over extracted content
- Search result highlighting
- Search history with filters

---

## 🔬 v0.8.0 - Testing & Quality (Q4 2025)

### Testing Infrastructure

#### UI Component Tests
- Add React Testing Library tests for critical components
- Test user flows (chat, file upload, settings)
- Target 80%+ coverage including `.tsx` files
- Integration tests for key scenarios

#### End-to-End Tests
- Add E2E test suite (Playwright or Cypress)
- Test extension installation flow
- Test model pulling and chat creation
- Test file upload and RAG functionality

---

### Code Quality

#### Documentation
- Create Architecture Decision Records (ADRs)
- API documentation for background handlers
- Component usage examples
- Testing strategy document
- Deployment guide
- Add JSDoc comments to complex functions

---

## 💡 Future / Backlog

#### Plugin System
- Extensible file processor architecture
- Custom model handlers
- Third-party integrations
- Community plugins marketplace

#### Web Search Enrichment (Optional)
- Offline-first architecture
- Opt-in Brave / DuckDuckGo API (user-provided key)
- WASM fallback (tinysearch) when no key
- Search result summarization

#### Rich Media Support (Future)
- **Image support in chat** (Refinement)
- **Mermaid Diagrams** (Rendering support)
- Image paste/compression optimizations

---

## 📊 Metrics & Monitoring

### Performance Targets

- **Chat load time**: < 100ms for sessions with < 100 messages
- **Model switch time**: < 500ms
- **Search results**: < 200ms for < 1000 vectors
- **File upload processing**: < 5s for 10MB PDF
- **Memory usage**: < 150MB for typical session

### Quality Targets

- **Test coverage**: 80%+ overall, 90%+ for critical paths
- **Linting errors**: 0 errors, < 10 warnings
- **Accessibility score**: WCAG 2.1 AA compliance
- **Bundle size**: < 2MB initial, < 5MB total
- **Performance**: Lighthouse score > 90

---

## 🤝 Contributing

Want to help with any of these features? Check out:

- [CONTRIBUTING.md](./CONTRIBUTING.md) - Contribution guidelines
- [ARCHITECTURE.md](./ARCHITECTURE.md) - Technical architecture
- [GitHub Issues](https://github.com/Shishir435/ollama-client/issues) - Open issues and feature requests

We welcome contributions for any items on this roadmap! Please discuss major changes in an issue first.

---

## 📝 Changelog

See [CHANGELOG.md](./CHANGELOG.md) for released versions and detailed changes.

---

**Note**: This roadmap is a living document and will be updated based on user feedback, technical discoveries, and community input.
