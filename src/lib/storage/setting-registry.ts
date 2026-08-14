import { POLICY_SETTINGS } from "./policy-settings"
import type { SettingDescriptor } from "./setting-descriptor"
import { SETTINGS } from "./settings"

const SETTINGS_BY_KEY = new Map<string, SettingDescriptor<unknown>>(
  [...Object.values(SETTINGS), ...Object.values(POLICY_SETTINGS)].map(
    (descriptor) => [descriptor.key, descriptor as SettingDescriptor<unknown>]
  )
)

/** Descriptor lookup for generic settings workflows such as presets/reset. */
export const getSettingDescriptor = (
  key: string
): SettingDescriptor<unknown> | undefined => SETTINGS_BY_KEY.get(key)
