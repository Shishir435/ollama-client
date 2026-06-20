import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  createAlarm: vi.fn(),
  onAlarmAddListener: vi.fn(),
  getPlasmoStoredValue: vi.fn(),
  setPlasmoStoredValue: vi.fn(),
  notifyJobComplete: vi.fn()
}))

vi.mock("@/lib/browser-api", () => ({
  supportsAlarms: vi.fn(() => true),
  browser: {
    alarms: {
      create: (...args: unknown[]) => mocks.createAlarm(...args),
      clear: vi.fn(),
      onAlarm: { addListener: mocks.onAlarmAddListener }
    }
  }
}))

vi.mock("@/lib/plasmo-global-storage", () => ({
  getPlasmoStoredValue: mocks.getPlasmoStoredValue,
  setPlasmoStoredValue: mocks.setPlasmoStoredValue
}))

vi.mock("@/background/lib/notify", () => ({
  notifyJobComplete: mocks.notifyJobComplete
}))

vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn() }
}))

import {
  alarmNameForReminder,
  fireReminder,
  registerReminderAlarms,
  scheduleReminder
} from "@/background/lib/reminders"
import { STORAGE_KEYS } from "@/lib/constants"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getPlasmoStoredValue.mockResolvedValue({ reminders: [] })
  mocks.setPlasmoStoredValue.mockResolvedValue(undefined)
  mocks.createAlarm.mockResolvedValue(undefined)
})

describe("reminders", () => {
  it("stores a reminder and creates a one-shot alarm", async () => {
    const reminder = await scheduleReminder({
      message: "Stretch",
      delayMinutes: 2
    })

    expect(reminder.message).toBe("Stretch")
    expect(reminder.dueAt).toBeGreaterThan(Date.now())
    expect(mocks.setPlasmoStoredValue).toHaveBeenCalledWith(
      STORAGE_KEYS.BACKGROUND.REMINDERS,
      { reminders: [expect.objectContaining({ message: "Stretch" })] }
    )
    expect(mocks.createAlarm).toHaveBeenCalledWith(
      alarmNameForReminder(reminder.id),
      { when: reminder.dueAt }
    )
  })

  it("fires a reminder, removes it, and sends notification", async () => {
    mocks.getPlasmoStoredValue.mockResolvedValue({
      reminders: [
        { id: "r1", message: "Drink water", dueAt: 123, createdAt: 100 },
        { id: "r2", message: "Keep", dueAt: 456, createdAt: 200 }
      ]
    })

    await fireReminder("r1")

    expect(mocks.setPlasmoStoredValue).toHaveBeenCalledWith(
      STORAGE_KEYS.BACKGROUND.REMINDERS,
      {
        reminders: [{ id: "r2", message: "Keep", dueAt: 456, createdAt: 200 }]
      }
    )
    expect(mocks.notifyJobComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "reminder-r1",
        title: "Reminder",
        message: "Drink water"
      })
    )
  })

  it("registers reminder alarm listener", () => {
    registerReminderAlarms()

    expect(mocks.onAlarmAddListener).toHaveBeenCalledTimes(1)
    const onAlarm = mocks.onAlarmAddListener.mock.calls[0][0]
    onAlarm({ name: "ollama-client:reminder:r1" })

    expect(mocks.getPlasmoStoredValue).toHaveBeenCalled()
  })
})
