import {
  getPlasmoStoredValue,
  removePlasmoStoredValue,
  setPlasmoStoredValue
} from "@/lib/plasmo-global-storage"
import type { SettingDescriptor } from "./setting-descriptor"

const parse = <T>(
  descriptor: SettingDescriptor<T>,
  value: unknown
): T | undefined => {
  if (value === undefined || value === null) return descriptor.defaultValue
  if (!descriptor.parser) return value as T
  const parsed = descriptor.parser.safeParse(value)
  return parsed.success ? parsed.data : descriptor.defaultValue
}

export const readSetting = async <T>(
  descriptor: SettingDescriptor<T>
): Promise<T | undefined> =>
  parse(descriptor, await getPlasmoStoredValue<unknown>(descriptor.key))

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
