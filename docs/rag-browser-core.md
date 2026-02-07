# Browser-First RAG Core (Audit + Design)

Status: implemented hardening pass. The embedding strategy is now runtime-enabled with non-breaking fallbacks.

## 1) Scope and Constraints

This project runs in:

- Chrome extension runtime
- Background service worker
- IndexedDB + in-memory storage
- HTTP model access only

Out of scope for current runtime:

- Node.js APIs
- native binaries
- server-side vector databases
- Electron assumptions

## 2) Audit of Current RAG Setup

### 2.1 Ingestion today

File ingestion path:

- `src/features/file-upload/hooks/use-file-upload.ts`
- `src/lib/file-processors/*`
- `src/lib/knowledge/knowledge-processor.ts`
- `src/lib/embeddings/storage.ts` (`fromDocuments`, `storeVector`)

Chat ingestion path:

- `src/features/chat/hooks/use-auto-embed-messages.ts`
- `src/lib/embeddings/storage.ts` (`storeVector`)

### 2.2 Chunking today

Two chunking paths currently exist:

- Legacy chunker:
  `src/lib/embeddings/chunker.ts`
- Enhanced text splitters:
  `src/lib/text-processing/character-text-splitter.ts`,
  `src/lib/text-processing/recursive-character-text-splitter.ts`
  via `src/lib/config/knowledge-config.ts`

This dual path is functional but increases maintenance risk and config drift.

### 2.3 Embeddings today

Embedding calls are routed through:

- `src/lib/embeddings/ollama-embedder.ts`
- `src/lib/embeddings/embedder-factory.ts`

Important current behavior:

- Embedding generation now uses a strategy chain:
  provider-native -> shared model -> background warmup -> Ollama fallback.
- Chat providers can be non-Ollama, with Ollama retained as the final reliability fallback.

### 2.4 Similarity + retrieval today

Vector/index/search path:

- Persistence: `src/lib/embeddings/db.ts` (Dexie IndexedDB)
- Storage ops: `src/lib/embeddings/storage.ts`
- Search: `src/lib/embeddings/search.ts`
- Keyword index: `src/lib/embeddings/keyword-index.ts` (MiniSearch)
- ANN-like index: `src/lib/embeddings/hnsw-index.ts` (in-memory brute-force style index)

RAG orchestration path:

- `src/features/chat/rag/rag-pipeline.ts`
- `src/features/chat/rag/rag-retriever.ts`

### 2.5 Prompt/context injection today

Primary runtime path:

- `src/features/chat/hooks/use-chat.ts`

Current behavior:

- Retrieved context is appended directly to the user message body.
- If retrieval fails for attached files, raw file text fallback is appended.

Additional background memory path:

- `src/background/handlers/handle-chat-with-model.ts`

Current behavior:

- A second retrieval pass can append memory context into system content.

### 2.6 Hard limitations (current runtime)

Token/context limits:

- Approximate token counting (`chars / 4`) is used in multiple paths.
- No single tokenizer contract across providers.

Memory/performance:

- Large retrieval/filtering can still pull many records into memory.
- HNSW module name is misleading today: current implementation is local in-memory vector scanning.

Browser constraints:

- Re-ranker (`transformers.js`) is present but disabled by default due extension CSP constraints (`src/lib/constants/config.ts` and `src/lib/embeddings/reranker.ts`).
- Service worker lifecycle and in-memory indexes require rebuild/load behavior.

## 2.10 Validation Against Intent (Final Pass)

Validation scope:

1. six module contracts exist and are provider-agnostic
2. prompt assembly/token budgeting behavior is deterministic where implemented
3. vector storage remains IndexedDB + bounded in-memory structures
4. ingestion/embedding/retrieval stay non-blocking

Validation outcome:

- `DocumentSource`, `Chunker`, `Embedder`, `VectorStore`, `Retriever`, `PromptAssembler` contracts exist at `src/lib/rag/core/interfaces.ts`.
- Browser-safe adapters now exist for all six modules at:
  - `src/lib/rag/core/browser-document-source.ts`
  - `src/lib/rag/core/browser-chunker.ts`
  - `src/lib/rag/core/browser-embedder.ts`
  - `src/lib/rag/core/browser-vector-store.ts`
  - `src/lib/rag/core/browser-retriever.ts`
  - `src/lib/rag/core/browser-prompt-assembler.ts`
- Provider logic remains outside RAG core interfaces.
- Retrieval and formatting remain deterministic (stable score sorting + max token guard by approximate budget).
- Vector persistence remains Dexie/IndexedDB; caches/indexes enforce max-size or cleanup behaviors.
- Minimal non-breaking UI responsiveness fix added:
  `CharacterTextSplitter` and `RecursiveCharacterTextSplitter` now yield to the event loop periodically during large splits.

Known remaining mismatch (documented, not breaking):

- Prompt budgeting is still approximate (`chars / 4`) and not tokenizer-accurate per provider.

### 2.7 What works reliably

- Local IndexedDB persistence for vectors
- Hybrid retrieval (keyword + semantic) for practical recall
- Metadata-aware filters (`type`, `sessionId`, `fileId`)
- Context source tracking back to chunks/files
- Graceful fallback when retrieval fails

### 2.8 What is fragile

- Dual chunking pipelines
- Warmup/pull mechanics are still Ollama-specific in background handlers
- Prompt assembly split across hooks/handlers with duplicated context logic
- Inconsistent use of advanced settings (`useReranking` toggle does not control the current call path in `rag-pipeline`)
- Mixed token budgeting assumptions

### 2.9 What is missing/incomplete

- Deterministic prompt truncation contract shared by all providers
- Unified metadata filter contract and ranking explainability
- Remote opt-in and precomputed import paths are documented but not runtime-enabled

## 3) Browser-First RAG Core Contract

New type contracts are now added at:

- `src/lib/rag/core/interfaces.ts`
- `src/lib/rag/core/index.ts`

Defined modules:

1. `DocumentSource`
2. `Chunker`
3. `Embedder`
4. `VectorStore`
5. `Retriever`
6. `PromptAssembler`

Design goals:

- browser-compatible only
- provider-agnostic boundaries
- replaceable implementations
- no provider leakage into RAG core interfaces

## 3.1 Provider Embedding Support Research

| Provider | Embedding Supported | How | Limitations |
|---|---|---|---|
| Ollama | Yes | `/api/embed` and `/api/embeddings` | Requires an installed embedding model locally |
| LM Studio | Conditional | OpenAI-compatible `/v1/embeddings` | Depends on runtime/model support; not all local models are embedding-capable |
| llama.cpp | Conditional | `/embedding` and `/v1/embeddings` | Requires `--embeddings`; pooling must not be `none` |

Primary sources:

- Ollama: [Embedding models and API usage](https://ollama.com/blog/embedding-models)
- LM Studio: [OpenAI-compatible REST endpoints](https://lmstudio.ai/docs/app/api/endpoints/openai)
- llama.cpp: [Server README](https://raw.githubusercontent.com/ggml-org/llama.cpp/master/examples/server/README.md)

## 4) Embeddings Strategy (Implemented)

Priority order (runtime):

1. active provider native embeddings (if available)
2. shared canonical model
3. background shared-model warmup (best effort, non-blocking)
4. Ollama fallback (reliability guardrail)

Canonical shared model target:

- `all-MiniLM-L6-v2` (provider-agnostic name)
- mapped to provider-specific names where required (for Ollama: `all-minilm`)

Implemented code path:

- `src/lib/embeddings/embedding-strategy.ts`
- called by `src/lib/embeddings/ollama-embedder.ts`
- diagnostics via `getEmbeddingCapabilitiesUnified` in `src/lib/embeddings/embedder-factory.ts`

### 4.1 Local HTTP embeddings (recommended default)

Example targets:

- Ollama local endpoint
- LM Studio local endpoint (if embedding API available)
- llama.cpp-compatible embedding endpoint (if configured)

Tradeoffs:

- Privacy: strong (local network boundary)
- Latency: medium (depends on local model/runtime)
- Reliability: good if endpoint is available

### 4.2 Remote embeddings (explicit opt-in)

Tradeoffs:

- Privacy: reduced (query/chunk text leaves machine)
- Latency: variable
- Reliability: can be high, but depends on network and vendor

Guardrails:

- explicit user toggle
- clear endpoint labeling
- no silent fallback to remote

### 4.3 Precomputed embeddings import (optional)

Tradeoffs:

- Privacy: depends on how vectors are produced
- Latency: best at query time
- Quality risk: mismatch if embedding model differs from query model

Implemented fallback behavior:

1. try configured active provider embedding route
2. try shared provider/model route
3. trigger background warmup request (silent, throttled)
4. fallback to Ollama embedding route

## 5) Browser-Only Vector Storage Design

Recommended runtime pattern:

- Source of truth: IndexedDB
- hot cache: in-memory LRU for recently accessed vectors/chunks
- deterministic scoring: cosine or dot product with fixed tie-breakers

Required behavior:

- metadata filtering before final ranking
- deterministic sort:
  1. score desc
  2. timestamp desc
  3. chunk/document id asc
- bounded memory cache by entry count and estimated bytes
- explicit eviction strategy (LRU + max-age)

## 6) Retrieval Quality Improvements (Browser-Safe)

### 6.1 Smarter chunking

Why it helps:

- better semantic cohesion and lower chunk noise

Cost:

- more preprocessing time

Failure mode:

- over-large chunks reduce recall, too-small chunks lose context

### 6.2 Metadata-aware retrieval

Why it helps:

- constrains candidates to relevant files/sessions/source types

Cost:

- extra filter bookkeeping

Failure mode:

- over-filtering can hide relevant chunks

### 6.3 Recency/source bias

Why it helps:

- improves relevance for evolving notes/docs

Cost:

- added ranking complexity

Failure mode:

- newer but lower-quality content can outrank better older content

### 6.4 Max-token budgeting before prompt assembly

Why it helps:

- avoids prompt bloat and truncation chaos

Cost:

- token estimation overhead

Failure mode:

- rough token estimates can still overshoot on some models

### 6.5 Ranking heuristics + explainability

Why it helps:

- easier debugging and contributor trust

Cost:

- additional score bookkeeping

Failure mode:

- conflicting heuristics can be hard to tune without diagnostics

## 7) Prompt Assembly Strategy (High Impact)

Rules:

1. Keep provider-facing payload separated:
   - system instruction
   - retrieved context block
   - user request
2. Enforce deterministic truncation with stable ordering.
3. Reserve response tokens before context packing.
4. Include source labels and chunk ids in context block.

Suggested template:

```text
[System]
You are a helpful assistant. Use only relevant context when available.
If context is insufficient, say so.

[Retrieved Context]
- Source: <title> (score: <score>, chunk: <id>)
  <chunk text>

[User]
<user prompt>
```

Deterministic truncation order:

1. Drop lowest-ranked retrieved chunks until within budget.
2. If still over budget, trim oldest chat history messages.
3. If still over budget, trim retrieved chunk bodies by stable order.

Safety notes:

- never claim context contains facts when it does not
- if retrieval score is below threshold, explicitly treat as low-confidence
- keep citation/source text machine-readable for UI disclosure

## 8) Provider-Agnostic Integration Rules

Rules for clean boundaries:

1. RAG core does not import provider modules.
2. Provider layer receives finalized `messages` only.
3. Stream handling remains provider responsibility.
4. Embedding transport is hidden behind `Embedder` contract.

This keeps RAG implementation stable while providers evolve.

## 9) File and Naming Cleanup Recommendation

Recommended structure (target, incremental migration):

```text
src/
  core/
    types/
  rag/
    core/
      interfaces.ts
      pipeline.ts
    ingestion/
      document-sources/
      chunkers/
      embedders/
    retrieval/
      vector-store/
      retriever/
      ranking/
    prompt/
      assembler/
  providers/
    ...
  storage/
    indexeddb/
    cache/
```

Rename guideline:

- name by responsibility, not vendor
- isolate provider-specific code under `providers/*`
- avoid `ollama-*` naming in cross-provider message keys for new code

## 10) Future Direction (Documentation Only)

Possible future track:

- desktop companion/local helper process for heavier indexing and richer reranking
- richer vector indexing and tokenizer-accurate budgeting

Important:

- this is not implemented in current runtime
- browser-only mode remains first-class and fully supported
- no core logic should assume helper availability

## 11) Why This Design

This design keeps quality improvements practical under extension constraints:

- explicit module seams reduce architectural coupling
- provider-agnostic contracts prevent future lock-in
- deterministic budgeting and ranking improve trust/debuggability
- documentation-first migration avoids risky runtime rewrites

## 12) RAG Stability Statement

RAG fundamentals are now considered stable for this project phase:

- contracts are explicit
- embedding fallback chain is in place
- browser constraints are documented and enforced
- no breaking API changes were introduced

Next planned focus areas can proceed without revisiting RAG fundamentals:

1. provider-agnostic naming cleanup
2. options page UX revamp
