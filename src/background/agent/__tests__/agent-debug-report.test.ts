import { beforeEach, describe, expect, it, vi } from "vitest"

const getLatestAgentRun = vi.fn()
const getAgentRun = vi.fn()
const listAgentSteps = vi.fn()

vi.mock("@/lib/repositories/agent-runs", () => ({
  getAgentRun: (...args: unknown[]) => getAgentRun(...args),
  getLatestAgentRun: () => getLatestAgentRun(),
  listAgentSteps: (...args: unknown[]) => listAgentSteps(...args)
}))

const { buildAgentDebugReport } = await import("../agent-debug-report")

const run = {
  id: "run-1",
  status: "failed",
  compacted: false,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_100,
  state: {
    goal: "Ask about the weather",
    status: "failed",
    modelId: "codex/gpt-5.6-luna",
    providerId: "codex",
    observationCount: 5,
    error: { code: "command_refused", message: 'Ref "e149" is not visible' }
  }
}

describe("agent debug report", () => {
  beforeEach(() => {
    getLatestAgentRun.mockReset()
    getAgentRun.mockReset()
    listAgentSteps.mockReset()
  })

  it("carries what a screenshot of the work log loses", async () => {
    /**
     * The panel shows a status per row. Which control the step named, why the
     * verifier refused it, and the failure's own code are the three things a
     * diagnosis needs and the picture does not have.
     */
    getLatestAgentRun.mockResolvedValue(run)
    listAgentSteps.mockResolvedValue([
      {
        sequence: 1,
        runId: "run-1",
        stepId: "run-1:1",
        status: "rejected",
        at: 1,
        risk: "low",
        command: {
          type: "click_point",
          x: 640,
          y: 300,
          snapshotId: "s",
          generation: 1
        },
        sourceUrl: "https://chatgpt.com/",
        verification: {
          outcome: "negative",
          evidence: {
            kind: "resolution",
            summary: 'Ref "e149" is not visible, so it cannot be acted on.',
            observedAt: 2
          }
        }
      }
    ])

    const report = await buildAgentDebugReport()

    expect(report).toMatchObject({
      runId: "run-1",
      status: "failed",
      observations: 5,
      model: "codex/gpt-5.6-luna",
      error: { code: "command_refused" }
    })
    expect(report?.steps[0]).toMatchObject({
      status: "rejected",
      command: "click_point",
      outcome: "negative",
      url: "https://chatgpt.com/"
    })
    /** The coordinates that were refused, which the row cannot show. */
    expect(report?.steps[0]?.detail).toMatchObject({ x: 640, y: 300 })
    expect(report?.steps[0]?.evidence).toContain("is not visible")
  })

  it("reads a named run rather than the last one when asked", async () => {
    getAgentRun.mockResolvedValue(run)
    listAgentSteps.mockResolvedValue([])

    await buildAgentDebugReport("run-9")

    expect(getAgentRun).toHaveBeenCalledWith("run-9")
    expect(getLatestAgentRun).not.toHaveBeenCalled()
  })

  it("answers nothing for a run that is not there", async () => {
    getLatestAgentRun.mockResolvedValue(null)
    expect(await buildAgentDebugReport()).toBeUndefined()
  })
})
