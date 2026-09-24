import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterAll, describe, expect, it, vi } from "vitest"

import { useAgentChatComposer } from "@/features/agent/lib/agent-chat-composer"
import { useAgentRunRenderer } from "@/features/chat/lib/agent-run-renderer"
import { chatInputStore } from "@/features/chat/stores/chat-input-store"

/** Read when the workspace module loads, so it is set before any import. */
vi.hoisted(() => {
  ;(
    globalThis as { __AGENT_PREVIEW_ENABLED__?: boolean }
  ).__AGENT_PREVIEW_ENABLED__ = true
})

/** What chat receives from the shell, read the way chat reads it. */
const ChatProbe = () => {
  const draft = useAgentChatComposer()
  const renderer = useAgentRunRenderer()
  return (
    <div>
      chat-surface
      <span data-testid="renderer">{renderer ? "card" : "none"}</span>
      {draft && (
        <>
          <button type="button" onClick={() => draft()}>
            card-ask
          </button>
          <button
            type="button"
            onClick={() => draft("Continue the browser task.")}>
            card-continue
          </button>
        </>
      )}
    </div>
  )
}

vi.mock("@/features/chat/components/chat", () => ({
  Chat: () => <ChatProbe />
}))

vi.mock("@/features/agent/agent-workspace", () => ({
  AgentWorkspace: ({ children }: { children: ReactNode }) => children
}))

import { SidepanelWorkspace } from "../sidepanel-workspace"

afterAll(() => {
  delete (globalThis as { __AGENT_PREVIEW_ENABLED__?: boolean })
    .__AGENT_PREVIEW_ENABLED__
})

describe("SidepanelWorkspace", () => {
  /** One workspace: chat, with the Agent's card lent for a run's row. */
  it("hands chat the Agent's card and nothing to switch", async () => {
    render(<SidepanelWorkspace />)

    /** The fallback is plain chat until the Agent chunk has loaded. */
    await waitFor(() =>
      expect(screen.getByTestId("renderer")).toHaveTextContent("card")
    )
    expect(screen.queryByText("act-toggle")).not.toBeInTheDocument()
  })

  it("lets a card ask about its run in chat", async () => {
    const before = chatInputStore.getState().focusRequest
    render(<SidepanelWorkspace />)

    fireEvent.click(await screen.findByRole("button", { name: "card-ask" }))

    expect(chatInputStore.getState().focusRequest).toBe(before + 1)
  })

  /** A follow-up is a message the user still sends, drafted for them. */
  it("drafts a card's follow-up in the chat composer", async () => {
    chatInputStore.getState().setInput("")
    render(<SidepanelWorkspace />)

    fireEvent.click(
      await screen.findByRole("button", { name: "card-continue" })
    )

    expect(chatInputStore.getState().input).toBe("Continue the browser task.")
  })
})
