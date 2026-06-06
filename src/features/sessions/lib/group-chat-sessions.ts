import type { ChatSession } from "@/types"

export type SessionGroupId = "today" | "yesterday" | "last7Days" | "older"

export interface GroupedChatSessions {
  id: SessionGroupId
  sessions: ChatSession[]
}

const DAY_MS = 24 * 60 * 60 * 1000

const startOfLocalDay = (time: number) => {
  const date = new Date(time)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

export const getSessionGroupId = (
  updatedAt: number,
  now = Date.now()
): SessionGroupId => {
  const dayDiff = Math.floor(
    (startOfLocalDay(now) - startOfLocalDay(updatedAt)) / DAY_MS
  )

  if (dayDiff <= 0) return "today"
  if (dayDiff === 1) return "yesterday"
  if (dayDiff < 7) return "last7Days"
  return "older"
}

export const groupChatSessions = (
  sessions: ChatSession[],
  now = Date.now()
): GroupedChatSessions[] => {
  const groups: GroupedChatSessions[] = [
    { id: "today", sessions: [] },
    { id: "yesterday", sessions: [] },
    { id: "last7Days", sessions: [] },
    { id: "older", sessions: [] }
  ]
  const byId = new Map(groups.map((group) => [group.id, group]))

  for (const session of sessions) {
    byId.get(getSessionGroupId(session.updatedAt, now))?.sessions.push(session)
  }

  return groups.filter((group) => group.sessions.length > 0)
}
