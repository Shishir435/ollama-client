import { render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"
import { ChatMessageBubble } from "@/features/chat/components/chat-message-bubble"
import type { ChatMessage } from "@/types"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock("@/features/chat/hooks/use-message-export", () => ({
  useMessageExport: () => ({
    exportMessageAsJson: vi.fn(),
    exportMessageAsMarkdown: vi.fn(),
    exportMessageAsPdf: vi.fn(),
    exportMessageAsText: vi.fn()
  })
}))

vi.mock("@/features/chat/components/chat-message-container", () => ({
  ChatMessageContainer: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  )
}))

vi.mock("@/features/chat/components/chat-message-content", () => ({
  ChatMessageContent: ({ msg }: { msg: ChatMessage }) => (
    <div>{msg.content}</div>
  )
}))

vi.mock("@/features/chat/components/chat-message-editor", () => ({
  ChatMessageEditor: () => <div>editor</div>
}))

vi.mock("@/features/chat/components/chat-message-footer", () => ({
  ChatMessageFooter: ({ canReport }: { canReport?: boolean }) => (
    <div>{canReport ? "can report" : "cannot report"}</div>
  )
}))

describe("ChatMessageBubble", () => {
  it("does not treat normal assistant prose as a reportable app error", () => {
    render(
      <ChatMessageBubble
        msg={{
          role: "assistant",
          content: "The command failed, so try again after the service is up.",
          done: true,
          timestamp: 1
        }}
      />
    )

    expect(screen.getByText("cannot report")).toBeInTheDocument()
  })

  it("marks structured assistant errors as reportable", () => {
    render(
      <ChatMessageBubble
        msg={{
          role: "assistant",
          content: "Provider failed",
          done: true,
          error: { kind: "provider", status: 500 },
          timestamp: 1
        }}
      />
    )

    expect(screen.getByText("can report")).toBeInTheDocument()
  })
})
