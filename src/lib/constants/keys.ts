/**
 * Runtime messages the background still accepts.
 *
 * Provider request/response work now goes through the typed RPC boundary
 * (`src/protocol/`), so what remains here is streaming ports, one-way events,
 * and the single content-script-reachable read (`GET_MODELS`). Do not add a
 * new request/response key — add an `RpcMethod` instead.
 */
export const PROVIDER_MESSAGE_KEYS = {
  GET_MODELS: "get-provider-models",
  CHAT_WITH_MODEL: "chat-with-model",
  START_TURN: "start-turn",
  BUILD_CONTEXT: "build-context",
  STREAM_RESPONSE: "provider-stream-response",
  RECONNECT_STREAM: "stream-reconnect",
  STOP_GENERATION: "stop-generation",
  START_SELECTION_ACTION: "start-selection-action",
  CANCEL_SELECTION_ACTION: "cancel-selection-action",
  CONFIRM_TOOL: "confirm-tool"
} as const

/**
 * Legacy Ollama-named message keys.
 *
 * Only the chat stream port name remains. Every legacy request/response twin
 * and the port-owned model pull were retired
 * with the RPC migration: a page old enough to send one is a page whose
 * extension context the browser already invalidated during the upgrade, so the
 * duplicate string bought compatibility with nothing while giving each action
 * two ways to behave differently.
 */
export const LEGACY_OLLAMA_MESSAGE_KEYS = {
  STREAM_RESPONSE: "ollama-stream-response"
} as const

export const MESSAGE_KEYS = {
  PROVIDER: PROVIDER_MESSAGE_KEYS,
  OLLAMA: LEGACY_OLLAMA_MESSAGE_KEYS,
  BROWSER: {
    OPEN_TAB: "open-tab",
    GET_PAGE_CONTENT: "get-page-content",
    ADD_SELECTION_TO_CHAT: "add-selection-to-chat",
    LOAD_SELECTION_OVERLAY: "load-selection-overlay",
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
    // Counterpart: reopen the handles once the import attempt is over, so a
    // sidepanel that never reloads (partial import failure) keeps working.
    REOPEN_DEXIE: "app-reopen-dexie",
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
  PERSISTENCE: {
    /**
     * Raw chrome.storage.local marker: which chat-history backend this
     * profile runs on ("legacy" IndexedDB blob vs "opfs" single owner). Flips
     * exactly once, after the migration verifies row counts.
     */
    BACKEND: "persistence_backend_v1",
    /**
     * Raw chrome.storage.local record of the last chat-history migration
     * attempt: source schema version, per-table counts, integrity results,
     * and outcome. Written on success and on failure, so a profile that never
     * migrated can say why.
     */
    MIGRATION_RECEIPT: "persistence_migration_receipt_v1",
    /**
     * Raw chrome.storage.local operator switch: pin this device to the
     * retained legacy IndexedDB blob regardless of the backend marker. Recovery
     * path for a migration that verified but produced wrong data.
     */
    LEGACY_OVERRIDE: "persistence_legacy_override_v1"
  },
  APP_LIFECYCLE: {
    /**
     * Raw chrome.storage.local flag: a destructive reset the background
     * executes on next worker boot, after runtime.reload() has closed every
     * page that could hold a database handle.
     */
    PENDING_RESET: "app_pending_reset_v1",
    /** Raw chrome.storage.local flag: reopen this options URL after reload. */
    REOPEN_OPTIONS: "app_reopen_options_v1",
    /** Raw chrome.storage.local record of the last failed scheduled reset. */
    RESET_FAILURE: "app_reset_failure_v1"
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
    MODEL_CAPABILITY_PROBES: "provider-model-capability-probes",
    // Whether each provider publishes a model catalog, learned from the first
    // request and fingerprinted by base URL. Keeps discovery from asking a
    // chat-only endpoint for a model list it will never have.
    MODEL_CATALOG_SUPPORT: "provider-model-catalog-support",
    // Whether an unrecognized remote provider may be asked for its favicon, so
    // it shows its own icon instead of a generic glyph.
    FAVICON_LOOKUP: "provider-favicon-lookup",
    // Favicons already fetched, as data URIs, keyed by provider id and
    // fingerprinted by base URL. Device-local: the base URL points at a
    // different server per device.
    FAVICON_CACHE: "provider-favicon-cache",
    // How often, in milliseconds, an open surface re-asks its providers for
    // their model catalogs. 0 turns the poll off.
    CATALOG_REFRESH_MS: "provider-catalog-refresh-ms"
  },
  THEME: {
    PREFERENCE: "light-dark-theme"
  },
  UI: {
    SETTINGS_LEVEL: "settings-disclosure-level"
  },
  LANGUAGE: "app-language",
  ONBOARDING: {
    /** Device-local resumable onboarding state. */
    STATE: "onboarding-state-v2"
  },
  DIAGNOSTICS: {
    /** Device-local, content-free diagnostic ring buffer. */
    EVENTS: "diagnostic-events-v1"
  },
  // Legacy one-shot flag. Read only while migrating onboarding state v2.
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
  EXPORT: {
    // 0.12.x security cleanup: opt-in to loading remote http(s) images in
    // print/PDF export. Off by default — exporting a chat must not fire
    // requests to third-party servers embedded in message content.
    ALLOW_REMOTE_IMAGES: "export-allow-remote-images"
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
