# 🗺️ Product Roadmap

> **Last Updated**: December 20, 2025
> **Current Version**: 0.5.10

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

### 3. RAG Quality Overhaul (RAG 2.5)
**Goal**: Solve the "Bad Context" problem without needing heavy GPUs.
- [ ] **Hybrid Search + Reranking (The "Quality Fix")**
    - *Problem*: Small embeddings (WebGPU) often miss semantic nuance.
    - *Solution*: Implement a **Cross-Encoder Reranker** (via Transformers.js). This re-scores the top 20 search results to filter out noise, dramatically improving answer quality.
- [ ] **Smart Chunking 2.0**
    - Semantic chunking based on markdown headers and code block boundaries.

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
- [x] **SQLite Migration (sql.js)**: Replaced Dexie.js with a full SQLite engine for ACID compliance and complex tree-history queries.
- [x] **Database Schema V3**: Full normalization with tree-based history support.
- [x] **Virtual Scrolling**: Implemented `react-virtuoso` for unlimited chat history performance.
- [x] **Global Error Boundaries**: Added React Error Boundaries for app stability.
- [x] **HNSW Vector Search**: High-performance client-side embedding search.
