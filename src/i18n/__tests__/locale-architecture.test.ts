import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

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
})
