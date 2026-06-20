import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  createAlarm: vi.fn(),
  clearAlarm: vi.fn(),
  onAlarmAddListener: vi.fn(),
  onStorageChangedAddListener: vi.fn(),
  getScheduledJobSettings: vi.fn(),
  checkStorageLimit: vi.fn(),
  removeDuplicateVectors: vi.fn(),
  notifyJobComplete: vi.fn()
}))

vi.mock("@/lib/browser-api", () => ({
  supportsAlarms: vi.fn(() => true),
  browser: {
    alarms: {
      create: (...args: unknown[]) => mocks.createAlarm(...args),
      clear: (...args: unknown[]) => mocks.clearAlarm(...args),
      get: vi.fn(),
      onAlarm: { addListener: mocks.onAlarmAddListener }
    },
    storage: {
      onChanged: { addListener: mocks.onStorageChangedAddListener }
    }
  }
}))

vi.mock("@/lib/scheduled-jobs", async () => {
  const actual = await vi.importActual<typeof import("@/lib/scheduled-jobs")>(
    "@/lib/scheduled-jobs"
  )
  return {
    ...actual,
    getScheduledJobSettings: mocks.getScheduledJobSettings
  }
})

vi.mock("@/lib/embeddings/storage", () => ({
  checkStorageLimit: mocks.checkStorageLimit,
  removeDuplicateVectors: mocks.removeDuplicateVectors
}))

vi.mock("@/background/lib/notify", () => ({
  notifyJobComplete: mocks.notifyJobComplete
}))

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn() }
}))

import {
  registerScheduledJobs,
  runScheduledJob,
  syncScheduledJobAlarms
} from "@/background/lib/scheduled-jobs"
import { STORAGE_KEYS } from "@/lib/constants"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getScheduledJobSettings.mockResolvedValue({
    enabled: { "vector-maintenance": false }
  })
  mocks.createAlarm.mockResolvedValue(undefined)
  mocks.clearAlarm.mockResolvedValue(true)
  mocks.checkStorageLimit.mockResolvedValue(undefined)
  mocks.removeDuplicateVectors.mockResolvedValue({ deleted: 0, kept: 0 })
})

describe("background scheduled jobs", () => {
  it("creates an alarm for enabled jobs", async () => {
    mocks.getScheduledJobSettings.mockResolvedValue({
      enabled: { "vector-maintenance": true }
    })

    await syncScheduledJobAlarms()

    expect(mocks.createAlarm).toHaveBeenCalledWith(
      "ollama-client:scheduled-job:vector-maintenance",
      { delayInMinutes: 5, periodInMinutes: 1440 }
    )
  })

  it("clears an alarm for disabled jobs", async () => {
    await syncScheduledJobAlarms()

    expect(mocks.clearAlarm).toHaveBeenCalledWith(
      "ollama-client:scheduled-job:vector-maintenance"
    )
  })

  it("does not run a disabled job", async () => {
    await runScheduledJob("vector-maintenance")

    expect(mocks.checkStorageLimit).not.toHaveBeenCalled()
  })

  it("runs maintenance and notifies when duplicates were removed", async () => {
    mocks.getScheduledJobSettings.mockResolvedValue({
      enabled: { "vector-maintenance": true }
    })
    mocks.removeDuplicateVectors.mockResolvedValue({ deleted: 3, kept: 10 })

    await runScheduledJob("vector-maintenance")

    expect(mocks.checkStorageLimit).toHaveBeenCalled()
    expect(mocks.notifyJobComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "vector-maintenance",
        message: expect.stringContaining("3")
      })
    )
  })

  it("registers alarm and storage listeners", () => {
    registerScheduledJobs()

    expect(mocks.onAlarmAddListener).toHaveBeenCalledTimes(1)
    expect(mocks.onStorageChangedAddListener).toHaveBeenCalledTimes(1)

    const onAlarm = mocks.onAlarmAddListener.mock.calls[0][0]
    onAlarm({ name: "ollama-client:scheduled-job:vector-maintenance" })

    const onStorageChanged = mocks.onStorageChangedAddListener.mock.calls[0][0]
    onStorageChanged({ [STORAGE_KEYS.BACKGROUND.SCHEDULED_JOBS]: {} })

    expect(mocks.getScheduledJobSettings).toHaveBeenCalled()
  })
})
