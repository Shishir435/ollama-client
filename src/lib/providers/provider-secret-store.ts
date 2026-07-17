import { STORAGE_KEYS } from "@/lib/constants"
import {
  plasmoDeviceStorage,
  plasmoGlobalStorage
} from "@/lib/plasmo-global-storage"
import { type ProviderConfig, ProviderStorageKey } from "@/lib/providers/types"
import { withStorageWriteLock } from "@/lib/storage/storage-write-lock"

type ProviderSecretMap = Record<string, string>
type ProviderPersistenceSnapshot = {
  publicConfigs: ProviderConfig[]
  secrets: ProviderSecretMap
}
type ProviderPersistenceJournal = {
  version: 1
  previousSecrets: ProviderSecretMap
  nextSecrets: ProviderSecretMap
  nextPublicConfigs: ProviderConfig[]
}

const PROVIDER_PERSISTENCE_LOCK = "ollama-client:provider-persistence"

const configsMatch = (
  left: ProviderConfig[] | undefined,
  right: ProviderConfig[]
): boolean => JSON.stringify(left) === JSON.stringify(right)

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

export const withProviderPersistenceLock = <T>(
  operation: () => Promise<T>
): Promise<T> => withStorageWriteLock(PROVIDER_PERSISTENCE_LOCK, operation)

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

/** Caller must hold the provider-persistence lock. */
export const recoverProviderPersistenceUnlocked = async (): Promise<void> => {
  const journal = await plasmoDeviceStorage.get<ProviderPersistenceJournal>(
    STORAGE_KEYS.PROVIDER.PERSISTENCE_JOURNAL
  )
  if (!journal) return

  const syncedConfig = await plasmoGlobalStorage.get<ProviderConfig[]>(
    ProviderStorageKey.CONFIG
  )
  const recoveredSecrets = configsMatch(syncedConfig, journal.nextPublicConfigs)
    ? journal.nextSecrets
    : journal.previousSecrets

  await plasmoDeviceStorage.set(STORAGE_KEYS.PROVIDER.SECRETS, recoveredSecrets)
  await plasmoDeviceStorage.remove(STORAGE_KEYS.PROVIDER.PERSISTENCE_JOURNAL)
}

/**
 * Persist credentials before public config. A failed local write leaves sync
 * untouched; a failed sync write is safe to retry and cannot lose credentials.
 */
export const persistProviderConfigsUnlocked = async (
  providers: ProviderConfig[]
): Promise<void> => {
  const snapshot: ProviderPersistenceSnapshot = {
    secrets: extractSecrets(providers),
    publicConfigs: providers.map(stripSecrets)
  }
  const previousSecrets =
    (await plasmoDeviceStorage.get<ProviderSecretMap>(
      STORAGE_KEYS.PROVIDER.SECRETS
    )) ?? {}
  const journal: ProviderPersistenceJournal = {
    version: 1,
    previousSecrets,
    nextSecrets: snapshot.secrets,
    nextPublicConfigs: snapshot.publicConfigs
  }

  await plasmoDeviceStorage.set(
    STORAGE_KEYS.PROVIDER.PERSISTENCE_JOURNAL,
    journal
  )
  await plasmoDeviceStorage.set(STORAGE_KEYS.PROVIDER.SECRETS, snapshot.secrets)

  try {
    await plasmoGlobalStorage.set(
      ProviderStorageKey.CONFIG,
      snapshot.publicConfigs
    )
  } catch (syncError) {
    try {
      await plasmoDeviceStorage.set(
        STORAGE_KEYS.PROVIDER.SECRETS,
        previousSecrets
      )
      await plasmoDeviceStorage.remove(
        STORAGE_KEYS.PROVIDER.PERSISTENCE_JOURNAL
      )
    } catch (rollbackError) {
      throw new AggregateError(
        [syncError, rollbackError],
        "Provider config write and credential rollback both failed"
      )
    }
    throw syncError
  }

  await plasmoDeviceStorage.remove(STORAGE_KEYS.PROVIDER.PERSISTENCE_JOURNAL)
}

export const persistProviderConfigs = async (
  providers: ProviderConfig[]
): Promise<void> => {
  // Snapshot before waiting: callers may mutate their form state while an
  // earlier save owns the cross-context lock.
  const snapshot = providers.map((provider) => ({ ...provider }))
  await withProviderPersistenceLock(async () => {
    await recoverProviderPersistenceUnlocked()
    await persistProviderConfigsUnlocked(snapshot)
  })
}
