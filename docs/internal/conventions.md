# Engineering reference: conventions

Start with [AGENTS.md](../../AGENTS.md). This reference covers integration and
maintenance constraints; git history carries individual repair stories.

## Messaging and handlers

- Add request/response operations through `RpcMethod`, its schemas, `RpcMap`,
  registry and service handler. Keep both-side validation, sender policy, safe
  errors and cancellation. RPC remains extension-page-only.
- `MESSAGE_KEYS` owns streaming ports and approved one-way events. The existing
  content-script-reachable `PROVIDER.GET_MODELS` read stays outside RPC.
- Do not restore removed runtime aliases. Persisted legacy storage keys are
  different: existing user data may still need them.
- `src/background/handlers/` adapts streaming protocols to services. Provider and
  model request/response work belongs in `ProviderRpcService` / `ModelRpcService`.
- Write-only stream producers take `ChatStreamSink`, not fabricated `ChromePort`
  objects. `withErrorContext` preserves the producer's port type; the real port
  adaptation remains in `port-router.ts`.

## UI composition

Use vendored `components/ui/` primitives, then app-owned composites, feature UI
and page shells. Add a composite for an actual caller, not a speculative future
use. Options-page spacing does not automatically fit a narrow side panel.

| Suffix | Root shape |
|---|---|
| `card` | Bordered surface |
| `section` | Titled group without its own surface |
| `fields` | Bare fields without a title or surface |
| `panel` | Composed feature surface |

Dense leading-icon/label/action rows use `ListRow` or `ListRowButton`.
Use `inset="nested"` inside padded containers and `trailingKind="control"` when
that control owns its padding. `description` is a second label line; `below`
is a separate content block. Dense empty states use `density="compact"`.

Import Lucide icons directly with named `icon-*` size tokens. Use semantic
colors, typography and radius tokens. RHF uses the existing `Controlled*`
wrappers; never spread `register()` into controlled Base UI primitives.

## Settings and localization

- `settings-registry.ts` owns navigation/search. Include real tab/section,
  visible strings in `searchKeys`, and only useful technical aliases.
- Each `id`/`focusId` must resolve to a mounted target through the shared focus
  props or `data-settings-focus-id`; no duplicate ids across tabs.
- Locale JSON is authoritative. Add keys in all nine locales, with no `t()`
  fallback strings. Keep extension metadata translated too.
- Load locales through `locale-loader.ts`'s explicit lazy map. Never aggregate
  all languages into the initial bundle.
- `public/_locales/` and selection locale assets are generated. Run
  `pnpm generate:resources` after source changes; do not edit outputs manually.

## Tests and tooling

Use the nearest `__tests__` directory. App tests use happy-dom and the shared
Chrome/IndexedDB setup; use Testing Library `fireEvent` (`user-event` is not
installed). Test behavior and failure boundaries. Source checks are justified
when they protect an architectural or packaging boundary, not cosmetic syntax.

`vitest.config.ts` owns coverage exclusions and separate TS/TSX thresholds.
Browser-only composition roots belong to browser gates. Do not lower thresholds
or remove regression cases to make a change pass. [tools/README.md](../../tools/README.md)
owns commands, hook lanes and release prerequisites.

Oxlint and Oxfmt own code style. Keep warnings fatal, hook dependencies exhaustive,
side-effect imports ordered and suppressions local with a reason. Preserve manual
memoization boundaries when compiler/lint changes would otherwise add caches.
Use semantic colors for `@shadcn/lint`; do not disable rules globally. Test-only
`any` is permitted; production escape hatches need an external-boundary reason.

Retain boundary coverage for repository ownership, package imports, validated
browser APIs, provider contracts, RHF integration, CSP, store-build contents,
package versions, docs negotiation and OpenAPI inputs. These protect behavior
that ordinary component tests cannot establish.

## Existing responsibility boundaries

- `use-chat.ts` wires hooks. `use-chat-turn-controller.ts` owns submission
  preconditions, preparation and durable turn command construction; do not split
  it opportunistically during unrelated cleanup.
- `use-chat-stream.ts` adapts React/i18n/browser effects around the pure
  `application/turns/chat-stream-session.ts` lifecycle and reducer.
- `background/durable-turn-runtime.ts` composes `background/turns/` observers,
  generation, reconnect, recovery and service factory. Keep registry maps in
  their existing owner and new controls in the corresponding module.
- The selection overlay reads its shared context; only its app knows the
  reducer/capture refs. Markdown/thinking rendering leaves stay prop-driven.
- The context-settings sheet delegates data to `use-context-settings.ts` and
  `use-context-tab-options.ts`; views and summary stay separate.
- Session-store slices use `chat-history.ts`. Provider-settings components
  delegate connection and custom-model editing to their existing slices.
- File-upload UI stays in its hook; move validation/registration/enqueue work
  through `file-upload-pipeline.ts` rather than adding workflows to the UI.
- `contents/index.ts` is bootstrap wiring. Prefer domain type modules over
  `types/index.ts`. `contracts/chat.ts` stays a public barrel; internal callers
  import the module owning the concept.
