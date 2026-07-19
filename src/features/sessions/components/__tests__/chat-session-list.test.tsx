import { fireEvent, render, screen } from "@testing-library/react"
import type React from "react"
import { describe, expect, it, vi } from "vitest"
import { ChatSessionList } from "@/features/sessions/components/chat-session-list"
import type { ChatSession } from "@/types"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === "string" ? fallback : key
  })
}))

vi.mock("react-virtuoso", () => ({
  Virtuoso: ({
    data,
    itemContent
  }: {
    data: unknown[]
    itemContent: (index: number, item: unknown) => React.ReactNode
  }) => <div>{data.map((item, index) => itemContent(index, item))}</div>
}))

vi.mock("@/features/sessions/components/chat-session-actions", () => ({
  ChatSessionActions: ({
    destructiveAction
  }: {
    destructiveAction?: { onClick: () => void }
  }) => (
    <div>
      {destructiveAction && (
        <button type="button" onClick={destructiveAction.onClick}>
          delete
        </button>
      )}
    </div>
  )
}))

vi.mock("@/features/sessions/stores/chat-session-store", () => {
  const mockNow = new Date("2026-06-06T12:00:00").getTime()
  const mockDay = 24 * 60 * 60 * 1000
  return {
    useChatSessions: () => ({
      sessions: [
        { id: "today", title: "today", updatedAt: mockNow },
        { id: "older", title: "older", updatedAt: mockNow - 8 * mockDay }
      ]
    })
  }
})

vi.mock("@/features/sessions/hooks/use-export-chat", () => ({
  useChatExport: () => ({
    exportSessionAsPdf: vi.fn(),
    exportSessionAsJson: vi.fn()
  })
}))

const now = new Date("2026-06-06T12:00:00").getTime()
const day = 24 * 60 * 60 * 1000

const session = (id: string, updatedAt: number): ChatSession => ({
  id,
  title: id,
  createdAt: updatedAt,
  updatedAt,
  messages: []
})

describe("ChatSessionList", () => {
  it("renders grouped sessions and delegates active row actions", () => {
    vi.useFakeTimers({ now })
    const onSelect = vi.fn()
    const onDelete = vi.fn()

    render(
      <ChatSessionList
        sessions={[session("today", now), session("older", now - 8 * day)]}
        currentSessionId="today"
        onSelect={onSelect}
        onDelete={onDelete}
      />
    )

    expect(screen.getByText("Today")).toBeInTheDocument()
    expect(screen.getByText("Older")).toBeInTheDocument()

    const todayButton = screen.getAllByRole("button", {
      name: "sessions.selector.select_session"
    })[0]
    expect(todayButton.parentElement).toHaveClass("bg-app-primary-soft")
    fireEvent.click(todayButton)
    expect(onSelect).toHaveBeenCalledWith("today")

    fireEvent.click(screen.getAllByText("delete")[0])
    expect(onDelete).toHaveBeenCalledWith("today")
    vi.useRealTimers()
  })

  it("filters sessions by title and shows a no-match state", () => {
    vi.useFakeTimers({ now })
    const props = {
      sessions: [
        session("Release notes", now),
        session("Provider setup", now - day)
      ],
      currentSessionId: null,
      onSelect: vi.fn(),
      onDelete: vi.fn()
    }
    const { rerender } = render(<ChatSessionList {...props} query="provider" />)

    expect(screen.getByText("Provider setup")).toBeInTheDocument()
    expect(screen.queryByText("Release notes")).not.toBeInTheDocument()

    rerender(<ChatSessionList {...props} query="missing" />)
    expect(screen.getByText("sessions.selector.no_matches")).toBeInTheDocument()
    vi.useRealTimers()
  })
})
