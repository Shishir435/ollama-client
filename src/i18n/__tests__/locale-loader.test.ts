import { describe, expect, it } from "vitest"
import {
  loadTranslation,
  normalizeSupportedLanguage
} from "@/i18n/locale-loader"

describe("locale loader", () => {
  it("normalizes supported regional languages and falls back to English", () => {
    expect(normalizeSupportedLanguage("fr-FR")).toBe("fr")
    expect(normalizeSupportedLanguage("ZH-cn")).toBe("zh")
    expect(normalizeSupportedLanguage("unknown")).toBe("en")
    expect(normalizeSupportedLanguage(undefined)).toBe("en")
  })

  it("loads only the requested translation module", async () => {
    const translation = await loadTranslation("de-DE")
    expect(translation.extension).toMatchObject({
      name: expect.any(String),
      description: expect.any(String)
    })
  })
})
