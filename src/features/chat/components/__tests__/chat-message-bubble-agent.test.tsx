import { render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"
import { ChatMessageBubble } from "@/features/chat/components/chat-message-bubble"
import { AgentRunRendererContext } from "@/features/chat/lib/agent-run-renderer"
import type { ChatMessage } from "@/types"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key })
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
    <div>content:{msg.content}</div>
  )
}))

vi.mock("@/features/chat/components/chat-message-footer", () => ({
  ChatMessageFooter: ({
    onRegenerate,
    canRetry
  }: {
    onRegenerate?: () => void
    canRetry?: boolean
  }) => (
    <div>
      {onRegenerate && <span>regenerate</span>}
      {canRetry && <span>retry</span>}
    </div>
  )
}))

const AgentRunCard = ({ msg }: { msg: ChatMessage }) => (
  <div>card:{msg.agentRunId}</div>
)

const agentRow: ChatMessage = {
  id: 7,
  role: "assistant",
  content: "Open 9 to 5.",
  model: "qwen3:8b",
  agentRunId: "run-1",
  metrics: { interrupted: true }
}

/** Renders the bubble inside a shell that offers the Agent's card. */
const withAgent = (children: ReactNode) => (
  <AgentRunRendererContext.Provider value={AgentRunCard}>
    {children}
  </AgentRunRendererContext.Provider>
)

describe("a message an Agent run reports into", () => {
  /**
   * The run is what the turn delegated and the text is what the model made of
   * its result, so both are shown: the card first, the answer under it.
   */
  it("draws the run's card above the model's answer", async () => {
    render(
      withAgent(<ChatMessageBubble msg={agentRow} onRegenerate={vi.fn()} />)
    )

    const card = await screen.findByText("card:run-1")
    const answer = screen.getByText("content:Open 9 to 5.")
    expect(
      card.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  /**
   * Regenerating the turn would ask the model to start the task again beside
   * a run that already acted on a page, and a retry would do the same.
   */
  it("offers no regenerate or retry", async () => {
    render(
      withAgent(<ChatMessageBubble msg={agentRow} onRegenerate={vi.fn()} />)
    )
    await screen.findByText("card:run-1")

    expect(screen.queryByText("regenerate")).not.toBeInTheDocument()
    expect(screen.queryByText("retry")).not.toBeInTheDocument()
  })

  it("leaves an ordinary assistant message alone", async () => {
    render(
      withAgent(
        <ChatMessageBubble
          msg={{ ...agentRow, agentRunId: undefined }}
          onRegenerate={vi.fn()}
        />
      )
    )

    expect(screen.getByText("content:Open 9 to 5.")).toBeInTheDocument()
    expect(screen.getByText("regenerate")).toBeInTheDocument()
  })

  /**
   * Firefox's shell offers no card, but a backup restored from Chrome still
   * carries the linked rows. They read as the plain answer the terminal
   * commit wrote.
   */
  it("renders as plain text where the shell offers no card", () => {
    render(<ChatMessageBubble msg={agentRow} onRegenerate={vi.fn()} />)

    expect(screen.getByText("content:Open 9 to 5.")).toBeInTheDocument()
    expect(screen.queryByText("card:run-1")).not.toBeInTheDocument()
    expect(screen.queryByText("regenerate")).not.toBeInTheDocument()
  })
})
