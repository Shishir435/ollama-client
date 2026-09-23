import { fireEvent, render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterAll, afterEach, describe, expect, it, vi } from "vitest"

import {
  useAgentChatComposer,
  useAgentSurfaceLauncher
} from "@/features/agent/lib/agent-surface-launcher"
import { useAgentRunRenderer } from "@/features/chat/lib/agent-run-renderer"
import { chatInputStore } from "@/features/chat/stores/chat-input-store"

/** Read when the workspace module loads, so it is set before any import. */
vi.hoisted(() => {
  ;(
    globalThis as { __AGENT_PREVIEW_ENABLED__?: boolean }
  ).__AGENT_PREVIEW_ENABLED__ = true
})

const loadSessionMessages = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock("@/features/sessions/stores/chat-session-store", () => ({
  chatSessionStore: {
    getState: () => ({ currentSessionId: "s-1", loadSessionMessages })
  }
}))

const OpenAgentFromCard = () => {
  const open = useAgentSurfaceLauncher()
  const ask = useAgentChatComposer()
  const renderer = useAgentRunRenderer()
  return open && ask && renderer ? (
    <>
      <button type="button" onClick={open}>
        card-open
      </button>
      <button type="button" onClick={ask}>
        card-ask
      </button>
    </>
  ) : null
}

vi.mock("@/features/chat/components/chat", () => ({
  Chat: ({ leading }: { leading?: ReactNode }) => (
    <div>
      chat-surface
      {leading}
      <OpenAgentFromCard />
    </div>
  )
}))

vi.mock("@/features/agent/agent-panel", () => ({
  AgentPanel: ({ leading }: { leading?: ReactNode }) => (
    <div>
      agent-surface
      {leading}
    </div>
  )
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

import { SidepanelWorkspace } from "../sidepanel-workspace"

afterEach(() => {
  loadSessionMessages.mockClear()
})

afterAll(() => {
  delete (globalThis as { __AGENT_PREVIEW_ENABLED__?: boolean })
    .__AGENT_PREVIEW_ENABLED__
})

describe("SidepanelWorkspace", () => {
  it("hands chat the Agent's card, and lets it open the Agent surface", async () => {
    render(<SidepanelWorkspace />)

    fireEvent.click(screen.getByRole("button", { name: "card-open" }))

    expect(await screen.findByText("agent-surface")).toBeInTheDocument()
  })

  /**
   * A run started on the Agent surface wrote its rows from the background,
   * which the chat store never saw. Without the re-read its card appears only
   * after a reload.
   */
  it("re-reads the open chat when coming back from the Agent", async () => {
    render(<SidepanelWorkspace />)

    fireEvent.click(screen.getByRole("button", { name: "card-open" }))
    await screen.findByText("agent-surface")
    expect(loadSessionMessages).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: "agent.surface.chat" }))

    expect(await screen.findByText("chat-surface")).toBeInTheDocument()
    expect(loadSessionMessages).toHaveBeenCalledWith("s-1")
  })

  it("lets a card ask about its run in chat, staying on the chat surface", () => {
    const before = chatInputStore.getState().focusRequest
    render(<SidepanelWorkspace />)

    fireEvent.click(screen.getByRole("button", { name: "card-ask" }))

    expect(chatInputStore.getState().focusRequest).toBe(before + 1)
    expect(screen.getByText("chat-surface")).toBeInTheDocument()
  })
})
