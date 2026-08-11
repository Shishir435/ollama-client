import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { createInstance } from "i18next"
import { describe, expect, it } from "vitest"

const repositoryRoot = process.cwd()
const localeRoot = join(repositoryRoot, "src/locales")
const localeLoaderPath = join(repositoryRoot, "src/i18n/locale-loader.ts")
const aggregateResourcePath = join(repositoryRoot, "src/i18n/resources.ts")
const generatorPath = join(repositoryRoot, "tools/generate-i18n-resources.ts")

describe("locale architecture", () => {
  it("keeps every source locale behind an explicit dynamic import", () => {
    const loaderSource = readFileSync(localeLoaderPath, "utf8")
    const locales = readdirSync(localeRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)

    for (const locale of locales) {
      expect(loaderSource).toContain(
        `() => import("@/locales/${locale}/translation.json")`
      )
    }
  })

  it("does not generate an aggregated all-languages module", () => {
    expect(existsSync(aggregateResourcePath)).toBe(false)
    expect(readFileSync(generatorPath, "utf8")).not.toContain(
      "src/i18n/resources.ts"
    )
  })

  // i18next 26 runs JSON v4 plurals, so the suffix must be a CLDR category that
  // `Intl.PluralRules` actually selects for that language. Russian resolves 2 to
  // `few` and 5 to `many`; a catalog with only `_one`/`_other` drops those
  // counts to the English fallback. Categories are derived from realistic counts
  // rather than the full category list, because `many` in es/fr/it only appears
  // at a million and up.
  it("covers every plural category a locale's counts can reach", () => {
    const locales = readdirSync(localeRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)

    const missing: string[] = []

    for (const locale of locales) {
      const catalog = JSON.parse(
        readFileSync(join(localeRoot, locale, "translation.json"), "utf8")
      ) as Record<string, unknown>

      const rules = new Intl.PluralRules(locale)
      const reachable = new Set<Intl.LDMLPluralRule>()
      for (let count = 0; count <= 500; count += 1) {
        reachable.add(rules.select(count))
      }

      // A key family opts into pluralization by declaring `_one`. Single-form
      // `{{count}}` keys are deliberate and out of scope.
      const families: string[] = []
      const walk = (node: unknown, path: string) => {
        if (typeof node !== "object" || node === null) return
        for (const [key, value] of Object.entries(node)) {
          const childPath = path ? `${path}.${key}` : key
          if (typeof value === "string") {
            if (key.endsWith("_one")) families.push(childPath.slice(0, -4))
            continue
          }
          walk(value, childPath)
        }
      }
      walk(catalog, "")

      for (const family of families) {
        const parts = family.split(".")
        const leaf = parts.pop() as string
        const parent = parts.reduce<Record<string, unknown>>(
          (node, segment) => node[segment] as Record<string, unknown>,
          catalog
        )
        for (const category of reachable) {
          if (typeof parent[`${leaf}_${category}`] !== "string") {
            missing.push(`${locale}: ${family}_${category}`)
          }
        }
      }
    }

    expect(missing).toEqual([])
  })

  it("resolves Russian result counts through i18next itself", async () => {
    const load = (locale: string) =>
      JSON.parse(
        readFileSync(join(localeRoot, locale, "translation.json"), "utf8")
      )

    const instance = createInstance()
    await instance.init({
      lng: "ru",
      fallbackLng: "en",
      defaultNS: "translation",
      resources: {
        ru: { translation: load("ru") },
        en: { translation: load("en") }
      },
      interpolation: { escapeValue: false }
    })

    const results = (count: number) =>
      instance.t("chat.reasoning.trace.results", { count })

    expect(results(1)).toBe("1 результат")
    // The two counts that used to fall through to the English catalog.
    expect(results(2)).toBe("2 результата")
    expect(results(5)).toBe("5 результатов")
    expect(results(21)).toBe("21 результат")
  })
})
