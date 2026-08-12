import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getStoredValue: vi.fn(),
  setSelectionLanguage: vi.fn()
}))

vi.mock("@/i18n/selection-config", () => ({
  setSelectionLanguage: mocks.setSelectionLanguage
}))

vi.mock("@/lib/plasmo-global-storage", () => ({
  getPlasmoStoredValue: mocks.getStoredValue
}))

import { syncSelectionLanguage } from "@/features/selection-actions/content-settings"

describe("syncSelectionLanguage", () => {
  beforeEach(() => {
    mocks.getStoredValue.mockResolvedValue("fr")
    mocks.setSelectionLanguage.mockRejectedValue(
      new Error("i18next initialization failed")
    )
  })

  it("does not block overlay mounting when locale initialization fails", async () => {
    await expect(syncSelectionLanguage()).resolves.toBeUndefined()
    expect(mocks.setSelectionLanguage).toHaveBeenCalledWith("fr")
  })
})
