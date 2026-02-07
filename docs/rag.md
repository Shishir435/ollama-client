# RAG in Ollama Client

This document explains what Retrieval-Augmented Generation (RAG) means in this project today.

## 1) What "RAG" Means Here

In this codebase, RAG is a local retrieval workflow that:

1. Converts file/chat content into embeddings.
2. Stores embeddings and metadata in local vector storage.
3. Retrieves relevant chunks for new prompts.
4. Injects retrieved context into generation input.

It is not a hosted vector service and not a server-side enterprise retrieval stack.

## 2) Current RAG Data Flow

### Ingestion flow

1. User uploads file or generates chat content.
2. Text is chunked (fixed/semantic/hybrid/markdown strategies).
3. Embeddings are generated (currently Ollama-backed).
4. Chunks + embeddings + metadata are stored in local vector DB.

### Query flow

1. User sends prompt.
2. Query classification determines retrieval strategy.
3. Hybrid retrieval runs (keyword + semantic).
4. Optional post-processing applies recency/diversity/feedback scoring.
5. Formatted context is appended to prompt history sent to model.

## 3) Retrieval Pipeline Components

Primary files:

- `src/features/chat/rag/rag-retriever.ts`
- `src/features/chat/rag/rag-pipeline.ts`
- `src/lib/embeddings/search.ts`
- `src/lib/embeddings/storage.ts`

Implemented features include:

- Adaptive hybrid weighting by query type
- Similarity thresholds
- MMR-style diversity filtering
- Recency score boost
- Feedback score blending hooks

Reranker note:

- `rerankerService` exists (`transformers.js`) but is disabled by default due extension CSP constraints.

## 4) Vector Storage and Indexing

### Supported now

- Vector storage: Dexie/IndexedDB (`VectorDatabase`)
- Keyword index: local keyword index manager
- ANN-like search path: local in-memory index manager + brute-force fallback


### Not currently implemented as runtime default

- Dedicated external vector DB service
- sqlite-vec as main retrieval backend

## 5) Example Usage

1. Enable RAG in settings.
2. Upload technical documents (PDF/DOCX/Markdown/etc.).
3. Ask a question tied to uploaded material.
4. Inspect retrieval sources in the message UI.
5. Tune chunk size, similarity threshold, and topK if results are noisy.

## 6) Configuration Surfaces

RAG-related controls live in embedding/settings surfaces and storage-backed config keys:

- chunking strategy/size/overlap
- search limits and similarity thresholds
- adaptive weighting toggles
- diversity/recency/feedback tuning
- auto-embed behavior

## 7) Constraints and Limitations

Important limitations today:

1. Embeddings currently depend on Ollama even for non-Ollama chat providers.
2. Reranker path is disabled by default due CSP restrictions.
3. Retrieval quality depends heavily on chunking and threshold tuning.
4. Heuristic quality filtering may underperform on non-technical or non-English content.
5. Large corpora may require ANN/index tuning beyond defaults.

## 8) Practical Debugging Tips

- If retrieval returns irrelevant chunks: raise min similarity and lower topK.
- If retrieval misses exact terms: increase keyword weight or test query phrasing.
- If retrieval is too sparse: lower threshold and increase topK incrementally.
- If indexing feels slow: reduce chunk volume or disable aggressive auto-embedding.

## 9) Roadmap Priorities for RAG

1. Better provider-agnostic embedding strategy.
2. Clear reranker enablement path under extension constraints.
3. Stronger retrieval diagnostics in UI.
4. Scalable indexing strategy for large local corpora.
