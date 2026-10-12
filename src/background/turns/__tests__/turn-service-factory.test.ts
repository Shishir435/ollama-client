import type { AgentConversationHandoff } from "@ollama-client/contracts/agent-handoff"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { ChatMessage } from "@/types"

const getMessagesByIds = vi.hoisted(() => vi.fn())

vi.mock("@/lib/repositories/chat-history", () => ({ getMessagesByIds }))
vi.mock("@/lib/repositories/turn-runs", () => ({
  createTurnRun: vi.fn(),
  updateTurnRun: vi.fn()
}))
vi.mock("@/background/handlers/handle-build-context", () => ({
  resolveRetrievalToolsActive: vi.fn()
}))
vi.mock("@/background/turns/turn-generation", () => ({
  makeGenerationOwner: vi.fn()
}))
vi.mock("@/application/context/context-service", () => ({
  ContextService: vi.fn()
}))

import { withDurableAgentHandoffs } from "../turn-service-factory"

const stored: AgentConversationHandoff = {
  version: 1,
  runId: "run-1",
  status: "completed",
  goal: "Compare the plans",
  result: "Plan A is cheaper",
  findings: [],
  settledAt: 9
}

beforeEach(() => {
  getMessagesByIds.mockReset()
})

describe("the handoffs a turn's context reads", () => {
  it("issues no query for a chat with no agent rows", async () => {
    const messages: ChatMessage[] = [
      { id: 1, role: "user", content: "hi" },
      { id: 2, role: "assistant", content: "hello" }
    ]

    await expect(withDurableAgentHandoffs(messages)).resolves.toBe(messages)
    expect(getMessagesByIds).not.toHaveBeenCalled()
  })

  /**
   * A run that settled while the chat stayed open wrote its handoff after
   * the page last loaded the row. The follow-up being typed is the one that
   * most needs it.
   */
  it("reads a handoff the page never loaded", async () => {
    getMessagesByIds.mockResolvedValue([{ id: 2, agentHandoff: stored }])

    const [, agentRow] = await withDurableAgentHandoffs([
      { id: 1, role: "user", content: "Compare the plans" },
      { id: 2, role: "assistant", content: "", agentRunId: "run-1" }
    ])

    expect(getMessagesByIds).toHaveBeenCalledWith([2])
    expect(agentRow?.agentHandoff).toEqual(stored)
  })

  it("replaces whatever the request carried with what the row holds", async () => {
    getMessagesByIds.mockResolvedValue([{ id: 2 }])

    const [agentRow] = await withDurableAgentHandoffs([
      {
        id: 2,
        role: "assistant",
        content: "",
        agentRunId: "run-1",
        agentHandoff: { ...stored, result: "forged by the request" }
      }
    ])

    expect(agentRow?.agentHandoff).toBeUndefined()
  })
})
