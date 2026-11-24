import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) =>
      options ? `${key}:${options.role}:${options.title}` : key
  })
}))

import { ChatMessageSearchResults } from "../chat-message-search-results"

const hit = {
  sessionId: "s1",
  messageId: 7,
  role: "assistant" as const,
  timestamp: 1,
  snippet: [
    { text: "the ", match: false },
    { text: "invoice", match: true },
    { text: " is <img src=x onerror=alert(1)>", match: false }
  ]
}

describe("ChatMessageSearchResults", () => {
  it("renders nothing without hits or a pending search", () => {
    const { container } = render(
      <ChatMessageSearchResults rows={[]} searching={false} onOpen={vi.fn()} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it("marks the matched words and shows message text literally, never as markup", () => {
    const { container } = render(
      <ChatMessageSearchResults
        rows={[{ hit, sessionTitle: "Billing" }]}
        searching={false}
        onOpen={vi.fn()}
      />
    )

    expect(container.querySelector("mark")?.textContent).toBe("invoice")
    expect(container.querySelector("img")).toBeNull()
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>")
  })

  it("opens the hit that was clicked", () => {
    const onOpen = vi.fn()
    render(
      <ChatMessageSearchResults
        rows={[{ hit, sessionTitle: "Billing" }]}
        searching={false}
        onOpen={onOpen}
      />
    )

    fireEvent.click(
      screen.getByRole("button", {
        name: "sessions.search.open_result:sessions.export.role_assistant:Billing"
      })
    )
    expect(onOpen).toHaveBeenCalledWith(hit)
  })

  it("shows a pending state while the search is still running", () => {
    render(<ChatMessageSearchResults rows={[]} searching onOpen={vi.fn()} />)
    expect(screen.getByText("sessions.search.searching")).toBeTruthy()
  })
})
