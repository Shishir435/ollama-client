import { beforeEach, describe, expect, it, vi } from "vitest"
import { loadSelectionTranslation } from "@/i18n/selection-locale-loader"

describe("loadSelectionTranslation", () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock)
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ selection_button: { panel: { close: "Close" } } })
    })
  })

  it("fetches only the normalized active selection locale", async () => {
    await expect(loadSelectionTranslation("fr-CA")).resolves.toMatchObject({
      language: "fr"
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("assets/selection-locales/fr.json")
    )
  })

  it("falls back to English for unsupported locales", async () => {
    await expect(loadSelectionTranslation("pt-BR")).resolves.toMatchObject({
      language: "en"
    })
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("assets/selection-locales/en.json")
    )
  })
})
