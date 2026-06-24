import { beforeEach, describe, expect, it, vi } from "vitest"

const get = vi.fn()
const set = vi.fn()

vi.mock("@/lib/plasmo-global-storage", () => ({
  getPlasmoStoredValue: (...args: unknown[]) => get(...args),
  setPlasmoStoredValue: (...args: unknown[]) => set(...args)
}))

import {
  DEFAULT_TOOL_FAMILY_SETTINGS,
  getToolFamilySettings,
  setToolFamilyEnabled,
  setToolMasterEnabled
} from "../tool-settings"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("tool-settings", () => {
  it("defaults to all-on when nothing is stored (no regression on upgrade)", async () => {
    get.mockResolvedValue(undefined)
    const settings = await getToolFamilySettings()
    expect(settings).toEqual(DEFAULT_TOOL_FAMILY_SETTINGS)
    expect(settings.enabled).toBe(true)
    expect(Object.values(settings.families).every(Boolean)).toBe(true)
  })

  it("merges stored partial families over the all-on defaults", async () => {
    get.mockResolvedValue({ families: { history: false } })
    const settings = await getToolFamilySettings()
    expect(settings.families.history).toBe(false)
    expect(settings.families.browser).toBe(true)
    expect(settings.enabled).toBe(true)
  })

  it("setToolMasterEnabled persists the master switch", async () => {
    get.mockResolvedValue(undefined)
    const next = await setToolMasterEnabled(false)
    expect(next.enabled).toBe(false)
    expect(set).toHaveBeenCalledWith(
      "tools-families-config",
      expect.objectContaining({ enabled: false })
    )
  })

  it("setToolFamilyEnabled flips one family and keeps the rest", async () => {
    get.mockResolvedValue(undefined)
    const next = await setToolFamilyEnabled("web", false)
    expect(next.families.web).toBe(false)
    expect(next.families.browser).toBe(true)
    expect(set).toHaveBeenCalledWith(
      "tools-families-config",
      expect.objectContaining({
        families: expect.objectContaining({ web: false })
      })
    )
  })

  it("serializes concurrent mutations without losing a change", async () => {
    // Stateful store so each write is visible to the next read.
    let store: unknown
    get.mockImplementation(async () => store)
    set.mockImplementation(async (_key: string, value: unknown) => {
      store = value
    })

    // Fire both before awaiting — the race the lock must prevent.
    await Promise.all([
      setToolMasterEnabled(false),
      setToolFamilyEnabled("knowledge", false)
    ])

    expect(store).toMatchObject({
      enabled: false,
      families: expect.objectContaining({ knowledge: false })
    })
  })
})
