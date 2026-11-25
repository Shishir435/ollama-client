import { z } from "zod"
import { STORAGE_KEYS } from "@/lib/constants"
import {
  getPlasmoStoredValue,
  setPlasmoStoredValue
} from "@/lib/plasmo-global-storage"
import { WEB_SEARCH_PROVIDER_IDS, type WebSearchProviderConfig } from "./types"

export const DEFAULT_SEARXNG_ENDPOINT = "http://localhost:8080"
export const BRAVE_SEARCH_ENDPOINT =
  "https://api.search.brave.com/res/v1/web/search"
export const TAVILY_SEARCH_ENDPOINT = "https://api.tavily.com/search"
export const OLLAMA_SEARCH_ENDPOINT = "https://ollama.com/api/web_search"
export const KEENABLE_SEARCH_ENDPOINT = "https://api.keenable.ai/v1/search"

export const DEFAULT_WEB_SEARCH_CONFIG: WebSearchProviderConfig = {
  provider: "searxng",
  endpoint: DEFAULT_SEARXNG_ENDPOINT,
  /**
   * Off until a test search returns results. The default SearXNG endpoint is
   * rarely running, so a feature that starts on offers a web toggle that can
   * only fail; a passing test in settings turns it on. Profiles that had it on
   * by default keep it, see {@link preserveLegacyWebSearchDefault}.
   */
  enabled: false,
  executionSource: "client",
  nativeMode: "cached",
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
    ...config
  }
  if (normalized.provider === "searxng" && !normalized.endpoint?.trim()) {
    normalized.endpoint = DEFAULT_SEARXNG_ENDPOINT
  }
  normalized.count = clamp(normalized.count, 1, 10, 5)
  normalized.searxngPages = clamp(normalized.searxngPages, 1, 3, 1)
  return normalized
}

const StoredWebSearchProviderConfigSchema = z.object({
  provider: z.enum(WEB_SEARCH_PROVIDER_IDS).optional().catch(undefined),
  endpoint: z.string().optional().catch(undefined),
  apiKey: z.string().optional().catch(undefined),
  apiKeysByProvider: z
    .partialRecord(z.enum(WEB_SEARCH_PROVIDER_IDS), z.string())
    .optional()
    .catch(undefined),
  count: z.number().finite().optional().catch(undefined),
  searxngPages: z.number().finite().optional().catch(undefined),
  safeSearch: z.enum(["off", "moderate", "strict"]).optional().catch(undefined),
  enabled: z.boolean().optional().catch(undefined),
  executionSource: z
    .enum(["auto", "client", "native"])
    .optional()
    .catch(undefined),
  nativeMode: z.enum(["cached", "indexed", "live"]).optional().catch(undefined)
})

/**
 * Runtime parser for the persisted UI setting. Older partial objects remain
 * readable; malformed fields are discarded before defaults and bounds apply.
 */
export const WebSearchProviderConfigSchema =
  StoredWebSearchProviderConfigSchema.transform((stored) => {
    const validFields = Object.fromEntries(
      Object.entries(stored).filter(([, value]) => value !== undefined)
    ) as Partial<WebSearchProviderConfig>
    return normalizeWebSearchConfig(validFields)
  })

export const getWebSearchConfig =
  async (): Promise<WebSearchProviderConfig> => {
    const stored = await getPlasmoStoredValue<unknown>(
      STORAGE_KEYS.WEB_SEARCH.CONFIG
    )
    const parsed = WebSearchProviderConfigSchema.safeParse(stored)
    return parsed.success ? parsed.data : DEFAULT_WEB_SEARCH_CONFIG
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

/**
 * Settle the off-by-default change once per profile.
 *
 * A profile that updates into it without ever saving web search settings had
 * web search on only because the default was, and nothing says whether it ever
 * ran a search — a localhost SearXNG may be answering for it. Turning a working
 * feature off is the worse mistake, so when that cannot be told it is left as
 * it was: the default it had is written down. A stored config is never touched.
 * A new install has no earlier default to keep, so it only records that it was
 * settled; without that record a later update would read its empty config as an
 * old profile's.
 *
 * Returns whether the legacy default was written.
 */
export const settleLegacyWebSearchDefault = async (
  reason: "install" | "update"
): Promise<boolean> => {
  const handled = await getPlasmoStoredValue<boolean>(
    STORAGE_KEYS.WEB_SEARCH.LEGACY_DEFAULT_HANDLED
  )
  if (handled) return false
  let wrote = false
  if (reason === "update") {
    const stored = await getPlasmoStoredValue<unknown>(
      STORAGE_KEYS.WEB_SEARCH.CONFIG
    )
    const storedEnabled =
      stored && typeof stored === "object"
        ? (stored as { enabled?: unknown }).enabled
        : undefined
    /**
     * A config saved before `enabled` was written has no say of its own, so it
     * was on by the default too; one that says it is on or off is left alone.
     */
    if (
      stored === undefined ||
      stored === null ||
      (typeof stored === "object" && typeof storedEnabled !== "boolean")
    ) {
      /**
       * Decoded first: an old profile can hold a malformed field (a numeric
       * endpoint), which normalizing raw would throw on and leave the profile
       * unsettled on every update.
       */
      const decoded = WebSearchProviderConfigSchema.safeParse(stored ?? {})
      await setWebSearchConfig({
        ...(decoded.success ? decoded.data : DEFAULT_WEB_SEARCH_CONFIG),
        enabled: true
      })
      wrote = true
    }
  }
  await setPlasmoStoredValue(
    STORAGE_KEYS.WEB_SEARCH.LEGACY_DEFAULT_HANDLED,
    true
  )
  return wrote
}
