# RAG (Current Browser Runtime)

This document describes RAG behavior that exists today in the browser extension runtime.

For full audit + redesign guidance, see:

- [Browser-First RAG Core (Audit + Design)](./rag-browser-core.md)

## 1) Runtime Scope

Current runtime assumptions:

- Chrome extension pages + background service worker
- IndexedDB + in-memory cache/index state
- HTTP-accessible model endpoints

Not assumed:

- Node.js runtime APIs
- native binaries
- server-side vector database

## 2) What Works Today

- local file/chat ingestion into embeddings
- Dexie-backed vector persistence
- hybrid retrieval (keyword + semantic)
- metadata filtering (file/session/type)
- context source display in chat UI
- retrieval fallback behavior when context is unavailable
- non-blocking embedding fallback chain:
  provider-native -> shared MiniLM -> background warmup -> Ollama fallback

## 2.1 Embedding Strategy Defaults

- Default reliability anchor: Ollama fallback remains available.
- Shared canonical target model: `all-MiniLM-L6-v2` (mapped as needed per provider).
- Background warmup runs silently and is throttled to avoid UI disruption.

What users should not expect:

- perfect embedding parity across local providers
- tokenizer-accurate budgeting in every model/runtime
- immediate warmup completion before first retrieval

## 3) Current Limitations (Important)

1. Runtime fallback reliability still depends on Ollama availability when provider-native/shared routes are unavailable.
2. Reranker path exists but is disabled by default for extension constraints.
3. Prompt/context assembly is split across UI/background paths and can duplicate logic.
4. Token budgeting is approximate (`chars / 4`) and provider context windows vary.
5. Dual chunking pipelines exist (legacy + enhanced splitters).
6. Provider embedding endpoints are conditional for some local runtimes (LM Studio, llama.cpp).

## 4) Core Improvement Direction

A provider-agnostic browser-first module contract is now defined at:

- `src/lib/rag/core/interfaces.ts`
- `src/lib/rag/core/*` browser adapters for each core module

Contract modules:

1. `DocumentSource`
2. `Chunker`
3. `Embedder`
4. `VectorStore`
5. `Retriever`
6. `PromptAssembler`

These adapters are additive and non-breaking; current runtime behavior remains intentionally unchanged.

## 5) Future Direction Policy

Potential desktop/helper expansion is discussed in docs only.

- It is not implemented.
- Browser-only mode remains first-class.
- Core runtime must not assume helper availability.
