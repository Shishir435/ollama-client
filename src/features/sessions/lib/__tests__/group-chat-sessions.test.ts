import { describe, expect, it } from "vitest"
import {
  getSessionGroupId,
  groupChatSessions
} from "@/features/sessions/lib/group-chat-sessions"
import type { ChatSession } from "@/types"

const day = 24 * 60 * 60 * 1000
const now = new Date("2026-06-06T12:00:00").getTime()

const session = (id: string, updatedAt: number): ChatSession => ({
  id,
  title: id,
  createdAt: updatedAt,
  updatedAt,
  messages: []
})

describe("groupChatSessions", () => {
  it("maps sessions to stable date groups", () => {
    expect(getSessionGroupId(now, now)).toBe("today")
    expect(getSessionGroupId(now - day, now)).toBe("yesterday")
    expect(getSessionGroupId(now - 3 * day, now)).toBe("last7Days")
    expect(getSessionGroupId(now - 8 * day, now)).toBe("older")
  })

  it("preserves session order inside visible groups", () => {
    const groups = groupChatSessions(
      [
        session("today-a", now),
        session("today-b", now - 60_000),
        session("old", now - 10 * day)
      ],
      now
    )

    expect(groups).toEqual([
      {
        id: "today",
        sessions: [
          expect.objectContaining({ id: "today-a" }),
          expect.objectContaining({ id: "today-b" })
        ]
      },
      {
        id: "older",
        sessions: [expect.objectContaining({ id: "old" })]
      }
    ])
  })
})
