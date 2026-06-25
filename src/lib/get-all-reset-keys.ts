import { LEGACY_STORAGE_KEYS, STORAGE_KEYS } from "@/lib/constants"
import { ProviderStorageKey } from "@/lib/providers/types"

export type ModuleKeyMap = {
  [module: string]: string[]
}

export const getAllResetKeys = (): ModuleKeyMap => {
  const map: ModuleKeyMap = {}

  map.PROVIDER = [
    ...Object.values(STORAGE_KEYS.PROVIDER),
    ...Object.values(LEGACY_STORAGE_KEYS.OLLAMA),
    ...Object.values(ProviderStorageKey)
  ]

  Object.entries(STORAGE_KEYS).forEach(([moduleName, keys]) => {
    if (moduleName === "PROVIDER") {
      return
    }
    map[moduleName] = typeof keys === "string" ? [keys] : Object.values(keys)
  })

  map.CHAT_SESSIONS = ["CHAT_SESSIONS"]
  map.FEEDBACK = ["FEEDBACK"]

  return map
}
