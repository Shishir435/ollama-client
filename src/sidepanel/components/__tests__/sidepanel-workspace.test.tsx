import { fireEvent, render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterAll, describe, expect, it, vi } from "vitest"

import { useAgentChatComposer } from "@/features/agent/lib/agent-chat-composer"
import { useAgentRunRenderer } from "@/features/chat/lib/agent-run-renderer"
import { useChatComposerMode } from "@/features/chat/lib/composer-mode"
import { chatInputStore } from "@/features/chat/stores/chat-input-store"

/** Read when the workspace module loads, so it is set before any import. */
vi.hoisted(() => {
  ;(
    globalThis as { __AGENT_PREVIEW_ENABLED__?: boolean }
  ).__AGENT_PREVIEW_ENABLED__ = true
})

/** What chat receives from the shell, read the way chat reads it. */
const ChatProbe = ({ leading }: { leading?: ReactNode }) => {
  const mode = useChatComposerMode()
  const ask = useAgentChatComposer()
  const renderer = useAgentRunRenderer()
  return (
    <div>
      chat-surface
      {leading}
      <span data-testid="mode">{mode?.active ? "act" : "chat"}</span>
      <span data-testid="renderer">{renderer ? "card" : "none"}</span>
      {ask && (
        <button type="button" onClick={ask}>
          card-ask
        </button>
      )}
    </div>
  )
}

vi.mock("@/features/chat/components/chat", () => ({
  Chat: (props: { leading?: ReactNode }) => <ChatProbe {...props} />
}))

vi.mock("@/features/agent/agent-workspace", () => ({
  AgentWorkspace: ({
    children
  }: {
    children: (slots: { toggle: ReactNode; mode: unknown }) => ReactNode
  }) =>
    children({
      toggle: <span>act-toggle</span>,
      mode: {
        active: true,
        inputLabel: "goal",
        placeholder: "goal",
        submitLabel: "Start",
        canSubmit: () => true,
        submit: () => undefined
      }
    })
}))

import { SidepanelWorkspace } from "../sidepanel-workspace"

afterAll(() => {
  delete (globalThis as { __AGENT_PREVIEW_ENABLED__?: boolean })
    .__AGENT_PREVIEW_ENABLED__
})

describe("SidepanelWorkspace", () => {
  /**
   * One workspace: chat, with the Agent lent to it — its switch in the
   * composer's row, its mode on the composer, and its card for a run's row.
   */
  it("hands chat the Agent's switch, composer mode and card", async () => {
    render(<SidepanelWorkspace />)

    expect(await screen.findByText("act-toggle")).toBeInTheDocument()
    expect(screen.getByTestId("mode")).toHaveTextContent("act")
    expect(screen.getByTestId("renderer")).toHaveTextContent("card")
  })

  it("lets a card ask about its run in chat", async () => {
    const before = chatInputStore.getState().focusRequest
    render(<SidepanelWorkspace />)

    fireEvent.click(await screen.findByRole("button", { name: "card-ask" }))

    expect(chatInputStore.getState().focusRequest).toBe(before + 1)
  })
})
