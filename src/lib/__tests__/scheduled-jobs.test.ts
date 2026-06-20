import { beforeEach, describe, expect, it, vi } from "vitest"
import { STORAGE_KEYS } from "@/lib/constants"
import {
  getPlasmoStoredValue,
  setPlasmoStoredValue
} from "@/lib/plasmo-global-storage"
import {
  getScheduledJobSettings,
  setScheduledJobEnabled
} from "@/lib/scheduled-jobs"

vi.mock("@/lib/plasmo-global-storage", () => ({
  getPlasmoStoredValue: vi.fn(),
  setPlasmoStoredValue: vi.fn()
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe("scheduled job settings", () => {
  it("defaults jobs off", async () => {
    vi.mocked(getPlasmoStoredValue).mockResolvedValue(undefined)

    await expect(getScheduledJobSettings()).resolves.toEqual({
      enabled: { "vector-maintenance": false }
    })
  })

  it("merges stored values over defaults", async () => {
    vi.mocked(getPlasmoStoredValue).mockResolvedValue({
      enabled: { "vector-maintenance": true }
    })

    await expect(getScheduledJobSettings()).resolves.toEqual({
      enabled: { "vector-maintenance": true }
    })
  })

  it("persists an enabled job", async () => {
    vi.mocked(getPlasmoStoredValue).mockResolvedValue(undefined)

    const settings = await setScheduledJobEnabled("vector-maintenance", true)

    expect(settings.enabled["vector-maintenance"]).toBe(true)
    expect(setPlasmoStoredValue).toHaveBeenCalledWith(
      STORAGE_KEYS.BACKGROUND.SCHEDULED_JOBS,
      { enabled: { "vector-maintenance": true } }
    )
  })
})
