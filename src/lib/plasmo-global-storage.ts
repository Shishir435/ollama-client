import { Storage } from "@plasmohq/storage"
import { getStorageKeyMetadata } from "@/lib/storage/storage-key-registry"

export const plasmoSyncStorage = new Storage({ area: "sync" })
export const plasmoDeviceStorage = new Storage({ area: "local" })

export const getPlasmoStorageForKey = (key: string) => {
  const metadata = getStorageKeyMetadata(key)
  return metadata?.scope === "device-local"
    ? plasmoDeviceStorage
    : plasmoSyncStorage
}

export const plasmoGlobalStorage = plasmoSyncStorage
