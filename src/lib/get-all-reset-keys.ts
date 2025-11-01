import { STORAGE_KEYS } from "@/lib/constants"

export type ModuleKeyMap = {
  [module: string]: string[]
}

export const getAllResetKeys = (): ModuleKeyMap => {
  const map: ModuleKeyMap = {}

  Object.entries(STORAGE_KEYS).forEach(([moduleName, keys]) => {
    map[moduleName] = Object.values(keys)
  })

  map.CHAT_SESSIONS = ["CHAT_SESSIONS"]

  return map
}
