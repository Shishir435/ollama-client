# Engineering reference: tools and docs

Start with [AGENTS.md](../../AGENTS.md). Read this reference when changing the subsystem below.

## Subsystems

### RAG / embeddings

- Pipeline: `src/application/context/rag/` (`rag-pipeline.ts`, `rag-retriever.ts`, `rag-prompt-builder.ts`, `query-classifier.ts`), driven by `src/application/context/build-context.ts`. It left `src/features/chat/` when context building went to the background — a feature directory cannot own work the background performs.
- **All** file, memory and live-page splitting goes through `src/lib/embeddings/chunker.ts`. Do not build a parallel text splitter.
- Plumbing: `src/lib/embeddings/` (`embedding-strategy.ts`, `embedder-factory.ts`, `keyword-index.ts`, `keyword-index-loader.ts`, `vector-codec.ts`, `storage.ts`, `chunker.ts`, `search.ts`).
- New installs use bundled MiniLM embeddings (`src/lib/embeddings/native/`). Existing users retain the provider-native → shared model → Ollama fallback chain until they opt in.
- Bundled inference uses a lazy dedicated CPU WASM worker in the existing Chromium offscreen document / Firefox background page. Model, tokenizer and runtime ship locally, pinned and hash-checked at build time. Never download executable code, model weights or tokenizer assets from remote URLs at runtime. Reading packaged assets via `fetch()` of extension-local URLs (`chrome-extension://` / `moz-extension://`) is allowed and requires no network connection.
- Native migration stages every saved vector in Dexie and commits replacements with the active vector-space pointer in one transaction. This index pointer belongs with the vectors, not in a separate settings write. Concurrent source changes prevent the swap. The background owns the batch loop (`driveNativeMigration`), so closing the dialog or side panel never stalls it; a worker lost mid-rebuild resumes at startup, while a failed batch sets `failed` and waits for the user's Resume. Provider settings remain in chrome.storage, as does the device-local announcement dismissal.
- **A full vector store refuses; it never deletes to make room.** `storeVector` throws `VectorStorageFullError` once the maintained total would pass `maxStorageSize`, and nothing is evicted — the oldest documents are the user's. The message is the stable code `vector_storage_full:<MB>`, which survives the ingestion failure record and which `useFileUpload` renders in the user's language; chat indexing skips the message but leaves a device-local marker (`STORAGE_KEYS.EMBEDDINGS.STORAGE_FULL`, cleared by the next write that fits) that the side panel turns into a notice linking to the limit setting, and a non-strict batch stops at the first refusal rather than reporting every chunk. The limit defaults to 0 (none); a user who sets one gets the refusal, never a deletion. Only two things delete vectors by themselves: the opt-in `autoCleanup` age rule, and the scheduled maintenance job, which removes exact duplicates.
- Hybrid search: keyword (`minisearch`) + dense exact cosine scan, configurable weights. There is no ANN index: a scoped search must rank inside its corpus, HNSW could not filter before top-K, and at corpus sizes a user reaches it cost minutes to build and no less to query than the scan.
- **Vectors are stored as float32.** A row holds `normalizedEmbedding` (`Float32Array`) and `norm`; the raw `embedding` is a non-enumerable getter the Dexie read hook attaches (`vector-codec.ts`), so scans that read only the unit vector never rebuild it. Write rows through `encodeVectorDocument`. Rows from earlier versions keep both float64 arrays until `vector-format-migration.ts` rewrites them in batches at startup; every reader must accept either shape, and `estimateVectorStorageSize` keeps the old formula for an old row so the running totals still subtract what was added.
- **The keyword index loads in the context that searches.** It lives only in memory, so `searchHybrid` loads it through `keyword-index-loader.ts` and waits up to two seconds before searching semantically.
- Reranking is a **cosine-similarity re-scorer** (`reranker.ts`), on by default — **not** a cross-encoder. A transformers.js / ONNX Runtime cross-encoder was blocked by MV3 CSP and never shipped; Transformers.js is not a dependency. ONNX Runtime now ships for the bundled embedder, not a cross-encoder. `config.ts` accepts the legacy `transformers-js`/`onnxruntime-web` strings only as a shim collapsing them to `cosine`.
- There is no `src/lib/rag/core/` tree. Any doc referencing one is stale.

### Web search

- Runtime: `src/lib/tools/web-search/`. `WebSearchBackend` adapters keep provider wire formats behind one `web_search` tool.
- Backends: SearXNG (`GET /search?q=…&format=json`), Brave (`GET api.search.brave.com/res/v1/web/search`, `X-Subscription-Token`), Tavily (`POST api.tavily.com/search`, bearer), Ollama (`POST ollama.com/api/web_search`, bearer). Ollama search supports query and result count only; it needs its own API key even with a signed-in daemon.
- Settings UI: `src/features/web-search/`, mounted in the internal `context` tab (shown as "Knowledge & web"). Config is device-local via `STORAGE_KEYS.WEB_SEARCH.CONFIG`. **Never log API keys.**
- Result counts: SearXNG has `pageno` but no count parameter — fetch configured pages, de-dupe, then cap. Brave uses `count`; Tavily uses `max_results`.
- Treat snippets and titles as untrusted. Cap per-result snippets and total tool output, and instruct models to cite returned URLs for current facts.

### Internal LLM tools

Model-callable tools live in `src/lib/tools/internal/`, registered in `internal-tool-source.ts`. When adding one:

- Give it a stable `displayNameKey` and add that key to `chat.reasoning.trace` in **every** `src/locales/<lang>/translation.json`, or the reasoning trace shows raw key paths.
- Run `pnpm generate:resources` after locale edits.
- Keep privacy-sensitive tools on the same permission and scope filters as their indexing/search pipeline. A live tool must not bypass user exclusions.
- Browser-data tools pass two independent gates before any provider sees them (`background/lib/tool-exposure-policy.ts`): the optional permission is granted **and** the current request asks for that data (`optional-permission-intent.ts`, which tolerates a one-edit typo in the keyword carrying the intent). Provider-side `tool_choice: auto` is not a privacy boundary.
- **The chat model is told it lives in the browser.** Whenever a tab tool is offered, `buildBrowserContextGuidance` says the model runs in the side panel beside the user's tab, that "this", a PR, an article and the like mean that tab, and that `current_tab` reads it; `browser_task` is for acting, not reading. The panel's tab (`browserTabId`) contributes its title and query-less URL as flattened metadata only after `classifyTabAccess` passes it — never its body, never an excluded or internal page, never incognito. `current_tab` reads that tab before falling back to the last focused window, which is another window's page when two are open. Without this, a hosted runtime's own persona answered "what's this PR?" with an empty workspace. This guidance, tool guidance and memory context ride on the latest user message in a `<runtime_context>` block — or, when the request has no user turn, a trailing system message of their own — never the leading system prompt, so the system prefix stays byte-stable for provider prompt caching.
- **`browser_task` is experimental and opt-in** (`SETTINGS.AGENT_ENABLED`, off by default; Settings → Agent or the Context sheet). While off it is neither listed nor callable, and a request that reads as a browser task gets the `browserAgent` notice card instead of a reply. The internal tool source is `volatile`, so `ToolRegistry` re-lists it every turn: caching its first answer kept `browser_task` missing for the worker's lifetime after the user turned the agent on.
- **Embedded frames are read with the page unless the user asked otherwise.** An artifact or an embedded document is part of what the user is looking at, so `current_tab`, `read_tab` and the tab-group tools append each frame's text, labelled by origin. A user who says to leave embedded, third-party or external content alone is honoured through `excludeEmbeddedFrames`, which the browser guidance and the tool description tell the model to set; the frames are then named by origin from the frame list and never asked for content, so nothing is extracted, scrolled or loaded. The tool cannot parse the user's words, so that instruction is the model's to carry. The tab-content cache records which of the two it holds and never answers one with the other.
- `browser_task` is exempt from the intent gate on purpose: the model deciding when the browser is needed is the feature. Its gate is the tool loop's approval, which `confirmation` forces whenever the turn could be carrying page text ([details](../../AGENT_INTERNALS.md#starting-a-run-from-chat)).

### Agent runtimes via the olc proxy

`packages/olc` is a Node CLI, not extension code. Bare `olc` manages native
Ollama on port 11434; `-b codex|opencode` runs an agent proxy (8083 / 8084)
and `-b fm` (alias `apple`) serves Apple's on-device Foundation Model (8085),
each over `/v1/chat/completions`, so those models reach the extension through
the ordinary OpenAI-compatible custom-provider flow.

- **Nothing in `src/` knows it exists.** Do not add proxy-aware branches to the
  extension: provider-shaped behaviour belongs behind the provider's own wire
  format, not behind a base-URL check in a handler.
- Its own rules — session lifecycle, parked turns, the single-flight queue,
  catalog caching, CORS — are in [`packages/olc/AGENTS.md`](../../packages/olc/AGENTS.md).
  `packages/olc/README.md` has the options, endpoints and known limits.

### Docs site and its agent surface

`docs/` is an Astro static build deployed by Vercel from `vercel.json`. Two
rules decide where a change goes.

- **Vercel evaluates `rewrites` after the filesystem.** Every documentation page
  is a built file, so nothing in `rewrites` can reshape its response. An
  `Accept`-conditioned rewrite there is dead config; an `Accept`-conditioned
  *header* there is worse, because it relabels a body it never replaced. That is
  what stamped `Content-Type: text/markdown` on the HTML homepage.
- **Request-time behaviour lives in `docs/proxy.ts`**, the Routing Middleware
  named by `vercel.json`'s `proxy` entry, which runs before the filesystem. It is
  an adapter only: every decision is in `docs/src/lib/agent-routing.ts` so it can
  be tested without a deployment (`src/lib/__tests__/agent-routing.test.ts`). Its
  `config.matcher` excludes assets, `og/`, `.well-known/`, `reference/`, and any
  path with a file extension — which is also what stops a `.md` rewrite from
  re-entering it.

The published contract, and where each piece is owned:

| Surface | Owner |
|---|---|
| Markdown twin of every page, negotiated at the same URL | `agent-routing.ts` + the `.md` files `generate-llms-docs.ts` writes |
| `llms.txt`, `llms-full.txt`, `ai.txt`, `index.md`, `404.md`, `.well-known/api-catalog` | `tools/generate/generate-llms-docs.ts`, gitignored under `docs/public/` |
| `openapi.json` | `tools/generate/generate-openapi.ts` over `tools/generate/openapi/olc-openapi.template.json`, versioned from `packages/olc` |
| JSON body of `/api` and `/api/health` | `docs/src/pages/`, prerendered |
| Headers of those two paths | `vercel.json`, because a static build discards the headers an endpoint module sets. `agent-routing.test.ts` asserts they match `apiHeaders()` exactly |
| JSON errors for `/api/*` (404, 405, 406) | `agent-routing.ts`; a static file cannot answer them |

- A page's Markdown twin exists because its slug is in `DOC_ORDER`
  (`docs/src/seo/doc-ia.mjs`), which is also the sidebar and the `llms.txt`
  order. A route that is published but has no twin goes in
  `NON_NEGOTIABLE_ROUTES`, or a Markdown client gets a 404 for a page it can
  plainly load.
- `pnpm verify:agent-endpoints [baseUrl]` proves the contract against a real
  deployment. Routing order, middleware execution and CDN variant caching are
  the parts no unit test can reach.

## Platform constraints

- MV3 permits bundled WASM through `wasm-unsafe-eval`, not dynamic evaluation.
- Firefox does not provide Chrome's declarativeNetRequest semantics. Provider
  access still depends on host permission and a compatible endpoint.
- Chunker token estimates are approximate (`chars / 4`), not a tokenizer proof.
- Dev-only assets are served from Vite, apart from the reload shim. Do not
  assume `chrome.runtime.getURL` names an emitted dev-only chunk on disk.
