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
  /** Extra search terms (plain words, not i18n keys) for fuzzy matching. */
  keywords?: string[]
  /** Power-user tuning control — eligible for "Advanced" grouping (item 10). */
  advanced?: boolean
  /** Deletes/clears data — never auto-collapsed, flagged in danger zones. */
  destructive?: boolean
}

/**
 * The registry. Grouped by tab for readability; order here is not significant.
 *
 * NOTE: the vector-DB / embedding-store entries below currently render on the
 * Context tab. Phase 5 #7 relocates them to the Embeddings tab and updates the
 * `tab` field here (with a `?tab=context` → `?tab=embeddings` focus fallback).
 */
export const SETTINGS_REGISTRY: SettingsEntry[] = [
  // ---- General -----------------------------------------------------------
  {
    id: "language-select",
    tab: "general",
    sectionId: "general",
    labelKey: "common.language.select_label",
    keywords: ["language", "locale", "translation"]
  },
  {
    id: "show-session-metrics",
    tab: "general",
    sectionId: "general",
    labelKey: "settings.chat_display.session_metrics_label",
    descriptionKey: "settings.chat_display.session_metrics_description",
    keywords: ["metrics", "tokens", "performance", "stats"]
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

  // ---- Context: Vector-DB (moves to Embeddings in Phase 5 #7) ------------
  {
    id: "max-embeddings-per-file",
    tab: "context",
    sectionId: "embedding-limits",
    labelKey: "model.embedding_config.max_embeddings_label",
    descriptionKey: "model.embedding_config.max_embeddings_description",
    advanced: true,
    keywords: ["embeddings", "limit", "per file"]
  },
  {
    id: "max-storage-size",
    tab: "context",
    sectionId: "embedding-limits",
    labelKey: "model.embedding_config.max_storage_label",
    descriptionKey: "model.embedding_config.max_storage_description",
    advanced: true,
    keywords: ["storage", "limit", "size"]
  },
  {
    id: "auto-cleanup",
    tab: "context",
    sectionId: "embedding-limits",
    labelKey: "model.embedding_config.auto_cleanup_label",
    descriptionKey: "model.embedding_config.auto_cleanup_description",
    advanced: true,
    keywords: ["cleanup", "auto", "prune"]
  },
  {
    id: "cleanup-days-old",
    tab: "context",
    sectionId: "embedding-limits",
    labelKey: "model.embedding_config.cleanup_age_label",
    descriptionKey: "model.embedding_config.cleanup_age_description",
    advanced: true,
    keywords: ["cleanup", "age", "days", "prune"]
  },
  {
    id: "remove-duplicate-vectors",
    tab: "context",
    sectionId: "vector-db",
    labelKey: "model.embedding_config.remove_duplicates_button",
    descriptionKey: "model.embedding_config.remove_duplicates_description",
    destructive: true,
    keywords: ["duplicates", "dedup", "vectors", "clean"]
  },
  {
    id: "clear-chat-vectors",
    tab: "context",
    sectionId: "vector-db",
    labelKey: "model.embedding_config.clear_chat_button",
    descriptionKey: "model.embedding_config.clear_chat_description",
    destructive: true,
    keywords: ["clear", "chat", "vectors", "delete"]
  },
  {
    id: "clear-all-vectors",
    tab: "context",
    sectionId: "vector-db",
    labelKey: "model.embedding_config.clear_all_button",
    descriptionKey: "model.embedding_config.clear_all_description",
    destructive: true,
    keywords: ["clear", "all", "vectors", "delete", "wipe"]
  },
  {
    id: "rebuild-embeddings",
    tab: "context",
    sectionId: "vector-db",
    labelKey: "settings.context.embedding_health.action",
    keywords: ["rebuild", "reindex", "embeddings", "health"]
  },
  {
    id: "rebuild-keyword-index",
    tab: "context",
    sectionId: "vector-db",
    labelKey: "settings.embeddings.rebuild_index.button",
    descriptionKey: "settings.embeddings.rebuild_index.description",
    advanced: true,
    keywords: ["rebuild", "keyword", "index"]
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
  }
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
  SETTINGS_REGISTRY.find((entry) => entry.id === id)

/**
 * Optional translator: resolves an i18n key to display text. When supplied,
 * `searchSettings` also matches against the resolved label/description so a
 * user's query hits the words they actually see, not just keywords. Without it
 * search still works off id + keywords + the raw key strings.
 */
export type Translate = (key: string) => string

/**
 * Search the registry. Matches every whitespace-separated token in `query`
 * (AND semantics) against the entry's id, keyword list, label/description i18n
 * keys, and — when `translate` is given — the resolved label/description text.
 *
 * Returns matches in registry order. An empty/whitespace query returns [].
 */
export const searchSettings = (
  query: string,
  translate?: Translate
): SettingsEntry[] => {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return []

  return SETTINGS_REGISTRY.filter((entry) => {
    const parts = [
      entry.id.replace(/-/g, " "),
      entry.id,
      entry.labelKey,
      entry.descriptionKey ?? "",
      ...(entry.keywords ?? [])
    ]
    if (translate) {
      parts.push(translate(entry.labelKey))
      if (entry.descriptionKey) parts.push(translate(entry.descriptionKey))
    }
    const haystack = parts.join(" ").toLowerCase()
    return tokens.every((token) => haystack.includes(token))
  })
}
