import {
  getPlasmoStoredValue,
  removePlasmoStoredValue,
  setPlasmoStoredValue
} from "@/lib/plasmo-global-storage"
import type {
  RequiredSettingDescriptor,
  SettingDescriptor
} from "./setting-descriptor"

const parseStored = <T>(
  descriptor: SettingDescriptor<T>,
  value: unknown
): T | undefined => {
  if (value === undefined || value === null) return undefined
  if (!descriptor.parser) return value as T
  const parsed = descriptor.parser.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

/**
 * Read and validate only a persisted value. Migration callers use this when
 * absence must remain distinguishable from a descriptor default.
 */
export const readStoredSetting = async <T>(
  descriptor: SettingDescriptor<T>
): Promise<T | undefined> =>
  parseStored(descriptor, await getPlasmoStoredValue<unknown>(descriptor.key))

export function readSetting<T>(
  descriptor: RequiredSettingDescriptor<T>
): Promise<T>
export function readSetting<T>(
  descriptor: SettingDescriptor<T>
): Promise<T | undefined>
export async function readSetting<T>(
  descriptor: SettingDescriptor<T>
): Promise<T | undefined> {
  return (await readStoredSetting(descriptor)) ?? descriptor.defaultValue
}

export const writeSetting = async <T>(
  descriptor: SettingDescriptor<T>,
  value: T
): Promise<void> => {
  if (descriptor.parser) {
    const parsed = descriptor.parser.safeParse(value)
    if (!parsed.success) {
      throw new Error(`Invalid value for setting ${descriptor.key}`)
    }
    await setPlasmoStoredValue(descriptor.key, parsed.data)
    return
  }
  await setPlasmoStoredValue(descriptor.key, value)
}

export const removeSetting = async <T>(
  descriptor: SettingDescriptor<T>
): Promise<void> => removePlasmoStoredValue(descriptor.key)
