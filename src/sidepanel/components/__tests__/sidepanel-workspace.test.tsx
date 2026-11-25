import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { useState } from "react"
import { afterAll, describe, expect, it, vi } from "vitest"
import { useAgentChatComposer } from "@/features/agent/lib/agent-chat-composer"
import { useAgentRunRenderer } from "@/features/chat/lib/agent-run-renderer"
import { chatInputStore } from "@/features/chat/stores/chat-input-store"

/** Read when the workspace module loads, so it is set before any import. */
const agentChunk = vi.hoisted(() => {
  ;(
    globalThis as { __AGENT_PREVIEW_ENABLED__?: boolean }
  ).__AGENT_PREVIEW_ENABLED__ = true
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
})

/** What chat receives from the shell, read the way chat reads it. */
const ChatProbe = () => {
  const draft = useAgentChatComposer()
  const renderer = useAgentRunRenderer()
  const [sessionsOpen, setSessionsOpen] = useState(false)
  return (
    <div>
      chat-surface
      <span data-testid="renderer">{renderer ? "card" : "none"}</span>
      <button type="button" onClick={() => setSessionsOpen(true)}>
        Open sessions
      </button>
      {sessionsOpen && <dialog open>Chat Sessions</dialog>}
      {draft && (
        <>
          <button type="button" onClick={() => draft()}>
            card-ask
          </button>
          <button
            type="button"
            onClick={() => draft("Continue the browser task.", "run-7")}>
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

vi.mock(import("@/features/agent/agent-workspace"), async (importOriginal) => {
  await agentChunk.promise
  return importOriginal()
})
vi.mock("@/features/agent/hooks/use-agent-run", () => ({
  useAgentRun: () => ({ snapshot: { steps: [] } })
}))
vi.mock("@/features/agent/hooks/use-agent-debug-report", () => ({
  useAgentDebugReport: () => undefined
}))

import { SidepanelWorkspace } from "../sidepanel-workspace"

afterAll(() => {
  delete (globalThis as { __AGENT_PREVIEW_ENABLED__?: boolean })
    .__AGENT_PREVIEW_ENABLED__
})

describe("SidepanelWorkspace", () => {
  it("keeps chat mounted when the Agent chunk loads", async () => {
    render(<SidepanelWorkspace />)

    expect(screen.getByTestId("renderer")).toHaveTextContent("none")
    fireEvent.click(screen.getByRole("button", { name: "Open sessions" }))
    const sheet = screen.getByRole("dialog")
    agentChunk.resolve()

    await waitFor(() =>
      expect(screen.getByTestId("renderer")).toHaveTextContent("card")
    )
    expect(screen.getByRole("dialog")).toBe(sheet)
  })

  it("lets a card ask about its run in chat", async () => {
    agentChunk.resolve()
    const before = chatInputStore.getState().focusRequest
    render(<SidepanelWorkspace />)

    fireEvent.click(await screen.findByRole("button", { name: "card-ask" }))

    expect(chatInputStore.getState().focusRequest).toBe(before + 1)
  })

  /** A follow-up is a message the user still sends, drafted for them. */
  it("drafts a card's follow-up in the chat composer", async () => {
    agentChunk.resolve()
    chatInputStore.getState().setInput("")
    render(<SidepanelWorkspace />)

    fireEvent.click(
      await screen.findByRole("button", { name: "card-continue" })
    )

    expect(chatInputStore.getState().input).toBe("Continue the browser task.")
    expect(chatInputStore.getState().agentFollowUp?.runId).toBe("run-7")
  })

  /** Ask drafts nothing, so the next message follows no card's run. */
  it("forgets a drafted follow-up when a card only asks", async () => {
    agentChunk.resolve()
    render(<SidepanelWorkspace />)

    fireEvent.click(
      await screen.findByRole("button", { name: "card-continue" })
    )
    fireEvent.click(screen.getByRole("button", { name: "card-ask" }))

    expect(chatInputStore.getState().agentFollowUp).toBeUndefined()
  })
})
