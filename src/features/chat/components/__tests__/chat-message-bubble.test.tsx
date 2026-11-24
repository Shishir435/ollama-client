import { act, fireEvent, render, screen } from "@testing-library/react"
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
    exportMessageAsPdf: vi.fn()
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
  ChatMessageFooter: ({
    onFork,
    canRetry,
    onRegenerate
  }: {
    onFork?: () => void
    canRetry?: boolean
    onRegenerate?: () => void
  }) => (
    <div>
      {canRetry && (
        <button type="button" onClick={onRegenerate}>
          footer retry
        </button>
      )}
      {onRegenerate && (
        <button type="button" onClick={onRegenerate}>
          switch model
        </button>
      )}
      {onFork && (
        <button type="button" onClick={onFork}>
          fork
        </button>
      )}
    </div>
  )
}))

describe("ChatMessageBubble", () => {
  it("hides fork while another turn is busy", () => {
    render(
      <ChatMessageBubble
        msg={{ role: "user", content: "question", timestamp: 1 }}
        isBusy
        onFork={vi.fn()}
      />
    )

    expect(
      screen.queryByRole("button", { name: "fork" })
    ).not.toBeInTheDocument()
  })

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

    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "chat.errors.open_issue" })
    ).not.toBeInTheDocument()
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
        announceError
      />
    )

    // A failed turn must not read as ordinary model output.
    expect(screen.getByRole("alert")).toBeInTheDocument()
    expect(
      screen.getByText("chat.errors.response_failed_title")
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "chat.errors.open_issue" })
    ).toBeInTheDocument()
    expect(
      screen.getByText("chat.errors.issue_draft_notice")
    ).toBeInTheDocument()
  })

  it("says a finished turn returned no text and offers a Retry", () => {
    const retry = vi.fn()
    render(
      <ChatMessageBubble
        msg={{
          role: "assistant",
          content: "",
          done: true,
          timestamp: 1,
          metrics: { eval_count: 40 }
        }}
        onRegenerate={retry}
      />
    )

    expect(screen.getByText("chat.empty_reply.no_text")).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole("button", { name: "common.actions.retry" })
    )
    expect(retry).toHaveBeenCalledOnce()
    // One Retry, beside the explanation, not a second one in the footer.
    expect(screen.queryByRole("button", { name: "footer retry" })).toBeNull()
  })

  it("says a turn produced only reasoning, and keeps that reasoning", () => {
    render(
      <ChatMessageBubble
        msg={{
          role: "assistant",
          content: "",
          thinking: "weighing it up",
          done: true,
          timestamp: 1,
          metrics: { thinkingOnlyResponse: true }
        }}
        onRegenerate={vi.fn()}
      />
    )

    expect(
      screen.getByText("chat.empty_reply.thinking_only")
    ).toBeInTheDocument()
    expect(screen.queryByText("chat.empty_reply.no_text")).toBeNull()
  })

  it("explains nothing while the turn is still running or was stopped", () => {
    const { rerender } = render(
      <ChatMessageBubble
        msg={{ role: "assistant", content: "", done: false, timestamp: 1 }}
        isStreaming
      />
    )
    expect(screen.queryByText("chat.empty_reply.no_text")).toBeNull()

    rerender(
      <ChatMessageBubble
        msg={{
          role: "assistant",
          content: "",
          done: true,
          timestamp: 1,
          metrics: { interrupted: true }
        }}
      />
    )
    expect(screen.queryByText("chat.empty_reply.no_text")).toBeNull()

    // Stopped by the user before the first token: no completion was reported.
    rerender(
      <ChatMessageBubble
        msg={{ role: "assistant", content: "", done: true, timestamp: 1 }}
      />
    )
    expect(screen.queryByText("chat.empty_reply.no_text")).toBeNull()
  })

  it("does not re-announce an older failure as an alert", () => {
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

    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(
      screen.getByText("chat.errors.response_failed_title")
    ).toBeInTheDocument()
  })
})

it("blocks both footer retries during Retry-After and restores them when it expires", async () => {
  vi.useFakeTimers()
  try {
    const retry = vi.fn()
    const { unmount } = render(
      <ChatMessageBubble
        msg={{
          role: "assistant",
          content: "Rate limited",
          done: true,
          timestamp: Date.now(),
          error: {
            kind: "provider",
            status: 429,
            retryable: true,
            recoveryAction: "wait-retry",
            retryAfterMs: 1000
          }
        }}
        onRegenerate={retry}
      />
    )
    expect(screen.queryByRole("button", { name: "footer retry" })).toBeNull()
    expect(screen.queryByRole("button", { name: "switch model" })).toBeNull()
    expect(
      screen.getByRole("button", { name: "chat.errors.retry_in" })
    ).toBeDisabled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1001)
    })
    fireEvent.click(screen.getByRole("button", { name: "footer retry" }))
    expect(retry).toHaveBeenCalledOnce()
    unmount()
  } finally {
    vi.useRealTimers()
  }
})

describe("ChatMessageBubble recovery", () => {
  const failed = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
    role: "assistant",
    content: "Can't reach Ollama.",
    done: true,
    error: {
      kind: "network",
      userMessage: "Can't reach Ollama.",
      recoveryAction: "test-connection"
    },
    timestamp: 1,
    ...overrides
  })

  it("offers Retry on an unreachable failure from days ago", () => {
    const onRegenerate = vi.fn()
    render(
      <ChatMessageBubble
        msg={failed({ timestamp: Date.now() - 3 * 24 * 60 * 60 * 1000 })}
        onRegenerate={onRegenerate}
      />
    )

    fireEvent.click(
      screen.getByRole("button", { name: "common.actions.retry" })
    )

    expect(onRegenerate).toHaveBeenCalledOnce()
  })

  it("withholds Retry once a high-risk tool has run in the failed turn", () => {
    render(
      <ChatMessageBubble
        msg={failed({
          metrics: {
            toolRuns: [
              {
                toolId: "mcp:send",
                label: "send",
                risk: "high",
                status: "error",
                startedAt: 1
              }
            ]
          }
        })}
        onRegenerate={vi.fn()}
      />
    )

    expect(
      screen.queryByRole("button", { name: "common.actions.retry" })
    ).toBeNull()
    expect(
      screen.getByRole("button", { name: "chat.errors.open_issue" })
    ).toBeInTheDocument()
  })

  it("offers Continue, keeping the partial text, when the stream broke part-way", () => {
    const onContinue = vi.fn()
    render(
      <ChatMessageBubble
        msg={failed({
          content: "The first half of the answer",
          error: {
            kind: "provider",
            userMessage: "The stream dropped.",
            code: "OLC-STREAM-DROPPED"
          }
        })}
        onRegenerate={vi.fn()}
        onContinue={onContinue}
      />
    )

    expect(screen.getByText("The first half of the answer")).toBeInTheDocument()
    expect(screen.getByText("The stream dropped.")).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole("button", { name: "chat.errors.continue" })
    )
    expect(onContinue).toHaveBeenCalledOnce()
  })

  it("offers no Continue when nothing was written before the failure", () => {
    render(
      <ChatMessageBubble
        msg={failed()}
        onRegenerate={vi.fn()}
        onContinue={vi.fn()}
      />
    )

    expect(
      screen.queryByRole("button", { name: "chat.errors.continue" })
    ).toBeNull()
  })
})

describe("ChatMessageBubble context trimming", () => {
  it("tells the user when the page was cut to fit the model's context", () => {
    render(
      <ChatMessageBubble
        msg={{
          role: "assistant",
          content: "Here is the summary",
          done: true,
          metrics: { tabContextTruncated: true }
        }}
      />
    )

    expect(screen.getByText("chat.context.trimmed")).toBeInTheDocument()
  })

  it("says nothing about trimming when the whole page fit", () => {
    render(
      <ChatMessageBubble
        msg={{
          role: "assistant",
          content: "Here is the summary",
          done: true,
          metrics: { tabContextTruncated: false }
        }}
      />
    )

    expect(screen.queryByText("chat.context.trimmed")).toBeNull()
  })

  it("does not show it while the answer is still being written", () => {
    render(
      <ChatMessageBubble
        isStreaming
        msg={{
          role: "assistant",
          content: "Here is",
          metrics: { tabContextTruncated: true }
        }}
      />
    )

    expect(screen.queryByText("chat.context.trimmed")).toBeNull()
  })
})
