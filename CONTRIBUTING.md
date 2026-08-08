# Contributing

Thanks for considering a contribution. This is a small project and the
guide below is meant to be practical, not bureaucratic. If anything is
unclear, open a draft PR or an issue and ask.

If you're using an AI coding assistant (Claude Code, Cursor, Copilot,
etc.), read `AGENTS.md` first — it has the architecture map and the
project-specific conventions an agent needs to be useful.

## 1. Local setup

### Prerequisites

- Node.js **≥22.12**
- pnpm **11** (the lockfile and scripts assume pnpm; npm/yarn will not work)
- At least one provider running locally if you want to exercise the
  chat feature end-to-end. Ollama is the easiest:
  - <https://www.ollamaclient.in/guides/provider-setup/>

### Install and run

```bash
git clone https://github.com/Shishir435/ollama-client.git
cd ollama-client
pnpm install
pnpm dev                    # Chrome MV3, live reload
pnpm dev:firefox            # Firefox MV2, live reload
```

Load the unpacked extension from `build/chrome-mv3-dev` (or
`build/firefox-mv2-dev`). WXT will rebuild automatically on file
changes.

## 2. Repository tour

Read [AGENTS.md](./AGENTS.md) for the full map. Quick orientation:

| Layer | Where it lives |
|---|---|
| Side panel (chat UI) | `src/entrypoints/sidepanel/index.tsx` → `src/sidepanel/` |
| Options page | `src/entrypoints/options/index.tsx` → `src/options/` |
| Background service worker | `src/entrypoints/background.ts` → `src/background/` |
| Content scripts (page extraction, selection button) | `src/entrypoints/content.ts`, `src/entrypoints/selection-button.content.tsx` → `src/contents/` |
| Feature folders (chat, sessions, model, file-upload, prompt, knowledge, memory, context, tabs) | `src/features/<feature>/` |
| Provider abstraction + implementations | `src/lib/providers/` |
| Chat-history persistence (SQLite-only) | `src/lib/repositories/chat-history.ts` (facade) |
| Context and RAG orchestration | `src/application/context/` |
| Embedding and vector primitives | `src/lib/embeddings/` |
| Shared UI primitives (shadcn) | `src/components/ui/` |
| i18n source-of-truth | `src/locales/<lang>/translation.json` (loaded as one lazy chunk per language) |

### Storage backend

`src/lib/repositories/chat-history.ts` is the SQLite-only runtime facade for
sessions, messages, files, and tool-loop checkpoints. **Always import from the
facade, never from `sqlite-chat-history.ts` or `src/lib/sqlite/` directly.**
Dexie remains only for vector embeddings and knowledge sets.

## 3. Where to add things

- **New chat UX behavior** → `src/features/chat/components/`,
  `src/features/chat/hooks/`. State mutation lives in
  `src/features/sessions/stores/chat-session-store.ts`.
- **A new built-in provider** → add a file in `src/lib/providers/` that extends
  `OpenAICompatibleProvider` when the wire is compatible, or implements
  `LLMProvider` when it is not. Register verified built-ins in
  `OPENAI_COMPAT_CONSTRUCTORS`, `DEFAULT_PROVIDERS`, and `registry.ts`. Most
  compatible servers should use the custom-provider flow instead. Add provider
  contract tests either way.
- **A new request/response background capability** → add an `RpcMethod`, its
  request/result schemas and `RpcMap` entry, registry metadata, and a service
  handler. Do not add an ad-hoc runtime message. Only streaming ports and
  intentional one-way/content-script events belong in background handlers.
- **RAG / retrieval changes** → pipeline orchestration in
  `src/application/context/rag/`, context composition in
  `src/application/context/build-context.ts`, and primitives (chunker, HNSW,
  keyword index, storage) in `src/lib/embeddings/`.

## 4. Quality gates before opening a PR

These all run in the pre-commit / pre-push hooks; running them
manually first just speeds up the loop:

```bash
pnpm typecheck
pnpm lint:check          # auto-fix with `pnpm lint:fix`
pnpm format:check        # auto-fix with `pnpm format:fix`
pnpm test:run            # full vitest suite
pnpm verify              # typecheck + lint + full vitest suite
pnpm build               # Chrome MV3
pnpm build:firefox       # Firefox MV2
```

Only when relevant:

```bash
pnpm verify:browser-smoke    # manifest / CSP / permissions changed
pnpm generate:resources      # locale strings changed
pnpm docs:generate           # docs changelog/provider matrix source changed
```

Docs site source lives in `docs/`, but not every docs page is hand-edited there. `tools/generate-docs.ts` generates the changelog page from `CHANGELOG.md` and the provider matrix page from `src/lib/providers/`. Treat `CHANGELOG.md`, provider source files, and `tools/generate-docs.ts` as the source of truth; do not hand-edit the generated pages under `docs/src/content/docs/about/changelog.md` or `docs/src/content/docs/concepts/provider-matrix.md`. Astro writes build output to `docs/dist/` for Vercel.

The git hooks are split:

- **pre-commit** runs `lint-staged` (typecheck, format-fix, lint-fix,
  related tests) plus full `typecheck` / `lint:check` /
  `format:check`. Fast enough to keep on every commit.
- **pre-push** runs `pnpm test:run` (full suite). This is the last
  safety net before code leaves your machine.

## 5. PR expectations

- Use the PR template; it asks the questions a reviewer would ask
  anyway.
- Keep PRs focused — bug fixes don't need surrounding cleanup,
  refactors shouldn't add features.
- Screenshots/GIFs for any UI change.
- If you touch chat-history persistence, the content script, the
  background dispatcher, or the manifest, say so in the PR description
  — those are the high-blast-radius surfaces.

## 6. Coding conventions

- TypeScript everywhere. `any` and `@ts-ignore` should be exceptional
  and explained in a comment.
- Prefer explicit, readable code over clever one-liners.
- Don't add error handling for things that can't happen. Validate at
  system boundaries (user input, external APIs), not at internal
  function calls.
- Default to no comments. Add one only when the *why* is non-obvious
  — a hidden constraint, a workaround, a subtle invariant. If
  removing the comment wouldn't confuse a future reader, don't write
  it.
- Feature-local modules over spread-out logic. Cross-cutting state
  (theme, shortcuts, search) lives in `src/stores/`; feature-scoped
  state lives under `features/<x>/stores/`.

## 7. Privacy / local-first

This is a local-first extension. Please respect that:

- No analytics, telemetry, or tracking dependencies.
- Endpoint usage stays explicit and user-configurable.
- Any new network call to a non-user-configured URL needs a clear
  justification in the PR.
- Any new manifest permission needs a clear justification in the PR.
- Storage migrations need a deprecation window — user chat history is
  not something we can lose.

## 8. Provider-specific notes

- Validate routing in both UI and background paths when changing
  provider logic.
- Don't assume Ollama-specific behavior unless the file is explicitly
  an Ollama implementation.
- Update the supported-providers list in `README.md` and `AGENTS.md`
  when adding or removing a provider.

## 9. RAG-specific notes

- Validate retrieval quality with realistic local data, not toy
  inputs.
- Document any config-default changes.
- Call out CSP / WASM constraints when introducing transformer-based
  components.
- Prefer measurable trade-offs (latency / quality / memory) over
  generic claims.

## 10. Good first contribution areas

These are real, scoped, valuable for the project right now:

- **`src/features/model/components/embedding-settings.tsx`** (665 LOC)
  could be split into focused sub-components, similar to the
  provider-settings split that already happened.
- **Durable stream ownership** characterization around
  `use-chat-streaming.ts` and `durable-turn-runtime.ts`.
- **Runtime schemas** for persisted tool-loop checkpoints and provider config.
- **Embedding-settings sub-component extraction** under
  `src/features/model/components/embedding-config/`.
- **Error message consistency** across `src/background/handlers/*` —
  some throw, some return `{ success: false, error: ... }`. Aligning
  those makes error UI simpler.
- **Documentation parity** — if you find a place where AGENTS.md or
  README is out of sync with the code, a small fix-up PR is welcome.

## 11. Getting help

- Search existing issues before opening a new one.
- Open focused bug reports with the template filled in (provider,
  browser, console logs, repro steps).
- Reference code by `path:line` rather than only by screenshot when
  possible.
- For setup questions, the
  [docs site](https://www.ollamaclient.in/) is usually
  the right starting point.
