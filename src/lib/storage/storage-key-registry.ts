import { STORAGE_KEYS } from "@/lib/constants"

export type StorageSyncScope = "sync-safe" | "device-local"

export interface StorageKeyMetadata {
  key: string
  scope: StorageSyncScope
  reason: string
}

export const STORAGE_KEY_REGISTRY: Record<string, StorageKeyMetadata> = {
  [STORAGE_KEYS.BACKUP.IMPORT_JOURNAL]: {
    key: STORAGE_KEYS.BACKUP.IMPORT_JOURNAL,
    scope: "device-local",
    reason: "Temporary rollback state for portable-settings imports."
  },
  [STORAGE_KEYS.APP_LIFECYCLE.PENDING_RESET]: {
    key: STORAGE_KEYS.APP_LIFECYCLE.PENDING_RESET,
    scope: "device-local",
    reason:
      "One-shot flag for a destructive reset the background runs after reload."
  },
  [STORAGE_KEYS.APP_LIFECYCLE.REOPEN_OPTIONS]: {
    key: STORAGE_KEYS.APP_LIFECYCLE.REOPEN_OPTIONS,
    scope: "device-local",
    reason: "One-shot flag to reopen the options page after a self-reload."
  },
  [STORAGE_KEYS.APP_LIFECYCLE.RESET_FAILURE]: {
    key: STORAGE_KEYS.APP_LIFECYCLE.RESET_FAILURE,
    scope: "device-local",
    reason: "One-shot record of a failed scheduled reset, shown once in UI."
  },
  [STORAGE_KEYS.PROVIDER.SECRETS]: {
    key: STORAGE_KEYS.PROVIDER.SECRETS,
    scope: "device-local",
    reason: "Provider credentials must never sync between browser profiles."
  },
  [STORAGE_KEYS.PROVIDER.PERSISTENCE_JOURNAL]: {
    key: STORAGE_KEYS.PROVIDER.PERSISTENCE_JOURNAL,
    scope: "device-local",
    reason: "Temporary recovery state for cross-area provider config commits."
  },
  [STORAGE_KEYS.PROVIDER.RESET_JOURNAL]: {
    key: STORAGE_KEYS.PROVIDER.RESET_JOURNAL,
    scope: "device-local",
    reason: "Durable recovery state for interrupted provider-data resets."
  },
  [STORAGE_KEYS.PROVIDER.BASE_URL]: {
    key: STORAGE_KEYS.PROVIDER.BASE_URL,
    scope: "sync-safe",
    reason: "User preference for default provider endpoint."
  },
  [STORAGE_KEYS.PROVIDER.SELECTED_MODEL]: {
    key: STORAGE_KEYS.PROVIDER.SELECTED_MODEL,
    scope: "sync-safe",
    reason:
      "Legacy selected model preference; mirrored with selected model ref."
  },
  [STORAGE_KEYS.PROVIDER.SELECTED_MODEL_REF]: {
    key: STORAGE_KEYS.PROVIDER.SELECTED_MODEL_REF,
    scope: "sync-safe",
    reason: "Provider-qualified model preference for routing."
  },
  [STORAGE_KEYS.PROVIDER.SELECTION_CONFLICT_MODEL]: {
    key: STORAGE_KEYS.PROVIDER.SELECTION_CONFLICT_MODEL,
    scope: "sync-safe",
    reason: "User-facing conflict state for ambiguous synced model names."
  },
  [STORAGE_KEYS.PROVIDER.PROMPT_TEMPLATES]: {
    key: STORAGE_KEYS.PROVIDER.PROMPT_TEMPLATES,
    scope: "sync-safe",
    reason: "User-authored prompt templates should follow the user."
  },
  [STORAGE_KEYS.PROVIDER.MODEL_CONFIGS]: {
    key: STORAGE_KEYS.PROVIDER.MODEL_CONFIGS,
    scope: "sync-safe",
    reason: "Model parameter presets are user preferences."
  },
  [STORAGE_KEYS.PROVIDER.MODEL_CAPABILITY_OVERRIDES]: {
    key: STORAGE_KEYS.PROVIDER.MODEL_CAPABILITY_OVERRIDES,
    scope: "sync-safe",
    reason: "User-declared model capabilities should follow the user."
  },
  [STORAGE_KEYS.PROVIDER.MODEL_CAPABILITY_PROBES]: {
    key: STORAGE_KEYS.PROVIDER.MODEL_CAPABILITY_PROBES,
    scope: "device-local",
    reason: "Probe results reflect the server this device's base URL points at."
  },
  [STORAGE_KEYS.TOOLS.APPROVAL_GRANTS]: {
    key: STORAGE_KEYS.TOOLS.APPROVAL_GRANTS,
    scope: "device-local",
    reason:
      "An approval to act on this machine should not follow the account to other devices."
  },
  [STORAGE_KEYS.IMAGES.MAX_SIZE_MB]: {
    key: STORAGE_KEYS.IMAGES.MAX_SIZE_MB,
    scope: "sync-safe",
    reason: "Per-image size cap is a user preference."
  },
  [STORAGE_KEYS.THEME.PREFERENCE]: {
    key: STORAGE_KEYS.THEME.PREFERENCE,
    scope: "sync-safe",
    reason: "UI preference."
  },
  [STORAGE_KEYS.LANGUAGE]: {
    key: STORAGE_KEYS.LANGUAGE,
    scope: "sync-safe",
    reason: "UI preference."
  },
  [STORAGE_KEYS.ONBOARDING_PERMISSIONS_SEEN]: {
    key: STORAGE_KEYS.ONBOARDING_PERMISSIONS_SEEN,
    scope: "device-local",
    reason:
      "One-shot first-run intro flag; optional permissions are per-device, so each browser shows it once."
  },
  [STORAGE_KEYS.BROWSER.TABS_ACCESS]: {
    key: STORAGE_KEYS.BROWSER.TABS_ACCESS,
    scope: "sync-safe",
    reason: "Explicit user preference for browser-tab context access."
  },
  [STORAGE_KEYS.BROWSER.EXCLUDE_URL_PATTERNS]: {
    key: STORAGE_KEYS.BROWSER.EXCLUDE_URL_PATTERNS,
    scope: "sync-safe",
    reason: "Privacy preference for excluded sites."
  },
  [STORAGE_KEYS.BROWSER.CONTENT_EXTRACTION_CONFIG]: {
    key: STORAGE_KEYS.BROWSER.CONTENT_EXTRACTION_CONFIG,
    scope: "sync-safe",
    reason: "Content extraction preferences and site overrides."
  },
  [STORAGE_KEYS.BROWSER.PER_SITE_PROFILES]: {
    key: STORAGE_KEYS.BROWSER.PER_SITE_PROFILES,
    scope: "sync-safe",
    reason:
      "Per-site context rules are user privacy preferences and should follow the user."
  },
  [STORAGE_KEYS.BROWSER.PENDING_SELECTION_TEXT]: {
    key: STORAGE_KEYS.BROWSER.PENDING_SELECTION_TEXT,
    scope: "device-local",
    reason:
      "Ephemeral cross-surface handoff; should not sync to another device."
  },
  [STORAGE_KEYS.BROWSER.PENDING_OMNIBOX_QUERY]: {
    key: STORAGE_KEYS.BROWSER.PENDING_OMNIBOX_QUERY,
    scope: "device-local",
    reason:
      "Ephemeral omnibox-to-chat handoff; should not sync to another device."
  },
  [STORAGE_KEYS.BROWSER.MAX_RESTORE_SESSIONS]: {
    key: STORAGE_KEYS.BROWSER.MAX_RESTORE_SESSIONS,
    scope: "sync-safe",
    reason: "Per-call reopen cap; a user tool-behavior preference."
  },
  [STORAGE_KEYS.TTS.RATE]: {
    key: STORAGE_KEYS.TTS.RATE,
    scope: "sync-safe",
    reason: "Speech preference."
  },
  [STORAGE_KEYS.TTS.PITCH]: {
    key: STORAGE_KEYS.TTS.PITCH,
    scope: "sync-safe",
    reason: "Speech preference."
  },
  [STORAGE_KEYS.TTS.VOICE_URI]: {
    key: STORAGE_KEYS.TTS.VOICE_URI,
    scope: "device-local",
    reason: "Installed voices differ per browser/device."
  },
  [STORAGE_KEYS.TTS.AUTO_PLAY]: {
    key: STORAGE_KEYS.TTS.AUTO_PLAY,
    scope: "sync-safe",
    reason: "Speech preference."
  },
  [STORAGE_KEYS.EMBEDDINGS.SELECTED_MODEL]: {
    key: STORAGE_KEYS.EMBEDDINGS.SELECTED_MODEL,
    scope: "sync-safe",
    reason: "Preferred embedding model name."
  },
  [STORAGE_KEYS.EMBEDDINGS.AUTO_DOWNLOADED]: {
    key: STORAGE_KEYS.EMBEDDINGS.AUTO_DOWNLOADED,
    scope: "device-local",
    reason: "Download completion is tied to local provider/device state."
  },
  [STORAGE_KEYS.EMBEDDINGS.CONFIG]: {
    key: STORAGE_KEYS.EMBEDDINGS.CONFIG,
    scope: "sync-safe",
    reason: "Embedding and retrieval tuning preferences."
  },
  [STORAGE_KEYS.EMBEDDINGS.GLOBAL_AUTO_EMBED]: {
    key: STORAGE_KEYS.EMBEDDINGS.GLOBAL_AUTO_EMBED,
    scope: "sync-safe",
    reason: "User preference for automatic embedding."
  },
  [STORAGE_KEYS.EMBEDDINGS.KEYWORD_INDEX_BUILT]: {
    key: STORAGE_KEYS.EMBEDDINGS.KEYWORD_INDEX_BUILT,
    scope: "device-local",
    reason: "Derived local index state."
  },
  [STORAGE_KEYS.EMBEDDINGS.AUTO_EMBED_CHAT]: {
    key: STORAGE_KEYS.EMBEDDINGS.AUTO_EMBED_CHAT,
    scope: "sync-safe",
    reason: "User preference for chat memory indexing."
  },
  [STORAGE_KEYS.EMBEDDINGS.USE_RAG]: {
    key: STORAGE_KEYS.EMBEDDINGS.USE_RAG,
    scope: "sync-safe",
    reason: "User preference for RAG use."
  },
  [STORAGE_KEYS.FILE_UPLOAD.CONFIG]: {
    key: STORAGE_KEYS.FILE_UPLOAD.CONFIG,
    scope: "sync-safe",
    reason: "File upload limits and auto-embedding preferences."
  },
  [STORAGE_KEYS.MEMORY.ENABLED]: {
    key: STORAGE_KEYS.MEMORY.ENABLED,
    scope: "sync-safe",
    reason: "User preference for chat memory."
  },
  [STORAGE_KEYS.CHAT.SHOW_SESSION_METRICS]: {
    key: STORAGE_KEYS.CHAT.SHOW_SESSION_METRICS,
    scope: "sync-safe",
    reason: "UI preference."
  },
  [STORAGE_KEYS.CHAT.MAX_TAB_CONTEXT_CHARS]: {
    key: STORAGE_KEYS.CHAT.MAX_TAB_CONTEXT_CHARS,
    scope: "sync-safe",
    reason: "Prompt-budget preference."
  },
  [STORAGE_KEYS.CHAT.MAX_RAG_CONTEXT_CHARS]: {
    key: STORAGE_KEYS.CHAT.MAX_RAG_CONTEXT_CHARS,
    scope: "sync-safe",
    reason: "Prompt-budget preference."
  },
  [STORAGE_KEYS.CHAT.MAX_TOOL_RESULT_CHARS]: {
    key: STORAGE_KEYS.CHAT.MAX_TOOL_RESULT_CHARS,
    scope: "sync-safe",
    reason: "Per tool-result size cap; a user prompt-budget preference."
  },
  [STORAGE_KEYS.CHAT.GROUNDED_ONLY_MODE]: {
    key: STORAGE_KEYS.CHAT.GROUNDED_ONLY_MODE,
    scope: "sync-safe",
    reason: "Answering-mode preference."
  },
  [STORAGE_KEYS.CHAT.AUTO_REFRESH_TAB_CONTEXT]: {
    key: STORAGE_KEYS.CHAT.AUTO_REFRESH_TAB_CONTEXT,
    scope: "sync-safe",
    reason: "Tab-context refresh preference."
  },
  [STORAGE_KEYS.CHAT.AUTO_SCREENSHOT_ON_VISION]: {
    key: STORAGE_KEYS.CHAT.AUTO_SCREENSHOT_ON_VISION,
    scope: "sync-safe",
    reason: "Auto-screenshot-on-vision preference."
  },
  [STORAGE_KEYS.WEB_SEARCH.CONFIG]: {
    key: STORAGE_KEYS.WEB_SEARCH.CONFIG,
    scope: "device-local",
    reason:
      "Web-search API keys and self-hosted endpoints are device-local secrets."
  },
  [STORAGE_KEYS.WEB_SEARCH.ACTIVE]: {
    key: STORAGE_KEYS.WEB_SEARCH.ACTIVE,
    scope: "device-local",
    reason:
      "Per-device chat toggle for web search; backend config stays in web-search-config."
  },
  [STORAGE_KEYS.TOOLS.FAMILIES]: {
    key: STORAGE_KEYS.TOOLS.FAMILIES,
    scope: "sync-safe",
    reason:
      "Which model-tool families are enabled is a portable preference, not a device secret."
  },
  [STORAGE_KEYS.TOOLS.MODEL_OVERRIDES]: {
    key: STORAGE_KEYS.TOOLS.MODEL_OVERRIDES,
    scope: "sync-safe",
    reason:
      "Per-model tool-family overrides are portable preferences keyed by provider+model."
  },
  [STORAGE_KEYS.KNOWLEDGE.ACTIVE_SET]: {
    key: STORAGE_KEYS.KNOWLEDGE.ACTIVE_SET,
    scope: "sync-safe",
    reason: "Active knowledge-set preference."
  },
  [STORAGE_KEYS.BACKGROUND.SCHEDULED_JOBS]: {
    key: STORAGE_KEYS.BACKGROUND.SCHEDULED_JOBS,
    scope: "device-local",
    reason:
      "Alarm state and recurring local jobs are tied to this browser profile."
  },
  [STORAGE_KEYS.BACKGROUND.REMINDERS]: {
    key: STORAGE_KEYS.BACKGROUND.REMINDERS,
    scope: "device-local",
    reason: "Pending one-off reminder alarms are tied to this browser profile."
  },
  [STORAGE_KEYS.SHORTCUTS]: {
    key: STORAGE_KEYS.SHORTCUTS,
    scope: "sync-safe",
    reason: "Keyboard shortcut preferences."
  }
}

export const getStorageKeyMetadata = (
  key: string
): StorageKeyMetadata | undefined => STORAGE_KEY_REGISTRY[key]
