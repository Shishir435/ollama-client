import { isEmbeddingModel } from "@/features/model/lib/model-utils"
import {
  DEFAULT_CONTENT_EXTRACTION_CONFIG,
  MESSAGE_KEYS,
  STORAGE_KEYS
} from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { isSelectedModelRef } from "@/lib/providers/selected-model"
import type {
  ChromeResponse,
  ContentExtractionConfig,
  ProviderModel
} from "@/types"

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
  const resp = (await chrome.runtime.sendMessage({
    type: MESSAGE_KEYS.PROVIDER.GET_MODELS
  })) as ChromeResponse

  if (!resp?.success || !resp.data || !("models" in (resp.data as object))) {
    return []
  }

  const all = (resp.data as { models: ProviderModel[] }).models
  return all.filter(
    (m) => !isEmbeddingModel(m.model, m.details?.families ?? [])
  )
}

export async function applyStoredTheme(container: HTMLElement) {
  const result = await chrome.storage.sync.get(STORAGE_KEYS.THEME.PREFERENCE)
  const pref =
    (result[STORAGE_KEYS.THEME.PREFERENCE] as string | undefined) ?? "system"
  const isDark =
    pref === "dark"
      ? true
      : pref === "light"
        ? false
        : window.matchMedia("(prefers-color-scheme: dark)").matches
  container.classList.toggle("dark", isDark)
}
