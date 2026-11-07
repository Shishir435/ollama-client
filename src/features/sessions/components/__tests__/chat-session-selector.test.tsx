import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ChatSessionSelector } from "../chat-session-selector"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const sessionState = vi.hoisted(() => ({
  sessions: [{ id: "a", title: "First", updatedAt: 1 }] as unknown[],
  deleteSession: vi.fn(),
  openSearchDialog: vi.fn()
}))

vi.mock("@/stores/search-dialog-store", () => ({
  useSearchDialogStore: (
    select: (s: { openSearchDialog: unknown }) => unknown
  ) => select({ openSearchDialog: sessionState.openSearchDialog })
}))

vi.mock("@/features/sessions/stores/chat-session-store", () => ({
  useChatSessions: () => ({
    sessions: sessionState.sessions,
    currentSessionId: null,
    setCurrentSessionId: vi.fn(),
    createSession: vi.fn(),
    deleteSession: sessionState.deleteSession
  })
}))

vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(() => ({ id: 1 }))
}))

vi.mock("@/hooks/use-keyboard-shortcuts", () => ({
  useKeyboardShortcuts: vi.fn()
}))

vi.mock("../chat-session-list", () => ({
  ChatSessionList: ({
    sessions,
    onDelete
  }: {
    sessions: unknown[]
    onDelete: (id: string) => void
  }) =>
    sessions.length > 0 ? (
      <button type="button" onClick={() => onDelete("a")}>
        delete-a
      </button>
    ) : null
}))
vi.mock("../chat-session-footer", () => ({ ChatSessionFooter: () => null }))

const open = () =>
  fireEvent.click(
    screen.getByRole("button", { name: "sessions.selector.title" })
  )

describe("ChatSessionSelector focus", () => {
  it("opens on the search field rather than a tooltip-bearing icon", async () => {
    sessionState.sessions = [{ id: "a", title: "First", updatedAt: 1 }]
    render(<ChatSessionSelector />)
    open()
    const search = await screen.findByRole("searchbox", {
      name: "sessions.selector.search_placeholder"
    })
    await waitFor(() => expect(document.activeElement).toBe(search))
  })

  it("opens on the create button when there is nothing to search", async () => {
    sessionState.sessions = []
    render(<ChatSessionSelector />)
    open()
    await waitFor(() =>
      expect(document.activeElement?.textContent).toBe(
        "sessions.selector.create_new"
      )
    )
  })
})

describe("ChatSessionSelector actions", () => {
  it("asks before deleting a chat and names it", async () => {
    sessionState.sessions = [{ id: "a", title: "First", updatedAt: 1 }]
    sessionState.deleteSession.mockClear()
    render(<ChatSessionSelector />)
    open()
    fireEvent.click(await screen.findByText("delete-a"))

    expect(sessionState.deleteSession).not.toHaveBeenCalled()
    expect(
      await screen.findByText("sessions.delete.confirm_title")
    ).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole("button", { name: "sessions.delete.tooltip" })
    )
    // The real delete waits out the Undo window; the chat is hidden at once.
    expect(sessionState.deleteSession).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByText("delete-a")).toBeNull())
  })

  it("shows a visible message-search row for a non-empty filter", async () => {
    sessionState.sessions = [{ id: "a", title: "First", updatedAt: 1 }]
    sessionState.openSearchDialog.mockClear()
    render(<ChatSessionSelector />)
    open()
    const search = await screen.findByRole("searchbox", {
      name: "sessions.selector.search_placeholder"
    })
    expect(
      screen.queryByText("sessions.selector.search_messages")
    ).not.toBeInTheDocument()
    fireEvent.change(search, { target: { value: "hello" } })
    fireEvent.click(screen.getByText("sessions.selector.search_messages"))
    expect(sessionState.openSearchDialog).toHaveBeenCalledWith("hello")
  })
})
