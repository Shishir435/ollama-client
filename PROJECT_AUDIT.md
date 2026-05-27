# Project Audit

Date: 2026-05-24

Scope: source-level audit of the browser extension, docs/config surface, provider stack, RAG pipeline, storage layer, and test/build setup. I did not do a full manual UX pass in a real browser session, but I did run the core local checks.

Verification run:

- `pnpm typecheck` passed
- `pnpm lint:check` passed
- `pnpm test:run` passed: 96 test files, 853 tests

## Executive Summary

This is a stronger project than its name suggests. It is not just an "Ollama client" anymore; it is a local-first browser AI workbench with multi-provider chat, sidepanel UX, page context, local file ingestion, local RAG, embeddings, import/export, session history, and an ongoing SQLite migration.

The best parts are the provider abstraction, the breadth of tests, the local-first posture, and the fact that complex migration and browser-extension constraints are being handled explicitly rather than hidden under wishful thinking.

The biggest risk is product and architecture sprawl. The project has accumulated several ambitious systems at once: multi-provider routing, browser content extraction, file processing, RAG, semantic search, speech, model management, SQLite durability, Dexie fallback, docs, and cross-browser packaging. The code mostly works, but future velocity will depend on simplifying the mental model for users and contributors.

If I were taking ownership, I would not start by adding another model provider. I would first make the existing experience more predictable: web search with explicit permissions and citations, provider capability parity, better RAG observability, safer storage migration finalization, and a clearer onboarding path for "local model users who do not know why CORS, embeddings, or provider mappings matter."

## What I Would Have Done Differently

### 1. Name the product around the actual scope

The repo is called `ollama-client`, but the product now supports Ollama, LM Studio, llama.cpp, OpenAI, vLLM, KoboldCPP, and LocalAI. That mismatch leaks into mental models, docs, legacy message names, and user expectations.

What I would do:

- Keep backward-compatible extension/store identity if needed, but introduce a broader product label in UI/docs.
- Use "Local AI Sidepanel" or "Local LLM Client" language more prominently.
- Continue removing new `ollama-*` concepts from internal APIs except compatibility shims.

### 2. Design provider capabilities as the primary abstraction from day one

The code has a `ProviderCapabilities` shape, which is good. But some user-facing workflows still feel Ollama-first: pull/delete/unload/version are richer for Ollama than for other providers.

What I would do:

- Make the UI capability-driven everywhere.
- Show unavailable actions as provider-specific explanations rather than generic disabled states.
- Put provider behavior into conformance tests: model discovery, chat stream, embeddings, error mapping, cancellation, and model management capabilities.

### 3. Keep storage migration isolated behind one permanent repository contract

The chat-history facade is a reasonable response to the Dexie-to-SQLite transition, and the durability comments show real thought. Still, the migration era is increasing cognitive load.

What I would do:

- Keep `src/lib/repositories/chat-history.ts` as the only public chat-history contract.
- Aggressively remove direct Dexie knowledge from feature code.
- Put a date or release condition on Dexie retirement, then actually remove it.
- Move vector storage toward the same repository discipline before it becomes the next long-lived dual-store system.

### 4. Build RAG around explainability earlier

The RAG pipeline is ambitious: hybrid search, reranking, MMR, memory, recency, feedback blending, token budgeting. That is impressive, but users will not trust it unless they can see why a chunk was used or ignored.

What I would do:

- Treat "why this answer used these sources" as core UX, not diagnostics.
- Add a retrieval inspector: query classification, candidate count, scores, final selected chunks, truncated chunks, embedding model, provider, and token budget.
- Make RAG failure states explicit: no embedding model, embedding dimension mismatch, empty index, low similarity, reranker threshold too strict, context trimmed.

### 5. Avoid putting too many product responsibilities into settings screens

The options/settings area is powerful, but power-user density can become intimidating. The app needs a progressive path from "I installed this" to "I understand providers, embeddings, RAG, and browser permissions."

What I would do:

- Add a setup checklist with health checks: provider reachable, model selected, embedding available, page context permission, storage healthy.
- Add "recommended defaults" profiles: simple chat, page Q&A, local docs/RAG, power user.
- Hide risky/advanced controls behind disclosure unless the user has opted into advanced mode.

## Missing Features

### 1. Web search with citations

This is the most obvious missing feature, and it is tricky for local models because the model cannot browse by itself. The extension has to become the retrieval tool.

Suggested approach:

- Add an explicit "Search web" toggle or command, never silent background search.
- Create a `web-search` feature module with two phases: search results retrieval and page fetch/extraction.
- Use a provider adapter for search APIs instead of hardcoding one vendor. Start with a simple bring-your-own-key search backend, then add local/SearXNG support.
- Reuse existing content extraction pieces where possible, but keep remote page fetching separate from active-tab extraction.
- Store source metadata with every injected snippet: URL, title, fetched time, snippet, extraction method, and rank.
- Add citations to assistant messages and expose the exact snippets used.
- Add SSRF/privacy guardrails: block local/private IP ranges by default, limit redirects, cap page size, time out aggressively, and show domains before fetch if needed.
- Make it clear that the local model receives retrieved web text in the prompt. "Local model" does not mean "the web content never enters the model context."

Minimal implementation path:

1. Add `MESSAGE_KEYS.WEB.SEARCH` and `MESSAGE_KEYS.WEB.FETCH_RESULT`.
2. Add background handlers for search and fetch/extract.
3. Add a sidepanel search toggle and source preview.
4. Add prompt-builder support for web snippets with citation IDs.
5. Add tests for blocked URLs, extraction fallback, citation formatting, and prompt token budgeting.

### 2. Tool/function calling

`ProviderCapabilities` includes `toolCalling`, but the product does not appear to expose a full tool-use loop yet.

What to add:

- Provider capability detection for tool calling.
- A tool registry with browser-safe tools: current page summary, selected tabs, web search, calculator, date/time, local knowledge lookup.
- A confirmation layer for networked or destructive tools.
- Transcript UI showing tool calls and results.

### 3. First-run diagnostic setup

The project would benefit from a guided health check.

Checks to include:

- Provider endpoint reachable.
- Selected model exists.
- Chat stream works.
- Embedding model exists or can be pulled/downloaded.
- RAG index is healthy.
- Browser permissions are sufficient for selected features.
- SQLite storage can write, flush, reload, and read.

### 4. Provider parity

Model management is strongest for Ollama. Other providers need clearer support boundaries.

Needed improvements:

- LM Studio model metadata display using `/api/v0/models`.
- llama.cpp metadata display from `/v1/models`.
- vLLM/OpenAI-compatible model discovery normalization.
- Better error messages for CORS, missing API key, refused connection, and unsupported model-management operations.

### 5. Conversation branching and version UX

The session store supports message tree concepts, but the UI can go further.

Useful features:

- Visible branch navigation for regenerated responses.
- Compare two assistant responses.
- Pin a preferred branch.
- Export a single branch or full tree.

### 6. RAG corpus management

File ingestion exists, but a serious RAG workflow needs corpus lifecycle tools.

Needed features:

- Knowledge-set overview with document counts, chunk counts, embedding model, last indexed time, and failed documents.
- Reindex one file, one knowledge set, or everything.
- Chunk preview before/after text splitting changes.
- Duplicate detection.
- Stale embedding detection when the embedding model/provider changes.

### 7. Privacy and security UX

The project is local-first, but privacy should be visible and inspectable.

Add:

- A "data map" screen showing where chat, files, vectors, settings, and backups live.
- Per-provider disclosure: local endpoint vs remote API.
- Clear warning when OpenAI or another remote provider is selected.
- Import/export encryption option.
- Redaction controls for page context and uploaded documents.

### 8. Automated browser UX regression tests

There are browser verification scripts, which is good. The next step is scenario coverage.

Important flows:

- First install to first successful chat.
- Provider switch.
- Upload file and ask a sourced question.
- Select tab context and ask grounded question.
- Stop generation.
- Regenerate/edit branch.
- Backup export/import.
- SQLite migration from seeded Dexie data.

## Current Features That Need Improvement

### Provider selection and model routing

Current issue:

The fallback to Ollama is sensible historically, but it can surprise users when two providers expose the same model name or when mappings are missing.

Recommendation:

- Make provider identity visible next to every selected model.
- Treat ambiguous model names as a blocking selection state.
- Add a provider/model resolver preview in settings.
- Consider storing model references as `{ providerId, modelId }` everywhere user intent matters.

### RAG retrieval quality

Current issue:

The pipeline is feature-rich, but the more knobs it has, the easier it is for users to configure themselves into silence: thresholds too high, reranker unavailable, embedding mismatch, token budget too small.

Recommendation:

- Add a "test retrieval" panel with exact results and reasons.
- Add auto-diagnosis when no chunks are returned.
- Track embedding dimension and model provenance in every vector row.
- Add golden retrieval tests with small fixed corpora and expected source rankings.

### Content extraction

Current issue:

The content script logs heavily and handles multiple extraction modes. Browser pages are hostile environments; extraction failures need to be expected, quiet, and diagnosable.

Recommendation:

- Gate verbose logs behind a debug flag.
- Add extraction confidence scores.
- Surface extraction status per selected tab.
- Split selection capture, page extraction, transcript extraction, and message handling into smaller modules.

### Storage and migration

Current issue:

The SQLite migration has strong safeguards, but `chrome.storage.sync` is still used for some per-device migration/backend state. Sync replication can create confusing multi-device states.

Recommendation:

- Prefer `chrome.storage.local` for per-device migration status and backend pointer.
- Keep sync storage for true user preferences only.
- Add a storage diagnostics panel with active backend, message counts, health cookie, last flush time, and repair actions.
- Retire Dexie chat-history paths after the cutover window.

### Settings complexity

Current issue:

Settings are comprehensive, but several components are large and cover too many concerns. This makes UX changes riskier.

Recommendation:

- Split provider settings by provider card/section.
- Split embedding settings by model selection, indexing, search quality, storage, and diagnostics.
- Add integration-style component tests for common settings workflows.

### Logging

Current issue:

There are many `console.log` calls in runtime code, especially content extraction, provider checks, transcript extraction, and settings diagnostics.

Recommendation:

- Route logs through the existing logger.
- Add log levels.
- Default production runtime to warnings/errors.
- Keep debug output available through an explicit setting.

### Print/export safety

Current issue:

The print entrypoint reads HTML from `localStorage` and assigns it via `innerHTML`. It may be controlled internally, but it is still a risky pattern in an extension context.

Recommendation:

- Sanitize before insertion with the existing DOMPurify dependency.
- Prefer structured export data where possible.
- Add tests for script/event-handler stripping.

## Architecture Strengths

- WXT entrypoints are clear and thin.
- Background handlers are mostly separated by action.
- Provider classes are isolated and share a useful interface.
- The repository facade is the right direction for chat persistence.
- The test suite is broad and fast.
- The docs and README are unusually candid about limitations.
- The project already thinks about browser-specific behavior rather than assuming Chrome-only forever.
- RAG is not a toy implementation; it includes hybrid retrieval, reranking hooks, diversity, recency, memory, and feedback.

## Architecture Risks

- Too many capabilities are moving at once for a small project.
- Legacy Ollama naming still exists in enough places to confuse future contributors.
- Dexie and SQLite coexistence should be temporary, but temporary migration layers often become permanent.
- RAG quality may be hard to reason about without a visible inspector.
- OpenAI-compatible providers are similar, but their edge cases differ enough that generic fallback behavior can hide provider-specific bugs.
- Content scripts can become noisy and fragile if logging and extraction concerns stay together.
- Settings screens can become the place where unfinished product decisions accumulate.

## Suggested Roadmap

### Phase 1: Trust and clarity

- Add first-run health check.
- Make selected provider/model identity explicit everywhere.
- Add RAG retrieval inspector.
- Gate verbose logs behind a debug setting.
- Sanitize print/export HTML path.

### Phase 2: Web search

- Add opt-in web search command/toggle.
- Implement search backend adapter.
- Fetch/extract pages in background with strict network limits.
- Inject cited snippets into prompts.
- Add source chips and citation display in assistant messages.

### Phase 3: Storage cleanup

- Move per-device migration/backend state out of sync storage where practical.
- Add storage diagnostics.
- Remove Dexie chat-history fallback once the cutover is done.
- Plan vector storage migration or at least wrap it in a repository boundary.

### Phase 4: Provider parity

- Expand provider conformance tests.
- Normalize model metadata across LM Studio, llama.cpp, vLLM, LocalAI, KoboldCPP, and OpenAI.
- Improve capability-aware UI for unavailable actions.
- Add provider-specific troubleshooting.

### Phase 5: Advanced assistant workflows

- Add tool-calling loop.
- Add conversation branch UI.
- Add knowledge-set lifecycle management.
- Add encrypted backups.
- Add browser scenario tests for complete user journeys.

## Highest-Leverage Next PRs

1. Add a production-safe logger path and remove noisy runtime `console.log` calls.
2. Add a RAG retrieval inspector in settings or a developer drawer.
3. Add explicit provider/model labels and ambiguity blocking in the chat header/model selector.
4. Sanitize `src/entrypoints/print/main.ts` before assigning exported HTML.
5. Create a `src/features/web-search/` skeleton with types, settings, and tests before wiring a search provider.
6. Add storage diagnostics for active backend, counts, SQLite health, and last flush state.
7. Split `provider-settings.tsx` into smaller provider/capability sections.

## Final Take

The project is promising because it is solving a real gap: a local-first AI assistant that lives where users browse, without forcing every workflow through a hosted SaaS account.

The main thing it needs now is focus. Do not measure progress by the number of providers or knobs. Measure it by whether a new user can install it, connect a local model, ask about a page or file, see the exact sources used, and understand what stayed local.

Web search is the right next major feature, but it should be implemented as a retrieval tool with citations, permissions, and network guardrails, not as a magical "the model can browse now" checkbox.
