import { isEmbeddingModel } from "@/features/model/lib/model-utils"
import {
  DEFAULT_CONTENT_EXTRACTION_CONFIG,
  MESSAGE_KEYS,
  STORAGE_KEYS
} from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { isSelectedModelRef } from "@/lib/providers/selected-model"
import { sendRuntimeMessage } from "@/lib/runtime-messages"
import type { ContentExtractionConfig, ProviderModel } from "@/types"

export async function syncSelectionLanguage() {
  const { default: i18n } = await import("@/i18n/config")
  const stored = await plasmoGlobalStorage.get<string>(STORAGE_KEYS.LANGUAGE)
  if (stored && i18n.language !== stored) {
    await i18n.changeLanguage(stored)
  }
}

export async function loadSelectionConfig() {
  const stored = await plasmoGlobalStorage.get<ContentExtractionConfig>(
    STORAGE_KEYS.BROWSER.CONTENT_EXTRACTION_CONFIG
  )
  return { ...DEFAULT_CONTENT_EXTRACTION_CONFIG, ...(stored ?? {}) }
}

export async function loadSelectedPanelModel(currentModel: string): Promise<{
  model: string
  providerId?: string
}> {
  if (currentModel) return { model: currentModel }

  const ref = await plasmoGlobalStorage.get<unknown>(
    STORAGE_KEYS.PROVIDER.SELECTED_MODEL_REF
  )
  const fallback = await plasmoGlobalStorage.get<string>(
    STORAGE_KEYS.PROVIDER.SELECTED_MODEL
  )

  if (isSelectedModelRef(ref)) {
    return { model: ref.modelId, providerId: ref.providerId }
  }

  if (fallback) {
    return { model: fallback }
  }

  return { model: "" }
}

export async function loadAvailablePanelModels(): Promise<ProviderModel[]> {
  const resp = await sendRuntimeMessage(MESSAGE_KEYS.PROVIDER.GET_MODELS)

  if (!resp?.success || !resp.data?.models) {
    return []
  }

  const all = resp.data.models
  return all.filter(
    (m) => !isEmbeddingModel(m.model, m.details?.families ?? [])
  )
}

// The theme preference is written by the zustand persist store through
// @plasmohq/storage, so the raw chrome.storage value is JSON-encoded twice
// and shaped like {"state":{"theme":"dark"},"version":0}. Unwrap defensively;
// a bare legacy "dark"/"light" string is also accepted.
function parseStoredTheme(raw: unknown): string | null {
  let value: unknown = raw
  for (let depth = 0; typeof value === "string" && depth < 2; depth += 1) {
    try {
      value = JSON.parse(value)
    } catch {
      break
    }
  }
  if (typeof value === "string") return value
  if (value && typeof value === "object") {
    const theme = (value as { state?: { theme?: unknown } }).state?.theme
    return typeof theme === "string" ? theme : null
  }
  return null
}

export async function applyStoredTheme(container: HTMLElement) {
  const result = await chrome.storage.sync.get(STORAGE_KEYS.THEME.PREFERENCE)
  const pref =
    parseStoredTheme(result[STORAGE_KEYS.THEME.PREFERENCE]) ?? "system"
  const isDark =
    pref === "dark"
      ? true
      : pref === "light"
        ? false
        : window.matchMedia("(prefers-color-scheme: dark)").matches
  container.classList.toggle("dark", isDark)
}
