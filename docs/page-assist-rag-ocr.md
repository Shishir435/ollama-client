# Page Assist Local RAG + OCR (Privacy-First) — Technical Analysis and Reimplementation Blueprint

This document extracts the concrete, code-level behavior of Page Assist’s local RAG and OCR features and translates it into an implementation blueprint for Ollama Client. It is intentionally technical and does not assume any cloud services.

Scope: local-only behaviors (extension UI, content/tab capture, workers, IndexedDB, WASM). Cloud features are explicitly excluded.

---

## 1. End-to-End Architecture (Observed in Page Assist)

Textual flow diagram (persistent knowledge base):

`Options UI → Add Knowledge → PubSub Queue → processKnowledge → Loader (PDF/CSV/TXT/DOCX) → Text Splitter → Local Embedding (Ollama /api/embed) → Vector Store (IndexedDB/Dexie)`

Textual flow diagram (ephemeral chat file RAG):

`Chat UI → File Upload → File Processor → Text Splitter → Local Embedding (Ollama /api/embed) → In-Memory Vector Store → Similarity Search → Prompt`

Textual flow diagram (chat with website):

`Chat UI → browser.scripting.executeScript (active tab) → HTML/URL → Parser/Readability → Context → Prompt`

Textual flow diagram (OCR for images in chat):

`Chat UI → humanMessageFormatter (useOCR) → pa-tesseract.js Worker + WASM → OCR text → Prompt`

**Separation of responsibilities (and why):**
- **Extension UI (options/sidepanel)** runs ingestion, chunking, embeddings, retrieval, and prompt assembly. This is necessary because it has storage access and can call local LLM servers.
- **Tab context capture** is done via `browser.scripting.executeScript` to pull `document.documentElement.outerHTML` from the active tab; it avoids persistent content scripts.
- **Web Workers** are used for OCR (Tesseract WASM) and PDF parsing (pdfjs-dist worker), keeping UI responsive.
- **Background/service worker** in Page Assist is orchestration-only (menus, notifications, model pull) and not involved in RAG/OCR logic.

---

## 2. RAG Ingestion Pipeline (Page Assist)

### 2.1 Supported Input Types
- Knowledge Base uploads: `PDF`, `CSV`, `TXT/MD`, `DOCX`
- Ephemeral chat files: same set
- Webpages: used for “chat with website” context but not stored in KB
- Images/scanned docs: **not** ingested into KB; OCR is only used in chat message flow

### 2.2 Text Extraction
- **PDF**: `pdfjs-dist` text layer extraction (`getTextContent()`), per page.
- **DOCX**: `mammoth.extractRawText`.
- **CSV**: `d3-dsv`, with optional column selection; rows turned into `header: value` lines.
- **TXT/MD**: raw text.
- **Webpages**: `@mozilla/readability` + `turndown` (HTML→Markdown). Special cases for Wikipedia and YouTube transcripts.

Dynamic/lazy content handling:
- For chat-with-website, the extension executes script in the active tab and captures *current DOM*, which includes client-rendered content.

Fallbacks:
- When Readability deems content not reader-friendly, it falls back to `main` / `[role=main]` / `body` extraction and then Turndown conversion.

### 2.3 Chunking Strategy
- Uses LangChain text splitters.
- Defaults:
  - `RecursiveCharacterTextSplitter`
  - `chunkSize = 1000` (characters)
  - `chunkOverlap = 200`
- Optional switch to `CharacterTextSplitter` with a custom separator.

Rationale (implicit): character-based splitting reduces complexity and is fast, at the cost of token-level precision.

### 2.4 Metadata Design
Metadata is stored per chunk and carried into vector store:
- **PDF**: `{ source: filename, page: number, type: "pdf" }`
- **CSV**: `{ source: filename, type: "csv", line: number }`
- **TXT**: `{ source: filename, type: "txt", line: number }`
- **DOCX**: `{ source: filename }`
- **HTML**: `{ source: url, url }` plus audio transcript metadata for YouTube

Deduplication:
- No hashing. De-duplication only occurs when formatting docs for prompts and during import merge checks.

---

## 3. Embedding Generation (Page Assist)

### Where embeddings are generated
- In the UI context (options/sidepanel). There is no dedicated embedding worker.

### How embeddings are generated
- **Local**: Ollama `/api/embed` via `OllamaEmbeddingsPageAssist`.
- **Remote (optional)**: OpenAI-compatible embeddings when a “custom model” is selected; this breaks privacy-first.

### Model loading and batching
- One embed request can contain an array of texts (batch).
- On batch failure, it falls back to per-text calls.

### Error handling
- Non-200 responses throw; fallback uses per-text embedding calls.

### Privacy controls
- Default base URL is `http://127.0.0.1:11434` (local Ollama).
- Users can configure remote providers; for privacy-first, disallow this in Ollama Client.

### Caching/versioning
- No explicit embedding cache.
- No embedding versioning; switching models requires re-embedding.

---

## 4. Vector Storage (Page Assist)

### Backend
- IndexedDB via Dexie.

### Schema
- `vectors` table: `{ id: string, vectors: PageAssistVector[] }`
- `PageAssistVector`: `{ content, embedding: number[], metadata, file_id }`
- Stored under key `vector:${knowledge_id}` (all chunks per KB in a single record).

### Similarity metric
- Cosine similarity (`ml-distance`).

### Search strategy
- Exact linear scan over all vectors loaded into memory, sort by similarity, top-K.
- No ANN/IVF/HNSW.

### Temporary/in-memory RAG
- A separate in-memory store is used for ephemeral chat file retrieval.

Performance implication:
- Large KBs degrade due to full-vector reads and O(n) similarity.

---

## 5. Query-Time RAG Flow (Page Assist)

### Knowledge Base RAG
1. User submits a query in RAG mode.
2. Follow-up question is rewritten to standalone using a local LLM prompt.
3. Query embedding is generated locally via Ollama.
4. Vector store performs similarity search (top-K default = 4).
5. Context is assembled into `<doc id='i'>...</doc>` blocks.
6. System prompt template (RAG):
   - Instructs model to use only context and say “I don’t know” if unknown.
7. Prompt sent to local LLM, response streamed.

### Ephemeral file RAG
- Same flow, but vector store is in-memory and built from uploaded files.

### Context limits
- RAG: top-K limits context implicitly.
- Non-RAG fallback: a maximum context length limit (`maxWebsiteContext`, default 7028 chars).

---

## 6. OCR Pipeline (Page Assist)

### 6.1 Entry Points
- OCR is triggered only for images attached to chat messages when `useOCR` is enabled.
- OCR is not used for PDFs or scanned documents during ingestion.

### 6.2 OCR Technology
- `pa-tesseract.js` (Tesseract compiled to WASM).
- SIMD-accelerated core:
  - `/ocr/tesseract-core-simd.js`
  - `/ocr/tesseract-core-simd.wasm`

### 6.3 Processing Flow
1. Resolve OCR language (session override or default).
2. Create Tesseract worker with custom paths:
   - `workerPath: /ocr/worker.min.js`
   - `corePath: /ocr/tesseract-core-simd.js`
   - `langPath: /ocr/lang` for non-offline languages
3. `worker.recognize(imageData)`
4. `worker.terminate()`
5. Return recognized text (empty string on error).

No preprocessing steps (resize, grayscale, thresholding) are applied.

### 6.4 Integration with RAG
- OCR text is appended directly into the user prompt:
  - `[IMAGE OCR TEXT]` section
- OCR output is **not embedded** or stored in KB.

---

## 7. Privacy & Security (Page Assist)

### Privacy-first features
- Default local LLM endpoint (`127.0.0.1:11434`).
- All RAG data stored in IndexedDB.
- OCR runs locally via WASM.
- No telemetry (per privacy policy).

### Privacy risks to remove for Ollama Client
- Custom models can send embeddings to external endpoints.
- Web search features fetch external pages.

### Permissions in manifest (Chrome)
- `storage`, `sidePanel`, `activeTab`, `scripting`, `declarativeNetRequest`, `unlimitedStorage`, `contextMenus`, `notifications`, etc.
- Host permissions: `http://*/*`, `https://*/*`, `file://*/*`.

For a privacy-first Ollama Client, restrict to `http://127.0.0.1/*`, `http://localhost/*` and only `https://*/*` if explicitly needed for web-page capture.

---

## 8. Performance & UX Considerations

- **Queue processing** for knowledge ingestion prevents parallel embedding overload.
- **Completion notifications** help users know ingestion finished.
- **Streaming responses** use `AbortController` for cancellation (not for OCR or ingestion).
- **Large KBs** can degrade due to linear similarity search and single-record storage layout.
- **OCR** is per-image, per-message and can be slow without preprocessing or caching.

---

## 9. Limitations & Tradeoffs (Page Assist)

- Vector search is O(n) and scales poorly.
- Vectors are stored as a single large array per KB → costly reads/writes.
- No embedding versioning or re-embedding automation.
- OCR not integrated into KB ingestion.
- No per-origin or per-site isolation.

---

## 10. Implementation Blueprint for Ollama Client (Local-Only)

### 10.1 Architecture Overview

Textual architecture:

`UI (Options/Sidepanel) → File/URL ingestion → Worker-based parsing (PDF/OCR) → Text splitters → Local embedding (Ollama) → IndexedDB vector store → Retrieval → Prompt assembly → Local LLM (Ollama/LM Studio/llama.cpp)`

### 10.2 Suggested Folder Structure

- `src/rag/`
  - `ingest.ts`, `retrieve.ts`, `prompts.ts`, `text-splitter.ts`
- `src/ocr/`
  - `ocr.ts`, `ocr-language.ts`
- `src/workers/`
  - `ocr.worker.ts`, `pdf.worker.ts`
- `src/storage/`
  - `db.ts`, `vector-store.ts`, `knowledge.ts`
- `src/parsers/`
  - `html.ts`, `readability.ts`, `pdf.ts`, `docx.ts`, `csv.ts`, `txt.ts`
- `src/models/`
  - `embedding.ts`, `llm.ts`

### 10.3 Core Interfaces

```ts
export interface EmbeddingProvider {
  embedDocuments(texts: string[]): Promise<number[][]>
  embedQuery(text: string): Promise<number[]>
}

export interface VectorStore {
  addVectors(vectors: number[][], docs: DocChunk[]): Promise<void>
  similaritySearch(query: string, k: number): Promise<DocChunk[]>
}

export interface DocChunk {
  id: string
  content: string
  metadata: Record<string, any>
}
```

### 10.4 Vector Storage (Recommended)

Unlike Page Assist, store **one vector per row** for better scalability:

Table `vectors`:
- `id` (chunk id)
- `knowledge_id`
- `file_id`
- `embedding` (Float32Array, serialized)
- `content`
- `metadata`

Indexes:
- `knowledge_id`
- `file_id`

This supports incremental deletes and efficient queries.

### 10.5 Ingestion Flow

1. File upload or text input.
2. Type-specific extraction:
   - PDF → pdfjs-dist (worker)
   - DOCX → mammoth
   - CSV → d3-dsv
   - TXT/MD → raw
3. Split into chunks (`chunkSize=1000`, `overlap=200` default).
4. Embed locally (`/api/embed`).
5. Persist each chunk to IndexedDB.

### 10.6 Retrieval Flow

1. Optional query rewriter (local LLM).
2. Embed query.
3. Linear similarity search (cosine) or optional ANN later.
4. Top‑K to context blocks:
   `<doc id='i'>…</doc>`
5. Assemble prompt with system prompt and user question.
6. Send to local LLM.

### 10.7 OCR Flow (Local)

1. OCR worker uses `pa-tesseract.js` or `tesseract.js`.
2. Worker config:
   - `workerPath: /ocr/worker.min.js`
   - `corePath: /ocr/tesseract-core-simd.js`
   - `langPath: /ocr/lang`
3. Text appended to prompt under a block tag:
   `[IMAGE OCR TEXT]`.

If you want OCR to feed RAG, add a toggle:
- Store OCR text as a synthetic document and embed it.

### 10.8 Privacy-First Defaults

- Only allow local URLs (127.0.0.1 / localhost).
- Do not ship any telemetry.
- Disable web search features unless explicitly enabled.
- Do not allow external embeddings or LLM calls unless user opts in.

---

## 11. Practical Implementation Notes for Ollama Client

- **Chunking defaults**: `1000` / `200` is the Page Assist baseline; start there.
- **Top‑K**: default `4` is used in Page Assist; should be configurable.
- **Query rewrite**: use a local LLM prompt to rewrite follow-ups into standalone queries.
- **Cancellation**: pass `AbortController` through embed + LLM stream calls.

---

## 12. Summary of Critical Differences to Improve

- Replace single-record vector storage with per-chunk records.
- Add embedding versioning metadata to allow re-embedding when models change.
- Optionally support OCR → RAG integration for scanned documents.
- Keep all network paths local by default.

---

## 13. Source Pointers (Page Assist)

These files in the Page Assist repo show the behaviors summarized above:

- `src/libs/process-knowledge.ts`
- `src/libs/PageAssistVectorStore.ts`
- `src/hooks/chat-modes/ragMode.ts`
- `src/hooks/chat-modes/documentChatMode.ts`
- `src/utils/text-splitter.ts`
- `src/models/OllamaEmbedding.ts`
- `src/utils/ocr.ts`
- `src/services/ocr.ts`
- `src/loader/pdf-url.ts`, `csv.ts`, `txt.ts`, `docx.ts`
- `src/db/dexie/schema.ts`
- `wxt.config.ts`


---

## 14. Ollama Client Alignment (Current Codebase)

This section maps the Page Assist behaviors to the existing Ollama Client architecture so implementation can reuse current modules.

**Ingestion + File Handling**
- Primary entry: `src/features/file-upload/hooks/use-file-upload.ts`
- File processors: `src/lib/file-processors/index.ts` and `src/features/file-upload/processors/*`
- Processed file metadata already supports OCR fields in `src/lib/file-processors/types.ts`.

**Knowledge Processing (KB ingestion)**
- `src/lib/knowledge/knowledge-processor.ts` is the main chunk+embed pipeline.
- Text splitting is centralized in `src/lib/config/knowledge-config.ts` via `getTextSplitter()`.

**Chunking**
- Token-aware and character splitting lives in `src/lib/embeddings/chunker.ts` and `src/lib/config/knowledge-config.ts`.
- Strategies already match Page Assist defaults (recursive, character + separator).

**Embeddings**
- `src/lib/embeddings/embedding-client.ts` provides cached, local-first embedding generation.
- Strategy routing: `src/lib/embeddings/embedding-strategy.ts` and `src/lib/embeddings/embedder-factory.ts`.
- RAG core adapter: `src/lib/rag/core/browser-embedder.ts`.

**Vector Storage + Retrieval**
- Dexie store: `src/lib/embeddings/db.ts` + `src/lib/embeddings/storage.ts`.
- Hybrid search and HNSW indexing: `src/lib/embeddings/search.ts`, `src/lib/embeddings/hnsw-index.ts`.
- RAG adapter: `src/lib/rag/core/browser-vector-store.ts`.

**RAG Query Flow**
- Retrieval pipeline: `src/features/chat/rag/rag-retriever.ts`, `rag-pipeline.ts`.
- Prompt assembly: `src/features/chat/rag/rag-prompt-builder.ts`.
- RAG toggle and config: `src/lib/config/knowledge-config.ts`.

**Webpage Extraction (Chat With Website)**
- Content script extraction: `src/contents/index.ts`.
- Heuristics and dynamic content detection: `src/lib/content-extractor.ts`.
- Transcript extraction: `src/lib/transcript-extractor.ts`.

**Chat Flow**
- Chat orchestration: `src/features/chat/hooks/use-chat.ts`.
- Provider streaming: `src/features/chat/hooks/use-chat-stream.ts` → `src/background/index.ts` handlers.

**Key Delta vs Page Assist**
- OCR pipeline is not implemented yet.
- Image files are rejected by the default `TextProcessor` and no OCR processor exists.
- Page Assist-style OCR injection into chat prompts is not present.
- Page Assist stores PDF page numbers as metadata; Ollama Client currently embeds page text without page-level metadata.

---

## 15. Actionable Implementation Tickets (Aligned to Ollama Client)

1. **Add OCR worker + service**
Scope: Implement a browser-safe OCR module using Tesseract WASM, modeled after Page Assist’s `processImageForOCR`.
Files:
- `src/lib/ocr/ocr.ts` (new)
- `src/lib/ocr/ocr-language.ts` (new)
- `public/ocr/worker.min.js`, `public/ocr/tesseract-core-simd.js`, `public/ocr/tesseract-core-simd.wasm`, optional `public/ocr/lang/*`
- `wxt.config.ts` (CSP and web_accessible_resources updates)
Acceptance:
- `processImageForOCR(dataUrl)` returns OCR text locally with no network.
- Workers are terminated after each OCR job.
- OCR runs on the extension side without blocking UI.

2. **Add Image File Processor for OCR-based ingestion**
Scope: Enable images to be ingested into the knowledge system by OCRing them into text.
Files:
- `src/features/file-upload/processors/image-processor.ts` (new)
- `src/lib/file-processors/index.ts` (register processor before `TextProcessor`)
- `src/lib/file-processors/types.ts` (already has OCR metadata fields)
Acceptance:
- Image files are accepted, converted to text via OCR, and passed into `processKnowledge`.
- OCR metadata (`ocrLanguage`, `ocrConfidence`, `processingTime`) stored on `ProcessedFile`.

3. **Add OCR settings + language selection UI**
Scope: Provide a user-facing toggle and language selection for OCR.
Files:
- `src/lib/constants/keys.ts` (new OCR storage keys)
- `src/options/*` (settings UI)
- `src/lib/plasmo-global-storage.ts` usage
Acceptance:
- Users can enable/disable OCR and choose language per session or globally.
- Default language is English offline model when available.

4. **Integrate OCR into chat message assembly**
Scope: If a user attaches images to chat, append OCR text into the user prompt for non-vision local models.
Files:
- `src/features/chat/hooks/use-chat.ts` (inject OCR before `contentWithRAG` is finalized)
- `src/features/chat/components` (UI support for image attachments if missing)
Acceptance:
- When OCR is enabled, images are converted to text and appended under a `[IMAGE OCR TEXT]` block.
- OCR is not sent to external services.

5. **Preserve PDF page metadata in embeddings**
Scope: Match Page Assist metadata by storing page numbers per chunk.
Files:
- `src/features/file-upload/processors/pdf-processor.ts`
- `src/lib/knowledge/knowledge-processor.ts` or `src/lib/embeddings/vector-store` helpers
Acceptance:
- Each chunk embeds metadata with `page` when originating from a PDF.
- Source UI can display page number in RAG sources.

6. **Optional: OCR text into RAG chunks**
Scope: Allow OCR output to be chunked and stored in the vector DB (for scanned PDFs/images).
Files:
- `src/lib/knowledge/knowledge-processor.ts`
- `src/features/file-upload/processors/image-processor.ts`
Acceptance:
- OCR text is chunked and embedded like normal documents.
- OCR chunks are labeled with metadata `sourceType: "file"`, `type: "image-ocr"`.

7. **Privacy enforcement for embedding providers**
Scope: Ensure “local-only” mode by restricting embedding strategy to local providers.
Files:
- `src/lib/embeddings/embedding-strategy.ts`
- `src/lib/config/knowledge-config.ts`
- `src/options/*` (toggle for local-only enforcement)
Acceptance:
- When local-only mode is enabled, embedding calls never hit external URLs.

---

## 16. Suggested Next Step

If you want, I can translate the tickets above into a concrete implementation plan that lists the exact function signatures, types, and minimal diffs for each file.
