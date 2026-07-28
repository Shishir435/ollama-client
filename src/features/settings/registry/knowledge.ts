import { STORAGE_KEYS } from "@/lib/constants"
import type { SettingsEntryDefinition } from "./types"

export const KNOWLEDGE_SETTINGS = [
  // ---- Context: Conversation Context -------------------------------------
  {
    id: "memory-enabled",
    sectionId: "conversation-context",
    labelKey: "settings.memory.enable.label",
    descriptionKey: "settings.memory.enable.description",
    level: "power",
    storageKey: STORAGE_KEYS.MEMORY.ENABLED,
    keywords: ["memory", "remember", "recall"]
  },
  {
    id: "clear-memory",
    sectionId: "conversation-context",
    labelKey: "settings.memory.clear.label",
    descriptionKey: "settings.memory.clear.description",
    destructive: true,
    keywords: ["clear", "forget", "memory"]
  },
  {
    id: "backfill-embeddings",
    sectionId: "conversation-context",
    labelKey: "chat.backfill.title",
    descriptionKey: "chat.backfill.description",
    level: "power",
    keywords: ["backfill", "history", "embed", "index"]
  },

  // ---- Context: Prompt Budget --------------------------------------------
  {
    id: "max-tab-context-chars",
    sectionId: "prompt-budget",
    labelKey: "settings.prompt_context_limits.max_tab_context_chars",
    level: "advanced",
    keywords: ["tab context", "characters", "limit", "budget"]
  },
  {
    id: "max-rag-context-chars",
    sectionId: "prompt-budget",
    labelKey: "settings.prompt_context_limits.max_rag_context_chars",
    level: "advanced",
    keywords: ["rag context", "characters", "limit", "budget"]
  },
  {
    id: "max-tool-result-chars",
    sectionId: "prompt-budget",
    labelKey: "settings.prompt_context_limits.max_tool_result_chars",
    descriptionKey: "settings.prompt_context_limits.max_tool_result_chars_hint",
    level: "advanced",
    keywords: ["tool result", "characters", "limit", "budget"]
  },
  {
    id: "auto-refresh-tab-context",
    sectionId: "prompt-budget",
    labelKey: "settings.prompt_context_limits.auto_refresh_label",
    descriptionKey: "settings.prompt_context_limits.auto_refresh_description",
    level: "advanced",
    keywords: ["auto refresh", "tab context"]
  },

  // ---- Context: Grounding ------------------------------------------------
  {
    id: "grounded-only-mode",
    sectionId: "grounding",
    labelKey: "settings.grounding_mode.label",
    descriptionKey: "settings.grounding_mode.description",
    level: "power",
    keywords: ["grounding", "grounded", "page only", "answer from page"]
  },
  {
    id: "auto-screenshot-on-vision",
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
    sectionId: "web-search",
    labelKey: "settings.web_search.enable.label",
    descriptionKey: "settings.web_search.enable.description",
    level: "power",
    keywords: ["web search", "internet", "online", "search"]
  },
  {
    id: "web-search-provider",
    sectionId: "web-search",
    labelKey: "settings.web_search.provider.label",
    descriptionKey: "settings.web_search.provider.description",
    level: "power",
    keywords: ["web search", "provider", "searxng", "brave", "tavily"]
  },
  {
    id: "web-search-safe-search",
    sectionId: "web-search",
    labelKey: "settings.web_search.safe_search.label",
    descriptionKey: "settings.web_search.safe_search.description",
    level: "power",
    keywords: ["safe search", "filter"]
  },
  {
    id: "web-search-endpoint",
    sectionId: "web-search",
    labelKey: "settings.web_search.endpoint.label",
    descriptionKey: "settings.web_search.endpoint.description",
    level: "power",
    keywords: ["endpoint", "url", "searxng"]
  },
  {
    id: "web-search-api-key",
    sectionId: "web-search",
    labelKey: "settings.web_search.api_key.label",
    descriptionKey: "settings.web_search.api_key.description",
    level: "power",
    keywords: ["api key", "token", "brave", "tavily"]
  },
  {
    id: "web-search-result-count",
    sectionId: "web-search",
    labelKey: "settings.web_search.result_count.label",
    descriptionKey: "settings.web_search.result_count.description",
    level: "power",
    keywords: ["result count", "results"]
  },

  // ---- Context: Retrieval ------------------------------------------------
  {
    id: "rag-enabled",
    sectionId: "retrieval",
    labelKey: "model.embedding_config.rag_enable_label",
    descriptionKey: "model.embedding_config.rag_enable_description",
    level: "power",
    keywords: ["rag", "retrieval", "knowledge"],
    aliases: ["document search", "search my documents", "knowledge base"]
  },
  {
    id: "use-reranking",
    sectionId: "retrieval",
    labelKey: "model.embedding_config.reranking_label",
    descriptionKey: "model.embedding_config.reranking_description",
    advanced: true,
    keywords: ["rerank", "reranking", "retrieval"]
  },
  {
    id: "search-limit-topk",
    sectionId: "retrieval",
    labelKey: "model.embedding_config.search_limit_label",
    descriptionKey: "model.embedding_config.search_limit_description",
    advanced: true,
    keywords: ["search limit", "top k", "retrieval"]
  },
  {
    id: "min-rerank-score",
    sectionId: "retrieval",
    labelKey: "knowledge_sets.min_rerank_label",
    descriptionKey: "knowledge_sets.min_rerank_description",
    advanced: true,
    keywords: ["min rerank", "score", "threshold", "retrieval"]
  },
  {
    id: "active-knowledge-set",
    sectionId: "retrieval",
    labelKey: "knowledge_sets.active_label",
    descriptionKey: "knowledge_sets.active_description",
    level: "power",
    keywords: ["knowledge set", "active", "collection"]
  },

  // ---- Context: Files ----------------------------------------------------
  {
    id: "max-file-size-mb",
    sectionId: "files",
    labelKey: "file_upload.settings.max_file_size_label",
    descriptionKey: "file_upload.settings.max_file_size_description",
    keywords: ["file size", "upload", "limit"]
  },
  {
    id: "max-image-size-mb",
    sectionId: "files",
    labelKey: "file_upload.settings.max_image_size_label",
    descriptionKey: "file_upload.settings.max_image_size_description",
    keywords: ["image size", "vision", "upload", "limit"]
  },

  // ---- Context: Chunking (advanced) --------------------------------------
  {
    id: "chunk-size",
    sectionId: "chunking",
    labelKey: "model.embedding_config.chunk_size_label",
    descriptionKey: "model.embedding_config.chunk_size_description",
    advanced: true,
    keywords: ["chunk size", "splitting"]
  },
  {
    id: "chunk-overlap",
    sectionId: "chunking",
    labelKey: "model.embedding_config.chunk_overlap_label",
    descriptionKey: "model.embedding_config.chunk_overlap_description",
    advanced: true,
    keywords: ["chunk overlap", "splitting"]
  },
  {
    id: "chunking-strategy",
    sectionId: "chunking",
    labelKey: "model.embedding_config.chunking_strategy_label",
    advanced: true,
    keywords: ["chunking strategy", "splitting"]
  },

  // ---- Embeddings: vector-DB (relocated from Context, Phase 5 #7) --------
  {
    id: "max-embeddings-per-file",
    sectionId: "embedding-limits",
    labelKey: "model.embedding_config.max_embeddings_label",
    descriptionKey: "model.embedding_config.max_embeddings_description",
    advanced: true,
    keywords: ["embeddings", "limit", "per file"]
  },
  {
    id: "max-storage-size",
    sectionId: "embedding-limits",
    labelKey: "model.embedding_config.max_storage_label",
    descriptionKey: "model.embedding_config.max_storage_description",
    advanced: true,
    keywords: ["storage", "limit", "size"]
  },
  {
    id: "auto-cleanup",
    sectionId: "embedding-limits",
    labelKey: "model.embedding_config.auto_cleanup_label",
    descriptionKey: "model.embedding_config.auto_cleanup_description",
    advanced: true,
    keywords: ["cleanup", "auto", "prune"]
  },
  {
    id: "cleanup-days-old",
    sectionId: "embedding-limits",
    labelKey: "model.embedding_config.cleanup_age_label",
    descriptionKey: "model.embedding_config.cleanup_age_description",
    advanced: true,
    keywords: ["cleanup", "age", "days", "prune"]
  },
  {
    id: "remove-duplicate-vectors",
    sectionId: "vector-db",
    labelKey: "model.embedding_config.remove_duplicates_button",
    descriptionKey: "model.embedding_config.remove_duplicates_description",
    destructive: true,
    keywords: ["duplicates", "dedup", "vectors", "clean"]
  },
  {
    id: "clear-chat-vectors",
    sectionId: "vector-db",
    labelKey: "model.embedding_config.clear_chat_button",
    descriptionKey: "model.embedding_config.clear_chat_description",
    destructive: true,
    keywords: ["clear", "chat", "vectors", "delete"]
  },
  {
    id: "clear-all-vectors",
    sectionId: "vector-db",
    labelKey: "model.embedding_config.clear_all_button",
    descriptionKey: "model.embedding_config.clear_all_description",
    destructive: true,
    keywords: ["clear", "all", "vectors", "delete", "wipe"]
  },
  {
    id: "rebuild-embeddings",
    focusId: "embeddings-model-select",
    sectionId: "vector-db",
    labelKey: "settings.context.embedding_health.action",
    keywords: ["rebuild", "reindex", "embeddings", "health"]
  },
  {
    id: "rebuild-keyword-index",
    sectionId: "vector-db",
    labelKey: "settings.embeddings.rebuild_index.button",
    descriptionKey: "settings.embeddings.rebuild_index.description",
    advanced: true,
    keywords: ["rebuild", "keyword", "index"]
  },
  {
    id: "embeddings-storage-stats",
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
    sectionId: "embeddings-model",
    labelKey: "settings.embeddings.model_select.label",
    descriptionKey: "settings.embeddings.model_select.description",
    level: "advanced",
    keywords: ["embedding model", "model", "select"]
  },
  {
    id: "embeddings-show-advanced-models",
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
    sectionId: "embeddings-generation",
    labelKey: "model.embedding_config.batch_size_label",
    descriptionKey: "model.embedding_config.batch_size_description",
    keywords: ["batch size", "generation"]
  },
  {
    id: "embeddings-enable-caching",
    sectionId: "embeddings-generation",
    labelKey: "model.embedding_config.enable_caching_label",
    descriptionKey: "model.embedding_config.enable_caching_description",
    keywords: ["cache", "caching"]
  },

  // ---- Embeddings: feedback ----------------------------------------------
  {
    id: "embeddings-feedback-enabled",
    sectionId: "embeddings-feedback",
    labelKey: "model.embedding_config.feedback_enable_label",
    descriptionKey: "model.embedding_config.feedback_enable_description",
    keywords: ["feedback", "learning"]
  },
  {
    id: "embeddings-show-retrieved-chunks",
    sectionId: "embeddings-feedback",
    labelKey: "model.embedding_config.feedback_show_chunks_label",
    descriptionKey: "model.embedding_config.feedback_show_chunks_description",
    keywords: ["chunks", "retrieved", "feedback"]
  },
  {
    id: "embeddings-feedback-clear",
    sectionId: "embeddings-feedback",
    labelKey: "model.embedding_config.feedback_clear_button",
    destructive: true,
    keywords: ["clear", "feedback", "delete"]
  },

  // ---- Embeddings: test / migration --------------------------------------
  {
    id: "embeddings-test-generation",
    sectionId: "embeddings-test",
    labelKey: "settings.embeddings.test_generation.button",
    descriptionKey: "settings.embeddings.test_generation.description",
    keywords: ["test", "generation", "diagnostic"]
  },
  {
    id: "embeddings-test-search",
    sectionId: "embeddings-test",
    labelKey: "settings.embeddings.test_search.title",
    descriptionKey: "settings.embeddings.test_search.description",
    searchKeys: ["settings.embeddings.test_search.placeholder"],
    aliases: ["semantic search", "test search", "search files"],
    keywords: ["search", "semantic", "uploaded files", "query"]
  }
] satisfies SettingsEntryDefinition[]
