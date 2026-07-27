import { Storage } from "@plasmohq/storage"
import { getStorageKeyMetadata } from "@/lib/storage/storage-key-registry"
import { assertSyncStorageQuota } from "@/lib/storage/sync-quota"

/**
 * A device-local key reached the sync area. Thrown rather than rerouted: the
 * caller asked for the wrong area, and silently writing somewhere else would
 * leave its later read looking in the place it named.
 */
export class DeviceLocalKeyInSyncError extends Error {
  constructor(readonly key: string) {
    super(
      `Storage key ${key} is registered device-local and must not be written to sync`
    )
    this.name = "DeviceLocalKeyInSyncError"
  }
}

/**
 * Enforce sync invariants on the storage instance rather than at each call site.
 *
 * The quota check used to live in `setPlasmoStoredValue`, which meant every
 * caller holding the raw handle — 34 direct writes plus every
 * `useStorage({ instance })` setter — wrote past it. Those are exactly the
 * records most likely to overflow (provider configs, model and tool overrides,
 * knowledge sets), so the one path that was checked was the one least at risk.
 *
 * The scope check is here for the same reason. `plasmoGlobalStorage` does not
 * route by registry scope, so a device-local key written through it lands in
 * sync — for credentials that is the difference between one profile and every
 * profile. No such key is written through it today; this is what keeps that
 * true without migrating ~95 call sites to descriptors first, and it fails
 * loudly on the write rather than quietly on someone else's machine.
 *
 * Reads and removes stay open: `getPlasmoStoredValue` deliberately reads a
 * legacy sync value and removes it as part of moving a key to local.
 *
 * Wrapped imperatively because Plasmo declares `set`/`setMany` as instance
 * fields, not prototype methods: a subclass override is assigned first and then
 * shadowed by the base class's own field, so it would silently never run.
 */
const guardSyncWrites = (storage: Storage): Storage => {
  const rawSet = storage.set.bind(storage)
  const rawSetMany = storage.setMany.bind(storage)

  // `isDeviceLocalStorageKey` is declared below; these closures only run after
  // module initialization, so the forward reference is resolved by then.
  const assertWritable = async (key: string, rawValue: unknown) => {
    if (isDeviceLocalStorageKey(key)) throw new DeviceLocalKeyInSyncError(key)
    await assertSyncStorageQuota(key, rawValue)
  }

  storage.set = async (key, rawValue) => {
    await assertWritable(key, rawValue)
    return rawSet(key, rawValue)
  }
  storage.setMany = async (items) => {
    // Per item: the browser applies the item limit to each key, and failing on
    // the offending key is more useful than failing on the batch.
    for (const [key, rawValue] of Object.entries(items)) {
      await assertWritable(key, rawValue)
    }
    return rawSetMany(items)
  }
  return storage
}

export const plasmoSyncStorage = guardSyncWrites(new Storage({ area: "sync" }))
export const plasmoDeviceStorage = new Storage({ area: "local" })

const EXTRA_DEVICE_LOCAL_KEYS = new Set([
  "embeddings.migration.embedding_dim.v1.completed",
  "embeddings.migration.embedding_dim.v1.progress"
])

export const isDeviceLocalStorageKey = (key: string) =>
  getStorageKeyMetadata(key)?.scope === "device-local" ||
  EXTRA_DEVICE_LOCAL_KEYS.has(key)

export const getPlasmoStorageForKey = (key: string) => {
  return isDeviceLocalStorageKey(key) ? plasmoDeviceStorage : plasmoSyncStorage
}

export const getPlasmoStoredValue = async <T>(
  key: string
): Promise<T | undefined> => {
  if (!isDeviceLocalStorageKey(key)) {
    return plasmoSyncStorage.get<T>(key)
  }

  const localValue = await plasmoDeviceStorage.get<T>(key)
  if (localValue !== undefined && localValue !== null) return localValue

  const legacySyncValue = await plasmoSyncStorage.get<T>(key)
  if (legacySyncValue !== undefined && legacySyncValue !== null) {
    await plasmoDeviceStorage.set(key, legacySyncValue)
    await plasmoSyncStorage.remove(key).catch(() => undefined)
  }
  return legacySyncValue
}

export const setPlasmoStoredValue = async <T>(
  key: string,
  value: T
): Promise<void> => {
  // The quota check lives on the sync instance, so routing is all this owes:
  // device-local keys go to an area with no per-item ceiling.
  await getPlasmoStorageForKey(key).set(key, value)
}

export const removePlasmoStoredValue = async (key: string): Promise<void> => {
  await getPlasmoStorageForKey(key).remove(key)
}

/**
 * @deprecated Use typed descriptors with readSetting/writeSetting/useSetting.
 *
 * Still the sync handle, so writes through it are quota-checked — but it does
 * not route by scope, so a device-local key written here lands in sync. That is
 * the remaining reason to migrate call sites, not the quota.
 */
export const plasmoGlobalStorage = plasmoSyncStorage
