import { LEGACY_STORAGE_KEYS, STORAGE_KEYS } from "@/lib/constants"
import { logger } from "@/lib/logger"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { sanitizeStoredProviders } from "./provider-compat-migration"
import { parseStoredProviderConfigs } from "./provider-config-schema"
import { DEFAULT_PROVIDERS } from "./provider-defaults"
import {
  containsLegacySyncedSecrets,
  hydrateProviderSecrets,
  persistProviderConfigsUnlocked,
  recoverProviderPersistenceUnlocked,
  recoverProviderResetUnlocked
} from "./provider-secret-store"
import { type ProviderConfig, ProviderId, ProviderStorageKey } from "./types"

const migrateLegacyOllamaUrl = async (
  providers: ProviderConfig[]
): Promise<ProviderConfig[]> => {
  let stored = providers
  try {
    const legacyStoredUrl = await plasmoGlobalStorage.get<string>(
      LEGACY_STORAGE_KEYS.OLLAMA.BASE_URL
    )
    const globalStoredUrl = await plasmoGlobalStorage.get<string>(
      STORAGE_KEYS.PROVIDER.BASE_URL
    )
    const legacyUrl = legacyStoredUrl?.trim()
      ? legacyStoredUrl
      : globalStoredUrl?.trim()
        ? globalStoredUrl
        : undefined

    if (legacyUrl) {
      const defaultProviderIndex = stored.findIndex(
        (provider) => provider.id === ProviderId.OLLAMA
      )
      const currentBaseUrl = stored[defaultProviderIndex]?.baseUrl
      const defaultBaseUrl = DEFAULT_PROVIDERS.find(
        (provider) => provider.id === ProviderId.OLLAMA
      )?.baseUrl
      if (
        defaultProviderIndex !== -1 &&
        legacyUrl !== currentBaseUrl &&
        (!currentBaseUrl || currentBaseUrl === defaultBaseUrl)
      ) {
        stored = [...stored]
        stored[defaultProviderIndex] = {
          ...stored[defaultProviderIndex],
          baseUrl: legacyUrl
        }
        await persistProviderConfigsUnlocked(stored)
      }
    }
    if (legacyStoredUrl !== undefined || globalStoredUrl !== undefined) {
      await plasmoGlobalStorage.remove(LEGACY_STORAGE_KEYS.OLLAMA.BASE_URL)
      await plasmoGlobalStorage.remove(STORAGE_KEYS.PROVIDER.BASE_URL)
    }
  } catch (error) {
    logger.warn(
      "Failed to migrate legacy provider URL in getProviders",
      "ProviderManager",
      { error }
    )
  }
  return stored
}

/** Caller must hold the provider-persistence lock. */
export const getProviderConfigsUnlocked = async (): Promise<
  ProviderConfig[]
> => {
  await recoverProviderResetUnlocked()
  await recoverProviderPersistenceUnlocked()
  const rawStored = await plasmoGlobalStorage.get<unknown>(
    ProviderStorageKey.CONFIG
  )
  const parsedStored = parseStoredProviderConfigs(rawStored)
  let stored = parsedStored.providers
  if (stored.length === 0) {
    stored = [...DEFAULT_PROVIDERS]
    await persistProviderConfigsUnlocked(stored)
  }

  const containsLegacySecrets = containsLegacySyncedSecrets(stored)
  stored = await hydrateProviderSecrets(stored)
  if (containsLegacySecrets) {
    await persistProviderConfigsUnlocked(stored)
  }

  const sanitized = sanitizeStoredProviders(stored)
  const sanitizationChanged =
    parsedStored.normalized ||
    sanitized.removed.length > 0 ||
    sanitized.migrated.length > 0 ||
    sanitized.duplicates.length > 0
  if (sanitizationChanged) {
    logger.info(
      "Sanitized provider configs not present in the built-in provider UI",
      "ProviderManager",
      {
        removed: sanitized.removed.map((provider) => provider.id),
        migrated: sanitized.migrated,
        duplicates: sanitized.duplicates,
        rejectedMalformedEntries: parsedStored.rejected
      }
    )
    stored = sanitized.providers
  }

  const missing = DEFAULT_PROVIDERS.filter(
    (candidate) => !stored.find((provider) => provider.id === candidate.id)
  )

  stored = await migrateLegacyOllamaUrl(stored)

  if (missing.length > 0) {
    const merged = [...stored, ...missing]
    await persistProviderConfigsUnlocked(merged)
    return merged
  }

  if (sanitizationChanged) {
    await persistProviderConfigsUnlocked(stored)
  }

  return stored
}
