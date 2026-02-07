import { LEGACY_STORAGE_KEYS, STORAGE_KEYS } from "@/lib/constants"

export type ModuleKeyMap = {
  [module: string]: string[]
}

export const getAllResetKeys = (): ModuleKeyMap => {
  const map: ModuleKeyMap = {}

  map.PROVIDER = [
    ...Object.values(STORAGE_KEYS.PROVIDER),
    ...Object.values(LEGACY_STORAGE_KEYS.OLLAMA)
  ]

  Object.entries(STORAGE_KEYS).forEach(([moduleName, keys]) => {
    if (moduleName === "PROVIDER") {
      return
    }
    map[moduleName] = Object.values(keys)
  })

  map.CHAT_SESSIONS = ["CHAT_SESSIONS"]

  return map
}
