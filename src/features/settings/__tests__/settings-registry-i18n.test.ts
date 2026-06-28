import { describe, expect, it } from "vitest"
import { SETTINGS_REGISTRY } from "@/features/settings/settings-registry"
import en from "@/locales/en/translation.json"

/**
 * Drift guard: every i18n key the settings registry points at must resolve to a
 * real string in the source-of-truth locale (en). When a setting's label or
 * description key is renamed or removed and the registry isn't updated, search
 * silently degrades (raw key paths / empty hits). This test fails loudly instead.
 *
 * Only i18n KEYS are checked — `aliases` and `keywords` are plain search words,
 * not translation keys.
 */
const resolveKey = (path: string): unknown =>
  path
    .split(".")
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === "object"
          ? (node as Record<string, unknown>)[part]
          : undefined,
      en
    )

const i18nKeysOf = (entry: (typeof SETTINGS_REGISTRY)[number]): string[] => [
  entry.labelKey,
  ...(entry.descriptionKey ? [entry.descriptionKey] : []),
  ...(entry.searchKeys ?? [])
]

describe("settings-registry i18n coverage", () => {
  it("resolves every label/description/search key in en", () => {
    const unresolved: string[] = []
    for (const entry of SETTINGS_REGISTRY) {
      for (const key of i18nKeysOf(entry)) {
        if (typeof resolveKey(key) !== "string") {
          unresolved.push(`${entry.id} -> ${key}`)
        }
      }
    }
    expect(unresolved).toEqual([])
  })
})
