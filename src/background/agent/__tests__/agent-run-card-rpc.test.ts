import type { AgentRunState } from "@ollama-client/contracts"
import { AgentGetRunResultSchema } from "@ollama-client/contracts/agent-rpc"
import { beforeEach, describe, expect, it, vi } from "vitest"

const getAgentRun = vi.hoisted(() => vi.fn())

vi.mock("@/lib/repositories/agent-runs", () => ({ getAgentRun }))

import { getAgentRunCard } from "../agent-run-card-rpc"

const run = (patch: Partial<AgentRunState> = {}): AgentRunState => ({
  version: 1,
  id: "run-1",
  goal: "Find the opening hours",
  status: "completed",
  stepCount: 4,
  observationCount: 5,
  controlledTabId: 12,
  providerId: "ollama",
  modelId: "qwen3:8b",
  allowedOrigins: ["https://example.com"],
  result: "Open 9 to 5.",
  outcome: { met: ["r1", "r2"], unmet: ["r3"] },
  createdAt: 1,
  updatedAt: 9,
  ...patch
})

beforeEach(() => {
  getAgentRun.mockReset()
})

describe("the run card RPC", () => {
  it("projects a run onto what the card shows, and nothing else", async () => {
    getAgentRun.mockResolvedValue({ id: "run-1", state: run() })

    const result = await getAgentRunCard({ runId: "run-1" })

    expect(AgentGetRunResultSchema.parse(result)).toEqual(result)
    expect(result.run).toEqual({
      id: "run-1",
      goal: "Find the opening hours",
      status: "completed",
      stepCount: 4,
      result: "Open 9 to 5.",
      outcome: { met: 2, total: 3 },
      updatedAt: 9
    })
  })

  /**
   * The runtime's message is English written for a receipt; the card leads
   * with the advice its code or key names, so the message never travels.
   */
  it("carries a failure as its code and key only", async () => {
    getAgentRun.mockResolvedValue({
      id: "run-1",
      state: run({
        status: "failed",
        result: undefined,
        error: {
          code: "model_unavailable",
          message: "fetch failed at http://localhost:11434",
          messageKey: "errors.provider.proxy_busy",
          retryable: true
        }
      })
    })

    const { run: card } = await getAgentRunCard({ runId: "run-1" })

    expect(card?.error).toEqual({
      code: "model_unavailable",
      messageKey: "errors.provider.proxy_busy"
    })
  })

  it("answers with no run when the row is gone or unreadable", async () => {
    getAgentRun.mockResolvedValueOnce(null)
    await expect(getAgentRunCard({ runId: "gone" })).resolves.toEqual({})

    getAgentRun.mockResolvedValueOnce({ id: "run-1", state: undefined })
    await expect(getAgentRunCard({ runId: "run-1" })).resolves.toEqual({})
  })
})
