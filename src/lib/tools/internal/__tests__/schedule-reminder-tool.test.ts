import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  scheduleReminder: vi.fn()
}))

vi.mock("@/background/lib/reminders", () => ({
  scheduleReminder: mocks.scheduleReminder
}))

import { runScheduleReminder } from "../schedule-reminder-tool"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.scheduleReminder.mockResolvedValue({
    id: "r1",
    message: "Stretch",
    dueAt: Date.UTC(2026, 5, 20, 18, 0),
    createdAt: Date.UTC(2026, 5, 20, 17, 58)
  })
})

describe("schedule_reminder tool", () => {
  it("schedules a reminder with message and delay", async () => {
    const result = await runScheduleReminder(
      { message: "Stretch", delay_minutes: 2 },
      {}
    )

    expect(result.isError).toBeUndefined()
    expect(mocks.scheduleReminder).toHaveBeenCalledWith({
      message: "Stretch",
      delayMinutes: 2
    })
    expect(result.content).toContain("Reminder scheduled")
    expect(result.content).toContain("Stretch")
  })

  it("rejects missing message", async () => {
    const result = await runScheduleReminder({ delay_minutes: 2 }, {})
    expect(result.isError).toBe(true)
  })

  it("rejects invalid delay", async () => {
    const result = await runScheduleReminder(
      { message: "Stretch", delay_minutes: 0 },
      {}
    )
    expect(result.isError).toBe(true)
  })
})
