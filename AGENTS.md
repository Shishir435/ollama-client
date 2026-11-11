# AGENTS.md

Working guide for Ollama Client. Keep this file short: put subsystem contracts in
the linked references, behavior in code, and change history in git.
`CLAUDE.md` imports this file; do not maintain a second instruction set there.

## Project

Local-first browser extension: Chrome MV3 and Firefox MV2, WXT, React 19,
TypeScript 6, Tailwind v4, pnpm 11, Oxlint and Oxfmt. Node.js 22.12+.
Built-in providers are Ollama, LM Studio and llama.cpp. Other compatible servers
and Anthropic use custom providers. Unmapped models fall back to Ollama.
The experimental browser agent is opt-in and compiled out of Firefox.

## Commands

```bash
pnpm install
pnpm dev                    # Chrome; pnpm dev:firefox for Firefox
pnpm build                  # Chrome; pnpm build:firefox for Firefox
pnpm test:run               # one-shot unit suite
pnpm test:run path/to/__tests__/module.test.ts
pnpm typecheck
pnpm lint:check
pnpm format:check
pnpm check:dead
pnpm verify                 # static checks and unit tests
pnpm docs:build             # generates docs, then builds Astro
pnpm generate:resources     # validates locales and generates extension assets
```

Before a PR: `pnpm verify`. For docs or locale changes, also run
`pnpm docs:build && pnpm generate:resources`. Browser, manifest, persistence and
release changes need the corresponding browser gates in [tools/README.md](tools/README.md).
Never bypass hooks with `--no-verify`. Branch promotion is
`release/*` → `preview` → `main`; do not promote a release branch directly to main.

## Ownership

| Layer | Owns |
|---|---|
| `src/entrypoints/` | Thin WXT bootstraps; manifest configuration is in `wxt.config.ts` |
| `src/features/<name>/` | Feature UI, hooks and ephemeral stores |
| `src/application/` | Use-case orchestration, context building, ingestion and agent model adapters |
| `src/background/` | Browser lifetime, privileged composition, streaming handlers and RPC dispatch |
| `src/lib/` | Providers, repositories, browser and persistence adapters, reusable infrastructure |
| `packages/contracts/` | Environment-independent Zod and wire contracts |
| `packages/runtime-core/` | Stream reduction, cancellation, retries and checkpoints |
| `packages/chat-runtime/` | Port-driven turn, context and tool-loop orchestration |
| `packages/agent-runtime/` | Pure agent controller, policy, affordances, verification and recovery |
| `packages/olc/` | Separate Node CLI; read its own AGENTS.md before changes |

Except for `olc`, packages must not import React, WXT, browser APIs, concrete
providers, persistence adapters, feature UI or background composition. All
workspace package versions track the extension version. Feature stores stay in
`features/<name>/stores/`; `src/stores/` is for cross-feature state only.

## Read only the reference your change needs

| Area | Reference |
|---|---|
| Browser agent: control, policy, evidence, completion, recovery | [AGENT_INTERNALS.md](AGENT_INTERNALS.md), then its relevant section |
| Provider discovery, capabilities, lifecycle, branding and favicons | [Provider contracts](docs/internal/providers.md) |
| SQLite ownership, durable jobs, startup, migrations and storage scopes | [Persistence contracts](docs/internal/persistence.md) |
| RAG, web search, internal tools, OLC boundary and docs routing | [Tools and docs](docs/internal/tools-and-docs.md) |
| RPC/stream conventions, UI, i18n, tests, hooks and existing refactor boundaries | [Conventions](docs/internal/conventions.md) |
| CLI backends and service lifecycle | [packages/olc/AGENTS.md](packages/olc/AGENTS.md) |
| Contributor workflow and verification prerequisites | [CONTRIBUTING.md](CONTRIBUTING.md), [tools/README.md](tools/README.md) |

## Boundaries to preserve

- Chat history uses one SQLite engine and writer in the persistence host.
  Call `src/lib/repositories/chat-history.ts`, never its concrete implementation.
  Migrations are forward-only. Dexie owns vectors and knowledge sets, not chats.
- SQLite owns durable workflows and per-model preferences. `chrome.storage`
  owns settings/configuration; every key needs a scoped descriptor in
  `storage-key-registry.ts`. Zustand is ephemeral except the documented
  durable-backed theme and shortcut stores. Components submit intent to the
  application/background owner rather than running durable workflows.
- Request/response operations use registered, validated `RpcMethod` contracts.
  RPC is extension-page-only. `MESSAGE_KEYS` names streaming ports and approved
  one-way/content-script events; it is not a second RPC or storage system.
- Provider catalogs are optional. Use `model-discovery.ts`, never call
  `.getModels()` elsewhere. Unknown vision/tool capabilities remain false;
  overrides, probes and metadata have explicit precedence. Lifecycle wire
  formats remain in provider adapters.
- RAG orchestration lives in `src/application/context/rag/`. All splitting uses
  `src/lib/embeddings/chunker.ts`. Packaged embedding assets stay local: never
  download executable code, weights or tokenizer assets at runtime. There is
  no OCR, cross-encoder or ANN index to revive accidentally.
- Page content and tool results are untrusted data. They cannot change the
  goal, grant consent, widen origins or override policy. Never replay a
  consequential effect whose execution is uncertain. Input delivery, observed
  effect and goal achievement are separate judgments.
- Raw shipped debugger access belongs only to
  `src/background/agent/agent-browser-session-manager.ts`. Keep model tools
  scoped and validated. Screenshots are masked, transient and never persisted.
- Credentials and opaque reasoning replay blocks never enter logs or UI.
  Preserve provider/model ownership and opaque ordering when replaying blocks.
- MV3 CSP blocks dynamic eval. Use guarded browser APIs from `lib/browser-api.ts`.
  Keep dev origins and experimental entrypoints out of packaged builds.

## Changes and tests

Match existing patterns. Use two-space indentation, double quotes, no semicolons,
Oxlint and Oxfmt. Comments should explain a constraint or non-obvious reason;
use JSDoc for module/declaration documentation. Avoid style-only tests.

Tests belong in the nearest `__tests__` directory. Prefer observable behavior,
negative cases and real boundary contracts over source-string snapshots or
checks of third-party library behavior. A short test can protect a serious bug:
permission, consent, persistence, schema agreement and duplicate-effect tests
are not disposable because they are small. Remove a regression test only when
the behavior is retired or another retained test demonstrably covers it.

Use existing UI primitives and semantic tokens. Import Lucide icons directly,
with named size tokens. Use `Controlled*` wrappers for React Hook Form; never
spread `register()` into controlled Base UI primitives.

User-visible strings need keys in all nine locales (`de en es fr hi it ja ru zh`),
with no fallback string passed to `t()`. Locale JSON is authoritative;
`public/_locales/` and selection locale assets are generated. Do not hand-edit
generated docs, locale assets or build output. Read the relevant reference
before changing a documented compatibility or recovery path.
