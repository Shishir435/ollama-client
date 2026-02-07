# Contributing Guide

This guide is focused on practical contributor workflow for this repository.

## 1) Local Development Setup

### Prerequisites

- Node.js 18+
- `pnpm`
- One local provider runtime (Ollama recommended for full feature coverage)

### Install and run

```bash
git clone https://github.com/Shishir435/ollama-client.git
cd ollama-client
pnpm install
pnpm dev
```

This project uses WXT as the extension build/dev framework.

Firefox (experimental):

```bash
pnpm dev:firefox
```

## 2) Codebase Structure Overview

Top-level execution layers:

- `src/sidepanel/*` - chat UI app
- `src/options/*` - settings UI app
- `src/background/*` - worker handlers/orchestration
- `src/contents/*` - in-page scripts

Feature modules:

- `src/features/chat/*`
- `src/features/model/*`
- `src/features/sessions/*`
- `src/features/file-upload/*`
- `src/features/tabs/*`

Shared internals:

- `src/lib/providers/*` - provider abstraction
- `src/lib/embeddings/*` - retrieval/embedding internals
- `src/lib/db.ts` - Dexie chat store
- `src/lib/sqlite/*` - migration/auxiliary SQLite path

## 3) Where to Add Features

### New chat UX behavior

- UI components: `src/features/chat/components/*`
- State/hooks: `src/features/chat/hooks/*`
- Session behavior: `src/features/sessions/stores/chat-session-store.ts`

### Provider improvements

- Provider interfaces/types: `src/lib/providers/types.ts`
- Provider implementations: `src/lib/providers/*.ts`
- Factory/manager wiring: `src/lib/providers/factory.ts`, `src/lib/providers/manager.ts`

### RAG/retrieval changes

- Pipeline/retriever: `src/features/chat/rag/*`
- Search/index/storage internals: `src/lib/embeddings/*`

### Model management handlers

- Background endpoints: `src/background/handlers/*`

## 4) Quality Gates Before PR

Run before opening PR:

```bash
pnpm lint:check
pnpm test:run
```

If behavior changes, update docs in the same PR.

## 5) PR Structure Expectations

A good PR should include:

1. Problem statement
2. Scope and non-goals
3. Implementation summary
4. Test evidence (commands + outcomes)
5. Screenshots/GIFs for UI changes
6. Risk notes and rollback strategy (if relevant)

Keep PRs focused; avoid mixing unrelated refactors with functional changes.

## 6) Coding Expectations

- Prefer explicit, readable code over clever one-liners.
- Preserve local-first and privacy-first assumptions.
- Avoid hidden network calls or silent telemetry additions.
- Keep backward compatibility for storage keys unless migration is included.
- Use feature-local modules instead of spreading logic across unrelated folders.

## 7) Provider-Related Contribution Rules

When changing provider logic:

- Validate routing in both UI and background paths.
- Avoid assuming Ollama-only behavior unless file is explicitly Ollama-specific.
- Update support matrix [docs](./docs/providers.md) when behavior changes.

## 8) RAG-Related Contribution Rules

When changing retrieval/embedding:

- Validate retrieval quality with realistic local data.
- Document config defaults and behavior changes.
- Call out CSP constraints if introducing transformer/WASM-based components.
- Prefer measurable tradeoffs (latency/quality/memory), not generic claims.

## 9) Security and Privacy Expectations

- Do not introduce analytics/tracking dependencies.
- Keep endpoint usage explicit and user-configurable.
- Treat local data safety as product behavior, not optional enhancement.

## 10) Good First Contribution Areas

- Provider naming cleanup (`ollama-*` legacy key paths)
- Error message consistency across handlers
- Retrieval debug UX improvements
- Documentation parity updates for feature changes

## 11) Getting Help

- Search existing issues before opening new ones.
- Open focused issues with reproduction details.
- Link code references and expected behavior, not only screenshots.
