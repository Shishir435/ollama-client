/**
 * Centralized section defaults.
 *
 * Presets (item 11) and per-card reset (item 12) both need "the default values
 * for this settings section, keyed by where they're stored." Those defaults
 * already exist as `DEFAULT_*` objects scattered across `defaults.ts` /
 * `config.ts`; this module re-exposes them grouped by settings section so the
 * later features import one manifest instead of re-hardcoding literals.
 *
 * IMPORTANT: every value here is *referenced* from an existing `DEFAULT_*`
 * source, never copied. A copied literal could silently diverge from the value
 * the control actually falls back to. The accompanying test asserts this.
 *
 * Storage model: some controls write a scalar storage key directly
 * (`chat-max-tab-context-chars`); others write one field inside a larger config
 * object stored under a single key (`embeddings-config.chunkSize`). A
 * `SectionDefault` captures both: `field` is the property name inside a config
 * object, or omitted for a scalar key. Reset/preset code groups by `storageKey`,
 * reads the current object, patches the listed `field`s, and writes back.
 */

import {
  DEFAULT_AUTO_REFRESH_TAB_CONTEXT,
  DEFAULT_CONTENT_EXTRACTION_CONFIG,
  DEFAULT_EMBEDDING_CONFIG,
  DEFAULT_FILE_UPLOAD_CONFIG,
  DEFAULT_GROUNDED_ONLY_MODE,
  DEFAULT_MAX_IMAGE_SIZE_MB,
  DEFAULT_MAX_RAG_CONTEXT_CHARS,
  DEFAULT_MAX_TAB_CONTEXT_CHARS,
  DEFAULT_MAX_TOOL_RESULT_CHARS,
  STORAGE_KEYS
} from "@/lib/constants"

export interface SectionDefault {
  /** The `@plasmohq/storage` key the control writes. */
  storageKey: string
  /** Property name inside a config-object key; omit for a scalar key. */
  field?: string
  /** Default value, sourced from an existing `DEFAULT_*` object. */
  value: unknown
}

const { CHAT, EMBEDDINGS, FILE_UPLOAD, IMAGES, BROWSER } = STORAGE_KEYS

/**
 * sectionId → defaults. sectionIds match the `sectionId` field used in the
 * settings registry so a section's registry entries and its defaults line up.
 */
export const SECTION_DEFAULTS: Record<string, SectionDefault[]> = {
  "prompt-budget": [
    {
      storageKey: CHAT.MAX_TAB_CONTEXT_CHARS,
      value: DEFAULT_MAX_TAB_CONTEXT_CHARS
    },
    {
      storageKey: CHAT.MAX_RAG_CONTEXT_CHARS,
      value: DEFAULT_MAX_RAG_CONTEXT_CHARS
    },
    {
      storageKey: CHAT.MAX_TOOL_RESULT_CHARS,
      value: DEFAULT_MAX_TOOL_RESULT_CHARS
    },
    {
      storageKey: CHAT.AUTO_REFRESH_TAB_CONTEXT,
      value: DEFAULT_AUTO_REFRESH_TAB_CONTEXT
    }
  ],
  grounding: [
    { storageKey: CHAT.GROUNDED_ONLY_MODE, value: DEFAULT_GROUNDED_ONLY_MODE }
  ],
  retrieval: [
    {
      storageKey: EMBEDDINGS.CONFIG,
      field: "useReranking",
      value: DEFAULT_EMBEDDING_CONFIG.useReranking
    },
    {
      storageKey: EMBEDDINGS.CONFIG,
      field: "defaultSearchLimit",
      value: DEFAULT_EMBEDDING_CONFIG.defaultSearchLimit
    },
    {
      storageKey: EMBEDDINGS.CONFIG,
      field: "minRerankScore",
      value: DEFAULT_EMBEDDING_CONFIG.minRerankScore
    }
  ],
  files: [
    {
      storageKey: FILE_UPLOAD.CONFIG,
      field: "maxFileSize",
      value: DEFAULT_FILE_UPLOAD_CONFIG.maxFileSize
    },
    { storageKey: IMAGES.MAX_SIZE_MB, value: DEFAULT_MAX_IMAGE_SIZE_MB }
  ],
  chunking: [
    {
      storageKey: EMBEDDINGS.CONFIG,
      field: "chunkSize",
      value: DEFAULT_EMBEDDING_CONFIG.chunkSize
    },
    {
      storageKey: EMBEDDINGS.CONFIG,
      field: "chunkOverlap",
      value: DEFAULT_EMBEDDING_CONFIG.chunkOverlap
    },
    {
      storageKey: EMBEDDINGS.CONFIG,
      field: "chunkingStrategy",
      value: DEFAULT_EMBEDDING_CONFIG.chunkingStrategy
    }
  ],
  "embedding-limits": [
    {
      storageKey: EMBEDDINGS.CONFIG,
      field: "maxEmbeddingsPerFile",
      value: DEFAULT_EMBEDDING_CONFIG.maxEmbeddingsPerFile
    },
    {
      storageKey: EMBEDDINGS.CONFIG,
      field: "maxStorageSize",
      value: DEFAULT_EMBEDDING_CONFIG.maxStorageSize
    },
    {
      storageKey: EMBEDDINGS.CONFIG,
      field: "autoCleanup",
      value: DEFAULT_EMBEDDING_CONFIG.autoCleanup
    },
    {
      storageKey: EMBEDDINGS.CONFIG,
      field: "cleanupDaysOld",
      value: DEFAULT_EMBEDDING_CONFIG.cleanupDaysOld
    }
  ],
  "content-extraction": [
    {
      storageKey: BROWSER.CONTENT_EXTRACTION_CONFIG,
      field: "enabled",
      value: DEFAULT_CONTENT_EXTRACTION_CONFIG.enabled
    },
    {
      storageKey: BROWSER.CONTENT_EXTRACTION_CONFIG,
      field: "contentScraper",
      value: DEFAULT_CONTENT_EXTRACTION_CONFIG.contentScraper
    },
    {
      storageKey: BROWSER.CONTENT_EXTRACTION_CONFIG,
      field: "scrollStrategy",
      value: DEFAULT_CONTENT_EXTRACTION_CONFIG.scrollStrategy
    },
    {
      storageKey: BROWSER.CONTENT_EXTRACTION_CONFIG,
      field: "scrollDepth",
      value: DEFAULT_CONTENT_EXTRACTION_CONFIG.scrollDepth
    },
    {
      storageKey: BROWSER.CONTENT_EXTRACTION_CONFIG,
      field: "selectionActionsEnabled",
      value: DEFAULT_CONTENT_EXTRACTION_CONFIG.selectionActionsEnabled
    },
    {
      storageKey: BROWSER.CONTENT_EXTRACTION_CONFIG,
      field: "selectionActionsMinChars",
      value: DEFAULT_CONTENT_EXTRACTION_CONFIG.selectionActionsMinChars
    }
  ],
  "content-extraction-timeouts": [
    {
      storageKey: BROWSER.CONTENT_EXTRACTION_CONFIG,
      field: "scrollDelay",
      value: DEFAULT_CONTENT_EXTRACTION_CONFIG.scrollDelay
    },
    {
      storageKey: BROWSER.CONTENT_EXTRACTION_CONFIG,
      field: "mutationObserverTimeout",
      value: DEFAULT_CONTENT_EXTRACTION_CONFIG.mutationObserverTimeout
    },
    {
      storageKey: BROWSER.CONTENT_EXTRACTION_CONFIG,
      field: "networkIdleTimeout",
      value: DEFAULT_CONTENT_EXTRACTION_CONFIG.networkIdleTimeout
    },
    {
      storageKey: BROWSER.CONTENT_EXTRACTION_CONFIG,
      field: "maxWaitTime",
      value: DEFAULT_CONTENT_EXTRACTION_CONFIG.maxWaitTime
    }
  ]
}

/**
 * Defaults for a settings section, keyed by the storage keys its controls
 * write. Returns `[]` for an unknown section.
 */
export const getSectionDefaults = (sectionId: string): SectionDefault[] =>
  SECTION_DEFAULTS[sectionId] ?? []

/** All sectionIds that have centralized defaults. */
export const getDefaultedSectionIds = (): string[] =>
  Object.keys(SECTION_DEFAULTS)
