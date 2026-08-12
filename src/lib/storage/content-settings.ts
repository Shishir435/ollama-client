import {
  DEFAULT_CONTENT_EXTRACTION_CONFIG,
  STORAGE_KEYS
} from "@/lib/constants"
import type { ContentExtractionConfig, SelectedModelRef } from "@/types"
import { defineSetting } from "./setting-descriptor"

const failed = { success: false as const }
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
const finite = (value: unknown): value is number =>
  Number.isFinite(value as number)
const nonNegative = (value: unknown): value is number =>
  finite(value) && value >= 0

const BOOLEAN_FIELDS = [
  "enabled",
  "showSelectionButton",
  "selectionActionsEnabled"
] as const
const NON_NEGATIVE_FIELDS = [
  "scrollDelay",
  "mutationObserverTimeout",
  "networkIdleTimeout",
  "maxWaitTime"
] as const
const SCRAPERS: unknown[] = ["auto", "defuddle", "readability"]
const SCROLL_STRATEGIES: unknown[] = ["none", "gradual", "instant", "smart"]

const parseExtractionOverride = (
  value: Record<string, unknown>
): Record<string, unknown> | undefined => {
  const parsed: Record<string, unknown> = {}
  for (const [key, field] of Object.entries(value)) {
    let valid: boolean
    if (BOOLEAN_FIELDS.includes(key as (typeof BOOLEAN_FIELDS)[number])) {
      valid = typeof field === "boolean"
    } else if (
      NON_NEGATIVE_FIELDS.includes(key as (typeof NON_NEGATIVE_FIELDS)[number])
    ) {
      valid = nonNegative(field)
    } else if (key === "selectionActionsMinChars") {
      valid = nonNegative(field) && Number.isInteger(field)
    } else if (
      key === "selectionActionsEnabledIds" ||
      key === "excludedUrlPatterns"
    ) {
      valid =
        Array.isArray(field) && field.every((item) => typeof item === "string")
    } else if (key === "contentScraper") {
      valid = SCRAPERS.includes(field)
    } else if (key === "scrollStrategy") {
      valid = SCROLL_STRATEGIES.includes(field)
    } else if (key === "scrollDepth") {
      valid = finite(field) && field >= 0 && field <= 1
    } else continue
    if (!valid) return undefined
    parsed[key] = field
  }
  return parsed
}

const ContentExtractionParser = {
  safeParse: (value: unknown) => {
    if (!isRecord(value)) return failed
    const stored = parseExtractionOverride(value)
    if (!stored) return failed
    let siteOverrides = DEFAULT_CONTENT_EXTRACTION_CONFIG.siteOverrides
    if ("siteOverrides" in value) {
      if (!isRecord(value.siteOverrides)) return failed
      const parsedOverrides: Record<string, Record<string, unknown>> = {}
      for (const [pattern, override] of Object.entries(value.siteOverrides)) {
        if (!isRecord(override)) return failed
        const parsed = parseExtractionOverride(override)
        if (!parsed) return failed
        parsedOverrides[pattern] = parsed
      }
      siteOverrides = parsedOverrides
    }
    return {
      success: true as const,
      data: {
        ...DEFAULT_CONTENT_EXTRACTION_CONFIG,
        ...stored,
        siteOverrides
      } as ContentExtractionConfig
    }
  }
}

const SelectedModelRefParser = {
  safeParse: (value: unknown) => {
    if (value === null) return { success: true as const, data: null }
    if (
      !isRecord(value) ||
      typeof value.providerId !== "string" ||
      !value.providerId ||
      typeof value.modelId !== "string" ||
      !value.modelId
    ) {
      return failed
    }
    return {
      success: true as const,
      data: { providerId: value.providerId, modelId: value.modelId }
    }
  }
}

/** Lightweight descriptors shared by content scripts and extension pages. */
export const CONTENT_SETTINGS = {
  LANGUAGE: defineSetting<string>(STORAGE_KEYS.LANGUAGE, {
    defaultValue: "en"
  }),
  SELECTED_MODEL: defineSetting<string>(STORAGE_KEYS.PROVIDER.SELECTED_MODEL, {
    defaultValue: ""
  }),
  SELECTED_MODEL_REF: defineSetting<SelectedModelRef | null>(
    STORAGE_KEYS.PROVIDER.SELECTED_MODEL_REF,
    { defaultValue: null, parser: SelectedModelRefParser }
  ),
  CONTENT_EXTRACTION_CONFIG: defineSetting<ContentExtractionConfig>(
    STORAGE_KEYS.BROWSER.CONTENT_EXTRACTION_CONFIG,
    {
      defaultValue: DEFAULT_CONTENT_EXTRACTION_CONFIG,
      parser: ContentExtractionParser
    }
  )
}
