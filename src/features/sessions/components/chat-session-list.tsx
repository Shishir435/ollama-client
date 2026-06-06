import { useMemo } from "react"
import { Virtuoso } from "react-virtuoso"
import { ChatSessionEmpty } from "@/features/sessions/components/chat-session-empty"
import { ChatSessionGroupLabel } from "@/features/sessions/components/chat-session-group-label"
import { ChatSessionItem } from "@/features/sessions/components/chat-session-item"
import { groupChatSessions } from "@/features/sessions/lib/group-chat-sessions"
import type { ChatSession } from "@/types"

type SessionListRow =
  | { type: "group"; id: ReturnType<typeof groupChatSessions>[number]["id"] }
  | { type: "session"; session: ChatSession }

export interface ChatSessionListProps {
  sessions: ChatSession[]
  currentSessionId: string | null
  onSelect: (id: string) => void
  onDelete: (id: string) => void
}

export const ChatSessionList = ({
  sessions,
  currentSessionId,
  onSelect,
  onDelete
}: ChatSessionListProps) => {
  const rows = useMemo<SessionListRow[]>(
    () =>
      groupChatSessions(sessions).flatMap((group) => [
        { type: "group", id: group.id },
        ...group.sessions.map(
          (session): SessionListRow => ({ type: "session", session })
        )
      ]),
    [sessions]
  )

  if (sessions.length === 0) return <ChatSessionEmpty />

  return (
    <Virtuoso
      data={rows}
      className="scrollbar-none"
      itemContent={(_index, row) =>
        row.type === "group" ? (
          <ChatSessionGroupLabel id={row.id} />
        ) : (
          <ChatSessionItem
            session={row.session}
            isActive={row.session.id === currentSessionId}
            onClick={onSelect}
            onDelete={onDelete}
          />
        )
      }
    />
  )
}
