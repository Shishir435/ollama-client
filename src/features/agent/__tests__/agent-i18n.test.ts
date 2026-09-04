import { describe, expect, it } from "vitest"
import de from "@/locales/de/translation.json"
import en from "@/locales/en/translation.json"
import es from "@/locales/es/translation.json"
import fr from "@/locales/fr/translation.json"
import hi from "@/locales/hi/translation.json"
import itLocale from "@/locales/it/translation.json"
import ja from "@/locales/ja/translation.json"
import ru from "@/locales/ru/translation.json"
import zh from "@/locales/zh/translation.json"

const flatten = (value: unknown, prefix = ""): string[] => {
  if (!value || typeof value !== "object") return [prefix]
  return Object.entries(value).flatMap(([key, child]) =>
    flatten(child, prefix ? `${prefix}.${key}` : key)
  )
}

describe("Agent locale coverage", () => {
  it("keeps every Agent key in all nine locales", () => {
    const expected = flatten(en.agent).sort()
    for (const locale of [de, es, fr, hi, itLocale, ja, ru, zh]) {
      expect(flatten(locale.agent).sort()).toEqual(expected)
    }
  })
})
