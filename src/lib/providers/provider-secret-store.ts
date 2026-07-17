import { STORAGE_KEYS } from "@/lib/constants"
import {
  plasmoDeviceStorage,
  plasmoGlobalStorage
} from "@/lib/plasmo-global-storage"
import { type ProviderConfig, ProviderStorageKey } from "@/lib/providers/types"

type ProviderSecretMap = Record<string, string>
type ProviderPersistenceSnapshot = {
  publicConfigs: ProviderConfig[]
  secrets: ProviderSecretMap
}

const PROVIDER_PERSISTENCE_LOCK = "ollama-client:provider-persistence"
let persistenceQueue = Promise.resolve()

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

const enqueuePersistence = (operation: () => Promise<void>): Promise<void> => {
  const queued = persistenceQueue.then(operation, operation)
  persistenceQueue = queued.then(
    () => undefined,
    () => undefined
  )
  return queued
}

export const withProviderPersistenceLock = <T>(
  operation: () => Promise<T>
): Promise<T> => {
  const lockManager = globalThis.navigator?.locks
  if (lockManager) {
    return lockManager
      .request(PROVIDER_PERSISTENCE_LOCK, operation)
      .then((result) => result)
  }
  let result: T
  return enqueuePersistence(async () => {
    result = await operation()
  }).then(() => result)
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
export const persistProviderConfigsUnlocked = async (
  providers: ProviderConfig[]
): Promise<void> => {
  const snapshot: ProviderPersistenceSnapshot = {
    secrets: extractSecrets(providers),
    publicConfigs: providers.map(stripSecrets)
  }

  await plasmoDeviceStorage.set(STORAGE_KEYS.PROVIDER.SECRETS, snapshot.secrets)
  await plasmoGlobalStorage.set(
    ProviderStorageKey.CONFIG,
    snapshot.publicConfigs
  )
}

export const persistProviderConfigs = async (
  providers: ProviderConfig[]
): Promise<void> => {
  // Snapshot before waiting: callers may mutate their form state while an
  // earlier save owns the cross-context lock.
  const snapshot = providers.map((provider) => ({ ...provider }))
  await withProviderPersistenceLock(() =>
    persistProviderConfigsUnlocked(snapshot)
  )
}
