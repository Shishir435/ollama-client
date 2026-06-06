import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ChatMessageContent } from "@/features/chat/components/chat-message-content"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "chat.reasoning.aria_label": "Model reasoning",
        "chat.reasoning.title": "Thought Process",
        "chat.reasoning.trace.planning": "Planning",
        "chat.reasoning.trace.thinking": "Thinking",
        "chat.reasoning.trace.page": "Reading page",
        "chat.reasoning.trace.files": "RAG",
        "chat.reasoning.trace.web": "Searching web",
        "chat.reasoning.trace.answering": "Answering",
        "chat.reasoning.loading_typing": "Typing",
        "chat.reasoning.loading_queued": "Queued",
        "chat.message.loading": "Loading..."
      })[key] ?? key
  })
}))

vi.mock("@/components/markdown-renderer", () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div>{content}</div>
}))

vi.mock("@/features/chat/components/file-attachment-display", () => ({
  FileAttachmentDisplay: () => <div>attachments</div>
}))

describe("ChatMessageContent", () => {
  it("shows trace status without a duplicate typing loader while streaming", () => {
    render(
      <ChatMessageContent
        msg={{ role: "assistant", content: "" }}
        isUser={false}
        isLoading
        isStreaming
      />
    )

    expect(screen.getAllByText("Thinking...").length).toBeGreaterThan(0)
    expect(screen.queryByText("Typing")).not.toBeInTheDocument()
  })
})
