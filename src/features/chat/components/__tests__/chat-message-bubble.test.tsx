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
