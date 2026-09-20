import type { AgentApprovalRequest } from "@ollama-client/contracts"
import { describe, expect, it, vi } from "vitest"

import { createAgentSupervision } from "../agent-supervision"

const approval = (
  overrides: Partial<AgentApprovalRequest> = {}
): AgentApprovalRequest => ({
  id: "approval-1",
  runId: "run-1",
  stepId: "step-1",
  risk: "high",
  action: "Submit the order form",
  consequence: "Places an order on example.com",
  createdAt: 1,
  ...overrides
})

const openSignal = () => {
  const controller = new AbortController()
  return { controller, signal: controller.signal }
}

describe("Agent supervision", () => {
  it("resolves the parked wait with the answer for that request", async () => {
    const supervision = createAgentSupervision()
    const { signal } = openSignal()
    const waiting = supervision.approval.request(approval(), signal)

    expect(supervision.pending("run-1")).toEqual({
      kind: "approval",
      request: approval()
    })
    expect(
      supervision.answerApproval({
        runId: "run-1",
        requestId: "approval-1",
        decision: { type: "approved" }
      })
    ).toBe(true)
    await expect(waiting).resolves.toEqual({ type: "approved" })
    expect(supervision.pending("run-1")).toBeUndefined()
  })

  it("ignores an answer that names another request or another kind", async () => {
    const supervision = createAgentSupervision()
    const { signal } = openSignal()
    const waiting = supervision.approval.request(approval(), signal)

    expect(
      supervision.answerApproval({
        runId: "run-1",
        requestId: "approval-0",
        decision: { type: "approved" }
      })
    ).toBe(false)
    expect(
      supervision.answerTakeover({
        runId: "run-1",
        requestId: "approval-1",
        decision: { type: "takeover_started" }
      })
    ).toBe(false)
    expect(
      supervision.answerApproval({
        runId: "run-2",
        requestId: "approval-1",
        decision: { type: "approved" }
      })
    ).toBe(false)

    supervision.answerApproval({
      runId: "run-1",
      requestId: "approval-1",
      decision: { type: "rejected" }
    })
    await expect(waiting).resolves.toEqual({ type: "rejected" })
  })

  it("refuses a second request while one is parked", async () => {
    const supervision = createAgentSupervision()
    const { signal } = openSignal()
    const first = supervision.approval.request(approval(), signal)

    await expect(
      supervision.approval.request(approval({ id: "approval-2" }), signal)
    ).rejects.toThrow("already awaits")
    expect(supervision.pending("run-1")?.request.id).toBe("approval-1")

    supervision.answerApproval({
      runId: "run-1",
      requestId: "approval-1",
      decision: { type: "approved" }
    })
    await expect(first).resolves.toEqual({ type: "approved" })
  })

  it("cannot be answered once the run is cancelled", async () => {
    const supervision = createAgentSupervision()
    const { controller, signal } = openSignal()
    const waiting = supervision.approval.request(approval(), signal)

    controller.abort()
    await expect(waiting).rejects.toThrow("cancelled")
    expect(
      supervision.answerApproval({
        runId: "run-1",
        requestId: "approval-1",
        decision: { type: "approved" }
      })
    ).toBe(false)
  })

  it("rejects immediately for a run whose signal is already aborted", async () => {
    const supervision = createAgentSupervision()
    const { controller, signal } = openSignal()
    controller.abort()

    await expect(
      supervision.approval.request(approval(), signal)
    ).rejects.toThrow("cancelled")
    expect(supervision.pending("run-1")).toBeUndefined()
  })

  it("announces every change so the panel can repaint", async () => {
    const supervision = createAgentSupervision()
    const listener = vi.fn()
    const stop = supervision.subscribe(listener)
    const { signal } = openSignal()

    const waiting = supervision.takeover.request(
      {
        id: "takeover-1",
        runId: "run-1",
        stepId: "step-1",
        reason: "authentication",
        instruction: "Sign in, then hand the run back",
        createdAt: 1
      },
      signal
    )
    expect(listener).toHaveBeenCalledWith("run-1")

    supervision.answerTakeover({
      runId: "run-1",
      requestId: "takeover-1",
      decision: { type: "takeover_started" }
    })
    await expect(waiting).resolves.toEqual({ type: "takeover_started" })
    expect(listener).toHaveBeenCalledTimes(2)

    stop()
    supervision.abandon("run-1")
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it("fails a parked wait it abandons", async () => {
    const supervision = createAgentSupervision()
    const { signal } = openSignal()
    const waiting = supervision.approval.request(approval(), signal)

    supervision.abandon("run-1")
    await expect(waiting).rejects.toThrow("abandoned")
    expect(supervision.pending("run-1")).toBeUndefined()
  })
})
