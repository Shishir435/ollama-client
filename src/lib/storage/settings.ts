import { z } from "zod"
import {
  DEFAULT_AUTO_REFRESH_TAB_CONTEXT,
  DEFAULT_CONTENT_EXTRACTION_CONFIG,
  DEFAULT_EMBEDDING_CONFIG,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_EXCLUDE_URLS,
  DEFAULT_FILE_UPLOAD_CONFIG,
  DEFAULT_GROUNDED_ONLY_MODE,
  DEFAULT_MAX_IMAGE_SIZE_MB,
  DEFAULT_MAX_RAG_CONTEXT_CHARS,
  DEFAULT_MAX_RESTORE_SESSIONS,
  DEFAULT_MAX_TAB_CONTEXT_CHARS,
  DEFAULT_MAX_TOOL_RESULT_CHARS,
  DEFAULT_MEMORY_ENABLED,
  DEFAULT_PROVIDER_CATALOG_REFRESH_MS,
  DEFAULT_TABS_ACCESS,
  type EmbeddingConfig,
  MAX_MAX_RESTORE_SESSIONS,
  MIN_MAX_RESTORE_SESSIONS,
  STORAGE_KEYS
} from "@/lib/constants"
import {
  ModelConfigMapSchema,
  type StoredModelConfigMap
} from "@/lib/model-config-utils"
import {
  DEFAULT_PER_SITE_PROFILE_SETTINGS,
  type PerSiteProfileSettings,
  PerSiteProfileSettingsSchema
} from "@/lib/per-site-profile-settings"
import {
  DEFAULT_WEB_SEARCH_CONFIG,
  type WebSearchProviderConfig,
  WebSearchProviderConfigSchema
} from "@/lib/tools/web-search"
import type {
  ContentExtractionConfig,
  FileUploadConfig,
  SelectedModelRef
} from "@/types"
import { defineSetting } from "./setting-descriptor"
import {
  ContentExtractionConfigSchema,
  EmbeddingConfigSchema,
  FileUploadConfigSchema,
  SelectedModelRefSchema
} from "./setting-schemas"

export const SETTINGS = {
  AGENT_REMOTE_OBSERVATION_ACKNOWLEDGED: defineSetting<boolean>(
    STORAGE_KEYS.AGENT.REMOTE_OBSERVATION_ACKNOWLEDGED,
    { defaultValue: false, parser: z.boolean() }
  ),
  LANGUAGE: defineSetting<string>(STORAGE_KEYS.LANGUAGE, {
    defaultValue: "en"
  }),
  SELECTED_MODEL: defineSetting<string>(STORAGE_KEYS.PROVIDER.SELECTED_MODEL, {
    defaultValue: ""
  }),
  SELECTED_MODEL_REF: defineSetting<SelectedModelRef | null>(
    STORAGE_KEYS.PROVIDER.SELECTED_MODEL_REF,
    { defaultValue: null, parser: SelectedModelRefSchema }
  ),
  SELECTION_CONFLICT_MODEL: defineSetting<string | null>(
    STORAGE_KEYS.PROVIDER.SELECTION_CONFLICT_MODEL,
    { defaultValue: null }
  ),
  MODEL_CONFIGS: defineSetting<StoredModelConfigMap>(
    STORAGE_KEYS.PROVIDER.MODEL_CONFIGS,
    { defaultValue: {}, parser: ModelConfigMapSchema }
  ),
  PROVIDER_FAVICON_LOOKUP: defineSetting<boolean>(
    STORAGE_KEYS.PROVIDER.FAVICON_LOOKUP,
    { defaultValue: true }
  ),
  PROVIDER_CATALOG_REFRESH_MS: defineSetting<number>(
    STORAGE_KEYS.PROVIDER.CATALOG_REFRESH_MS,
    { defaultValue: DEFAULT_PROVIDER_CATALOG_REFRESH_MS }
  ),
  TABS_ACCESS: defineSetting<boolean>(STORAGE_KEYS.BROWSER.TABS_ACCESS, {
    defaultValue: DEFAULT_TABS_ACCESS,
    parser: z.boolean()
  }),
  CONTENT_EXTRACTION_CONFIG: defineSetting<ContentExtractionConfig>(
    STORAGE_KEYS.BROWSER.CONTENT_EXTRACTION_CONFIG,
    {
      defaultValue: DEFAULT_CONTENT_EXTRACTION_CONFIG,
      parser: ContentExtractionConfigSchema
    }
  ),
  EXCLUDE_URL_PATTERNS: defineSetting<string[]>(
    STORAGE_KEYS.BROWSER.EXCLUDE_URL_PATTERNS,
    { defaultValue: DEFAULT_EXCLUDE_URLS }
  ),
  PER_SITE_PROFILES: defineSetting<PerSiteProfileSettings>(
    STORAGE_KEYS.BROWSER.PER_SITE_PROFILES,
    {
      defaultValue: DEFAULT_PER_SITE_PROFILE_SETTINGS,
      parser: PerSiteProfileSettingsSchema
    }
  ),
  MAX_RESTORE_SESSIONS: defineSetting<number>(
    STORAGE_KEYS.BROWSER.MAX_RESTORE_SESSIONS,
    {
      defaultValue: DEFAULT_MAX_RESTORE_SESSIONS,
      parser: z
        .number()
        .finite()
        .transform((value) =>
          Math.max(
            MIN_MAX_RESTORE_SESSIONS,
            Math.min(MAX_MAX_RESTORE_SESSIONS, Math.floor(value))
          )
        )
    }
  ),
  EMBEDDING_SELECTED_MODEL: defineSetting<string>(
    STORAGE_KEYS.EMBEDDINGS.SELECTED_MODEL,
    { defaultValue: DEFAULT_EMBEDDING_MODEL }
  ),
  EMBEDDING_CONFIG: defineSetting<EmbeddingConfig>(
    STORAGE_KEYS.EMBEDDINGS.CONFIG,
    { defaultValue: DEFAULT_EMBEDDING_CONFIG, parser: EmbeddingConfigSchema }
  ),
  USE_RAG: defineSetting<boolean>(STORAGE_KEYS.EMBEDDINGS.USE_RAG, {
    defaultValue: true,
    parser: z.boolean()
  }),
  MEMORY_ENABLED: defineSetting<boolean>(STORAGE_KEYS.MEMORY.ENABLED, {
    defaultValue: DEFAULT_MEMORY_ENABLED,
    parser: z.boolean()
  }),
  FILE_UPLOAD_CONFIG: defineSetting<FileUploadConfig>(
    STORAGE_KEYS.FILE_UPLOAD.CONFIG,
    { defaultValue: DEFAULT_FILE_UPLOAD_CONFIG, parser: FileUploadConfigSchema }
  ),
  MAX_IMAGE_SIZE_MB: defineSetting<number>(STORAGE_KEYS.IMAGES.MAX_SIZE_MB, {
    defaultValue: DEFAULT_MAX_IMAGE_SIZE_MB
  }),
  SHOW_SESSION_METRICS: defineSetting<boolean>(
    STORAGE_KEYS.CHAT.SHOW_SESSION_METRICS,
    { defaultValue: true }
  ),
  MAX_TAB_CONTEXT_CHARS: defineSetting<number>(
    STORAGE_KEYS.CHAT.MAX_TAB_CONTEXT_CHARS,
    { defaultValue: DEFAULT_MAX_TAB_CONTEXT_CHARS }
  ),
  MAX_RAG_CONTEXT_CHARS: defineSetting<number>(
    STORAGE_KEYS.CHAT.MAX_RAG_CONTEXT_CHARS,
    { defaultValue: DEFAULT_MAX_RAG_CONTEXT_CHARS }
  ),
  MAX_TOOL_RESULT_CHARS: defineSetting<number>(
    STORAGE_KEYS.CHAT.MAX_TOOL_RESULT_CHARS,
    { defaultValue: DEFAULT_MAX_TOOL_RESULT_CHARS }
  ),
  GROUNDED_ONLY_MODE: defineSetting<boolean>(
    STORAGE_KEYS.CHAT.GROUNDED_ONLY_MODE,
    { defaultValue: DEFAULT_GROUNDED_ONLY_MODE }
  ),
  AUTO_REFRESH_TAB_CONTEXT: defineSetting<boolean>(
    STORAGE_KEYS.CHAT.AUTO_REFRESH_TAB_CONTEXT,
    { defaultValue: DEFAULT_AUTO_REFRESH_TAB_CONTEXT }
  ),
  AUTO_SCREENSHOT_ON_VISION: defineSetting<boolean>(
    STORAGE_KEYS.CHAT.AUTO_SCREENSHOT_ON_VISION,
    { defaultValue: false }
  ),
  EXPORT_ALLOW_REMOTE_IMAGES: defineSetting<boolean>(
    STORAGE_KEYS.EXPORT.ALLOW_REMOTE_IMAGES,
    { defaultValue: false }
  ),
  TTS_RATE: defineSetting<number>(STORAGE_KEYS.TTS.RATE, { defaultValue: 1 }),
  TTS_PITCH: defineSetting<number>(STORAGE_KEYS.TTS.PITCH, {
    defaultValue: 1
  }),
  TTS_VOICE_URI: defineSetting<string>(STORAGE_KEYS.TTS.VOICE_URI, {
    defaultValue: ""
  }),
  SETTINGS_LEVEL: defineSetting<"basic" | "power" | "advanced">(
    STORAGE_KEYS.UI.SETTINGS_LEVEL,
    {
      defaultValue: "basic",
      parser: z.enum(["basic", "power", "advanced"])
    }
  ),
  WEB_SEARCH_ACTIVE: defineSetting<boolean>(STORAGE_KEYS.WEB_SEARCH.ACTIVE, {
    defaultValue: true,
    parser: z.boolean()
  }),
  WEB_SEARCH_CONFIG: defineSetting<WebSearchProviderConfig>(
    STORAGE_KEYS.WEB_SEARCH.CONFIG,
    {
      defaultValue: DEFAULT_WEB_SEARCH_CONFIG,
      parser: WebSearchProviderConfigSchema
    }
  )
}
