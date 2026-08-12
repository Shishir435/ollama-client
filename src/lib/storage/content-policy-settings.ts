import {
  DEFAULT_EXCLUDE_URLS,
  DEFAULT_TABS_ACCESS,
  STORAGE_KEYS
} from "@/lib/constants"
import { defineSetting } from "./setting-descriptor"

const BooleanParser = {
  safeParse: (value: unknown) =>
    typeof value === "boolean"
      ? { success: true as const, data: value }
      : { success: false as const }
}

export const TAB_ACCESS_SETTING = defineSetting<boolean>(
  STORAGE_KEYS.BROWSER.TABS_ACCESS,
  { defaultValue: DEFAULT_TABS_ACCESS, parser: BooleanParser }
)

export const EXCLUDE_URL_PATTERNS_SETTING = defineSetting<string[]>(
  STORAGE_KEYS.BROWSER.EXCLUDE_URL_PATTERNS,
  { defaultValue: DEFAULT_EXCLUDE_URLS }
)
