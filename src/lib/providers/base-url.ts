import { createAppError } from "@/lib/error-utils"
import type { ProviderConfig } from "./types"
import { ProviderId } from "./types"

const DEFAULT_PROVIDER_BASE_URLS: Partial<Record<ProviderId, string>> = {
  [ProviderId.OLLAMA]: "http://localhost:11434",
  [ProviderId.LM_STUDIO]: "http://localhost:1234/v1",
  [ProviderId.LLAMA_CPP]: "http://localhost:8000/v1"
}

export const normalizeProviderBaseUrl = (baseUrl: string): string =>
  baseUrl.trim().replace(/\/+$/, "")

/**
 * Resolve one provider's API root from its canonical config.
 * Built-ins have explicit defaults; custom providers must always declare a URL.
 */
export const resolveProviderBaseUrl = (config: ProviderConfig): string => {
  if (config.baseUrl?.trim()) {
    return normalizeProviderBaseUrl(config.baseUrl)
  }

  const fallback = DEFAULT_PROVIDER_BASE_URLS[config.id as ProviderId]
  if (fallback) return fallback

  throw createAppError(`Provider ${config.id} has no base URL`, {
    kind: "validation",
    providerId: config.id
  })
}
