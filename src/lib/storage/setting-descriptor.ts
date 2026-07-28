import type { StorageSyncScope } from "./storage-key-registry"
import { getStorageKeyMetadata } from "./storage-key-registry"

export interface ValueParser<T> {
  safeParse: (
    value: unknown
  ) => { success: true; data: T } | { success: false; error: unknown }
}

export interface SettingDescriptor<T> {
  readonly key: string
  readonly scope: StorageSyncScope
  readonly defaultValue?: T
  readonly parser?: ValueParser<T>
}

export type RequiredSettingDescriptor<T> = SettingDescriptor<T> & {
  readonly defaultValue: T
}

export function defineSetting<T>(
  key: string,
  options: { defaultValue: T; parser?: ValueParser<T> }
): RequiredSettingDescriptor<T>
export function defineSetting<T>(
  key: string,
  options?: { defaultValue?: T; parser?: ValueParser<T> }
): SettingDescriptor<T>
export function defineSetting<T>(
  key: string,
  options: { defaultValue?: T; parser?: ValueParser<T> } = {}
): SettingDescriptor<T> {
  const metadata = getStorageKeyMetadata(key)
  if (!metadata) throw new Error(`Unregistered storage key: ${key}`)
  return {
    key,
    scope: metadata.scope,
    ...options
  }
}
