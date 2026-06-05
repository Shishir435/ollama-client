import { Storage } from "@plasmohq/storage"
import { getStorageKeyMetadata } from "@/lib/storage/storage-key-registry"

export const plasmoSyncStorage = new Storage({ area: "sync" })
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
  await getPlasmoStorageForKey(key).set(key, value)
}

export const removePlasmoStoredValue = async (key: string): Promise<void> => {
  await getPlasmoStorageForKey(key).remove(key)
}

export const plasmoGlobalStorage = plasmoSyncStorage
