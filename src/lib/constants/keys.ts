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
  START_SELECTION_ACTION: "start-selection-action",
  CANCEL_SELECTION_ACTION: "cancel-selection-action",
  CONFIRM_TOOL: "confirm-tool"
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
    OMNIBOX_QUERY: "omnibox-query",
    SELECTION_BRIDGE_PORT: "selection-bridge-port",
    SELECTION_ACTION_CHUNK: "selection-action-chunk",
    SELECTION_ACTION_DONE: "selection-action-done",
    SELECTION_ACTION_ERROR: "selection-action-error"
  },
  APP: {
    RELOAD: "app-reload",
    FLUSH_SQLITE: "app-flush-sqlite",
    // Ask other extension contexts to close their Dexie handles so a backup
    // import can delete/recreate the vector and knowledge databases without
    // blocked-deletion warnings.
    CLOSE_DEXIE: "app-close-dexie",
    NOTIFY_JOB_COMPLETE: "app-notify-job-complete",
    KEEP_TOOL_LOOP_ALIVE: "app-keep-tool-loop-alive"
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
  BACKUP: {
    /** Durable rollback state for interrupted portable-settings imports. */
    IMPORT_JOURNAL: "backup_import_journal_v1"
  },
  APP_LIFECYCLE: {
    /**
     * Raw chrome.storage.local flag: a destructive reset the background
     * executes on next worker boot, after runtime.reload() has closed every
     * page that could hold a database handle.
     */
    PENDING_RESET: "app_pending_reset_v1",
    /** Raw chrome.storage.local flag: reopen this options URL after reload. */
    REOPEN_OPTIONS: "app_reopen_options_v1"
  },
  PROVIDER: {
    BASE_URL: "provider-base-url",
    /** Device-local provider credentials; never store this key in sync. */
    SECRETS: "llm_provider_secrets_v1",
    /** Recovery journal for cross-area provider config commits. */
    PERSISTENCE_JOURNAL: "llm_provider_persistence_journal_v1",
    /** Durable tombstone for interrupted provider-data resets. */
    RESET_JOURNAL: "llm_provider_reset_journal_v1",
    SELECTED_MODEL: "provider-selected-model",
    SELECTED_MODEL_REF: "provider-selected-model-ref",
    SELECTION_CONFLICT_MODEL: "provider-selection-conflict-model",
    PROMPT_TEMPLATES: "provider-prompt-templates",
    MODEL_CONFIGS: "provider-model-config",
    // User-set per-model capability overrides, used when a provider cannot
    // report a model's capabilities (anything other than Ollama). Resolution
    // order is: user override → probe result → model metadata → provider default.
    MODEL_CAPABILITY_OVERRIDES: "provider-model-capability-overrides",
    // Empirical capability probe results (one-shot trivial tool-call request),
    // keyed `providerId::model`. Device-local: results are tied to whatever
    // server this device's base URL points at.
    MODEL_CAPABILITY_PROBES: "provider-model-capability-probes"
  },
  THEME: {
    PREFERENCE: "light-dark-theme"
  },
  LANGUAGE: "app-language",
  // One-shot flag: the first-run permissions/privacy intro has been shown.
  ONBOARDING_PERMISSIONS_SEEN: "onboarding-permissions-seen",
  BROWSER: {
    TABS_ACCESS: "browser-tab-access",
    EXCLUDE_URL_PATTERNS: "exclude-url-pattern",
    CONTENT_EXTRACTION_CONFIG: "content-extraction-config",
    PER_SITE_PROFILES: "browser-per-site-profiles",
    PENDING_SELECTION_TEXT: "pending-selection-text",
    PENDING_OMNIBOX_QUERY: "pending-omnibox-query",
    // Max tabs restore_session will reopen in one call. Configurable.
    MAX_RESTORE_SESSIONS: "browser-max-restore-sessions"
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
  WEB_SEARCH: {
    CONFIG: "web-search-config",
    // Per-device "use web search in this chat" toggle. Split from CONFIG so
    // the composer toggle doesn't silently flip the settings-level enable.
    ACTIVE: "web-search-active"
  },
  TOOLS: {
    // E10: per-family governance over model-callable tools (master + families).
    FAMILIES: "tools-families-config",
    // 0.11.18: per-model overrides layered over the global family settings.
    MODEL_OVERRIDES: "tools-model-overrides",
    // 0.12.x approval boundary: persisted "Always allow" grants, keyed
    // `${toolName}::${origin}` ("*" when a tool has no origin). Device-local:
    // an approval to act on this machine should not follow the account.
    APPROVAL_GRANTS: "tools-approval-grants"
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
    MAX_TOOL_RESULT_CHARS: "chat-max-tool-result-chars",
    GROUNDED_ONLY_MODE: "chat-grounded-only-mode",
    AUTO_REFRESH_TAB_CONTEXT: "chat-auto-refresh-tab-context",
    // E1: auto-capture a screenshot on send when a vision model is selected.
    AUTO_SCREENSHOT_ON_VISION: "chat-auto-screenshot-on-vision"
  },
  KNOWLEDGE: {
    ACTIVE_SET: "knowledge-active-set"
  },
  BACKGROUND: {
    SCHEDULED_JOBS: "background-scheduled-jobs",
    REMINDERS: "background-reminders"
  },
  SHORTCUTS: "keyboard-shortcuts"
}
