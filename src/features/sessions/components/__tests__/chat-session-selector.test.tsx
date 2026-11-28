import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ChatSessionSelector } from "../chat-session-selector"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const sessionState = vi.hoisted(() => ({
  sessions: [{ id: "a", title: "First", updatedAt: 1 }] as unknown[],
  deleteSession: vi.fn(),
  openSearchDialog: vi.fn(),
  ensureMessageLoaded: vi.fn(async () => undefined),
  setHighlightedMessage: vi.fn(),
  keyword: { hits: [] as unknown[], searching: false },
  store: {} as Record<string, unknown>
}))

vi.mock("@/features/sessions/hooks/use-keyword-chat-search", () => ({
  useKeywordChatSearch: () => sessionState.keyword
}))

vi.mock("@/stores/search-dialog-store", () => ({
  useSearchDialogStore: (
    select: (s: { openSearchDialog: unknown }) => unknown
  ) => select({ openSearchDialog: sessionState.openSearchDialog })
}))

vi.mock("@/features/sessions/stores/chat-session-store", () => ({
  chatSessionStore: { getState: () => sessionState.store },
  useChatSessions: () => ({
    ensureMessageLoaded: sessionState.ensureMessageLoaded,
    setHighlightedMessage: sessionState.setHighlightedMessage,
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

  it("pages back to an older message hit before highlighting it", async () => {
    sessionState.sessions = [{ id: "a", title: "First", updatedAt: 1 }]
    sessionState.keyword = {
      hits: [
        {
          sessionId: "a",
          messageId: 7,
          role: "user",
          timestamp: 1,
          snippet: [{ text: "old words", match: true }]
        }
      ],
      searching: false
    }
    const loadMoreMessages = vi.fn(async () => {
      sessionState.store.sessions = [
        { id: "a", messages: [{ id: 7 }, { id: 9 }] }
      ]
    })
    sessionState.store = {
      currentSessionId: "a",
      sessions: [{ id: "a", messages: [{ id: 9 }] }],
      hasMoreMessages: true,
      loadMoreMessages
    }
    render(<ChatSessionSelector />)
    open()
    fireEvent.click(
      await screen.findByRole("button", { name: "sessions.search.open_result" })
    )

    await waitFor(() =>
      expect(sessionState.setHighlightedMessage).toHaveBeenCalledWith(
        expect.objectContaining({ id: 7 })
      )
    )
    expect(loadMoreMessages).toHaveBeenCalledTimes(1)
    sessionState.keyword = { hits: [], searching: false }
  })

  it("stops paging and highlights nothing once another chat is open", async () => {
    sessionState.setHighlightedMessage.mockClear()
    sessionState.keyword = {
      hits: [
        {
          sessionId: "a",
          messageId: 7,
          role: "user",
          timestamp: 1,
          snippet: [{ text: "old words", match: true }]
        }
      ],
      searching: false
    }
    const loadMoreMessages = vi.fn()
    sessionState.store = {
      currentSessionId: "b",
      sessions: [{ id: "a", messages: [{ id: 9 }] }],
      hasMoreMessages: true,
      loadMoreMessages
    }
    render(<ChatSessionSelector />)
    open()
    fireEvent.click(
      await screen.findByRole("button", { name: "sessions.search.open_result" })
    )

    await waitFor(() =>
      expect(sessionState.ensureMessageLoaded).toHaveBeenCalled()
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(loadMoreMessages).not.toHaveBeenCalled()
    expect(sessionState.setHighlightedMessage).not.toHaveBeenCalled()
    sessionState.keyword = { hits: [], searching: false }
  })

  it("lets a later hit win over one still paging back", async () => {
    sessionState.setHighlightedMessage.mockClear()
    const hit = (messageId: number) => ({
      sessionId: "a",
      messageId,
      role: "user",
      timestamp: 1,
      snippet: [{ text: `words ${messageId}`, match: true }]
    })
    sessionState.keyword = { hits: [hit(1), hit(9)], searching: false }
    let finishPage = () => {}
    const loadMoreMessages = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishPage = () => {
            sessionState.store.sessions = [
              { id: "a", messages: [{ id: 1 }, { id: 9 }] }
            ]
            resolve()
          }
        })
    )
    sessionState.store = {
      currentSessionId: "a",
      sessions: [{ id: "a", messages: [{ id: 9 }] }],
      hasMoreMessages: true,
      loadMoreMessages
    }
    render(<ChatSessionSelector />)
    open()
    const name = "sessions.search.open_result"
    fireEvent.click((await screen.findAllByRole("button", { name }))[0])
    await waitFor(() => expect(loadMoreMessages).toHaveBeenCalledTimes(1))

    open()
    fireEvent.click((await screen.findAllByRole("button", { name }))[1])
    await waitFor(() =>
      expect(sessionState.setHighlightedMessage).toHaveBeenCalledWith(
        expect.objectContaining({ id: 9 })
      )
    )
    finishPage()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(sessionState.setHighlightedMessage).toHaveBeenCalledTimes(1)
    sessionState.keyword = { hits: [], searching: false }
  })

  it("follows a hit however far back it is, and stops when a page adds nothing", async () => {
    sessionState.setHighlightedMessage.mockClear()
    sessionState.keyword = {
      hits: [
        {
          sessionId: "a",
          messageId: 1,
          role: "user",
          timestamp: 1,
          snippet: [{ text: "first words", match: true }]
        }
      ],
      searching: false
    }
    let oldest = 100
    const loadMoreMessages = vi.fn(async () => {
      oldest -= 1
      const [session] = sessionState.store.sessions as Array<{
        messages: Array<{ id: number }>
      }>
      session.messages = [{ id: oldest }, ...session.messages]
    })
    sessionState.store = {
      currentSessionId: "a",
      sessions: [{ id: "a", messages: [{ id: 100 }] }],
      hasMoreMessages: true,
      loadMoreMessages
    }
    render(<ChatSessionSelector />)
    open()
    fireEvent.click(
      await screen.findByRole("button", { name: "sessions.search.open_result" })
    )

    await waitFor(() =>
      expect(sessionState.setHighlightedMessage).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1 })
      )
    )
    expect(loadMoreMessages).toHaveBeenCalledTimes(99)
    sessionState.keyword = { hits: [], searching: false }
  })
})
