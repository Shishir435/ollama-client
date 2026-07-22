import {
  normalizeSettingsSearchText,
  scoreSettingsSearchToken
} from "@/features/settings/settings-search-scoring"
import { STORAGE_KEYS } from "@/lib/constants"
import {
  getStorageKeyMetadata,
  type StorageSyncScope
} from "@/lib/storage/storage-key-registry"

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
  "knowledge",
  "browser",
  "privacy",
  "help"
] as const

export type SettingsTab = (typeof SETTINGS_TABS)[number]

export const SETTINGS_LEVELS = ["basic", "power", "advanced"] as const
export type SettingsLevel = (typeof SETTINGS_LEVELS)[number]

const LEGACY_TAB_MAP = {
  chat: "general",
  "model-behavior": "models",
  providers: "models",
  "knowledge-web": "knowledge",
  "saved-knowledge": "knowledge",
  "page-tabs": "browser",
  "prompt-library": "general",
  shortcuts: "general",
  speech: "general",
  privacy: "privacy",
  "data-backup": "privacy",
  help: "help"
} as const

type LegacySettingsTab = keyof typeof LEGACY_TAB_MAP

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
  /** Minimum progressive-disclosure level needed to show this setting. */
  level?: SettingsLevel
  /** Registered persistence key, when this UI maps directly to stored state. */
  storageKey?: string
  /** Derived from storageKey; never duplicate scope by hand. */
  scope?: StorageSyncScope
  /** Deletes/clears data — never auto-collapsed, flagged in danger zones. */
  destructive?: boolean
}

type RawSettingsEntry = Omit<SettingsEntry, "tab"> & {
  tab: LegacySettingsTab
}

/**
 * The registry. Grouped by tab for readability; order here is not significant.
 *
 * The vector-DB / embedding-store entries (embedding limits + the destructive
 * database actions) live on the "saved-knowledge" tab. `settings-page.tsx`
 * resolves a deep-linked focus id's home tab through this registry, so a link
 * only needs the correct `focus` id even if its `tab` is stale.
 */
const RAW_SETTINGS_REGISTRY: RawSettingsEntry[] = [
  {
    id: "settings-disclosure-level",
    tab: "chat",
    sectionId: "general",
    labelKey: "settings.disclosure.title",
    descriptionKey: "settings.disclosure.description",
    storageKey: STORAGE_KEYS.UI.SETTINGS_LEVEL,
    aliases: ["basic settings", "power settings", "advanced settings"]
  },
  {
    id: "diagnostics-support",
    tab: "help",
    sectionId: "diagnostics",
    labelKey: "diagnostics.title",
    descriptionKey: "diagnostics.description",
    searchKeys: ["diagnostics.run", "diagnostics.preview"],
    aliases: ["support bundle", "self test", "support code"]
  },
  // ---- General -----------------------------------------------------------
  {
    id: "language-select",
    tab: "chat",
    sectionId: "general",
    labelKey: "common.language.select_label",
    storageKey: STORAGE_KEYS.LANGUAGE,
    aliases: ["language", "locale", "translation"]
  },
  {
    id: "show-session-metrics",
    tab: "chat",
    sectionId: "general",
    labelKey: "settings.chat_display.session_metrics_label",
    descriptionKey: "settings.chat_display.session_metrics_description",
    storageKey: STORAGE_KEYS.CHAT.SHOW_SESSION_METRICS,
    aliases: ["metrics", "tokens", "performance", "stats"]
  },
  {
    id: "settings-presets",
    tab: "chat",
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
    tab: "model-behavior",
    sectionId: "model-system",
    labelKey: "settings.model.system.prompt_label",
    keywords: ["system", "persona", "instructions"]
  },
  {
    id: "stop-sequences",
    tab: "model-behavior",
    sectionId: "model-system",
    labelKey: "settings.model.system.stop_sequences_label",
    keywords: ["stop", "sequences"]
  },

  // ---- Models: sampling parameters (advanced) ----------------------------
  {
    id: "temperature",
    tab: "model-behavior",
    sectionId: "model-parameters",
    labelKey: "settings.model.parameters.temperature.label",
    advanced: true,
    keywords: ["temperature", "sampling", "randomness", "creativity"]
  },
  {
    id: "top-p",
    tab: "model-behavior",
    sectionId: "model-parameters",
    labelKey: "settings.model.parameters.top_p.label",
    advanced: true,
    keywords: ["top p", "nucleus", "sampling"]
  },
  {
    id: "top-k",
    tab: "model-behavior",
    sectionId: "model-parameters",
    labelKey: "settings.model.parameters.top_k.label",
    advanced: true,
    keywords: ["top k", "sampling"]
  },
  {
    id: "min-p",
    tab: "model-behavior",
    sectionId: "model-parameters",
    labelKey: "settings.model.parameters.min_p.label",
    advanced: true,
    keywords: ["min p", "sampling"]
  },
  {
    id: "seed",
    tab: "model-behavior",
    sectionId: "model-parameters",
    labelKey: "settings.model.parameters.seed.label",
    advanced: true,
    keywords: ["seed", "deterministic", "reproducible"]
  },
  {
    id: "num-ctx",
    tab: "model-behavior",
    sectionId: "model-parameters",
    labelKey: "settings.model.parameters.num_ctx.label",
    advanced: true,
    keywords: ["context length", "window", "num_ctx"]
  },
  {
    id: "num-predict",
    tab: "model-behavior",
    sectionId: "model-parameters",
    labelKey: "settings.model.parameters.num_predict.label",
    advanced: true,
    keywords: ["predictions", "max tokens", "num_predict"]
  },
  {
    id: "repeat-penalty",
    tab: "model-behavior",
    sectionId: "model-parameters",
    labelKey: "settings.model.parameters.repeat_penalty.label",
    advanced: true,
    keywords: ["repeat", "penalty", "repetition"]
  },
  {
    id: "repeat-last-n",
    tab: "model-behavior",
    sectionId: "model-parameters",
    labelKey: "settings.model.parameters.repeat_last_n.label",
    advanced: true,
    keywords: ["repeat", "last n", "repetition"]
  },

  // ---- Models: runtime ---------------------------------------------------
  {
    id: "keep-alive",
    tab: "model-behavior",
    sectionId: "model-runtime",
    labelKey: "settings.model.runtime.keep_alive_label",
    descriptionKey: "settings.model.runtime.keep_alive_description",
    level: "advanced",
    keywords: ["keep alive", "memory", "unload"]
  },
  {
    id: "warm-on-select",
    tab: "model-behavior",
    sectionId: "model-runtime",
    labelKey: "settings.model.runtime.warm_on_select_label",
    descriptionKey: "settings.model.runtime.warm_on_select_description",
    level: "advanced",
    keywords: ["warm", "preload"]
  },
  {
    id: "unload-on-switch",
    tab: "model-behavior",
    sectionId: "model-runtime",
    labelKey: "settings.model.runtime.unload_on_switch_label",
    descriptionKey: "settings.model.runtime.unload_on_switch_description",
    level: "advanced",
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
    id: "provider-add",
    tab: "providers",
    sectionId: "providers",
    labelKey: "settings.providers.add.button",
    descriptionKey: "settings.providers.add.description",
    searchKeys: [
      "settings.providers.add.title",
      "settings.providers.add.wire_openai",
      "settings.providers.add.wire_openai_api",
      "settings.providers.add.wire_ollama",
      "settings.providers.add.wire_anthropic",
      "settings.providers.add.wire_anthropic_compatible",
      "settings.providers.add.wire_openrouter",
      "settings.providers.models.title"
    ],
    aliases: [
      "provider",
      "add provider",
      "custom provider",
      "openai compatible",
      "anthropic",
      "claude",
      "manual model",
      "second ollama",
      "remote server",
      "lan"
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
    tab: "knowledge-web",
    sectionId: "conversation-context",
    labelKey: "settings.memory.enable.label",
    descriptionKey: "settings.memory.enable.description",
    level: "power",
    storageKey: STORAGE_KEYS.MEMORY.ENABLED,
    keywords: ["memory", "remember", "recall"]
  },
  {
    id: "clear-memory",
    tab: "knowledge-web",
    sectionId: "conversation-context",
    labelKey: "settings.memory.clear.label",
    descriptionKey: "settings.memory.clear.description",
    destructive: true,
    keywords: ["clear", "forget", "memory"]
  },
  {
    id: "backfill-embeddings",
    tab: "knowledge-web",
    sectionId: "conversation-context",
    labelKey: "chat.backfill.title",
    descriptionKey: "chat.backfill.description",
    level: "power",
    keywords: ["backfill", "history", "embed", "index"]
  },

  // ---- Context: Prompt Budget --------------------------------------------
  {
    id: "max-tab-context-chars",
    tab: "knowledge-web",
    sectionId: "prompt-budget",
    labelKey: "settings.prompt_context_limits.max_tab_context_chars",
    level: "advanced",
    keywords: ["tab context", "characters", "limit", "budget"]
  },
  {
    id: "max-rag-context-chars",
    tab: "knowledge-web",
    sectionId: "prompt-budget",
    labelKey: "settings.prompt_context_limits.max_rag_context_chars",
    level: "advanced",
    keywords: ["rag context", "characters", "limit", "budget"]
  },
  {
    id: "max-tool-result-chars",
    tab: "knowledge-web",
    sectionId: "prompt-budget",
    labelKey: "settings.prompt_context_limits.max_tool_result_chars",
    descriptionKey: "settings.prompt_context_limits.max_tool_result_chars_hint",
    level: "advanced",
    keywords: ["tool result", "characters", "limit", "budget"]
  },
  {
    id: "auto-refresh-tab-context",
    tab: "knowledge-web",
    sectionId: "prompt-budget",
    labelKey: "settings.prompt_context_limits.auto_refresh_label",
    descriptionKey: "settings.prompt_context_limits.auto_refresh_description",
    level: "advanced",
    keywords: ["auto refresh", "tab context"]
  },

  // ---- Context: Grounding ------------------------------------------------
  {
    id: "grounded-only-mode",
    tab: "knowledge-web",
    sectionId: "grounding",
    labelKey: "settings.grounding_mode.label",
    descriptionKey: "settings.grounding_mode.description",
    level: "power",
    keywords: ["grounding", "grounded", "page only", "answer from page"]
  },
  {
    id: "auto-screenshot-on-vision",
    tab: "knowledge-web",
    sectionId: "grounding",
    labelKey: "chat.input.auto_screenshot",
    level: "power",
    aliases: [
      "auto screenshot",
      "automatic screenshot",
      "vision screenshot",
      "capture screenshot"
    ]
  },

  // ---- Context: Web Search -----------------------------------------------
  {
    id: "web-search-enabled",
    tab: "knowledge-web",
    sectionId: "web-search",
    labelKey: "settings.web_search.enable.label",
    descriptionKey: "settings.web_search.enable.description",
    level: "power",
    keywords: ["web search", "internet", "online", "search"]
  },
  {
    id: "web-search-provider",
    tab: "knowledge-web",
    sectionId: "web-search",
    labelKey: "settings.web_search.provider.label",
    descriptionKey: "settings.web_search.provider.description",
    level: "power",
    keywords: ["web search", "provider", "searxng", "brave", "tavily"]
  },
  {
    id: "web-search-safe-search",
    tab: "knowledge-web",
    sectionId: "web-search",
    labelKey: "settings.web_search.safe_search.label",
    descriptionKey: "settings.web_search.safe_search.description",
    level: "power",
    keywords: ["safe search", "filter"]
  },
  {
    id: "web-search-endpoint",
    tab: "knowledge-web",
    sectionId: "web-search",
    labelKey: "settings.web_search.endpoint.label",
    descriptionKey: "settings.web_search.endpoint.description",
    level: "power",
    keywords: ["endpoint", "url", "searxng"]
  },
  {
    id: "web-search-api-key",
    tab: "knowledge-web",
    sectionId: "web-search",
    labelKey: "settings.web_search.api_key.label",
    descriptionKey: "settings.web_search.api_key.description",
    level: "power",
    keywords: ["api key", "token", "brave", "tavily"]
  },
  {
    id: "web-search-result-count",
    tab: "knowledge-web",
    sectionId: "web-search",
    labelKey: "settings.web_search.result_count.label",
    descriptionKey: "settings.web_search.result_count.description",
    level: "power",
    keywords: ["result count", "results"]
  },

  // ---- Context: Retrieval ------------------------------------------------
  {
    id: "rag-enabled",
    tab: "knowledge-web",
    sectionId: "retrieval",
    labelKey: "model.embedding_config.rag_enable_label",
    descriptionKey: "model.embedding_config.rag_enable_description",
    level: "power",
    keywords: ["rag", "retrieval", "knowledge"],
    aliases: ["document search", "search my documents", "knowledge base"]
  },
  {
    id: "use-reranking",
    tab: "knowledge-web",
    sectionId: "retrieval",
    labelKey: "model.embedding_config.reranking_label",
    descriptionKey: "model.embedding_config.reranking_description",
    advanced: true,
    keywords: ["rerank", "reranking", "retrieval"]
  },
  {
    id: "search-limit-topk",
    tab: "knowledge-web",
    sectionId: "retrieval",
    labelKey: "model.embedding_config.search_limit_label",
    descriptionKey: "model.embedding_config.search_limit_description",
    advanced: true,
    keywords: ["search limit", "top k", "retrieval"]
  },
  {
    id: "min-rerank-score",
    tab: "knowledge-web",
    sectionId: "retrieval",
    labelKey: "knowledge_sets.min_rerank_label",
    descriptionKey: "knowledge_sets.min_rerank_description",
    advanced: true,
    keywords: ["min rerank", "score", "threshold", "retrieval"]
  },
  {
    id: "active-knowledge-set",
    tab: "knowledge-web",
    sectionId: "retrieval",
    labelKey: "knowledge_sets.active_label",
    descriptionKey: "knowledge_sets.active_description",
    level: "power",
    keywords: ["knowledge set", "active", "collection"]
  },

  // ---- Context: Files ----------------------------------------------------
  {
    id: "max-file-size-mb",
    tab: "knowledge-web",
    sectionId: "files",
    labelKey: "file_upload.settings.max_file_size_label",
    descriptionKey: "file_upload.settings.max_file_size_description",
    keywords: ["file size", "upload", "limit"]
  },
  {
    id: "max-image-size-mb",
    tab: "knowledge-web",
    sectionId: "files",
    labelKey: "file_upload.settings.max_image_size_label",
    descriptionKey: "file_upload.settings.max_image_size_description",
    keywords: ["image size", "vision", "upload", "limit"]
  },

  // ---- Context: Chunking (advanced) --------------------------------------
  {
    id: "chunk-size",
    tab: "knowledge-web",
    sectionId: "chunking",
    labelKey: "model.embedding_config.chunk_size_label",
    descriptionKey: "model.embedding_config.chunk_size_description",
    advanced: true,
    keywords: ["chunk size", "splitting"]
  },
  {
    id: "chunk-overlap",
    tab: "knowledge-web",
    sectionId: "chunking",
    labelKey: "model.embedding_config.chunk_overlap_label",
    descriptionKey: "model.embedding_config.chunk_overlap_description",
    advanced: true,
    keywords: ["chunk overlap", "splitting"]
  },
  {
    id: "chunking-strategy",
    tab: "knowledge-web",
    sectionId: "chunking",
    labelKey: "model.embedding_config.chunking_strategy_label",
    advanced: true,
    keywords: ["chunking strategy", "splitting"]
  },

  // ---- Embeddings: vector-DB (relocated from Context, Phase 5 #7) --------
  {
    id: "max-embeddings-per-file",
    tab: "saved-knowledge",
    sectionId: "embedding-limits",
    labelKey: "model.embedding_config.max_embeddings_label",
    descriptionKey: "model.embedding_config.max_embeddings_description",
    advanced: true,
    keywords: ["embeddings", "limit", "per file"]
  },
  {
    id: "max-storage-size",
    tab: "saved-knowledge",
    sectionId: "embedding-limits",
    labelKey: "model.embedding_config.max_storage_label",
    descriptionKey: "model.embedding_config.max_storage_description",
    advanced: true,
    keywords: ["storage", "limit", "size"]
  },
  {
    id: "auto-cleanup",
    tab: "saved-knowledge",
    sectionId: "embedding-limits",
    labelKey: "model.embedding_config.auto_cleanup_label",
    descriptionKey: "model.embedding_config.auto_cleanup_description",
    advanced: true,
    keywords: ["cleanup", "auto", "prune"]
  },
  {
    id: "cleanup-days-old",
    tab: "saved-knowledge",
    sectionId: "embedding-limits",
    labelKey: "model.embedding_config.cleanup_age_label",
    descriptionKey: "model.embedding_config.cleanup_age_description",
    advanced: true,
    keywords: ["cleanup", "age", "days", "prune"]
  },
  {
    id: "remove-duplicate-vectors",
    tab: "saved-knowledge",
    sectionId: "vector-db",
    labelKey: "model.embedding_config.remove_duplicates_button",
    descriptionKey: "model.embedding_config.remove_duplicates_description",
    destructive: true,
    keywords: ["duplicates", "dedup", "vectors", "clean"]
  },
  {
    id: "clear-chat-vectors",
    tab: "saved-knowledge",
    sectionId: "vector-db",
    labelKey: "model.embedding_config.clear_chat_button",
    descriptionKey: "model.embedding_config.clear_chat_description",
    destructive: true,
    keywords: ["clear", "chat", "vectors", "delete"]
  },
  {
    id: "clear-all-vectors",
    tab: "saved-knowledge",
    sectionId: "vector-db",
    labelKey: "model.embedding_config.clear_all_button",
    descriptionKey: "model.embedding_config.clear_all_description",
    destructive: true,
    keywords: ["clear", "all", "vectors", "delete", "wipe"]
  },
  {
    id: "rebuild-embeddings",
    focusId: "embeddings-model-select",
    tab: "saved-knowledge",
    sectionId: "vector-db",
    labelKey: "settings.context.embedding_health.action",
    keywords: ["rebuild", "reindex", "embeddings", "health"]
  },
  {
    id: "rebuild-keyword-index",
    tab: "saved-knowledge",
    sectionId: "vector-db",
    labelKey: "settings.embeddings.rebuild_index.button",
    descriptionKey: "settings.embeddings.rebuild_index.description",
    advanced: true,
    keywords: ["rebuild", "keyword", "index"]
  },
  {
    id: "embeddings-storage-stats",
    tab: "saved-knowledge",
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
    tab: "saved-knowledge",
    sectionId: "embeddings-model",
    labelKey: "settings.embeddings.model_select.label",
    descriptionKey: "settings.embeddings.model_select.description",
    level: "advanced",
    keywords: ["embedding model", "model", "select"]
  },
  {
    id: "embeddings-show-advanced-models",
    tab: "saved-knowledge",
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
    tab: "saved-knowledge",
    sectionId: "embeddings-generation",
    labelKey: "model.embedding_config.batch_size_label",
    descriptionKey: "model.embedding_config.batch_size_description",
    keywords: ["batch size", "generation"]
  },
  {
    id: "embeddings-enable-caching",
    tab: "saved-knowledge",
    sectionId: "embeddings-generation",
    labelKey: "model.embedding_config.enable_caching_label",
    descriptionKey: "model.embedding_config.enable_caching_description",
    keywords: ["cache", "caching"]
  },

  // ---- Embeddings: feedback ----------------------------------------------
  {
    id: "embeddings-feedback-enabled",
    tab: "saved-knowledge",
    sectionId: "embeddings-feedback",
    labelKey: "model.embedding_config.feedback_enable_label",
    descriptionKey: "model.embedding_config.feedback_enable_description",
    keywords: ["feedback", "learning"]
  },
  {
    id: "embeddings-show-retrieved-chunks",
    tab: "saved-knowledge",
    sectionId: "embeddings-feedback",
    labelKey: "model.embedding_config.feedback_show_chunks_label",
    descriptionKey: "model.embedding_config.feedback_show_chunks_description",
    keywords: ["chunks", "retrieved", "feedback"]
  },
  {
    id: "embeddings-feedback-clear",
    tab: "saved-knowledge",
    sectionId: "embeddings-feedback",
    labelKey: "model.embedding_config.feedback_clear_button",
    destructive: true,
    keywords: ["clear", "feedback", "delete"]
  },

  // ---- Embeddings: test / migration --------------------------------------
  {
    id: "embeddings-test-generation",
    tab: "saved-knowledge",
    sectionId: "embeddings-test",
    labelKey: "settings.embeddings.test_generation.button",
    descriptionKey: "settings.embeddings.test_generation.description",
    keywords: ["test", "generation", "diagnostic"]
  },
  {
    id: "embeddings-test-search",
    tab: "saved-knowledge",
    sectionId: "embeddings-test",
    labelKey: "settings.embeddings.test_search.title",
    descriptionKey: "settings.embeddings.test_search.description",
    searchKeys: ["settings.embeddings.test_search.placeholder"],
    aliases: ["semantic search", "test search", "search files"],
    keywords: ["search", "semantic", "uploaded files", "query"]
  },
  // NOTE: the old "embeddings-search" advanced card (search limit, min
  // similarity, cache TTL/size, ANN backend/min-vectors) no longer exists in
  // the UI — its config fields are internal now. Registry entries for it were
  // removed so search never offers results that focus nothing. The live
  // search-limit and rerank-threshold sliders in RAG settings have their own
  // entries ("search-limit-topk", "min-rerank-score").
  {
    id: "data-migration-export",
    tab: "data-backup",
    sectionId: "data-migration",
    labelKey: "settings.migration.export.button",
    descriptionKey: "settings.migration.export.description",
    keywords: ["export", "backup", "migration", "data backup"]
  },
  {
    id: "data-migration-import",
    tab: "data-backup",
    sectionId: "data-migration",
    labelKey: "settings.migration.import.button",
    descriptionKey: "settings.migration.import.description",
    keywords: ["import", "restore", "migration", "data backup"]
  },

  // ---- Content Extraction ------------------------------------------------
  {
    id: "content-extraction-enabled",
    tab: "page-tabs",
    sectionId: "content-extraction",
    labelKey: "settings.content_extraction.enable.label",
    descriptionKey: "settings.content_extraction.enable.description",
    keywords: ["content extraction", "scrape", "page"],
    aliases: ["page reading", "read page", "website text", "current page"]
  },
  {
    id: "content-scraper",
    tab: "page-tabs",
    sectionId: "content-extraction",
    labelKey: "settings.content_extraction.scraper.label",
    level: "power",
    keywords: ["scraper", "extraction", "engine"]
  },
  {
    id: "scroll-strategy",
    tab: "page-tabs",
    sectionId: "content-extraction",
    labelKey: "settings.content_extraction.scroll_strategy.label",
    level: "advanced",
    keywords: ["scroll", "strategy"]
  },
  {
    id: "scroll-depth",
    tab: "page-tabs",
    sectionId: "content-extraction",
    labelKey: "settings.content_extraction.scroll_depth.label",
    descriptionKey: "settings.content_extraction.scroll_depth.description",
    level: "advanced",
    keywords: ["scroll", "depth"]
  },
  {
    id: "site-overrides",
    tab: "page-tabs",
    sectionId: "site-overrides",
    labelKey: "model.site_overrides.title",
    descriptionKey: "model.site_overrides.description",
    level: "power",
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
    tab: "page-tabs",
    sectionId: "selection-actions",
    labelKey: "settings.content_extraction.selection_actions.label",
    descriptionKey: "settings.content_extraction.selection_actions.description",
    level: "power",
    keywords: ["selection", "actions", "highlight", "toolbar"]
  },
  {
    id: "selection-actions-min-chars",
    tab: "page-tabs",
    sectionId: "selection-actions",
    labelKey: "settings.content_extraction.selection_actions_min_chars.label",
    descriptionKey:
      "settings.content_extraction.selection_actions_min_chars.description",
    level: "power",
    keywords: ["selection", "minimum", "characters"]
  },
  {
    id: "scroll-delay",
    tab: "page-tabs",
    sectionId: "content-extraction-timeouts",
    labelKey: "settings.content_extraction.timeout.scroll_delay",
    advanced: true,
    keywords: ["scroll delay", "timeout", "milliseconds"]
  },
  {
    id: "mutation-timeout",
    tab: "page-tabs",
    sectionId: "content-extraction-timeouts",
    labelKey: "settings.content_extraction.timeout.mutation_timeout",
    advanced: true,
    keywords: ["mutation", "timeout", "milliseconds"]
  },
  {
    id: "network-timeout",
    tab: "page-tabs",
    sectionId: "content-extraction-timeouts",
    labelKey: "settings.content_extraction.timeout.network_timeout",
    advanced: true,
    keywords: ["network", "idle", "timeout", "milliseconds"]
  },
  {
    id: "max-wait",
    tab: "page-tabs",
    sectionId: "content-extraction-timeouts",
    labelKey: "settings.content_extraction.timeout.max_wait",
    advanced: true,
    keywords: ["max wait", "timeout", "milliseconds"]
  },

  // ---- Voices ------------------------------------------------------------
  {
    id: "voice-selection",
    tab: "speech",
    sectionId: "voices",
    labelKey: "settings.speech.voice_label",
    keywords: ["voice", "tts", "speech"]
  },
  {
    id: "speech-rate",
    tab: "speech",
    sectionId: "voices",
    labelKey: "settings.speech.rate_label",
    keywords: ["rate", "speed", "tts", "speech"]
  },
  {
    id: "speech-pitch",
    tab: "speech",
    sectionId: "voices",
    labelKey: "settings.speech.pitch_label",
    keywords: ["pitch", "tone", "tts", "speech"]
  },

  // ---- Prompts -----------------------------------------------------------
  {
    id: "prompt-templates",
    tab: "prompt-library",
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
      "settings.shortcuts.export_pdf",
      "settings.shortcuts.export_pdf_desc"
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
    id: "shortcut-export-pdf",
    tab: "shortcuts",
    sectionId: "shortcuts",
    labelKey: "settings.shortcuts.export_pdf",
    descriptionKey: "settings.shortcuts.export_pdf_desc",
    aliases: ["pdf export shortcut"]
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
    tab: "data-backup",
    sectionId: "reset-modules",
    labelKey: "settings.reset.title",
    descriptionKey: "settings.reset.description",
    aliases: ["reset settings", "clear data"]
  },
  {
    id: "reset-provider",
    tab: "data-backup",
    sectionId: "reset-modules",
    labelKey: "settings.reset.modules.provider.title",
    descriptionKey: "settings.reset.modules.provider.description",
    aliases: ["provider settings", "models", "configuration"]
  },
  {
    id: "reset-theme",
    tab: "data-backup",
    sectionId: "reset-modules",
    labelKey: "settings.reset.modules.theme.title",
    descriptionKey: "settings.reset.modules.theme.description",
    aliases: ["theme", "ui", "appearance"]
  },
  {
    id: "reset-browser",
    tab: "data-backup",
    sectionId: "reset-modules",
    labelKey: "settings.reset.modules.browser.title",
    descriptionKey: "settings.reset.modules.browser.description",
    aliases: ["browser settings", "tab access", "url patterns"]
  },
  {
    id: "reset-tts",
    tab: "data-backup",
    sectionId: "reset-modules",
    labelKey: "settings.reset.modules.tts.title",
    descriptionKey: "settings.reset.modules.tts.description",
    aliases: ["text to speech", "tts", "speech"]
  },
  {
    id: "reset-chat-sessions",
    tab: "data-backup",
    sectionId: "reset-modules",
    labelKey: "settings.reset.modules.chat_sessions.title",
    descriptionKey: "settings.reset.modules.chat_sessions.description",
    aliases: ["chat history", "conversation history"]
  },
  {
    id: "reset-feedback",
    tab: "data-backup",
    sectionId: "reset-modules",
    labelKey: "settings.reset.modules.feedback.title",
    descriptionKey: "settings.reset.modules.feedback.description",
    aliases: ["user feedback", "learning feedback"]
  },
  {
    id: "reset-danger-zone",
    tab: "data-backup",
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
    tab: "help",
    sectionId: "guides",
    labelKey: "guides.title",
    descriptionKey: "guides.description",
    aliases: ["documentation", "docs", "help"]
  },
  {
    id: "guide-setup",
    tab: "help",
    sectionId: "guides",
    labelKey: "guides.items.setup.label",
    descriptionKey: "guides.items.setup.description",
    searchKeys: ["guides.items.setup.badge"],
    aliases: ["setup guide", "install guide"]
  },
  {
    id: "guide-library",
    tab: "help",
    sectionId: "guides",
    labelKey: "guides.items.library.label",
    descriptionKey: "guides.items.library.description",
    searchKeys: ["guides.items.library.badge"],
    aliases: ["model library", "ollama library"]
  },
  {
    id: "guide-github",
    tab: "help",
    sectionId: "guides",
    labelKey: "guides.items.github.label",
    descriptionKey: "guides.items.github.description",
    searchKeys: ["guides.items.github.badge"],
    aliases: ["github", "repo", "source code", "releases"]
  },
  {
    id: "guide-issue",
    tab: "help",
    sectionId: "guides",
    labelKey: "guides.items.issue.label",
    descriptionKey: "guides.items.issue.description",
    searchKeys: ["guides.items.issue.badge"],
    aliases: ["bug", "issue", "support", "feedback", "github issue"]
  },
  {
    id: "guide-faq",
    tab: "help",
    sectionId: "guides",
    labelKey: "guides.items.faq.label",
    descriptionKey: "guides.items.faq.description",
    searchKeys: ["guides.items.faq.badge"],
    aliases: ["faq", "troubleshooting", "support"]
  },
  {
    id: "guide-support",
    tab: "help",
    sectionId: "guides",
    labelKey: "guides.support.title",
    descriptionKey: "guides.support.description",
    aliases: ["product hunt", "support project"]
  },

  // ---- Permissions & Privacy ---------------------------------------------
  {
    id: "privacy-data-inventory",
    tab: "privacy",
    sectionId: "privacy",
    labelKey: "settings.privacy_spine.inventory.title",
    descriptionKey: "settings.privacy_spine.inventory.description",
    searchKeys: [
      "settings.privacy_spine.inventory.chat",
      "settings.privacy_spine.inventory.knowledge",
      "settings.privacy_spine.inventory.settings",
      "settings.privacy_spine.inventory.preferences"
    ],
    aliases: ["local data", "stored data", "privacy", "inventory", "sync"]
  },
  {
    id: "permissions",
    tab: "privacy",
    sectionId: "permissions",
    labelKey: "settings.permissions.title",
    descriptionKey: "settings.permissions.description",
    aliases: ["permissions", "privacy", "access", "consent", "data"]
  },
  {
    id: "browser-tab-access",
    tab: "privacy",
    sectionId: "permissions",
    labelKey: "settings.presets.fields.tab_access",
    storageKey: STORAGE_KEYS.BROWSER.TABS_ACCESS,
    aliases: [
      "tab access",
      "other tabs",
      "open tabs",
      "read tabs",
      "stop ai seeing tabs"
    ]
  },
  {
    id: "model-tools",
    tab: "privacy",
    sectionId: "permissions",
    labelKey: "settings.permissions.tools.title",
    descriptionKey: "settings.permissions.tools.description",
    level: "power",
    searchKeys: [
      "settings.permissions.tools.master.label",
      "settings.permissions.tools.families.browser.label",
      "settings.permissions.tools.families.knowledge.label",
      "settings.permissions.tools.families.history.label",
      "settings.permissions.tools.families.web.label",
      "settings.permissions.tools.families.automation.label",
      "settings.permissions.tools.inventory.title"
    ],
    aliases: [
      "model tools",
      "ai tools",
      "tool calling",
      "function calling",
      "agent",
      "browser tools",
      "available tools",
      "tool inventory"
    ]
  },
  {
    id: "export-allow-remote-images",
    tab: "privacy",
    sectionId: "permissions",
    labelKey: "settings.export_privacy.remote_images_label",
    descriptionKey: "settings.export_privacy.remote_images_hint",
    focusId: "export-allow-remote-images",
    storageKey: STORAGE_KEYS.EXPORT.ALLOW_REMOTE_IMAGES,
    aliases: [
      "export images",
      "remote images",
      "print images",
      "pdf images",
      "tracking pixel"
    ]
  },
  {
    id: "tool-approvals",
    tab: "privacy",
    sectionId: "permissions",
    labelKey: "settings.permissions.approvals.title",
    descriptionKey: "settings.permissions.approvals.description",
    searchKeys: [
      "settings.permissions.approvals.empty",
      "settings.permissions.approvals.clear_all"
    ],
    aliases: [
      "approvals",
      "always allow",
      "tool permissions",
      "grants",
      "revoke",
      "confirmation"
    ]
  },
  {
    // Routes per-model search hits to the model picker in the Model tools card.
    // focusId must equal the Select's data-settings-focus-id.
    id: "model-tools-per-model",
    tab: "privacy",
    sectionId: "permissions",
    labelKey: "settings.permissions.tools.perModel.title",
    descriptionKey: "settings.permissions.tools.perModel.description",
    level: "advanced",
    aliases: ["per model tools", "per-model", "model specific tools"]
  },
  {
    // The non-native fallback toggle mounts under the per-model card once a
    // model is selected; focusId matches its SettingsSwitch id.
    id: "model-tools-nonnative-fallback",
    focusId: "model-tools-override-nonnative-fallback",
    tab: "privacy",
    sectionId: "permissions",
    labelKey: "settings.permissions.tools.perModel.nonNativeFallback.label",
    descriptionKey:
      "settings.permissions.tools.perModel.nonNativeFallback.description",
    level: "advanced",
    aliases: [
      "non-native tools",
      "prompt-based tools",
      "tool fallback",
      "react tools",
      "tools without native tool calling"
    ]
  },
  {
    id: "max-restore-sessions",
    tab: "privacy",
    sectionId: "permissions",
    labelKey: "settings.restore_sessions.max_label",
    descriptionKey: "settings.restore_sessions.description",
    aliases: [
      "reopen tabs",
      "restore session limit",
      "reopen closed tabs",
      "restore_session",
      "max tabs to reopen"
    ]
  },
  {
    id: "permission-bookmarks",
    tab: "privacy",
    sectionId: "permissions",
    labelKey: "settings.permissions.items.bookmarks.label",
    descriptionKey: "settings.permissions.items.bookmarks.description",
    aliases: ["bookmarks", "saved pages", "permission"]
  },
  {
    id: "permission-history",
    tab: "privacy",
    sectionId: "permissions",
    labelKey: "settings.permissions.items.history.label",
    descriptionKey: "settings.permissions.items.history.description",
    aliases: ["history", "browsing history", "permission"]
  },
  {
    id: "permission-notifications",
    tab: "privacy",
    sectionId: "permissions",
    labelKey: "settings.permissions.items.notifications.label",
    descriptionKey: "settings.permissions.items.notifications.description",
    aliases: ["notifications", "alerts", "permission"]
  },
  {
    id: "permission-downloads",
    tab: "privacy",
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
          tab: "privacy" as const,
          sectionId: "permissions",
          labelKey: "settings.permissions.items.tabGroups.label",
          descriptionKey: "settings.permissions.items.tabGroups.description",
          aliases: ["tab groups", "permission"]
        }
      ]
    : []),
  {
    id: "permission-alarms",
    tab: "privacy",
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
    id: "permission-sessions",
    tab: "privacy",
    sectionId: "permissions",
    labelKey: "settings.permissions.items.sessions.label",
    descriptionKey: "settings.permissions.items.sessions.description",
    aliases: [
      "recently closed tabs",
      "closed tabs",
      "browser sessions",
      "synced tabs",
      "permission"
    ]
  },
  {
    id: "permissions-host",
    tab: "privacy",
    sectionId: "permissions",
    labelKey: "settings.permissions.host.title",
    descriptionKey: "settings.permissions.host.description",
    aliases: ["host access", "all urls", "site access", "remote url"]
  },
  {
    id: "scheduled-job-vector-maintenance",
    tab: "privacy",
    sectionId: "permissions",
    labelKey: "settings.permissions.scheduled.items.vectorMaintenance.label",
    descriptionKey:
      "settings.permissions.scheduled.items.vectorMaintenance.description",
    level: "advanced",
    aliases: ["scheduled jobs", "maintenance", "alarms", "cleanup"]
  }
]

export const SETTINGS_REGISTRY: SettingsEntry[] = RAW_SETTINGS_REGISTRY.map(
  (entry) => ({
    ...entry,
    tab: LEGACY_TAB_MAP[entry.tab],
    scope: entry.storageKey
      ? getStorageKeyMetadata(entry.storageKey)?.scope
      : undefined
  })
)

const SETTINGS_LEVEL_RANK: Record<SettingsLevel, number> = {
  basic: 0,
  power: 1,
  advanced: 2
}

export const getSettingsEntryLevel = (
  entry: SettingsEntry | undefined
): SettingsLevel => entry?.level ?? (entry?.advanced ? "advanced" : "basic")

export const settingsLevelIncludes = (
  current: SettingsLevel,
  required: SettingsLevel
): boolean => SETTINGS_LEVEL_RANK[current] >= SETTINGS_LEVEL_RANK[required]

export const maxSettingsLevel = (
  left: SettingsLevel,
  right: SettingsLevel
): SettingsLevel =>
  SETTINGS_LEVEL_RANK[left] >= SETTINGS_LEVEL_RANK[right] ? left : right

export const isSettingsLevel = (value: unknown): value is SettingsLevel =>
  typeof value === "string" && SETTINGS_LEVELS.includes(value as SettingsLevel)

const TAB_SET = new Set<string>(SETTINGS_TABS)

/** Type guard: is `tab` a real options-page tab key. */
export const isSettingsTab = (tab: string): tab is SettingsTab =>
  TAB_SET.has(tab)

/** Resolve current and pre-0.12.1 deep links to the six intent tabs. */
export const resolveSettingsTab = (
  tab: string | null | undefined
): SettingsTab | undefined => {
  if (!tab) return undefined
  if (isSettingsTab(tab)) return tab
  return LEGACY_TAB_MAP[tab as LegacySettingsTab]
}

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
