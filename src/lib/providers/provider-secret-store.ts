import { STORAGE_KEYS } from "@/lib/constants"
import {
  plasmoDeviceStorage,
  plasmoGlobalStorage
} from "@/lib/plasmo-global-storage"
import { type ProviderConfig, ProviderStorageKey } from "@/lib/providers/types"

type ProviderSecretMap = Record<string, string>

const hasOwnApiKey = (provider: ProviderConfig): boolean =>
  Object.hasOwn(provider, "apiKey")

const stripSecrets = (provider: ProviderConfig): ProviderConfig => {
  const { apiKey: _apiKey, ...publicConfig } = provider
  return publicConfig
}

const extractSecrets = (providers: ProviderConfig[]): ProviderSecretMap => {
  const secrets: ProviderSecretMap = {}
  for (const provider of providers) {
    const apiKey = provider.apiKey?.trim()
    if (apiKey) secrets[String(provider.id)] = apiKey
  }
  return secrets
}

export const hydrateProviderSecrets = async (
  providers: ProviderConfig[]
): Promise<ProviderConfig[]> => {
  const secrets =
    (await plasmoDeviceStorage.get<ProviderSecretMap>(
      STORAGE_KEYS.PROVIDER.SECRETS
    )) ?? {}

  return providers.map((provider) => {
    // During migration, legacy sync value wins. This also preserves an explicit
    // empty value so saving it clears an existing local credential.
    if (hasOwnApiKey(provider)) return provider
    const apiKey = secrets[String(provider.id)]
    return apiKey ? { ...provider, apiKey } : provider
  })
}

export const containsLegacySyncedSecrets = (
  providers: ProviderConfig[]
): boolean => providers.some(hasOwnApiKey)

/**
 * Persist credentials before public config. A failed local write leaves sync
 * untouched; a failed sync write is safe to retry and cannot lose credentials.
 */
export const persistProviderConfigs = async (
  providers: ProviderConfig[]
): Promise<void> => {
  await plasmoDeviceStorage.set(
    STORAGE_KEYS.PROVIDER.SECRETS,
    extractSecrets(providers)
  )
  await plasmoGlobalStorage.set(
    ProviderStorageKey.CONFIG,
    providers.map(stripSecrets)
  )
}
