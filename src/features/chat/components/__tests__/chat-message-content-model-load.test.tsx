import { act, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ChatMessageContent } from "@/features/chat/components/chat-message-content"
import type { ChatMessage } from "@/types"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))
vi.mock("@/components/markdown-renderer", () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div>{content}</div>
}))

const setting = vi.hoisted(() => ({
  ref: { providerId: "ollama", modelId: "llama3.2" } as {
    providerId: string
    modelId: string
  }
}))
vi.mock("@/hooks/use-setting", () => ({
  useSetting: () => [setting.ref]
}))

const waiting = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  role: "assistant",
  content: "",
  ...overrides
})

const renderBusy = (msg: ChatMessage) =>
  render(<ChatMessageContent msg={msg} isUser={false} isLoading isStreaming />)

describe("loading-model hint", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setting.ref = { providerId: "ollama", modelId: "llama3.2" }
  })
  afterEach(() => vi.useRealTimers())

  it("stays quiet through a normal start", () => {
    renderBusy(waiting())
    act(() => {
      vi.advanceTimersByTime(1_900)
    })

    expect(screen.queryAllByText("chat.reasoning.loading_model")).toHaveLength(
      0
    )
  })

  it("says the model is loading when no first token arrives for two seconds", () => {
    renderBusy(waiting())
    act(() => {
      vi.advanceTimersByTime(2_100)
    })

    expect(
      screen.getAllByText("chat.reasoning.loading_model").length
    ).toBeGreaterThan(0)
  })

  it("does not blame the model while a tool or the context is still running", () => {
    renderBusy(
      waiting({
        metrics: {
          activityEvents: [
            {
              id: "a",
              kind: "searching_files",
              label: "Searching files",
              status: "running",
              startedAt: 1
            }
          ]
        }
      })
    )
    act(() => {
      vi.advanceTimersByTime(5_000)
    })

    expect(screen.queryAllByText("chat.reasoning.loading_model")).toHaveLength(
      0
    )
  })

  it("is only said of Ollama, which loads models on demand", () => {
    setting.ref = { providerId: "custom:openai:remote", modelId: "gpt" }
    renderBusy(waiting())
    act(() => {
      vi.advanceTimersByTime(5_000)
    })

    expect(screen.queryAllByText("chat.reasoning.loading_model")).toHaveLength(
      0
    )
  })

  it("is dropped as soon as text arrives", () => {
    const { rerender } = renderBusy(waiting())
    act(() => {
      vi.advanceTimersByTime(3_000)
    })
    expect(
      screen.getAllByText("chat.reasoning.loading_model").length
    ).toBeGreaterThan(0)

    rerender(
      <ChatMessageContent
        msg={waiting({ content: "Hello" })}
        isUser={false}
        isLoading
        isStreaming
      />
    )

    expect(screen.queryAllByText("chat.reasoning.loading_model")).toHaveLength(
      0
    )
  })
})
