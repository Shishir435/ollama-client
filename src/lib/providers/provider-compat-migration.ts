import { DEFAULT_PROVIDERS, REMOVED_BETA_DEFAULTS } from "./provider-defaults"
import {
  isCustomProviderId,
  type ProviderConfig,
  type ProviderId,
  ProviderType
} from "./types"

const DEFAULT_PROVIDER_IDS = new Set(DEFAULT_PROVIDERS.map((p) => p.id))

const isKnownProviderId = (id: string): boolean =>
  DEFAULT_PROVIDER_IDS.has(id as ProviderId) || isCustomProviderId(id)

const duplicateRetentionScore = (config: ProviderConfig): number =>
  (config.apiKey?.trim() ? 4 : 0) +
  ((config.customModels?.length ?? 0) > 0 ? 2 : 0) +
  (config.enabled ? 1 : 0)

export const remapLegacyProviderId = (providerId: string): string =>
  REMOVED_BETA_DEFAULTS[providerId]?.customId ?? providerId

export interface SanitizedProviderConfigs {
  providers: ProviderConfig[]
  removed: ProviderConfig[]
  migrated: Array<{ from: string; to: string }>
  duplicates: string[]
}

export const sanitizeStoredProviders = (
  providers: ProviderConfig[]
): SanitizedProviderConfigs => {
  const kept: ProviderConfig[] = []
  const removed: ProviderConfig[] = []
  const migrated: Array<{ from: string; to: string }> = []

  for (const provider of providers) {
    const id = String(provider.id)
    if (isKnownProviderId(id)) {
      kept.push(provider)
      continue
    }

    const legacy = REMOVED_BETA_DEFAULTS[id]
    const wasConfigured =
      legacy &&
      (provider.enabled ||
        Boolean(provider.apiKey?.trim()) ||
        Boolean(provider.customModels?.length) ||
        provider.baseUrl !== legacy.baseUrl ||
        provider.name !== legacy.name)
    if (legacy && wasConfigured) {
      kept.push({
        ...provider,
        id: legacy.customId,
        type: ProviderType.OPENAI
      })
      migrated.push({ from: id, to: legacy.customId })
      continue
    }

    removed.push(provider)
  }

  const byId = new Map<string, ProviderConfig>()
  const duplicates: string[] = []
  for (const provider of kept) {
    const id = String(provider.id)
    const incumbent = byId.get(id)
    if (!incumbent) {
      byId.set(id, provider)
      continue
    }
    duplicates.push(id)
    if (
      duplicateRetentionScore(provider) > duplicateRetentionScore(incumbent)
    ) {
      byId.set(id, provider)
    }
  }

  return {
    providers: [...byId.values()],
    removed,
    migrated,
    duplicates
  }
}
