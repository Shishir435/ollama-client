import { describe, expect, it, vi } from "vitest"
import { selectionI18n, setSelectionLanguage } from "@/i18n/selection-config"

describe("selection i18n bootstrap", () => {
  it("mounts with an empty English fallback and recovers on a later load", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("Locale unavailable"))
      .mockRejectedValueOnce(new Error("English locale unavailable"))
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          selection_button: { panel: { close: "Fermer" } }
        })
      })
    vi.stubGlobal("fetch", fetchMock)

    await expect(setSelectionLanguage("fr")).resolves.toBeUndefined()
    expect(selectionI18n.isInitialized).toBe(true)
    expect(selectionI18n.language).toBe("en")

    await expect(setSelectionLanguage("fr")).resolves.toBeUndefined()
    expect(selectionI18n.language).toBe("fr")
    expect(selectionI18n.t("selection_button.panel.close")).toBe("Fermer")
  })
})
