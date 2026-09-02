import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

/**
 * The store-visible title and description are generated, not authored where
 * they are read. `wxt.config.ts` resolves the manifest name from
 * `__MSG_extName__`, Chrome resolves that from `public/_locales`, and
 * `tools/generate/generate-i18n-resources.ts` generates those from
 * `src/locales/<lang>/translation.json`. Three copies of one string, only one
 * of which is authoritative.
 *
 * 0.13.0 shipped the pre-0.12.7 title in all nine locales: the 0.12.7 store
 * metadata lived only on its release branch, and reconciling release ancestry
 * dropped it from the translations while `package.json` kept the new string.
 * Nothing failed, because nothing compared the copies.
 */

const repositoryRoot = process.cwd()
const localeRoot = join(repositoryRoot, "src/locales")
const chromeLocaleRoot = join(repositoryRoot, "public/_locales")

/** Mirrors CHROME_LOCALE_MAP in tools/generate/generate-i18n-resources.ts. */
const CHROME_LOCALE_MAP: Record<string, string> = { zh: "zh_CN" }

/** Chrome Web Store listing limits, enforced at upload rather than at build. */
const MAX_NAME_LENGTH = 75
const MAX_DESCRIPTION_LENGTH = 132

type ExtensionBlock = {
  name: string
  short_name: string
  description: string
  action_default_title: string
}

const locales = readdirSync(localeRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)

const readExtensionBlock = (locale: string): ExtensionBlock =>
  JSON.parse(readFileSync(join(localeRoot, locale, "translation.json"), "utf8"))
    .extension

const readChromeMessages = (
  locale: string
): Record<string, { message: string }> =>
  JSON.parse(
    readFileSync(
      join(
        chromeLocaleRoot,
        CHROME_LOCALE_MAP[locale] ?? locale,
        "messages.json"
      ),
      "utf8"
    )
  )

describe("store metadata", () => {
  it("keeps the committed _locales in sync with the source translations", () => {
    const drift: string[] = []

    for (const locale of locales) {
      const extension = readExtensionBlock(locale)
      const messages = readChromeMessages(locale)
      const expected: Record<string, string> = {
        extName: extension.name,
        extShortName: extension.short_name,
        extDescription: extension.description,
        actionDefaultTitle: extension.action_default_title
      }

      for (const [key, value] of Object.entries(expected)) {
        if (messages[key]?.message !== value) {
          drift.push(
            `${locale}/${key}: _locales has ${JSON.stringify(messages[key]?.message)}, translations have ${JSON.stringify(value)}`
          )
        }
      }
    }

    // Run `pnpm generate:resources` after editing an extension block.
    expect(drift).toEqual([])
  })

  // `description` is deliberately not compared: package.json describes the
  // repository and is free of the store's 132-character cap, so it names the
  // custom-provider flow the listing has no room for. `displayName` is the
  // store title verbatim, and it is what kept looking correct while the nine
  // catalogues that actually ship the name had regressed.
  it("keeps package.json displayName equal to the en extension name", () => {
    const manifestPackage = JSON.parse(
      readFileSync(join(repositoryRoot, "package.json"), "utf8")
    )

    expect(manifestPackage.displayName).toBe(readExtensionBlock("en").name)
  })

  it("stays inside the Chrome Web Store listing limits", () => {
    const overflow: string[] = []

    for (const locale of locales) {
      const { name, description } = readExtensionBlock(locale)
      if (name.length > MAX_NAME_LENGTH) {
        overflow.push(`${locale}/name: ${name.length}/${MAX_NAME_LENGTH}`)
      }
      if (description.length > MAX_DESCRIPTION_LENGTH) {
        overflow.push(
          `${locale}/description: ${description.length}/${MAX_DESCRIPTION_LENGTH}`
        )
      }
    }

    expect(overflow).toEqual([])
  })
})
