import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  createAlarm: vi.fn(),
  clearAlarm: vi.fn(),
  getAlarm: vi.fn(),
  onAlarmAddListener: vi.fn(),
  onStorageChangedAddListener: vi.fn(),
  getScheduledJobSettings: vi.fn(),
  checkStorageLimit: vi.fn(),
  removeDuplicateVectors: vi.fn(),
  loggerWarn: vi.fn(),
  notifyJobComplete: vi.fn()
}))

vi.mock("@/lib/browser-api", () => ({
  supportsAlarms: vi.fn(() => true),
  browser: {
    alarms: {
      create: (...args: unknown[]) => mocks.createAlarm(...args),
      clear: (...args: unknown[]) => mocks.clearAlarm(...args),
      get: (...args: unknown[]) => mocks.getAlarm(...args),
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
  logger: { info: vi.fn(), warn: mocks.loggerWarn }
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
  mocks.getAlarm.mockResolvedValue(null)
  mocks.checkStorageLimit.mockResolvedValue(undefined)
  mocks.removeDuplicateVectors.mockResolvedValue({ deleted: 0, kept: 0 })
})

describe("background scheduled jobs", () => {
  it("creates an alarm for enabled jobs when none exists", async () => {
    mocks.getScheduledJobSettings.mockResolvedValue({
      enabled: { "vector-maintenance": true }
    })

    await syncScheduledJobAlarms()

    expect(mocks.getAlarm).toHaveBeenCalledWith(
      "ollama-client:scheduled-job:vector-maintenance"
    )
    expect(mocks.createAlarm).toHaveBeenCalledWith(
      "ollama-client:scheduled-job:vector-maintenance",
      { delayInMinutes: 5, periodInMinutes: 1440 }
    )
    expect(mocks.getAlarm.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.createAlarm.mock.invocationCallOrder[0]
    )
  })

  it("preserves an existing enabled alarm", async () => {
    mocks.getScheduledJobSettings.mockResolvedValue({
      enabled: { "vector-maintenance": true }
    })
    mocks.getAlarm.mockResolvedValue({ name: "existing" })

    await syncScheduledJobAlarms()

    expect(mocks.createAlarm).not.toHaveBeenCalled()
    expect(mocks.clearAlarm).not.toHaveBeenCalled()
  })

  it("clears an alarm for disabled jobs", async () => {
    await syncScheduledJobAlarms()

    expect(mocks.clearAlarm).toHaveBeenCalledWith(
      "ollama-client:scheduled-job:vector-maintenance"
    )
  })

  it("logs alarm sync failures without throwing", async () => {
    mocks.getScheduledJobSettings.mockResolvedValue({
      enabled: { "vector-maintenance": true }
    })
    mocks.createAlarm.mockRejectedValue(new Error("alarm failed"))

    await expect(syncScheduledJobAlarms()).resolves.toBeUndefined()

    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      "Scheduled job alarm sync failed",
      "ScheduledJobs",
      expect.objectContaining({ jobId: "vector-maintenance" })
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
