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

    /** Details for a specific model (shown in the model detail panel). */
    info: (modelId: string) => ["model", "info", modelId] as const,

    /** The full list of models from all enabled providers. */
    providerList: () => ["model", "provider-list"] as const,

    /** Ollama version string (shown next to model selector). */
    providerVersion: () => ["model", "provider-version"] as const,

    /** Search results from the Ollama model library. */
    librarySearch: (query: string) =>
      ["model", "library-search", query] as const,

    /** Available variants (tags) for a specific library model. */
    libraryVariants: (modelName: string) =>
      ["model", "library-variants", modelName] as const
  }
} as const
