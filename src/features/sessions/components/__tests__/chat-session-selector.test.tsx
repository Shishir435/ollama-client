import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ChatSessionSelector } from "../chat-session-selector"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const sessionState = vi.hoisted(() => ({
  sessions: [{ id: "a", title: "First", updatedAt: 1 }] as unknown[]
}))

vi.mock("@/features/sessions/stores/chat-session-store", () => ({
  useChatSessions: () => ({
    sessions: sessionState.sessions,
    currentSessionId: null,
    setCurrentSessionId: vi.fn(),
    createSession: vi.fn(),
    deleteSession: vi.fn()
  })
}))

vi.mock("@/hooks/use-keyboard-shortcuts", () => ({
  useKeyboardShortcuts: vi.fn()
}))

vi.mock("../chat-session-list", () => ({ ChatSessionList: () => null }))
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
