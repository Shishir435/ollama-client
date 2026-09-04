import type {
  AgentController,
  AgentPersistencePort
} from "@ollama-client/agent-runtime"
import type { AgentRunState } from "@ollama-client/contracts"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { DurableAgentRun } from "@/lib/repositories/agent-runs"
import { createAgentRunService } from "../agent-run-service"
import { createAgentSupervision } from "../agent-supervision"

vi.mock("@/application/agent/agent-model-port", () => ({
  createProviderAgentModelPort: () => ({ decide: vi.fn() })
}))

const runs = new Map<string, AgentRunState>()

const persistence = (): AgentPersistencePort => ({
  claim: async ({ runId, phase }) => {
    const state = runs.get(runId)
    if (!state) return { claimed: false }
    const next: AgentRunState = { ...state, status: phase }
    runs.set(runId, next)
    return { claimed: true, state: next }
  },
  appendStep: async () => undefined,
  transition: async ({ runId, to }) => {
    const state = runs.get(runId)
    if (!state) return { transitioned: false }
    const next: AgentRunState = { ...state, status: to }
    runs.set(runId, next)
    return { transitioned: true, state: next }
  },
  load: async (runId) => runs.get(runId)
})

const service = (
  overrides: Partial<Parameters<typeof createAgentRunService>[0]> = {}
) => {
  const controller: AgentController = {
    start: vi.fn(async () => undefined),
    requestPause: vi.fn(async () => undefined),
    resume: vi.fn(async () => undefined),
    requestCancel: vi.fn(async () => undefined),
    completeTakeover: vi.fn(async () => undefined)
  }
  const sessions = {
    observe: vi.fn(),
    executeDomMutation: vi.fn(),
    executeScroll: vi.fn(),
    release: vi.fn()
  }
  const created = createAgentRunService({
    sessions,
    persistence: persistence(),
    createRun: vi.fn(async (state: AgentRunState) => {
      runs.set(state.id, state)
    }),
    readRun: async (runId: string) => {
      const state = runs.get(runId)
      return state ? ({ state } as DurableAgentRun) : null
    },
    readSteps: vi.fn(async () => []),
    createController: () => controller,
    hasPerception: async () => true,
    getTab: async () => ({ url: "https://example.com/start" }),
    classifyAccess: async () => "ok",
    now: () => 1_000,
    newRunId: () => "run-1",
    ...overrides
  })
  return { service: created, controller, sessions }
}

const startInput = {
  goal: "Find the pricing page",
  tabId: 7,
  providerId: "ollama",
  modelId: "qwen3"
}

describe("Agent run service", () => {
  beforeEach(() => {
    runs.clear()
  })

  it("starts a run bound to the controlled tab's origin", async () => {
    const { service: agent, controller } = service()
    const state = await agent.start(startInput)

    expect(state).toMatchObject({
      status: "submitted",
      controlledTabId: 7,
      allowedOrigins: ["https://example.com"],
      stepCount: 0
    })
    expect(controller.start).toHaveBeenCalledWith("run-1")
    expect(agent.activeRunId()).toBe("run-1")
  })

  it("refuses a second run while one is unresolved", async () => {
    const { service: agent } = service()
    await agent.start(startInput)

    await expect(agent.start(startInput)).rejects.toThrow("already unresolved")
  })

  it("refuses to start without the perception permission", async () => {
    const { service: agent, controller } = service({
      hasPerception: async () => false
    })

    await expect(agent.start(startInput)).rejects.toThrow("permission")
    expect(controller.start).not.toHaveBeenCalled()
    expect(agent.activeRunId()).toBeUndefined()
  })

  it.each([
    ["restricted tab", { classifyAccess: async () => "excluded" as const }],
    ["addressless tab", { getTab: async () => ({}) }],
    ["non-http page", { getTab: async () => ({ url: "chrome://settings" }) }]
  ])("writes no run row for a %s", async (_label, overrides) => {
    const createRun = vi.fn(async () => undefined)
    const { service: agent } = service({ ...overrides, createRun })

    await expect(agent.start(startInput)).rejects.toThrow()
    expect(createRun).not.toHaveBeenCalled()
    expect(agent.activeRunId()).toBeUndefined()
  })

  it("frees the slot and releases the session once the run settles", async () => {
    const { service: agent, sessions } = service()
    await agent.start(startInput)
    runs.set("run-1", {
      ...(runs.get("run-1") as AgentRunState),
      status: "completed"
    })

    await agent.stop("run-1")

    expect(sessions.release).toHaveBeenCalledWith("run-1")
    expect(agent.activeRunId()).toBeUndefined()
    await expect(agent.start(startInput)).resolves.toMatchObject({
      id: "run-1"
    })
  })

  it("keeps the slot while the run is still unresolved", async () => {
    const { service: agent, sessions } = service()
    await agent.start(startInput)

    await agent.pause("run-1")

    expect(sessions.release).not.toHaveBeenCalled()
    expect(agent.activeRunId()).toBe("run-1")
  })

  it("announces durable writes and supervision changes to subscribers", async () => {
    const supervision = createAgentSupervision()
    const { service: agent } = service({ supervision })
    const listener = vi.fn()
    const stop = agent.subscribe(listener)

    await agent.start(startInput)
    expect(listener).toHaveBeenCalledWith("run-1")

    listener.mockClear()
    void supervision.approval.request(
      {
        id: "approval-1",
        runId: "run-1",
        stepId: "step-1",
        risk: "high",
        action: "Submit",
        consequence: "Places an order",
        createdAt: 1
      },
      { aborted: false }
    )
    expect(listener).toHaveBeenCalledWith("run-1")

    stop()
    expect(
      agent.answerApproval({
        runId: "run-1",
        requestId: "approval-1",
        decision: { type: "approved" }
      })
    ).toBe(true)
  })

  it("reports the run, its steps and any parked request", async () => {
    const { service: agent } = service()
    await agent.start(startInput)

    await expect(agent.snapshot("run-1")).resolves.toMatchObject({
      run: { id: "run-1", goal: "Find the pricing page" },
      steps: []
    })
    await expect(agent.snapshot("unknown")).resolves.toEqual({
      run: undefined,
      steps: [],
      pending: undefined
    })
  })
})
