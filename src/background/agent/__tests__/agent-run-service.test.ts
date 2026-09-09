import type {
  AgentController,
  AgentPersistencePort
} from "@ollama-client/agent-runtime"
import type { AgentRunState, AgentRunStatus } from "@ollama-client/contracts"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { DurableAgentRun } from "@/lib/repositories/agent-runs"
import type {
  AgentBrowserSessionInterruption,
  AgentBrowserSessionManager
} from "../agent-browser-session-manager"
import { createAgentRunService } from "../agent-run-service"
import { createAgentSupervision } from "../agent-supervision"

const runs = new Map<string, AgentRunState>()

const persistence = (): AgentPersistencePort => ({
  claim: async ({ runId, phase, patch }) => {
    const state = runs.get(runId)
    if (!state) return { claimed: false }
    const next: AgentRunState = { ...state, ...patch, status: phase }
    runs.set(runId, next)
    return { claimed: true, state: next }
  },
  appendStep: async () => undefined,
  transition: async ({ runId, to, patch }) => {
    const state = runs.get(runId)
    if (!state) return { transitioned: false }
    const next: AgentRunState = { ...state, ...patch, status: to }
    runs.set(runId, next)
    return { transitioned: true, state: next }
  },
  load: async (runId) => runs.get(runId),
  steps: async () => []
})

const service = (
  overrides: Partial<Parameters<typeof createAgentRunService>[0]> = {}
) => {
  const controller: AgentController = {
    start: vi.fn(async () => undefined),
    requestPause: vi.fn(async () => undefined),
    resume: vi.fn(async () => undefined),
    requestCancel: vi.fn(async () => undefined),
    completeTakeover: vi.fn(async () => undefined),
    answerQuestion: vi.fn(async () => undefined)
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
    readIncompleteRuns: async () =>
      [...runs.values()]
        .filter(
          (state) =>
            !["completed", "failed", "cancelled"].includes(state.status)
        )
        .map((state) => ({ state, id: state.id }) as DurableAgentRun),
    buildController: () => controller,
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

const browserSessions = () => {
  let listener: ((event: AgentBrowserSessionInterruption) => void) | undefined
  const manager = {
    capabilities: {
      backend: "cdp",
      cdpControl: true,
      domControl: true,
      frameTracking: true
    },
    attach: vi.fn(async (_runId: string, _tabId: number) => undefined),
    detach: vi.fn(async (_runId: string) => undefined),
    isAttached: vi.fn(() => true),
    attachedTabId: vi.fn(() => 7),
    frames: vi.fn(() => ({ status: "tracking" as const, frames: [] })),
    mapFrame: vi.fn(() => ({
      mapped: false as const,
      reason: "no_matching_frame" as const
    })),
    subscribe: vi.fn((next) => {
      listener = next
      return () => {
        if (listener === next) listener = undefined
      }
    }),
    dispose: vi.fn(async () => undefined)
  } satisfies AgentBrowserSessionManager
  return {
    manager,
    interrupt(event: AgentBrowserSessionInterruption) {
      listener?.(event)
    }
  }
}

const transitionController = (to: AgentRunStatus) =>
  vi.fn(({ persistence: port }) => {
    const transition = async (runId: string) => {
      const state = await port.load(runId)
      if (!state) return
      await port.transition({ runId, from: state.status, to })
    }
    return {
      start: vi.fn(async () => undefined),
      requestPause: vi.fn(transition),
      resume: vi.fn(async () => undefined),
      requestCancel: vi.fn(transition),
      completeTakeover: vi.fn(transition),
      answerQuestion: vi.fn(async () => undefined)
    } satisfies AgentController
  })

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

  it("persists and authorizes the tab before attaching browser control", async () => {
    const order: string[] = []
    const browser = browserSessions()
    browser.manager.attach.mockImplementation(async () => {
      order.push("attach")
    })
    const { service: agent } = service({
      browserSessions: browser.manager,
      createRun: async (state) => {
        runs.set(state.id, state)
        order.push("persist")
      },
      classifyAccess: async () => {
        order.push("authorize")
        return "ok"
      }
    })

    await agent.start(startInput)

    expect(order).toEqual(["authorize", "persist", "authorize", "attach"])
    expect(browser.manager.attach).toHaveBeenCalledWith("run-1", 7)
  })

  it("fails durably when Chromium browser control cannot attach", async () => {
    const browser = browserSessions()
    browser.manager.attach.mockRejectedValue(new Error("attach refused"))
    const {
      service: agent,
      controller,
      sessions
    } = service({
      browserSessions: browser.manager
    })

    await expect(agent.start(startInput)).rejects.toMatchObject({
      reason: "browser_control_unavailable"
    })

    expect(runs.get("run-1")).toMatchObject({
      status: "failed",
      error: { code: "observation_failed", retryable: true }
    })
    expect(controller.start).not.toHaveBeenCalled()
    expect(browser.manager.detach).toHaveBeenCalledWith("run-1")
    expect(sessions.release).toHaveBeenCalledWith("run-1")
    expect(agent.activeRunId()).toBeUndefined()
  })

  it("does not start runtime work after an attach is cancelled", async () => {
    const browser = browserSessions()
    browser.manager.attach.mockRejectedValue(
      new DOMException("cancelled", "AbortError")
    )
    const { service: agent, controller } = service({
      browserSessions: browser.manager
    })

    await expect(agent.start(startInput)).resolves.toMatchObject({
      status: "submitted"
    })
    expect(controller.start).not.toHaveBeenCalled()
    expect(runs.get("run-1")?.status).toBe("submitted")
  })

  it("pauses clearly when the debugger disconnects", async () => {
    const browser = browserSessions()
    const { service: agent, controller } = service({
      browserSessions: browser.manager
    })
    await agent.start(startInput)

    browser.interrupt({
      runId: "run-1",
      tabId: 7,
      reason: "debugger_disconnected"
    })

    await vi.waitFor(() =>
      expect(controller.requestPause).toHaveBeenCalledWith(
        "run-1",
        "browser_disconnected"
      )
    )
  })

  /**
   * A controller that claims page work the way the runtime does, so the test
   * can fire a disconnect between the service's ownership check and the claim.
   */
  const claimingController = (
    browser: ReturnType<typeof browserSessions>,
    interruptBefore: "start" | "resume" | "none"
  ) => {
    const claims: boolean[] = []
    const build = vi.fn(({ persistence: port, runId }) => {
      const claim = async (expected: AgentRunStatus) => {
        const result = await port.claim({
          runId,
          phase: "observing",
          expected: [expected]
        })
        claims.push(result.claimed)
      }
      const interrupt = () =>
        browser.interrupt({ runId, tabId: 7, reason: "debugger_disconnected" })
      return {
        start: vi.fn(async () => {
          if (interruptBefore === "start") interrupt()
          await claim("submitted")
        }),
        requestPause: vi.fn(async (id: string, reason?: string) => {
          const state = await port.load(id)
          if (!state || state.status === "paused") return
          await port.transition({
            runId: id,
            from: state.status,
            to: "paused",
            patch: { pauseReason: reason as AgentRunState["pauseReason"] }
          })
        }),
        resume: vi.fn(async () => {
          if (interruptBefore === "resume") interrupt()
          await claim("paused")
        }),
        requestCancel: vi.fn(async () => undefined),
        completeTakeover: vi.fn(async () => undefined),
        answerQuestion: vi.fn(async () => undefined)
      } satisfies AgentController
    })
    return { build, claims }
  }

  it("lets an attached run claim page work", async () => {
    const browser = browserSessions()
    const { build, claims } = claimingController(browser, "none")
    const { service: agent } = service({
      browserSessions: browser.manager,
      buildController: build
    })

    await agent.start(startInput)

    await vi.waitFor(() => expect(claims).toEqual([true]))
    expect(runs.get("run-1")?.status).toBe("observing")
  })

  it("refuses page work when a disconnect races the start", async () => {
    const browser = browserSessions()
    const { build, claims } = claimingController(browser, "start")
    const { service: agent } = service({
      browserSessions: browser.manager,
      buildController: build
    })

    await agent.start(startInput)

    await vi.waitFor(() => expect(claims).toEqual([false]))
    await vi.waitFor(() =>
      expect(runs.get("run-1")).toMatchObject({
        status: "paused",
        pauseReason: "browser_disconnected"
      })
    )
  })

  it("refuses page work when a disconnect races the resume", async () => {
    const browser = browserSessions()
    const { build, claims } = claimingController(browser, "resume")
    const { service: agent } = service({
      browserSessions: browser.manager,
      buildController: build
    })
    await agent.start(startInput)
    await vi.waitFor(() => expect(claims).toEqual([true]))
    claims.length = 0
    runs.set("run-1", {
      ...(runs.get("run-1") as AgentRunState),
      status: "paused",
      pauseReason: "user"
    })

    await agent.resume("run-1")

    expect(claims).toEqual([false])
    expect(runs.get("run-1")?.status).toBe("paused")
  })

  it.each([
    ["pause", "paused"],
    ["stop", "cancelling"]
  ] as const)("detaches browser control on %s", async (method, status) => {
    const browser = browserSessions()
    const { service: agent } = service({
      browserSessions: browser.manager,
      buildController: transitionController(status)
    })
    await agent.start(startInput)

    await agent[method]("run-1")

    expect(browser.manager.detach).toHaveBeenCalledWith("run-1")
    expect(runs.get("run-1")?.status).toBe(status)
  })

  it("admits only one simultaneous start before the durable lookup settles", async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const lookup = vi.fn(async () => {
      await gate
      return []
    })
    let nextId = 0
    const { service: agent, controller } = service({
      readIncompleteRuns: lookup,
      newRunId: () => `run-${++nextId}`
    })
    const first = agent.start(startInput)
    await expect(
      agent.start({ ...startInput, tabId: 8 })
    ).rejects.toMatchObject({ reason: "already_running" })
    expect(lookup).toHaveBeenCalledTimes(1)
    expect(runs.size).toBe(0)
    release()
    await first
    expect(runs.size).toBe(1)
    expect(controller.start).toHaveBeenCalledTimes(1)
  })

  it("holds admission until the insert settles and releases after a failed insert", async () => {
    let rejectInsert: (error: Error) => void = () => {}
    const gate = new Promise<void>((_resolve, reject) => {
      rejectInsert = reject
    })
    const createRun = vi
      .fn(async (state: AgentRunState) => {
        runs.set(state.id, state)
      })
      .mockImplementationOnce(() => gate)
    const { service: agent, controller } = service({ createRun })
    const first = agent.start(startInput)
    const failed = expect(first).rejects.toThrow("insert failed")
    await vi.waitFor(() => expect(createRun).toHaveBeenCalledTimes(1))
    await expect(agent.start(startInput)).rejects.toMatchObject({
      reason: "already_running"
    })
    rejectInsert(new Error("insert failed"))
    await failed
    expect(agent.activeRunId()).toBeUndefined()
    expect(controller.start).not.toHaveBeenCalled()
    await agent.start(startInput)
    expect(runs.size).toBe(1)
    expect(controller.start).toHaveBeenCalledTimes(1)
  })

  it("releases admission after a permission refusal", async () => {
    const hasPerception = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true)
    const { service: agent } = service({ hasPerception })
    await expect(agent.start(startInput)).rejects.toMatchObject({
      reason: "permission_denied"
    })
    await expect(agent.start(startInput)).resolves.toMatchObject({
      id: "run-1"
    })
  })

  it("refuses a second run while one is unresolved", async () => {
    const { service: agent } = service()
    await agent.start(startInput)

    await expect(agent.start(startInput)).rejects.toThrow("already unresolved")
  })

  it("refuses a run the durable rows still hold after a worker restart", async () => {
    const { service: first } = service()
    await first.start(startInput)

    const { service: restarted, controller } = service()
    expect(restarted.activeRunId()).toBeUndefined()
    await expect(restarted.start(startInput)).rejects.toThrow(
      "already unresolved"
    )
    expect(controller.start).not.toHaveBeenCalled()
    expect(restarted.activeRunId()).toBe("run-1")
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

describe("Agent run service tab scope", () => {
  beforeEach(() => {
    runs.clear()
  })

  it("starts with the controlled tab as the run's whole scope", async () => {
    const { service: agent } = service()
    const state = await agent.start(startInput)
    expect(state.scopedTabIds).toEqual([7])
  })

  it("moves the debugger onto the tab the run adopted before page work begins", async () => {
    const browser = browserSessions()
    const order: string[] = []
    browser.manager.detach.mockImplementation(async () => {
      order.push("detach")
    })
    browser.manager.attach.mockImplementation(async (_runId, tabId) => {
      order.push(`attach:${tabId}`)
    })
    const { service: agent } = service({
      browserSessions: browser.manager,
      buildController: vi.fn(({ persistence: port, runId }) => ({
        start: vi.fn(async () => {
          const claimed = await port.claim({
            runId,
            phase: "observing",
            expected: ["submitted"],
            patch: { controlledTabId: 9, scopedTabIds: [7, 9] }
          })
          order.push(`claimed:${claimed.claimed}`)
        }),
        requestPause: vi.fn(async () => undefined),
        resume: vi.fn(async () => undefined),
        requestCancel: vi.fn(async () => undefined),
        completeTakeover: vi.fn(async () => undefined),
        answerQuestion: vi.fn(async () => undefined)
      }))
    })

    await agent.start(startInput)

    await vi.waitFor(() =>
      expect(order).toEqual(["attach:7", "detach", "attach:9", "claimed:true"])
    )
  })
})
