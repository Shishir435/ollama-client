# 🗺️ Product Roadmap

> **Last Updated**: December 18, 2025
> **Current Version**: 0.5.10

This document outlines the strategic direction for **Ollama Client**.

---

## 🚀 Active Development

### v0.6.0 - Connectivity & Integrations (Next)
**Focus**: Expanding beyond local-only to support broader workflows.

- [ ] **Multi-Provider Architecture**
    - Abstract the LLM layer to support OpenAI-compatible endpoints (LMStudio, LocalAI)
    - Allow per-model base URL configuration
- [ ] **Enhanced RAG 2.0**
    - Multi-file reasoning (query across 5+ PDFs simultaneously)
    - Citation linking (click citation -> jump to source text)

---

## ✅ Recent Completions (v0.5.x)

### Core Reliability & Performance
- [x] **Database Schema V3**: Full normalization with tree-based history support.
- [x] **Virtual Scrolling**: Implemented `react-virtuoso` for unlimited chat history performance.
- [x] **Global Error Boundaries**: Added React Error Boundaries for app stability.
- [x] **HNSW Vector Search**: High-performance client-side embedding search.

### User Experience
- [x] **Conversation Branching**: Edit messages to creating forking conversation paths.
- [x] **Cascading Delete**: Recursive deletion of message trees.
- [x] **Advanced Exports**: PDF, JSON, Markdown, and Text support.
- [x] **Voice Input/Output**: TTS with voice selection and pitch control.
