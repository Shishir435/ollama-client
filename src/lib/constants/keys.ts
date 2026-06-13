export const PROVIDER_MESSAGE_KEYS = {
  GET_MODELS: "get-provider-models",
  CHAT_WITH_MODEL: "chat-with-model",
  STREAM_RESPONSE: "provider-stream-response",
  STOP_GENERATION: "stop-generation",
  SHOW_MODEL_DETAILS: "show-model-details",
  PULL_MODEL: "PROVIDER.PULL_MODEL",
  SCRAPE_MODEL: "scrape-model-library",
  SCRAPE_MODEL_VARIANTS: "scrape-model-library-variant",
  UPDATE_BASE_URL: "provider-update-base-url",
  GET_LOADED_MODELS: "get-loaded-models",
  UNLOAD_MODEL: "unload-model",
  WARMUP_MODEL: "warmup-model",
  DELETE_MODEL: "delete-model",
  GET_PROVIDER_VERSION: "get-provider-version",
  CHECK_EMBEDDING_MODEL: "check-embedding-model",
  PREPARE_EMBEDDING_MODEL: "prepare-embedding-model",
  EMBED_FILE_CHUNKS: "embed-file-chunks",
  START_SELECTION_ACTION: "start-selection-action",
  CANCEL_SELECTION_ACTION: "cancel-selection-action"
} as const

/**
 * Legacy Ollama-named message keys.
 *
 * Only kept for the keys that have a string value distinct from
 * PROVIDER_MESSAGE_KEYS — these are real backward-compatibility strings that
 * older clients (already-open tabs during an extension upgrade) may still send.
 *
 * Keys whose value matched the provider-namespaced version exactly were
 * removed; those `case` arms in the background dispatcher were dead code.
 */
export const LEGACY_OLLAMA_MESSAGE_KEYS = {
  GET_MODELS: "get-ollama-models",
  STREAM_RESPONSE: "ollama-stream-response",
  PULL_MODEL: "OLLAMA.PULL_MODEL",
  SCRAPE_MODEL: "scrape-ollama-model",
  SCRAPE_MODEL_VARIANTS: "scrape-ollama-model-variant",
  UPDATE_BASE_URL: "ollama-update-base-url",
  GET_LOADED_MODELS: "get-loaded-model",
  GET_OLLAMA_VERSION: "get-ollama-version"
} as const

export const MESSAGE_KEYS = {
  PROVIDER: PROVIDER_MESSAGE_KEYS,
  OLLAMA: LEGACY_OLLAMA_MESSAGE_KEYS,
  BROWSER: {
    OPEN_TAB: "open-tab",
    GET_PAGE_CONTENT: "get-page-content",
    ADD_SELECTION_TO_CHAT: "add-selection-to-chat",
    SELECTION_BRIDGE_PORT: "selection-bridge-port",
    SELECTION_ACTION_CHUNK: "selection-action-chunk",
    SELECTION_ACTION_DONE: "selection-action-done",
    SELECTION_ACTION_ERROR: "selection-action-error"
  },
  APP: {
    RELOAD: "app-reload"
  }
} as const

export const LEGACY_STORAGE_KEYS = {
  OLLAMA: {
    BASE_URL: "ollama-base-url",
    SELECTED_MODEL: "selected-ollama-model",
    PROMPT_TEMPLATES: "ollama-prompt-templates",
    MODEL_CONFIGS: "ollama-model-config"
  }
}

export const STORAGE_KEYS = {
  PROVIDER: {
    BASE_URL: "provider-base-url",
    SELECTED_MODEL: "provider-selected-model",
    SELECTED_MODEL_REF: "provider-selected-model-ref",
    SELECTION_CONFLICT_MODEL: "provider-selection-conflict-model",
    PROMPT_TEMPLATES: "provider-prompt-templates",
    MODEL_CONFIGS: "provider-model-config",
    // User-set per-model capability overrides, used when a provider cannot
    // report a model's capabilities (anything other than Ollama). Resolution
    // order is: user override → model metadata → provider default.
    MODEL_CAPABILITY_OVERRIDES: "provider-model-capability-overrides"
  },
  THEME: {
    PREFERENCE: "light-dark-theme"
  },
  LANGUAGE: "app-language",
  BROWSER: {
    TABS_ACCESS: "browser-tab-access",
    EXCLUDE_URL_PATTERNS: "exclude-url-pattern",
    CONTENT_EXTRACTION_CONFIG: "content-extraction-config",
    PENDING_SELECTION_TEXT: "pending-selection-text"
  },
  TTS: {
    RATE: "tts-rate",
    PITCH: "tts-pitch",
    VOICE_URI: "tts-voice-uri",
    AUTO_PLAY: "tts-auto-play"
  },
  IMAGES: {
    // Per-image size cap (MB) for vision input; configurable on options page.
    MAX_SIZE_MB: "image-max-size-mb"
  },
  EMBEDDINGS: {
    SELECTED_MODEL: "embeddings-selected-model",
    AUTO_DOWNLOADED: "embeddings-auto-downloaded",
    CONFIG: "embeddings-config",
    GLOBAL_AUTO_EMBED: "global-auto-embed-enabled",
    KEYWORD_INDEX_BUILT: "keyword-index-built", // Track if keyword index is built
    AUTO_EMBED_CHAT: "embeddings-auto-embed-chat",
    USE_RAG: "embeddings-use-rag"
  },
  FILE_UPLOAD: {
    CONFIG: "file-upload-config"
  },
  MEMORY: {
    ENABLED: "memory-enabled"
  },
  CHAT: {
    SHOW_SESSION_METRICS: "chat-show-session-metrics",
    MAX_TAB_CONTEXT_CHARS: "chat-max-tab-context-chars",
    MAX_RAG_CONTEXT_CHARS: "chat-max-rag-context-chars",
    GROUNDED_ONLY_MODE: "chat-grounded-only-mode",
    AUTO_REFRESH_TAB_CONTEXT: "chat-auto-refresh-tab-context"
  },
  KNOWLEDGE: {
    ACTIVE_SET: "knowledge-active-set"
  },
  SHORTCUTS: "keyboard-shortcuts"
}
