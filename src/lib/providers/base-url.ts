import { createAppError } from "@/lib/error-utils"
import { classifyEndpointScope } from "./endpoint-scope"
import type { ProviderConfig } from "./types"
import { ProviderId } from "./types"

const DEFAULT_PROVIDER_BASE_URLS: Partial<Record<ProviderId, string>> = {
  [ProviderId.OLLAMA]: "http://localhost:11434",
  [ProviderId.LM_STUDIO]: "http://localhost:1234/v1",
  [ProviderId.LLAMA_CPP]: "http://localhost:8000/v1"
}

export const normalizeProviderBaseUrl = (baseUrl: string): string =>
  baseUrl.trim().replace(/\/+$/, "")

type ProviderAddress = Pick<ProviderConfig, "id" | "baseUrl">

export const configuredEndpoint = (
  config: ProviderAddress
): string | undefined =>
  config.id === ProviderId.BROWSER
    ? "browser"
    : config.baseUrl?.trim()
      ? normalizeProviderBaseUrl(config.baseUrl)
      : DEFAULT_PROVIDER_BASE_URLS[config.id as ProviderId]

export const providerEndpointScope = (config?: ProviderAddress) =>
  config?.id === ProviderId.BROWSER
    ? "loopback"
    : classifyEndpointScope(config ? (configuredEndpoint(config) ?? "") : "")

/**
 * Resolve one provider's API root from its canonical config.
 * Built-ins have explicit defaults; custom providers must always declare a URL.
 */
export const resolveProviderBaseUrl = (config: ProviderConfig): string => {
  const endpoint = configuredEndpoint(config)
  if (endpoint && config.id !== ProviderId.BROWSER) return endpoint

  throw createAppError(`Provider ${config.id} has no base URL`, {
    kind: "validation",
    providerId: config.id
  })
}
