import { browser } from "@/lib/browser-api"
import { STORAGE_KEYS } from "@/lib/constants"
import {
  plasmoDeviceStorage,
  plasmoGlobalStorage
} from "@/lib/plasmo-global-storage"
import {
  persistProviderConfigsUnlocked,
  recoverProviderPersistenceUnlocked,
  recoverProviderResetUnlocked,
  withProviderPersistenceLock
} from "@/lib/providers/provider-secret-store"
import { type ProviderConfig, ProviderStorageKey } from "@/lib/providers/types"
import { getImportResetStorageKeys } from "@/lib/storage/backup-storage-policy"

type BackupImportPhase = "prepared" | "settings-applied" | "committed"

type BackupImportJournal = {
  version: 1
  phase: BackupImportPhase
  previousSync: Record<string, unknown>
  nextProviderConfigs?: ProviderConfig[]
}

const getSyncSnapshot = async (): Promise<Record<string, unknown>> =>
  (await browser.storage.sync.get(getImportResetStorageKeys())) as Record<
    string,
    unknown
  >

const replacePortableSyncState = async (
  nextSync: Record<string, unknown>
): Promise<void> => {
  if (Object.keys(nextSync).length > 0) {
    await browser.storage.sync.set(nextSync)
  }

  const keysToRemove = getImportResetStorageKeys().filter(
    (key) => !Object.hasOwn(nextSync, key)
  )
  if (keysToRemove.length > 0) {
    await browser.storage.sync.remove(keysToRemove)
  }
}

const restorePreviousSyncState = async (
  previousSync: Record<string, unknown>,
  signal?: AbortSignal
): Promise<void> => {
  signal?.throwIfAborted()
  const keysToRemove = getImportResetStorageKeys().filter(
    (key) => !Object.hasOwn(previousSync, key)
  )
  if (keysToRemove.length > 0) {
    await browser.storage.sync.remove(keysToRemove)
  }
  signal?.throwIfAborted()
  if (Object.keys(previousSync).length > 0) {
    await browser.storage.sync.set(previousSync)
  }
}

const providerCommitMatches = async (
  nextProviderConfigs: ProviderConfig[],
  signal?: AbortSignal
): Promise<boolean> => {
  signal?.throwIfAborted()
  const [publicConfigs, secrets] = await Promise.all([
    plasmoGlobalStorage.get<ProviderConfig[]>(ProviderStorageKey.CONFIG),
    plasmoDeviceStorage.get<Record<string, string>>(
      STORAGE_KEYS.PROVIDER.SECRETS
    )
  ])
  signal?.throwIfAborted()
  const expectedPublicConfigs = nextProviderConfigs.map(
    ({ apiKey: _apiKey, ...provider }) => provider
  )
  return (
    JSON.stringify(publicConfigs) === JSON.stringify(expectedPublicConfigs) &&
    Object.keys(secrets ?? {}).length === 0
  )
}

/** Caller must hold the provider-persistence lock. */
export const recoverBackupImportUnlocked = async (
  signal?: AbortSignal
): Promise<void> => {
  signal?.throwIfAborted()
  const journal = await plasmoDeviceStorage.get<BackupImportJournal>(
    STORAGE_KEYS.BACKUP.IMPORT_JOURNAL
  )
  signal?.throwIfAborted()
  if (!journal) return

  const canFinalize =
    journal.phase === "committed" ||
    (journal.phase === "settings-applied" &&
      (journal.nextProviderConfigs === undefined ||
        (await providerCommitMatches(journal.nextProviderConfigs, signal))))

  if (!canFinalize) {
    await restorePreviousSyncState(journal.previousSync, signal)
  }
  signal?.throwIfAborted()
  await plasmoDeviceStorage.remove(STORAGE_KEYS.BACKUP.IMPORT_JOURNAL)
}

export const recoverBackupImport = async (
  signal?: AbortSignal
): Promise<void> =>
  withProviderPersistenceLock(async () => {
    signal?.throwIfAborted()
    await recoverProviderResetUnlocked(signal)
    signal?.throwIfAborted()
    await recoverProviderPersistenceUnlocked(signal)
    signal?.throwIfAborted()
    await recoverBackupImportUnlocked(signal)
  })

export const importPortableStorageTransaction = async (
  data: Record<string, unknown>,
  providerConfigs?: ProviderConfig[]
): Promise<void> =>
  withProviderPersistenceLock(async () => {
    await recoverProviderResetUnlocked()
    await recoverProviderPersistenceUnlocked()
    await recoverBackupImportUnlocked()

    const previousSync = await getSyncSnapshot()
    const journal: BackupImportJournal = {
      version: 1,
      phase: "prepared",
      previousSync,
      ...(providerConfigs === undefined
        ? {}
        : { nextProviderConfigs: providerConfigs })
    }
    await plasmoDeviceStorage.set(STORAGE_KEYS.BACKUP.IMPORT_JOURNAL, journal)

    try {
      await replacePortableSyncState(data)
      journal.phase = "settings-applied"
      await plasmoDeviceStorage.set(STORAGE_KEYS.BACKUP.IMPORT_JOURNAL, journal)

      if (providerConfigs !== undefined) {
        await persistProviderConfigsUnlocked(providerConfigs)
      }
    } catch (importError) {
      try {
        await restorePreviousSyncState(previousSync)
        await plasmoDeviceStorage.remove(STORAGE_KEYS.BACKUP.IMPORT_JOURNAL)
      } catch (rollbackError) {
        throw new AggregateError(
          [importError, rollbackError],
          "Portable settings import and rollback both failed"
        )
      }
      throw importError
    }

    journal.phase = "committed"
    try {
      await plasmoDeviceStorage.set(STORAGE_KEYS.BACKUP.IMPORT_JOURNAL, journal)
    } catch {
      // settings-applied is recoverable: provider state is either absent from
      // this import or already committed through its own journal.
      return
    }

    await plasmoDeviceStorage
      .remove(STORAGE_KEYS.BACKUP.IMPORT_JOURNAL)
      .catch(() => undefined)
  })
