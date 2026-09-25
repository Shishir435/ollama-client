import type { AgentRunState } from "@ollama-client/contracts"
import { AgentGetRunResultSchema } from "@ollama-client/contracts/agent-rpc"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { getAgentRun, listAgentSteps } = vi.hoisted(() => ({
  getAgentRun: vi.fn(),
  listAgentSteps: vi.fn()
}))

vi.mock("@/lib/repositories/agent-runs", () => ({
  getAgentRun,
  listAgentSteps
}))

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
  listAgentSteps.mockReset()
  listAgentSteps.mockResolvedValue([])
})

describe("the run card RPC", () => {
  /**
   * The settled card used to drop the work log with the run: one line of
   * result and a count that disagreed with the rows the log had shown.
   */
  it("keeps one row per step and counts the pages they touched", async () => {
    getAgentRun.mockResolvedValue({ id: "run-1", state: run() })
    listAgentSteps.mockResolvedValue([
      {
        runId: "run-1",
        stepId: "run-1:1",
        sequence: 1,
        status: "planned",
        at: 100,
        command: { type: "click", ref: "e1", snapshotId: "s", generation: 1 },
        target: { name: "Delete", rowContext: "old.pdf Delete" },
        sourceUrl: "https://files.test/list?session=secret",
        thinking: "The old file is first.",
        telemetry: { decideMs: 4 }
      },
      {
        runId: "run-1",
        stepId: "run-1:1",
        sequence: 2,
        status: "verified",
        at: 900,
        verification: {
          outcome: "confirmed",
          evidence: { kind: "native_dialog", summary: "x", observedAt: 900 }
        }
      },
      {
        runId: "run-1",
        stepId: "run-1:2",
        sequence: 3,
        status: "verified",
        at: 1_200,
        sourceUrl: "https://files.test/done"
      }
    ])

    const result = await getAgentRunCard({ runId: "run-1" })

    expect(AgentGetRunResultSchema.parse(result)).toEqual(result)
    expect(result.run?.pages).toBe(2)
    expect(result.run?.steps).toHaveLength(2)
    expect(result.run?.steps?.[0]).toMatchObject({
      stepId: "run-1:1",
      status: "verified",
      at: 900,
      startedAt: 100,
      target: { name: "Delete", rowContext: "old.pdf Delete" },
      thinking: "The old file is first."
    })
    expect(result.run?.steps?.[0]).not.toHaveProperty("sourceUrl")
    expect(result.run?.steps?.[0]).not.toHaveProperty("telemetry")
  })

  it("still answers when the steps cannot be read", async () => {
    getAgentRun.mockResolvedValue({ id: "run-1", state: run() })
    listAgentSteps.mockRejectedValue(new Error("unreadable"))

    const result = await getAgentRunCard({ runId: "run-1" })
    expect(result.run?.id).toBe("run-1")
    expect(result.run).not.toHaveProperty("steps")
  })

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
