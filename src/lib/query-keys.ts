/**
 * Centralised query key factory for all TanStack Query keys.
 *
 * Using factory functions (instead of raw string arrays) gives us:
 * - Type safety: each key is `readonly` and inferred correctly.
 * - Easy partial invalidation: `queryKeys.model.all()` covers every model sub-query.
 * - Single source of truth: rename a key here and TypeScript will catch every usage.
 */
export const queryKeys = {
  model: {
    /** Invalidates / matches every model-related query. */
    all: () => ["model"] as const,

    /** Invalidates / matches every per-model details query. */
    infoAll: () => ["model", "info"] as const,

    /** Details for a specific model (shown in the model detail panel). */
    info: (modelId: string) => ["model", "info", modelId] as const,

    /** Prefix covering every provider's model list; invalidates all of them. */
    providerList: () => ["model", "provider-list"] as const,

    /**
     * One provider's models. Per provider on purpose: editing one provider's
     * endpoint or declared ids must not re-discover everybody else's catalog.
     */
    providerModels: (providerId: string) =>
      ["model", "provider-list", providerId] as const,

    /** Enabled-provider configuration, the fan-out source for the lists above. */
    providerConfigs: () => ["model", "provider-configs"] as const,

    /** Ollama version string (shown next to model selector). */
    providerVersion: () => ["model", "provider-version"] as const,

    /** Site icons for providers with no curated vendor mark. */
    providerIcons: () => ["model", "provider-icons"] as const,

    /** Search results from the Ollama model library. */
    librarySearch: (query: string) =>
      ["model", "library-search", query] as const,

    /** Available variants (tags) for a specific library model. */
    libraryVariants: (modelName: string) =>
      ["model", "library-variants", modelName] as const
  }
} as const
