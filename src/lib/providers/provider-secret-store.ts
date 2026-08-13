import { z } from "zod"
import { STORAGE_KEYS } from "@/lib/constants"
import { logger } from "@/lib/logger"
import {
  plasmoDeviceStorage,
  plasmoGlobalStorage,
  removePlasmoStoredValue
} from "@/lib/plasmo-global-storage"
import { type ProviderConfig, ProviderStorageKey } from "@/lib/providers/types"
import { withStorageWriteLock } from "@/lib/storage/storage-write-lock"
import {
  ProviderConfigSchema,
  validateProviderConfigs
} from "./provider-config-schema"

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
type ProviderResetJournal = {
  version: 1
  keys: string[]
}

const ProviderSecretMapSchema = z
  .record(z.string(), z.unknown())
  .transform((stored): ProviderSecretMap => {
    const secrets: ProviderSecretMap = {}
    for (const [providerId, value] of Object.entries(stored)) {
      if (typeof value === "string" && value.trim()) secrets[providerId] = value
    }
    return secrets
  })

const ProviderPersistenceJournalSchema = z.object({
  version: z.literal(1),
  previousSecrets: ProviderSecretMapSchema,
  nextSecrets: ProviderSecretMapSchema,
  nextPublicConfigs: z.array(ProviderConfigSchema)
})

const ProviderResetJournalSchema = z.object({
  version: z.literal(1),
  keys: z.array(z.string())
})

const PROVIDER_PERSISTENCE_LOCK = "ollama-client:provider-persistence"

const configsMatch = (left: unknown, right: ProviderConfig[]): boolean =>
  JSON.stringify(left) === JSON.stringify(right)

const parseSecretMap = (value: unknown): ProviderSecretMap => {
  const parsed = ProviderSecretMapSchema.safeParse(value)
  return parsed.success ? parsed.data : {}
}

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
  const secrets = parseSecretMap(
    await plasmoDeviceStorage.get<unknown>(STORAGE_KEYS.PROVIDER.SECRETS)
  )

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
export const recoverProviderResetUnlocked = async (
  signal?: AbortSignal
): Promise<void> => {
  signal?.throwIfAborted()
  const stored = await plasmoDeviceStorage.get<unknown>(
    STORAGE_KEYS.PROVIDER.RESET_JOURNAL
  )
  signal?.throwIfAborted()
  if (!stored) return
  const parsed = ProviderResetJournalSchema.safeParse(stored)
  if (!parsed.success) {
    logger.warn(
      "Discarded invalid provider reset journal",
      "ProviderSecretStore"
    )
    signal?.throwIfAborted()
    await plasmoDeviceStorage.remove(STORAGE_KEYS.PROVIDER.RESET_JOURNAL)
    return
  }
  const journal: ProviderResetJournal = parsed.data

  for (const key of journal.keys) {
    signal?.throwIfAborted()
    await removePlasmoStoredValue(key)
  }
  signal?.throwIfAborted()
  await plasmoDeviceStorage.remove(STORAGE_KEYS.PROVIDER.RESET_JOURNAL)
}

/**
 * Durably clear provider storage. The journal remains until every removal
 * succeeds, so a later provider read or write can finish interrupted cleanup.
 * Caller must hold the provider-persistence lock.
 */
export const resetProviderStorageUnlocked = async (
  keys: string[]
): Promise<void> => {
  const resetKeys = [
    ProviderStorageKey.CONFIG,
    ...keys.filter(
      (key) =>
        key !== ProviderStorageKey.CONFIG &&
        key !== STORAGE_KEYS.PROVIDER.RESET_JOURNAL
    )
  ]
  const journal: ProviderResetJournal = {
    version: 1,
    keys: [...new Set(resetKeys)]
  }

  await plasmoDeviceStorage.set(STORAGE_KEYS.PROVIDER.RESET_JOURNAL, journal)
  await recoverProviderResetUnlocked()
}

/** Caller must hold the provider-persistence lock. */
export const recoverProviderPersistenceUnlocked = async (
  signal?: AbortSignal
): Promise<void> => {
  signal?.throwIfAborted()
  const stored = await plasmoDeviceStorage.get<unknown>(
    STORAGE_KEYS.PROVIDER.PERSISTENCE_JOURNAL
  )
  signal?.throwIfAborted()
  if (!stored) return
  const parsed = ProviderPersistenceJournalSchema.safeParse(stored)
  if (!parsed.success) {
    logger.warn(
      "Discarded invalid provider persistence journal",
      "ProviderSecretStore"
    )
    signal?.throwIfAborted()
    await plasmoDeviceStorage.remove(STORAGE_KEYS.PROVIDER.PERSISTENCE_JOURNAL)
    return
  }
  const journal: ProviderPersistenceJournal = parsed.data

  const syncedConfig = await plasmoGlobalStorage.get<unknown>(
    ProviderStorageKey.CONFIG
  )
  signal?.throwIfAborted()
  const recoveredSecrets = configsMatch(syncedConfig, journal.nextPublicConfigs)
    ? journal.nextSecrets
    : journal.previousSecrets

  await plasmoDeviceStorage.set(STORAGE_KEYS.PROVIDER.SECRETS, recoveredSecrets)
  signal?.throwIfAborted()
  await plasmoDeviceStorage.remove(STORAGE_KEYS.PROVIDER.PERSISTENCE_JOURNAL)
}

/**
 * Persist credentials before public config. A failed local write leaves sync
 * untouched; a failed sync write is safe to retry and cannot lose credentials.
 */
export const persistProviderConfigsUnlocked = async (
  providers: ProviderConfig[]
): Promise<void> => {
  providers = validateProviderConfigs(providers)
  const snapshot: ProviderPersistenceSnapshot = {
    secrets: extractSecrets(providers),
    publicConfigs: providers.map(stripSecrets)
  }
  const previousSecrets = parseSecretMap(
    await plasmoDeviceStorage.get<unknown>(STORAGE_KEYS.PROVIDER.SECRETS)
  )
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
    await recoverProviderResetUnlocked()
    await recoverProviderPersistenceUnlocked()
    await persistProviderConfigsUnlocked(snapshot)
  })
}
