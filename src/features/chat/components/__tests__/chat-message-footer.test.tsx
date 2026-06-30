import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ChatMessageFooter } from "@/features/chat/components/chat-message-footer"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "chat.actions.delete": "Delete Message",
        "chat.actions.export": "Export",
        "chat.actions.more": "More",
        "chat.actions.switch_model_tooltip": "Switch model"
      })[key] ?? key
  })
}))

vi.mock("@/features/chat/components/copy-button", () => ({
  CopyButton: () => <button type="button">Copy</button>
}))

vi.mock("@/features/chat/components/speech-button", () => ({
  SpeechButton: () => <button type="button">Speak</button>
}))

vi.mock("@/features/chat/components/regenerate-button", () => ({
  RegenerateButton: () => <button type="button">Regenerate</button>
}))

vi.mock("@/features/chat/components/rag-sources-button", () => ({
  RAGSourcesButton: () => <button type="button">Sources</button>
}))

vi.mock("@/features/chat/components/used-context-button", () => ({
  UsedContextButton: () => <button type="button">Context</button>
}))

describe("ChatMessageFooter", () => {
  it("renders connected actions and compact model chip", () => {
    render(
      <ChatMessageFooter
        msg={{
          role: "assistant",
          content: "answer",
          model: "deepseek-r1:8b",
          timestamp: 1
        }}
        isUser={false}
        onExport={vi.fn()}
        onDelete={vi.fn()}
        onRegenerate={vi.fn()}
      />
    )

    expect(
      screen.queryByRole("button", { name: /More/i })
    ).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Export/i })).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /Delete Message/i })
    ).toBeInTheDocument()
    expect(screen.getByText("deepseek-r1:8b")).toBeInTheDocument()
  })
})
