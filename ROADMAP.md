# 🗺️ Product Roadmap

> **Last Updated**: December 29, 2025
> **Current Version**: 0.5.12

This document outlines the strategic direction for **Ollama Client**.

---

## 🚀 Active Strategic Pillars

### 1. Robust Data Infrastructure (v0.6.0)
**Goal**: Move beyond browser limits to desktop-class performance.
- [ ] **Unified Sync Adapter**
    - Implement `File System Access API` to perform real-time sync of the SQLite DB to a local folder (e.g., User's Dropbox/iCloud Drive).
- [ ] **At-Rest Encryption**
    - Leverage SQLite's power to implement encrypted session storage using user-provided keys.

### 2. Universal Connectivity (v0.7.0)
**Goal**: Support any LLM provider, not just Ollama.
- [ ] **Multi-Provider Architecture**
    - **OpenAI-Compatible API**: Add support for Generic OpenAI endpoints (LMStudio, LocalAI, vLLM).
    - **Per-Model Routing**: Allow mapping specific models to specific URLs (e.g., "Use GPT-4 for code, but Llama 3 for chat").
- [ ] **Cloud Vendor Integration**
    - Native support for Anthropic (Claude) and DeepSeek APIs for users who want hybrid Local/Cloud workflows.

### 3. RAG v3.0: Adaptive Intelligence
**Goal**: Context-aware retrieval with learning capabilities.
- [ ] **Adaptive Hybrid Weights**
    - Query classification to adjust keyword/semantic balance dynamically
    - Code/API queries: 80% keyword, Conceptual queries: 20% keyword
- [ ] **Semantic MMR Deduplication**
    - Use embedding similarity instead of text overlap for diversity filtering
    - Reduce context window waste by 10-15%
- [ ] **Temporal Relevance Boosting**
    - Prioritize recent documentation over outdated content
    - Formula: `score = base_score * (1 + recency_factor)`
- [ ] **WebGPU Embedding Generation**
    - Run embedding models in-browser (not just re-ranking)
    - 10x speed improvement for large file ingestion
- [ ] **Multi-language Quality Filtering**
    - Extend quality filter beyond English technical content
    - Support for CJK languages, Spanish, French, German
- [ ] **User Feedback Loop**
    - Allow users to mark retrieved chunks as helpful/not helpful
    - Learn from corrections to improve future retrievals

### 4. Privacy & Security
**Goal**: Best-in-class local privacy.
- [ ] **At-Rest Encryption**
    - Option to encrypt the SQLite database file with a user password.
- [ ] **Incognito Mode**
    - Ephemeral sessions that are never written to disk (RAM-only).
- [ ] **Panic Button**
    - Single-click "Nuke" to securely wipe all local data and keys.

---

## ✅ Recent Completions (v0.5.x)

### RAG Quality Overhaul (v0.5.12)
- [x] **3-Stage Enhanced Pipeline**: Hybrid Search → Cross-Encoder Re-Ranking → MMR Diversity
- [x] **WebGPU Re-Ranking**: Transformers.js integration with 50ms performance (4x faster than CPU)
- [x] **Content Quality Filtering**: Heuristic scoring prevents greetings, affirmations, and noise from being embedded
- [x] **Markdown-Aware Chunking**: Preserves code blocks and headers for semantic integrity
- [x] **Granular Configuration UI**: Advanced settings for all RAG parameters
- [x] **Full Internationalization**: All RAG UI strings translated to 8 languages

**Impact:** Reduced RAG noise from ~40% to ~10% (measured)

### Core Infrastructure (v0.5.x)
- [x] **SQLite Migration (sql.js)**: Replaced Dexie.js with a full SQLite engine for ACID compliance and complex tree-history queries.
- [x] **Database Schema V3**: Full normalization with tree-based history support.
- [x] **Virtual Scrolling**: Implemented `react-virtuoso` for unlimited chat history performance.
- [x] **Global Error Boundaries**: Added React Error Boundaries for app stability.
- [x] **HNSW Vector Search**: High-performance client-side embedding search.
