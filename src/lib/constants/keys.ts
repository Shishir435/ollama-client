export const MESSAGE_KEYS = {
  OLLAMA: {
    GET_MODELS: "get-ollama-models",
    CHAT_WITH_MODEL: "chat-with-model",
    STREAM_RESPONSE: "ollama-stream-response",
    STOP_GENERATION: "stop-generation",
    SHOW_MODEL_DETAILS: "show-model-details",
    PULL_MODEL: "OLLAMA.PULL_MODEL",
    SCRAPE_MODEL: "scrape-ollama-model",
    SCRAPE_MODEL_VARIANTS: "scrape-ollama-model-variant",
    UPDATE_BASE_URL: "ollama-update-base-url",
    GET_LOADED_MODELS: "get-loaded-model",
    UNLOAD_MODEL: "unload-model",
    DELETE_MODEL: "delete-model",
    GET_OLLAMA_VERSION: "get-ollama-version",
    CHECK_EMBEDDING_MODEL: "check-embedding-model",
    EMBED_FILE_CHUNKS: "embed-file-chunks"
  },
  BROWSER: {
    OPEN_TAB: "open-tab",
    GET_PAGE_CONTENT: "get-page-content",
    ADD_SELECTION_TO_CHAT: "add-selection-to-chat"
  }
}

export const STORAGE_KEYS = {
  OLLAMA: {
    BASE_URL: "ollama-base-url",
    SELECTED_MODEL: "selected-ollama-model",
    PROMPT_TEMPLATES: "ollama-prompt-templates",
    MODEL_CONFIGS: "ollama-model-config"
  },
  THEME: {
    PREFERENCE: "light-dark-theme"
  },
  LANGUAGE: "app-language",
  BROWSER: {
    TABS_ACCESS: "browser-tab-access",
    EXCLUDE_URL_PATTERNS: "exclude-url-pattern",
    CONTENT_EXTRACTION_CONFIG: "content-extraction-config"
  },
  TTS: {
    RATE: "tts-rate",
    PITCH: "tts-pitch",
    VOICE_URI: "tts-voice-uri",
    AUTO_PLAY: "tts-auto-play"
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
    SHOW_SESSION_METRICS: "chat-show-session-metrics"
  },
  SHORTCUTS: "keyboard-shortcuts",
  LOGGER: {
    LEVEL: "logger-level",
    BUFFER_SIZE: "logger-buffer-size"
  }
}
