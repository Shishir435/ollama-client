import {
  normalizeSettingsSearchText,
  scoreSettingsSearchToken
} from "@/features/settings/settings-search-scoring"

/**
 * Only register tab-group search when this browser exposes the API. Chromium and
 * Firefox can both support it; older browsers hide the target row.
 */
const extensionGlobals = globalThis as unknown as {
  navigator?: { userAgent?: string }
  browser?: Record<string, unknown>
  chrome?: Record<string, unknown>
}
const firefoxMajorVersion = Number(
  extensionGlobals.navigator?.userAgent?.match(/Firefox\/(\d+)/i)?.[1] ?? 0
)
const TAB_GROUPS_AVAILABLE =
  typeof extensionGlobals.browser?.tabGroups !== "undefined" ||
  typeof extensionGlobals.chrome?.tabGroups !== "undefined" ||
  firefoxMajorVersion >= 139

/**
 * Preview-feature toggles are a dev/QA control hidden in the production build
 * (see `permissions-panel.tsx`). Gate the matching search entry the same way so
 * a production search hit can't land on a card that never mounts.
 */
const PREVIEW_FEATURES_VISIBLE = process.env.NODE_ENV !== "production"

/**
 * Settings registry — the single source of truth for "what settings exist,
 * where they live, and what they're called."
 *
 * This manifest backs three features that would otherwise each re-derive the
 * same knowledge from JSX:
 *   - settings search (match label/description/keyword keys, never raw JSX text)
 *   - deep-link focus (`?tab=<tab>&focus=<id>` → scroll + highlight)
 *   - presets / per-card reset (group entries by `sectionId`)
 *
 * Each `id` is the kebab-case focus id; it MUST equal the `data-settings-focus-id`
 * the matching control renders. F3 extends focus-id coverage so every entry here
 * resolves to a mounted element (guarded by a test).
 */

/** Real options-page tab keys (see `settings-page.tsx` navSections). */
export const SETTINGS_TABS = [
  "general",
  "models",
  "providers",
  "context",
  "embeddings",
  "contentExtraction",
  "prompts",
  "shortcuts",
  "voices",
  "permissions",
  "reset",
  "guides"
] as const

export type SettingsTab = (typeof SETTINGS_TABS)[number]

export interface SettingsEntry {
  /** Kebab-case focus id; equals the control's `data-settings-focus-id`. */
  id: string
  /** Which options tab the control is rendered on. */
  tab: SettingsTab
  /** Logical group within a tab — used for presets, per-card reset, grouping. */
  sectionId: string
  /** i18n key for the control's label. */
  labelKey: string
  /** i18n key for the control's description, when it has one. */
  descriptionKey?: string
  /** Additional visible i18n strings that should route to this setting. */
  searchKeys?: string[]
  /** Focus target override for search records; defaults to `id`. */
  focusId?: string
  /** Extra search terms (plain words, not i18n keys) for fuzzy matching. */
  keywords?: string[]
  /** Non-i18n search aliases, typos, and technical synonyms. */
  aliases?: string[]
  /** Power-user tuning control — eligible for "Advanced" grouping (item 10). */
  advanced?: boolean
  /** Deletes/clears data — never auto-collapsed, flagged in danger zones. */
  destructive?: boolean
}

/**
 * The registry. Grouped by tab for readability; order here is not significant.
 *
 * The vector-DB / embedding-store entries (embedding limits + the destructive
 * database actions) live on the Embeddings tab as of Phase 5 #7. Old deep links
 * that still point at `?tab=context` for these ids are redirected to the
 * embeddings tab by `settings-page.tsx` (it resolves the focus id's tab through
 * this registry).
 */
export const SETTINGS_REGISTRY: SettingsEntry[] = [
  // ---- General -----------------------------------------------------------
  {
    id: "language-select",
    tab: "general",
    sectionId: "general",
    labelKey: "common.language.select_label",
    aliases: ["language", "locale", "translation"]
  },
  {
    id: "show-session-metrics",
    tab: "general",
    sectionId: "general",
    labelKey: "settings.chat_display.session_metrics_label",
    descriptionKey: "settings.chat_display.session_metrics_description",
    aliases: ["metrics", "tokens", "performance", "stats"]
  },
  {
    id: "settings-presets",
    tab: "general",
    sectionId: "presets",
    labelKey: "settings.presets.title",
    descriptionKey: "settings.presets.description",
    searchKeys: [
      "settings.presets.fast.label",
      "settings.presets.fast.description",
      "settings.presets.balanced.label",
      "settings.presets.balanced.description",
      "settings.presets.large_context.label",
      "settings.presets.large_context.description",
      "settings.presets.privacy_strict.label",
      "settings.presets.privacy_strict.description"
    ],
    aliases: ["preset", "presets", "profiles", "quick setup"]
  },

  // ---- Models: system ----------------------------------------------------
  {
    id: "system-prompt",
    tab: "models",
    sectionId: "model-system",
    labelKey: "settings.model.system.prompt_label",
    keywords: ["system", "persona", "instructions"]
  },
  {
    id: "stop-sequences",
    tab: "models",
    sectionId: "model-system",
    labelKey: "settings.model.system.stop_sequences_label",
    keywords: ["stop", "sequences"]
  },

  // ---- Models: sampling parameters (advanced) ----------------------------
  {
    id: "temperature",
    tab: "models",
    sectionId: "model-parameters",
    labelKey: "settings.model.parameters.temperature.label",
    advanced: true,
    keywords: ["temperature", "sampling", "randomness", "creativity"]
  },
  {
    id: "top-p",
    tab: "models",
    sectionId: "model-parameters",
    labelKey: "settings.model.parameters.top_p.label",
    advanced: true,
    keywords: ["top p", "nucleus", "sampling"]
  },
  {
    id: "top-k",
    tab: "models",
    sectionId: "model-parameters",
    labelKey: "settings.model.parameters.top_k.label",
    advanced: true,
    keywords: ["top k", "sampling"]
  },
  {
    id: "min-p",
    tab: "models",
    sectionId: "model-parameters",
    labelKey: "settings.model.parameters.min_p.label",
    advanced: true,
    keywords: ["min p", "sampling"]
  },
  {
    id: "seed",
    tab: "models",
    sectionId: "model-parameters",
    labelKey: "settings.model.parameters.seed.label",
    advanced: true,
    keywords: ["seed", "deterministic", "reproducible"]
  },
  {
    id: "num-ctx",
    tab: "models",
    sectionId: "model-parameters",
    labelKey: "settings.model.parameters.num_ctx.label",
    advanced: true,
    keywords: ["context length", "window", "num_ctx"]
  },
  {
    id: "num-predict",
    tab: "models",
    sectionId: "model-parameters",
    labelKey: "settings.model.parameters.num_predict.label",
    advanced: true,
    keywords: ["predictions", "max tokens", "num_predict"]
  },
  {
    id: "repeat-penalty",
    tab: "models",
    sectionId: "model-parameters",
    labelKey: "settings.model.parameters.repeat_penalty.label",
    advanced: true,
    keywords: ["repeat", "penalty", "repetition"]
  },
  {
    id: "repeat-last-n",
    tab: "models",
    sectionId: "model-parameters",
    labelKey: "settings.model.parameters.repeat_last_n.label",
    advanced: true,
    keywords: ["repeat", "last n", "repetition"]
  },

  // ---- Models: runtime ---------------------------------------------------
  {
    id: "keep-alive",
    tab: "models",
    sectionId: "model-runtime",
    labelKey: "settings.model.runtime.keep_alive_label",
    descriptionKey: "settings.model.runtime.keep_alive_description",
    keywords: ["keep alive", "memory", "unload"]
  },
  {
    id: "warm-on-select",
    tab: "models",
    sectionId: "model-runtime",
    labelKey: "settings.model.runtime.warm_on_select_label",
    descriptionKey: "settings.model.runtime.warm_on_select_description",
    keywords: ["warm", "preload"]
  },
  {
    id: "unload-on-switch",
    tab: "models",
    sectionId: "model-runtime",
    labelKey: "settings.model.runtime.unload_on_switch_label",
    descriptionKey: "settings.model.runtime.unload_on_switch_description",
    keywords: ["unload", "memory", "switch"]
  },

  // ---- Providers ---------------------------------------------------------
  {
    id: "provider-picker",
    tab: "providers",
    sectionId: "providers",
    labelKey: "settings.tabs.providers",
    searchKeys: [
      "settings.providers.default",
      "settings.providers.beta_badge",
      "settings.providers.enabled",
      "settings.providers.disabled",
      "settings.providers.inactive",
      "settings.providers.connected",
      "settings.providers.connection_failed",
      "settings.providers.not_tested"
    ],
    aliases: [
      "provider",
      "providers",
      "ollama",
      "lm studio",
      "llama.cpp",
      "vllm",
      "koboldcpp",
      "localai",
      "openai compatible",
      "localhost",
      "remote"
    ]
  },
  {
    id: "provider-enabled",
    tab: "providers",
    sectionId: "providers",
    labelKey: "settings.providers.enabled",
    searchKeys: ["settings.providers.disabled"],
    aliases: ["provider", "enable", "disable", "toggle"]
  },
  {
    id: "provider-test-connection",
    tab: "providers",
    sectionId: "providers",
    labelKey: "settings.providers.test",
    searchKeys: [
      "settings.providers.connected",
      "settings.providers.connection_failed",
      "settings.providers.not_tested"
    ],
    aliases: ["provider", "test", "connection", "health", "localhost"]
  },
  {
    id: "provider-base-url",
    tab: "providers",
    sectionId: "providers",
    labelKey: "settings.providers.base_url",
    descriptionKey: "settings.providers.base_url_default",
    searchKeys: ["settings.base_url.title", "settings.base_url.label"],
    aliases: ["provider", "base url", "endpoint", "localhost", "remote"]
  },
  {
    id: "provider-api-key",
    tab: "providers",
    sectionId: "providers",
    labelKey: "settings.providers.api_key",
    aliases: ["provider", "api key", "token", "secret", "remote"]
  },
  {
    id: "provider-custom-models",
    tab: "providers",
    sectionId: "providers",
    labelKey: "settings.providers.custom_models",
    descriptionKey: "settings.providers.custom_models_description",
    aliases: ["provider", "custom models", "manual models", "openai compatible"]
  },

  // ---- Context: Conversation Context -------------------------------------
  {
    id: "memory-enabled",
    tab: "context",
    sectionId: "conversation-context",
    labelKey: "settings.memory.enable.label",
    descriptionKey: "settings.memory.enable.description",
    keywords: ["memory", "remember", "recall"]
  },
  {
    id: "clear-memory",
    tab: "context",
    sectionId: "conversation-context",
    labelKey: "settings.memory.clear.label",
    descriptionKey: "settings.memory.clear.description",
    destructive: true,
    keywords: ["clear", "forget", "memory"]
  },
  {
    id: "backfill-embeddings",
    tab: "context",
    sectionId: "conversation-context",
    labelKey: "chat.backfill.title",
    descriptionKey: "chat.backfill.description",
    keywords: ["backfill", "history", "embed", "index"]
  },

  // ---- Context: Prompt Budget --------------------------------------------
  {
    id: "max-tab-context-chars",
    tab: "context",
    sectionId: "prompt-budget",
    labelKey: "settings.prompt_context_limits.max_tab_context_chars",
    keywords: ["tab context", "characters", "limit", "budget"]
  },
  {
    id: "max-rag-context-chars",
    tab: "context",
    sectionId: "prompt-budget",
    labelKey: "settings.prompt_context_limits.max_rag_context_chars",
    keywords: ["rag context", "characters", "limit", "budget"]
  },
  {
    id: "max-tool-result-chars",
    tab: "context",
    sectionId: "prompt-budget",
    labelKey: "settings.prompt_context_limits.max_tool_result_chars",
    descriptionKey: "settings.prompt_context_limits.max_tool_result_chars_hint",
    keywords: ["tool result", "characters", "limit", "budget"]
  },
  {
    id: "auto-refresh-tab-context",
    tab: "context",
    sectionId: "prompt-budget",
    labelKey: "settings.prompt_context_limits.auto_refresh_label",
    descriptionKey: "settings.prompt_context_limits.auto_refresh_description",
    keywords: ["auto refresh", "tab context"]
  },

  // ---- Context: Grounding ------------------------------------------------
  {
    id: "grounded-only-mode",
    tab: "context",
    sectionId: "grounding",
    labelKey: "settings.grounding_mode.label",
    descriptionKey: "settings.grounding_mode.description",
    keywords: ["grounding", "grounded", "page only", "answer from page"]
  },

  // ---- Context: Web Search -----------------------------------------------
  {
    id: "web-search-enabled",
    tab: "context",
    sectionId: "web-search",
    labelKey: "settings.web_search.enable.label",
    descriptionKey: "settings.web_search.enable.description",
    keywords: ["web search", "internet", "online", "search"]
  },
  {
    id: "web-search-provider",
    tab: "context",
    sectionId: "web-search",
    labelKey: "settings.web_search.provider.label",
    descriptionKey: "settings.web_search.provider.description",
    keywords: ["web search", "provider", "searxng", "brave", "tavily"]
  },
  {
    id: "web-search-safe-search",
    tab: "context",
    sectionId: "web-search",
    labelKey: "settings.web_search.safe_search.label",
    descriptionKey: "settings.web_search.safe_search.description",
    keywords: ["safe search", "filter"]
  },
  {
    id: "web-search-endpoint",
    tab: "context",
    sectionId: "web-search",
    labelKey: "settings.web_search.endpoint.label",
    descriptionKey: "settings.web_search.endpoint.description",
    keywords: ["endpoint", "url", "searxng"]
  },
  {
    id: "web-search-api-key",
    tab: "context",
    sectionId: "web-search",
    labelKey: "settings.web_search.api_key.label",
    descriptionKey: "settings.web_search.api_key.description",
    keywords: ["api key", "token", "brave", "tavily"]
  },
  {
    id: "web-search-result-count",
    tab: "context",
    sectionId: "web-search",
    labelKey: "settings.web_search.result_count.label",
    descriptionKey: "settings.web_search.result_count.description",
    keywords: ["result count", "results"]
  },

  // ---- Context: Retrieval ------------------------------------------------
  {
    id: "rag-enabled",
    tab: "context",
    sectionId: "retrieval",
    labelKey: "model.embedding_config.rag_enable_label",
    descriptionKey: "model.embedding_config.rag_enable_description",
    keywords: ["rag", "retrieval", "knowledge"]
  },
  {
    id: "use-reranking",
    tab: "context",
    sectionId: "retrieval",
    labelKey: "model.embedding_config.reranking_label",
    descriptionKey: "model.embedding_config.reranking_description",
    advanced: true,
    keywords: ["rerank", "reranking", "retrieval"]
  },
  {
    id: "search-limit-topk",
    tab: "context",
    sectionId: "retrieval",
    labelKey: "model.embedding_config.search_limit_label",
    descriptionKey: "model.embedding_config.search_limit_description",
    advanced: true,
    keywords: ["search limit", "top k", "retrieval"]
  },
  {
    id: "min-rerank-score",
    tab: "context",
    sectionId: "retrieval",
    labelKey: "knowledge_sets.min_rerank_label",
    descriptionKey: "knowledge_sets.min_rerank_description",
    advanced: true,
    keywords: ["min rerank", "score", "threshold", "retrieval"]
  },
  {
    id: "active-knowledge-set",
    tab: "context",
    sectionId: "retrieval",
    labelKey: "knowledge_sets.active_label",
    descriptionKey: "knowledge_sets.active_description",
    keywords: ["knowledge set", "active", "collection"]
  },

  // ---- Context: Files ----------------------------------------------------
  {
    id: "max-file-size-mb",
    tab: "context",
    sectionId: "files",
    labelKey: "file_upload.settings.max_file_size_label",
    descriptionKey: "file_upload.settings.max_file_size_description",
    keywords: ["file size", "upload", "limit"]
  },
  {
    id: "max-image-size-mb",
    tab: "context",
    sectionId: "files",
    labelKey: "file_upload.settings.max_image_size_label",
    descriptionKey: "file_upload.settings.max_image_size_description",
    keywords: ["image size", "vision", "upload", "limit"]
  },

  // ---- Context: Chunking (advanced) --------------------------------------
  {
    id: "enhanced-chunking",
    tab: "context",
    sectionId: "chunking",
    labelKey: "model.embedding_config.enhanced_chunking_label",
    descriptionKey: "model.embedding_config.enhanced_chunking_description",
    advanced: true,
    keywords: ["chunking", "enhanced", "splitting"]
  },
  {
    id: "chunk-size",
    tab: "context",
    sectionId: "chunking",
    labelKey: "model.embedding_config.chunk_size_label",
    descriptionKey: "model.embedding_config.chunk_size_description",
    advanced: true,
    keywords: ["chunk size", "splitting"]
  },
  {
    id: "chunk-overlap",
    tab: "context",
    sectionId: "chunking",
    labelKey: "model.embedding_config.chunk_overlap_label",
    descriptionKey: "model.embedding_config.chunk_overlap_description",
    advanced: true,
    keywords: ["chunk overlap", "splitting"]
  },
  {
    id: "chunking-strategy",
    tab: "context",
    sectionId: "chunking",
    labelKey: "model.embedding_config.chunking_strategy_label",
    advanced: true,
    keywords: ["chunking strategy", "splitting"]
  },

  // ---- Embeddings: vector-DB (relocated from Context, Phase 5 #7) --------
  {
    id: "max-embeddings-per-file",
    tab: "embeddings",
    sectionId: "embedding-limits",
    labelKey: "model.embedding_config.max_embeddings_label",
    descriptionKey: "model.embedding_config.max_embeddings_description",
    advanced: true,
    keywords: ["embeddings", "limit", "per file"]
  },
  {
    id: "max-storage-size",
    tab: "embeddings",
    sectionId: "embedding-limits",
    labelKey: "model.embedding_config.max_storage_label",
    descriptionKey: "model.embedding_config.max_storage_description",
    advanced: true,
    keywords: ["storage", "limit", "size"]
  },
  {
    id: "auto-cleanup",
    tab: "embeddings",
    sectionId: "embedding-limits",
    labelKey: "model.embedding_config.auto_cleanup_label",
    descriptionKey: "model.embedding_config.auto_cleanup_description",
    advanced: true,
    keywords: ["cleanup", "auto", "prune"]
  },
  {
    id: "cleanup-days-old",
    tab: "embeddings",
    sectionId: "embedding-limits",
    labelKey: "model.embedding_config.cleanup_age_label",
    descriptionKey: "model.embedding_config.cleanup_age_description",
    advanced: true,
    keywords: ["cleanup", "age", "days", "prune"]
  },
  {
    id: "remove-duplicate-vectors",
    tab: "embeddings",
    sectionId: "vector-db",
    labelKey: "model.embedding_config.remove_duplicates_button",
    descriptionKey: "model.embedding_config.remove_duplicates_description",
    destructive: true,
    keywords: ["duplicates", "dedup", "vectors", "clean"]
  },
  {
    id: "clear-chat-vectors",
    tab: "embeddings",
    sectionId: "vector-db",
    labelKey: "model.embedding_config.clear_chat_button",
    descriptionKey: "model.embedding_config.clear_chat_description",
    destructive: true,
    keywords: ["clear", "chat", "vectors", "delete"]
  },
  {
    id: "clear-all-vectors",
    tab: "embeddings",
    sectionId: "vector-db",
    labelKey: "model.embedding_config.clear_all_button",
    descriptionKey: "model.embedding_config.clear_all_description",
    destructive: true,
    keywords: ["clear", "all", "vectors", "delete", "wipe"]
  },
  {
    id: "rebuild-embeddings",
    focusId: "embeddings-model-select",
    tab: "embeddings",
    sectionId: "vector-db",
    labelKey: "settings.context.embedding_health.action",
    keywords: ["rebuild", "reindex", "embeddings", "health"]
  },
  {
    id: "rebuild-keyword-index",
    tab: "embeddings",
    sectionId: "vector-db",
    labelKey: "settings.embeddings.rebuild_index.button",
    descriptionKey: "settings.embeddings.rebuild_index.description",
    advanced: true,
    keywords: ["rebuild", "keyword", "index"]
  },
  {
    id: "embeddings-storage-stats",
    tab: "embeddings",
    sectionId: "vector-db",
    labelKey: "model.embedding_config.storage_stats_title",
    searchKeys: [
      "model.embedding_config.total_vectors",
      "model.embedding_config.storage_used",
      "model.embedding_config.cache"
    ],
    keywords: ["storage statistics", "vectors", "cache", "usage"]
  },

  // ---- Embeddings: model selection ---------------------------------------
  {
    id: "embeddings-model-select",
    tab: "embeddings",
    sectionId: "embeddings-model",
    labelKey: "settings.embeddings.model_select.label",
    descriptionKey: "settings.embeddings.model_select.description",
    keywords: ["embedding model", "model", "select"]
  },
  {
    id: "embeddings-show-advanced-models",
    tab: "embeddings",
    sectionId: "embeddings-model",
    labelKey: "settings.embeddings.model_select.show_advanced_label",
    descriptionKey:
      "settings.embeddings.model_select.show_advanced_description",
    advanced: true,
    keywords: ["advanced", "models", "show"]
  },

  // ---- Embeddings: generation --------------------------------------------
  {
    id: "embeddings-batch-size",
    tab: "embeddings",
    sectionId: "embeddings-generation",
    labelKey: "model.embedding_config.batch_size_label",
    descriptionKey: "model.embedding_config.batch_size_description",
    keywords: ["batch size", "generation"]
  },
  {
    id: "embeddings-enable-caching",
    tab: "embeddings",
    sectionId: "embeddings-generation",
    labelKey: "model.embedding_config.enable_caching_label",
    descriptionKey: "model.embedding_config.enable_caching_description",
    keywords: ["cache", "caching"]
  },

  // ---- Embeddings: feedback ----------------------------------------------
  {
    id: "embeddings-feedback-enabled",
    tab: "embeddings",
    sectionId: "embeddings-feedback",
    labelKey: "model.embedding_config.feedback_enable_label",
    descriptionKey: "model.embedding_config.feedback_enable_description",
    keywords: ["feedback", "learning"]
  },
  {
    id: "embeddings-show-retrieved-chunks",
    tab: "embeddings",
    sectionId: "embeddings-feedback",
    labelKey: "model.embedding_config.feedback_show_chunks_label",
    descriptionKey: "model.embedding_config.feedback_show_chunks_description",
    keywords: ["chunks", "retrieved", "feedback"]
  },
  {
    id: "embeddings-feedback-clear",
    tab: "embeddings",
    sectionId: "embeddings-feedback",
    labelKey: "model.embedding_config.feedback_clear_button",
    destructive: true,
    keywords: ["clear", "feedback", "delete"]
  },

  // ---- Embeddings: test / migration --------------------------------------
  {
    id: "embeddings-test-generation",
    tab: "embeddings",
    sectionId: "embeddings-test",
    labelKey: "settings.embeddings.test_generation.button",
    descriptionKey: "settings.embeddings.test_generation.description",
    keywords: ["test", "generation", "diagnostic"]
  },
  {
    id: "embeddings-test-search",
    tab: "embeddings",
    sectionId: "embeddings-test",
    labelKey: "settings.embeddings.test_search.title",
    descriptionKey: "settings.embeddings.test_search.description",
    searchKeys: ["settings.embeddings.test_search.placeholder"],
    aliases: ["semantic search", "test search", "search files"],
    keywords: ["search", "semantic", "uploaded files", "query"]
  },
  {
    id: "embeddings-search-limit-topk",
    tab: "embeddings",
    sectionId: "embeddings-search",
    labelKey: "model.embedding_config.search_limit_label",
    descriptionKey: "model.embedding_config.search_limit_description",
    advanced: true,
    keywords: ["search limit", "top k", "semantic search", "retrieval"]
  },
  {
    id: "embeddings-min-similarity",
    tab: "embeddings",
    sectionId: "embeddings-search",
    labelKey: "model.embedding_config.min_similarity_label",
    descriptionKey: "model.embedding_config.min_similarity_description",
    advanced: true,
    keywords: ["similarity", "threshold", "semantic search", "cosine"]
  },
  {
    id: "embeddings-cache-ttl",
    tab: "embeddings",
    sectionId: "embeddings-search",
    labelKey: "model.embedding_config.cache_ttl_label",
    descriptionKey: "model.embedding_config.cache_ttl_description",
    advanced: true,
    keywords: ["cache", "ttl", "minutes", "search cache"]
  },
  {
    id: "embeddings-cache-max-size",
    tab: "embeddings",
    sectionId: "embeddings-search",
    labelKey: "model.embedding_config.cache_max_size_label",
    descriptionKey: "model.embedding_config.cache_max_size_description",
    advanced: true,
    keywords: ["cache", "cached queries", "search cache"]
  },
  {
    id: "embeddings-ann-backend",
    tab: "embeddings",
    sectionId: "embeddings-search",
    labelKey: "model.embedding_config.ann_backend_label",
    descriptionKey: "model.embedding_config.ann_backend_description",
    searchKeys: [
      "model.embedding_config.ann_backend_placeholder",
      "model.embedding_config.ann_backend_group",
      "model.embedding_config.ann_backend_ts",
      "model.embedding_config.ann_backend_bruteforce"
    ],
    advanced: true,
    keywords: ["ann", "hnsw", "brute force", "vector search"]
  },
  {
    id: "embeddings-ann-min-vectors",
    tab: "embeddings",
    sectionId: "embeddings-search",
    labelKey: "model.embedding_config.ann_min_vectors_label",
    descriptionKey: "model.embedding_config.ann_min_vectors_description",
    advanced: true,
    keywords: ["ann", "min vectors", "threshold", "vector search"]
  },
  {
    id: "data-migration-export",
    tab: "embeddings",
    sectionId: "embeddings-migration",
    labelKey: "settings.migration.export.button",
    descriptionKey: "settings.migration.export.description",
    keywords: ["export", "backup", "migration"]
  },
  {
    id: "data-migration-import",
    tab: "embeddings",
    sectionId: "embeddings-migration",
    labelKey: "settings.migration.import.button",
    descriptionKey: "settings.migration.import.description",
    keywords: ["import", "restore", "migration"]
  },

  // ---- Content Extraction ------------------------------------------------
  {
    id: "content-extraction-enabled",
    tab: "contentExtraction",
    sectionId: "content-extraction",
    labelKey: "settings.content_extraction.enable.label",
    descriptionKey: "settings.content_extraction.enable.description",
    keywords: ["content extraction", "scrape", "page"]
  },
  {
    id: "content-scraper",
    tab: "contentExtraction",
    sectionId: "content-extraction",
    labelKey: "settings.content_extraction.scraper.label",
    keywords: ["scraper", "extraction", "engine"]
  },
  {
    id: "scroll-strategy",
    tab: "contentExtraction",
    sectionId: "content-extraction",
    labelKey: "settings.content_extraction.scroll_strategy.label",
    keywords: ["scroll", "strategy"]
  },
  {
    id: "scroll-depth",
    tab: "contentExtraction",
    sectionId: "content-extraction",
    labelKey: "settings.content_extraction.scroll_depth.label",
    descriptionKey: "settings.content_extraction.scroll_depth.description",
    keywords: ["scroll", "depth"]
  },
  {
    id: "site-overrides",
    tab: "contentExtraction",
    sectionId: "site-overrides",
    labelKey: "model.site_overrides.title",
    descriptionKey: "model.site_overrides.description",
    searchKeys: [
      "model.site_overrides.scroll_strategy_label",
      "model.site_overrides.scroll_depth_label",
      "settings.permissions.siteProfiles.fields.tabContext",
      "settings.permissions.siteProfiles.fields.groundedOnly"
    ],
    aliases: [
      "site overrides",
      "per-site",
      "auto context",
      "never read",
      "grounded only",
      "domain rules"
    ]
  },
  // selection-actions labels are localized in Phase 6 #13; ids/keys reserved
  // here so search + focus light up the moment those keys land.
  {
    id: "selection-actions-enabled",
    tab: "contentExtraction",
    sectionId: "selection-actions",
    labelKey: "settings.content_extraction.selection_actions.label",
    descriptionKey: "settings.content_extraction.selection_actions.description",
    keywords: ["selection", "actions", "highlight", "toolbar"]
  },
  {
    id: "selection-actions-min-chars",
    tab: "contentExtraction",
    sectionId: "selection-actions",
    labelKey: "settings.content_extraction.selection_actions_min_chars.label",
    descriptionKey:
      "settings.content_extraction.selection_actions_min_chars.description",
    keywords: ["selection", "minimum", "characters"]
  },
  {
    id: "scroll-delay",
    tab: "contentExtraction",
    sectionId: "content-extraction-timeouts",
    labelKey: "settings.content_extraction.timeout.scroll_delay",
    advanced: true,
    keywords: ["scroll delay", "timeout", "milliseconds"]
  },
  {
    id: "mutation-timeout",
    tab: "contentExtraction",
    sectionId: "content-extraction-timeouts",
    labelKey: "settings.content_extraction.timeout.mutation_timeout",
    advanced: true,
    keywords: ["mutation", "timeout", "milliseconds"]
  },
  {
    id: "network-timeout",
    tab: "contentExtraction",
    sectionId: "content-extraction-timeouts",
    labelKey: "settings.content_extraction.timeout.network_timeout",
    advanced: true,
    keywords: ["network", "idle", "timeout", "milliseconds"]
  },
  {
    id: "max-wait",
    tab: "contentExtraction",
    sectionId: "content-extraction-timeouts",
    labelKey: "settings.content_extraction.timeout.max_wait",
    advanced: true,
    keywords: ["max wait", "timeout", "milliseconds"]
  },

  // ---- Voices ------------------------------------------------------------
  {
    id: "voice-selection",
    tab: "voices",
    sectionId: "voices",
    labelKey: "settings.speech.voice_label",
    keywords: ["voice", "tts", "speech"]
  },
  {
    id: "speech-rate",
    tab: "voices",
    sectionId: "voices",
    labelKey: "settings.speech.rate_label",
    keywords: ["rate", "speed", "tts", "speech"]
  },
  {
    id: "speech-pitch",
    tab: "voices",
    sectionId: "voices",
    labelKey: "settings.speech.pitch_label",
    keywords: ["pitch", "tone", "tts", "speech"]
  },

  // ---- Prompts -----------------------------------------------------------
  {
    id: "prompt-templates",
    tab: "prompts",
    sectionId: "prompts",
    labelKey: "settings.prompts.title",
    searchKeys: [
      "settings.prompts.new_template",
      "settings.prompts.search_placeholder",
      "settings.prompts.category_placeholder",
      "settings.prompts.all_categories",
      "settings.prompts.sort.recent",
      "settings.prompts.sort.popular",
      "settings.prompts.sort.alphabetical",
      "settings.prompts.empty_state.title",
      "settings.prompts.empty_state.description",
      "settings.prompts.export",
      "settings.prompts.import",
      "settings.prompts.reset",
      "settings.prompts.form.title",
      "settings.prompts.form.category",
      "settings.prompts.form.description",
      "settings.prompts.form.tags",
      "settings.prompts.form.system_prompt",
      "settings.prompts.form.user_prompt",
      "settings.prompts.form.create_button",
      "settings.prompts.variables.title",
      "settings.prompts.variables.description"
    ],
    aliases: ["prompt templates", "templates", "system prompt template"]
  },

  // ---- Shortcuts ---------------------------------------------------------
  {
    id: "browser-shortcuts",
    tab: "shortcuts",
    sectionId: "shortcuts",
    labelKey: "settings.shortcuts.browser.title",
    descriptionKey: "settings.shortcuts.browser.description",
    aliases: [
      "global shortcut",
      "open panel hotkey",
      "browser shortcut",
      "side panel"
    ]
  },
  {
    id: "keyboard-shortcuts",
    tab: "shortcuts",
    sectionId: "shortcuts",
    labelKey: "settings.shortcuts.title",
    descriptionKey: "settings.shortcuts.description",
    searchKeys: [
      "settings.shortcuts.recording",
      "settings.shortcuts.reset_all",
      "settings.shortcuts.new_chat",
      "settings.shortcuts.new_chat_desc",
      "settings.shortcuts.focus_input",
      "settings.shortcuts.focus_input_desc",
      "settings.shortcuts.toggle_sidebar",
      "settings.shortcuts.toggle_sidebar_desc",
      "settings.shortcuts.stop_generation",
      "settings.shortcuts.stop_generation_desc",
      "settings.shortcuts.open_settings",
      "settings.shortcuts.open_settings_desc",
      "settings.shortcuts.toggle_theme",
      "settings.shortcuts.toggle_theme_desc",
      "settings.shortcuts.toggle_rag",
      "settings.shortcuts.toggle_rag_desc",
      "settings.shortcuts.toggle_speech",
      "settings.shortcuts.toggle_speech_desc",
      "settings.shortcuts.toggle_tabs",
      "settings.shortcuts.toggle_tabs_desc",
      "settings.shortcuts.search_messages",
      "settings.shortcuts.search_messages_desc",
      "settings.shortcuts.clear_chat",
      "settings.shortcuts.clear_chat_desc",
      "settings.shortcuts.copy_last_response",
      "settings.shortcuts.copy_last_response_desc",
      "settings.shortcuts.toggle_session_metrics",
      "settings.shortcuts.toggle_session_metrics_desc",
      "settings.shortcuts.export_json",
      "settings.shortcuts.export_json_desc",
      "settings.shortcuts.export_markdown",
      "settings.shortcuts.export_markdown_desc",
      "settings.shortcuts.export_pdf",
      "settings.shortcuts.export_pdf_desc",
      "settings.shortcuts.export_text",
      "settings.shortcuts.export_text_desc"
    ],
    aliases: ["shortcuts", "keyboard", "hotkeys", "keybindings"]
  },
  {
    id: "shortcut-focus-input",
    tab: "shortcuts",
    sectionId: "shortcuts",
    labelKey: "settings.shortcuts.focus_input",
    descriptionKey: "settings.shortcuts.focus_input_desc",
    aliases: ["input shortcut", "focus chat input"]
  },
  {
    id: "shortcut-close-sidebar",
    tab: "shortcuts",
    sectionId: "shortcuts",
    labelKey: "settings.shortcuts.toggle_sidebar",
    descriptionKey: "settings.shortcuts.toggle_sidebar_desc",
    aliases: ["sidebar shortcut", "close sidebar"]
  },
  {
    id: "shortcut-settings",
    tab: "shortcuts",
    sectionId: "shortcuts",
    labelKey: "settings.shortcuts.open_settings",
    descriptionKey: "settings.shortcuts.open_settings_desc",
    aliases: ["settings shortcut", "open settings"]
  },
  {
    id: "shortcut-search-messages",
    tab: "shortcuts",
    sectionId: "shortcuts",
    labelKey: "settings.shortcuts.search_messages",
    descriptionKey: "settings.shortcuts.search_messages_desc",
    aliases: ["message search shortcut", "semantic chat search"]
  },
  {
    id: "shortcut-new-chat",
    tab: "shortcuts",
    sectionId: "shortcuts",
    labelKey: "settings.shortcuts.new_chat",
    descriptionKey: "settings.shortcuts.new_chat_desc",
    aliases: ["new chat shortcut"]
  },
  {
    id: "shortcut-stop-generation",
    tab: "shortcuts",
    sectionId: "shortcuts",
    labelKey: "settings.shortcuts.stop_generation",
    descriptionKey: "settings.shortcuts.stop_generation_desc",
    aliases: ["stop response shortcut"]
  },
  {
    id: "shortcut-clear-chat",
    tab: "shortcuts",
    sectionId: "shortcuts",
    labelKey: "settings.shortcuts.clear_chat",
    descriptionKey: "settings.shortcuts.clear_chat_desc",
    aliases: ["clear chat shortcut"]
  },
  {
    id: "shortcut-copy-last-response",
    tab: "shortcuts",
    sectionId: "shortcuts",
    labelKey: "settings.shortcuts.copy_last_response",
    descriptionKey: "settings.shortcuts.copy_last_response_desc",
    aliases: ["copy response shortcut"]
  },
  {
    id: "shortcut-export-json",
    tab: "shortcuts",
    sectionId: "shortcuts",
    labelKey: "settings.shortcuts.export_json",
    descriptionKey: "settings.shortcuts.export_json_desc",
    aliases: ["json export shortcut"]
  },
  {
    id: "shortcut-export-markdown",
    tab: "shortcuts",
    sectionId: "shortcuts",
    labelKey: "settings.shortcuts.export_markdown",
    descriptionKey: "settings.shortcuts.export_markdown_desc",
    aliases: ["markdown export shortcut"]
  },
  {
    id: "shortcut-export-pdf",
    tab: "shortcuts",
    sectionId: "shortcuts",
    labelKey: "settings.shortcuts.export_pdf",
    descriptionKey: "settings.shortcuts.export_pdf_desc",
    aliases: ["pdf export shortcut"]
  },
  {
    id: "shortcut-export-text",
    tab: "shortcuts",
    sectionId: "shortcuts",
    labelKey: "settings.shortcuts.export_text",
    descriptionKey: "settings.shortcuts.export_text_desc",
    aliases: ["text export shortcut"]
  },
  {
    id: "shortcut-toggle-theme",
    tab: "shortcuts",
    sectionId: "shortcuts",
    labelKey: "settings.shortcuts.toggle_theme",
    descriptionKey: "settings.shortcuts.toggle_theme_desc",
    aliases: ["theme shortcut"]
  },
  {
    id: "shortcut-toggle-rag",
    tab: "shortcuts",
    sectionId: "shortcuts",
    labelKey: "settings.shortcuts.toggle_rag",
    descriptionKey: "settings.shortcuts.toggle_rag_desc",
    aliases: ["rag shortcut", "context retrieval shortcut"]
  },
  {
    id: "shortcut-toggle-speech",
    tab: "shortcuts",
    sectionId: "shortcuts",
    labelKey: "settings.shortcuts.toggle_speech",
    descriptionKey: "settings.shortcuts.toggle_speech_desc",
    aliases: ["speech shortcut", "tts shortcut"]
  },
  {
    id: "shortcut-toggle-tabs",
    tab: "shortcuts",
    sectionId: "shortcuts",
    labelKey: "settings.shortcuts.toggle_tabs",
    descriptionKey: "settings.shortcuts.toggle_tabs_desc",
    aliases: ["tabs shortcut", "tab access shortcut"]
  },
  {
    id: "shortcut-toggle-session-metrics",
    tab: "shortcuts",
    sectionId: "shortcuts",
    labelKey: "settings.shortcuts.toggle_session_metrics",
    descriptionKey: "settings.shortcuts.toggle_session_metrics_desc",
    aliases: ["metrics shortcut", "session metrics shortcut"]
  },

  // ---- Reset -------------------------------------------------------------
  {
    id: "reset-settings",
    tab: "reset",
    sectionId: "reset-modules",
    labelKey: "settings.reset.title",
    descriptionKey: "settings.reset.description",
    aliases: ["reset settings", "clear data"]
  },
  {
    id: "reset-provider",
    tab: "reset",
    sectionId: "reset-modules",
    labelKey: "settings.reset.modules.provider.title",
    descriptionKey: "settings.reset.modules.provider.description",
    aliases: ["provider settings", "models", "configuration"]
  },
  {
    id: "reset-theme",
    tab: "reset",
    sectionId: "reset-modules",
    labelKey: "settings.reset.modules.theme.title",
    descriptionKey: "settings.reset.modules.theme.description",
    aliases: ["theme", "ui", "appearance"]
  },
  {
    id: "reset-browser",
    tab: "reset",
    sectionId: "reset-modules",
    labelKey: "settings.reset.modules.browser.title",
    descriptionKey: "settings.reset.modules.browser.description",
    aliases: ["browser settings", "tab access", "url patterns"]
  },
  {
    id: "reset-tts",
    tab: "reset",
    sectionId: "reset-modules",
    labelKey: "settings.reset.modules.tts.title",
    descriptionKey: "settings.reset.modules.tts.description",
    aliases: ["text to speech", "tts", "speech"]
  },
  {
    id: "reset-chat-sessions",
    tab: "reset",
    sectionId: "reset-modules",
    labelKey: "settings.reset.modules.chat_sessions.title",
    descriptionKey: "settings.reset.modules.chat_sessions.description",
    aliases: ["chat history", "conversation history"]
  },
  {
    id: "reset-feedback",
    tab: "reset",
    sectionId: "reset-modules",
    labelKey: "settings.reset.modules.feedback.title",
    descriptionKey: "settings.reset.modules.feedback.description",
    aliases: ["user feedback", "learning feedback"]
  },
  {
    id: "reset-danger-zone",
    tab: "reset",
    sectionId: "reset-modules",
    labelKey: "settings.reset.danger_zone.title",
    descriptionKey: "settings.reset.danger_zone.description",
    searchKeys: ["settings.reset.danger_zone.button"],
    aliases: ["reset all", "clear all", "danger zone", "factory reset"],
    destructive: true
  },

  // ---- Guides ------------------------------------------------------------
  {
    id: "guides-overview",
    focusId: "guides-card",
    tab: "guides",
    sectionId: "guides",
    labelKey: "guides.title",
    descriptionKey: "guides.description",
    aliases: ["documentation", "docs", "help"]
  },
  {
    id: "guide-setup",
    tab: "guides",
    sectionId: "guides",
    labelKey: "guides.items.setup.label",
    descriptionKey: "guides.items.setup.description",
    searchKeys: ["guides.items.setup.badge"],
    aliases: ["setup guide", "install guide"]
  },
  {
    id: "guide-library",
    tab: "guides",
    sectionId: "guides",
    labelKey: "guides.items.library.label",
    descriptionKey: "guides.items.library.description",
    searchKeys: ["guides.items.library.badge"],
    aliases: ["model library", "ollama library"]
  },
  {
    id: "guide-github",
    tab: "guides",
    sectionId: "guides",
    labelKey: "guides.items.github.label",
    descriptionKey: "guides.items.github.description",
    searchKeys: ["guides.items.github.badge"],
    aliases: ["github", "repo", "source code", "releases"]
  },
  {
    id: "guide-faq",
    tab: "guides",
    sectionId: "guides",
    labelKey: "guides.items.faq.label",
    descriptionKey: "guides.items.faq.description",
    searchKeys: ["guides.items.faq.badge"],
    aliases: ["faq", "troubleshooting", "support"]
  },
  {
    id: "guide-support",
    tab: "guides",
    sectionId: "guides",
    labelKey: "guides.support.title",
    descriptionKey: "guides.support.description",
    aliases: ["product hunt", "support project"]
  },

  // ---- Permissions & Privacy ---------------------------------------------
  {
    id: "permissions",
    tab: "permissions",
    sectionId: "permissions",
    labelKey: "settings.permissions.title",
    descriptionKey: "settings.permissions.description",
    aliases: ["permissions", "privacy", "access", "consent", "data"]
  },
  {
    id: "model-tools",
    tab: "permissions",
    sectionId: "permissions",
    labelKey: "settings.permissions.tools.title",
    descriptionKey: "settings.permissions.tools.description",
    searchKeys: [
      "settings.permissions.tools.master.label",
      "settings.permissions.tools.families.browser.label",
      "settings.permissions.tools.families.knowledge.label",
      "settings.permissions.tools.families.history.label",
      "settings.permissions.tools.families.web.label",
      "settings.permissions.tools.families.automation.label"
    ],
    aliases: [
      "model tools",
      "ai tools",
      "tool calling",
      "function calling",
      "agent",
      "browser tools"
    ]
  },
  {
    // Routes per-model search hits to the model picker in the Model tools card.
    // focusId must equal the Select's data-settings-focus-id.
    id: "model-tools-per-model",
    tab: "permissions",
    sectionId: "permissions",
    labelKey: "settings.permissions.tools.perModel.title",
    descriptionKey: "settings.permissions.tools.perModel.description",
    aliases: ["per model tools", "per-model", "model specific tools"]
  },
  {
    id: "permission-bookmarks",
    tab: "permissions",
    sectionId: "permissions",
    labelKey: "settings.permissions.items.bookmarks.label",
    descriptionKey: "settings.permissions.items.bookmarks.description",
    aliases: ["bookmarks", "saved pages", "permission"]
  },
  {
    id: "permission-history",
    tab: "permissions",
    sectionId: "permissions",
    labelKey: "settings.permissions.items.history.label",
    descriptionKey: "settings.permissions.items.history.description",
    aliases: ["history", "browsing history", "permission"]
  },
  {
    id: "permission-notifications",
    tab: "permissions",
    sectionId: "permissions",
    labelKey: "settings.permissions.items.notifications.label",
    descriptionKey: "settings.permissions.items.notifications.description",
    aliases: ["notifications", "alerts", "permission"]
  },
  {
    id: "permission-downloads",
    tab: "permissions",
    sectionId: "permissions",
    labelKey: "settings.permissions.items.downloads.label",
    descriptionKey: "settings.permissions.items.downloads.description",
    aliases: ["downloads", "save file", "export", "permission"]
  },
  // Only register tab groups for search where its focus target actually exists.
  ...(TAB_GROUPS_AVAILABLE
    ? [
        {
          id: "permission-tab-groups",
          tab: "permissions" as const,
          sectionId: "permissions",
          labelKey: "settings.permissions.items.tabGroups.label",
          descriptionKey: "settings.permissions.items.tabGroups.description",
          aliases: ["tab groups", "permission"]
        }
      ]
    : []),
  {
    id: "permission-alarms",
    tab: "permissions",
    sectionId: "permissions",
    labelKey: "settings.permissions.items.alarms.label",
    descriptionKey: "settings.permissions.items.alarms.description",
    aliases: [
      "alarms",
      "reminders",
      "scheduled jobs",
      "maintenance",
      "permission"
    ]
  },
  {
    id: "permissions-host",
    tab: "permissions",
    sectionId: "permissions",
    labelKey: "settings.permissions.host.title",
    descriptionKey: "settings.permissions.host.description",
    aliases: ["host access", "all urls", "site access", "remote url"]
  },
  {
    id: "scheduled-job-vector-maintenance",
    tab: "permissions",
    sectionId: "permissions",
    labelKey: "settings.permissions.scheduled.items.vectorMaintenance.label",
    descriptionKey:
      "settings.permissions.scheduled.items.vectorMaintenance.description",
    aliases: ["scheduled jobs", "maintenance", "alarms", "cleanup"]
  },
  // Preview-features card is dev-only (hidden in the production build), so only
  // register its search entry where the focus target actually mounts.
  ...(PREVIEW_FEATURES_VISIBLE
    ? [
        {
          id: "permissions-preview",
          tab: "permissions" as const,
          sectionId: "permissions",
          labelKey: "settings.permissions.preview.title",
          descriptionKey: "settings.permissions.preview.description",
          aliases: ["preview", "experimental", "beta", "feature flags"]
        }
      ]
    : [])
]

const TAB_SET = new Set<string>(SETTINGS_TABS)

/** Type guard: is `tab` a real options-page tab key. */
export const isSettingsTab = (tab: string): tab is SettingsTab =>
  TAB_SET.has(tab)

/** All entries rendered on a given tab. */
export const getSettingsForTab = (tab: SettingsTab): SettingsEntry[] =>
  SETTINGS_REGISTRY.filter((entry) => entry.tab === tab)

/** All entries belonging to a logical section. */
export const getSectionEntries = (sectionId: string): SettingsEntry[] =>
  SETTINGS_REGISTRY.filter((entry) => entry.sectionId === sectionId)

/** Look up a single entry by its focus id. */
export const getSettingsEntry = (id: string): SettingsEntry | undefined =>
  SETTINGS_REGISTRY.find((entry) => entry.id === id || entry.focusId === id)

/**
 * Optional translator: resolves an i18n key to display text. When supplied,
 * `searchSettings` also matches against the resolved label/description so a
 * user's query hits the words they actually see, not just keywords. Without it
 * search still works off id + keywords + the raw key strings.
 */
export type Translate = (key: string) => string

export interface RankedSettingsEntry {
  entry: SettingsEntry
  score: number
}

const getSearchParts = (entry: SettingsEntry, translate?: Translate) => {
  const parts = [
    entry.id.replace(/-/g, " "),
    entry.id,
    entry.labelKey,
    entry.descriptionKey ?? "",
    ...(entry.searchKeys ?? []),
    ...(entry.aliases ?? []),
    ...(entry.keywords ?? [])
  ]
  if (translate) {
    parts.push(translate(entry.labelKey))
    if (entry.descriptionKey) parts.push(translate(entry.descriptionKey))
  }
  return parts
}

/**
 * Search the registry. Ranks exact phrases, exact words, substrings, and small
 * typos against the entry's id, keywords, label/description i18n keys, and —
 * when `translate` is given — the resolved label/description text.
 *
 * Returns ranked matches. An empty/whitespace query returns [].
 */
export const searchSettings = (
  query: string,
  translate?: Translate
): SettingsEntry[] => {
  return rankSettings(query, translate).map((result) => result.entry)
}

export const rankSettings = (
  query: string,
  translate?: Translate
): RankedSettingsEntry[] => {
  const normalizedQuery = normalizeSettingsSearchText(query)
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return []

  return SETTINGS_REGISTRY.map((entry, index) => {
    const haystack = normalizeSettingsSearchText(
      getSearchParts(entry, translate).join(" ")
    )
    const words = haystack.split(/\s+/).filter(Boolean)
    const phraseScore = haystack.includes(normalizedQuery) ? 100 : 0
    const tokenScore = tokens.reduce(
      (total, token) =>
        total + scoreSettingsSearchToken(token, haystack, words),
      0
    )
    return {
      entry,
      score: phraseScore + tokenScore,
      index
    }
  })
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ entry, score }) => ({ entry, score }))
}
