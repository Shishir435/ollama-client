import {
  DEFAULT_CONTENT_EXTRACTION_CONFIG,
  STORAGE_KEYS
} from "@/lib/constants"
import type { ContentExtractionConfig, SelectedModelRef } from "@/types"
import { defineSetting } from "./setting-descriptor"

const failed = { success: false as const }
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

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

const SelectionConfigParser = {
  safeParse: (value: unknown) => {
    if (!isRecord(value)) return failed
    const enabled = value.selectionActionsEnabled
    const minChars = value.selectionActionsMinChars
    const enabledIds = value.selectionActionsEnabledIds
    if (
      (enabled !== undefined && typeof enabled !== "boolean") ||
      (minChars !== undefined &&
        (!Number.isInteger(minChars) || (minChars as number) < 0)) ||
      (enabledIds !== undefined &&
        (!Array.isArray(enabledIds) ||
          !enabledIds.every((item) => typeof item === "string")))
    ) {
      return failed
    }
    return {
      success: true as const,
      data: {
        ...DEFAULT_CONTENT_EXTRACTION_CONFIG,
        ...(enabled === undefined ? {} : { selectionActionsEnabled: enabled }),
        ...(minChars === undefined
          ? {}
          : { selectionActionsMinChars: minChars }),
        ...(enabledIds === undefined
          ? {}
          : { selectionActionsEnabledIds: enabledIds })
      } as ContentExtractionConfig
    }
  }
}

export const SELECTION_ACTION_SETTINGS = {
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
      parser: SelectionConfigParser
    }
  )
}
