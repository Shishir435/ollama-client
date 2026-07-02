import { STORAGE_KEYS } from "@/lib/constants"
import {
  getPlasmoStoredValue,
  setPlasmoStoredValue
} from "@/lib/plasmo-global-storage"
import type { WebSearchProviderConfig } from "./types"

export const DEFAULT_SEARXNG_ENDPOINT = "http://localhost:8080"
export const BRAVE_SEARCH_ENDPOINT =
  "https://api.search.brave.com/res/v1/web/search"
export const TAVILY_SEARCH_ENDPOINT = "https://api.tavily.com/search"

export const DEFAULT_WEB_SEARCH_CONFIG: WebSearchProviderConfig = {
  provider: "searxng",
  endpoint: DEFAULT_SEARXNG_ENDPOINT,
  enabled: false,
  count: 5,
  searxngPages: 1,
  safeSearch: "moderate"
}

const clamp = (value: unknown, min: number, max: number, fallback: number) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.floor(value), min), max)
}

export const normalizeWebSearchConfig = (
  config?: Partial<WebSearchProviderConfig> | null
): WebSearchProviderConfig => {
  const normalized = {
    ...DEFAULT_WEB_SEARCH_CONFIG,
    ...(config ?? {})
  }
  if (normalized.provider === "searxng" && !normalized.endpoint?.trim()) {
    normalized.endpoint = DEFAULT_SEARXNG_ENDPOINT
  }
  normalized.count = clamp(normalized.count, 1, 10, 5)
  normalized.searxngPages = clamp(normalized.searxngPages, 1, 3, 1)
  return normalized
}

export const getWebSearchConfig =
  async (): Promise<WebSearchProviderConfig> => {
    const stored = await getPlasmoStoredValue<WebSearchProviderConfig>(
      STORAGE_KEYS.WEB_SEARCH.CONFIG
    )
    return normalizeWebSearchConfig(stored)
  }

export const setWebSearchConfig = async (
  config: WebSearchProviderConfig
): Promise<void> => {
  await setPlasmoStoredValue(STORAGE_KEYS.WEB_SEARCH.CONFIG, config)
}

/**
 * Per-device "use web search in this chat" flag, separate from
 * `config.enabled` (which means "configured/available" and lives in
 * settings). Defaults to true so enabling web search in settings keeps
 * working with no extra step — the composer toggle then opts out per device.
 */
export const getWebSearchActive = async (): Promise<boolean> => {
  const stored = await getPlasmoStoredValue<boolean>(
    STORAGE_KEYS.WEB_SEARCH.ACTIVE
  )
  return stored ?? true
}

export const setWebSearchActive = async (active: boolean): Promise<void> => {
  await setPlasmoStoredValue(STORAGE_KEYS.WEB_SEARCH.ACTIVE, active)
}
