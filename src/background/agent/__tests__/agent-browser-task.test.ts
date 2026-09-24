import type {
  AgentPanelSnapshot,
  AgentRunState
} from "@ollama-client/contracts"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { ToolContext } from "@/lib/tools/types"

const settings = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  writes: [] as [string, unknown][]
}))
vi.mock("@/lib/storage/setting-access", () => ({
  readSetting: vi.fn(
    async (descriptor: { key: string; defaultValue?: unknown }) =>
      settings.values.has(descriptor.key)
        ? settings.values.get(descriptor.key)
        : descriptor.defaultValue
  ),
  writeSetting: vi.fn(async (descriptor: { key: string }, value: unknown) => {
    settings.writes.push([descriptor.key, value])
  })
}))
vi.mock("@/lib/browser-tab-access", () => ({
  classifyAgentTabAccess: vi.fn(async (url: string) =>
    url.startsWith("https://") ? "ok" : "restricted"
  )
}))
vi.mock("../agent-provider-disclosure", () => ({
  resolveAgentProviderDisclosure: vi.fn()
}))

import { STORAGE_KEYS } from "@/lib/constants"
import { createBrowserTaskRunner } from "../agent-browser-task"
import { AgentRunError, type AgentRunService } from "../agent-run-service"

type Provider = AgentPanelSnapshot["provider"]

const local: Provider = {
  name: "Ollama",
  model: "qwen3",
  location: "local",
  screenshots: false,
  readiness: { status: "ready", reason: "metadata", vision: "unsupported" }
}

const remote: Provider = {
  ...local,
  name: "Hosted",
  location: "remote",
  screenshots: true
}

const runState = (patch: Partial<AgentRunState> = {}): AgentRunState => ({
  version: 1,
  id: "run-1",
  goal: "Find the pricing page",
  status: "submitted",
  stepCount: 0,
  observationCount: 0,
  controlledTabId: 7,
  providerId: "ollama",
  modelId: "qwen3",
  allowedOrigins: ["https://example.com"],
  createdAt: 1,
  updatedAt: 1,
  ...patch
})

const turn = (patch: Partial<ToolContext> = {}): ToolContext => ({
  sessionId: "chat-1",
  assistantMessageId: 42,
  providerId: "ollama",
  model: "qwen3",
  browserTabId: 7,
  ...patch
})

const request = { goal: "Find the pricing page", continuePrevious: false }

const serviceStub = (patch: Partial<AgentRunService> = {}) =>
  ({
    delegate: vi.fn(async () => runState()),
    awaitSettled: vi.fn(async () => runState({ status: "completed" })),
    stop: vi.fn(async () => undefined),
    ...patch
  }) as unknown as AgentRunService

const tabs: Record<number, { id: number; url: string }> = {
  7: { id: 7, url: "https://example.com/start" },
  9: { id: 9, url: "https://other.example/page" },
  11: { id: 11, url: "chrome://settings" }
}

const runner = (
  service: AgentRunService,
  provider: Provider = local,
  patch: Partial<Parameters<typeof createBrowserTaskRunner>[0]> = {}
) =>
  createBrowserTaskRunner({
    service,
    disclose: async () => provider,
    getTab: async (id) => tabs[id],
    activeTab: async () => tabs[9],
    readHandoff: async () => ({
      version: 1,
      runId: "run-1",
      goal: "Find the pricing page",
      status: "completed",
      result: "Pricing is under Plans.",
      findings: [],
      settledAt: 2
    }),
    ...patch
  })

beforeEach(() => {
  settings.values.clear()
  settings.writes.length = 0
})

describe("the browser task's start prompt", () => {
  it("names the goal and the banner, and leaves a clean first start to the grant", async () => {
    const demand = await runner(serviceStub()).confirmation(request, turn())

    expect(demand).toEqual({
      always: false,
      summary: "Find the pricing page",
      notes: ["agent.start_gate.supervised"]
    })
  })

  /**
   * A goal written after the model read a page may be what the page told it
   * to write, so no grant from earlier in the chat covers it.
   */
  it("always asks when the turn read page content before the task", async () => {
    const task = runner(serviceStub())

    for (const ctx of [
      turn({ pageContentInContext: true }),
      turn({ taintGeneration: 1 })
    ]) {
      const demand = await task.confirmation(request, ctx)
      expect(demand.always).toBe(true)
      expect(demand.notes).toContain("agent.start_gate.after_page")
    }
  })

  it("always asks about a tab other than the one on screen", async () => {
    const demand = await runner(serviceStub()).confirmation(
      { ...request, tabId: 9 },
      turn()
    )

    expect(demand.always).toBe(true)
    expect(demand.notes).toContain("agent.start_gate.other_tab")
  })

  it("carries the remote notice until it has been acknowledged", async () => {
    const task = runner(serviceStub(), remote)

    const first = await task.confirmation(request, turn())
    expect(first.always).toBe(true)
    expect(first.notes).toContain("agent.privacy.remote_notice_screenshots")

    settings.values.set(
      STORAGE_KEYS.AGENT.REMOTE_OBSERVATION_ACKNOWLEDGED,
      true
    )
    settings.values.set(STORAGE_KEYS.AGENT.REMOTE_SCREENSHOT_ACKNOWLEDGED, true)
    const later = await task.confirmation(request, turn())
    expect(later.always).toBe(false)
  })

  it("scopes its grant to the origin of the tab it would start on", async () => {
    const task = runner(serviceStub())

    await expect(task.origin(request, turn())).resolves.toBe(
      "https://example.com"
    )
    await expect(
      task.origin(request, turn({ browserTabId: undefined }))
    ).resolves.toBe("https://other.example")
  })
})

describe("running a browser task", () => {
  it("delegates into the turn's own row and hands back the run's record", async () => {
    const service = serviceStub()
    const result = await runner(service).run(request, turn())

    expect(service.delegate).toHaveBeenCalledWith({
      goal: "Find the pricing page",
      tabId: 7,
      providerId: "ollama",
      modelId: "qwen3",
      sessionId: "chat-1",
      messageId: 42,
      goalAuthor: "model",
      allowRoutineActions: true
    })
    expect(result.provenance).toBe("web-untrusted")
    expect(result.isError).toBeUndefined()
    expect(result.content).toContain("<agent_runs>")
    expect(result.content).toContain("Result: Pricing is under Plans.")
  })

  it("marks a goal written after reading a page as the model's, not the user's", async () => {
    const service = serviceStub()
    await runner(service).run(
      request,
      turn({ pageContentInContext: true, userConfirmed: true })
    )

    expect(service.delegate).toHaveBeenCalledWith(
      expect.objectContaining({ goalAuthor: "model_after_page" })
    )
  })

  it("mints no routine grants when the user asked to approve each action", async () => {
    settings.values.set(STORAGE_KEYS.AGENT.PERMISSION_MODE, "approve_each")
    const service = serviceStub()
    await runner(service).run(request, turn())

    expect(service.delegate).toHaveBeenCalledWith(
      expect.objectContaining({ allowRoutineActions: false })
    )
  })

  it("names the previous run only when the model says it continues one", async () => {
    const service = serviceStub()
    const task = runner(service)

    await task.run(request, turn({ previousAgentRunId: "run-0" }))
    expect(service.delegate).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ previousRunId: expect.anything() })
    )

    await task.run(
      { ...request, continuePrevious: true },
      turn({ previousAgentRunId: "run-0" })
    )
    expect(service.delegate).toHaveBeenLastCalledWith(
      expect.objectContaining({ previousRunId: "run-0" })
    )
  })

  it("refuses outside a saved chat turn", async () => {
    const service = serviceStub()
    const result = await runner(service).run(
      request,
      turn({ assistantMessageId: undefined })
    )

    expect(result.isError).toBe(true)
    expect(service.delegate).not.toHaveBeenCalled()
  })

  it("refuses a model that cannot drive a run", async () => {
    const service = serviceStub()
    const result = await runner(service, {
      ...local,
      readiness: {
        status: "unsupported",
        reason: "reported_unsupported",
        vision: "unknown"
      }
    }).run(request, turn())

    expect(result.isError).toBe(true)
    expect(service.delegate).not.toHaveBeenCalled()
  })

  /**
   * Tool calling the user switched on is theirs to try, once they approved
   * a prompt that said so; unasked, it is refused like any unconfirmed model.
   */
  it("starts on a model with overridden tool calling only after approval", async () => {
    const experimental: Provider = {
      ...local,
      readiness: {
        status: "experimental",
        reason: "user_override",
        vision: "unknown"
      }
    }
    const service = serviceStub()
    const task = runner(service, experimental)

    expect((await task.run(request, turn())).isError).toBe(true)
    await task.run(request, turn({ userConfirmed: true }))
    expect(service.delegate).toHaveBeenCalledWith(
      expect.objectContaining({ allowExperimentalModel: true })
    )
  })

  it("records the remote acknowledgement the approved prompt carried", async () => {
    const service = serviceStub()
    const task = runner(service, remote)

    expect((await task.run(request, turn())).isError).toBe(true)
    expect(service.delegate).not.toHaveBeenCalled()

    await task.run(request, turn({ userConfirmed: true }))
    expect(settings.writes).toEqual([
      [STORAGE_KEYS.AGENT.REMOTE_OBSERVATION_ACKNOWLEDGED, true],
      [STORAGE_KEYS.AGENT.REMOTE_SCREENSHOT_ACKNOWLEDGED, true]
    ])
    expect(service.delegate).toHaveBeenCalledOnce()
  })

  it("refuses a page the run may not touch", async () => {
    const service = serviceStub()
    const result = await runner(service).run(
      { ...request, tabId: 11 },
      turn({ userConfirmed: true })
    )

    expect(result.isError).toBe(true)
    expect(service.delegate).not.toHaveBeenCalled()
  })

  it("refuses when the tab moved to another site after approval", async () => {
    const service = serviceStub()
    const result = await runner(service).run(
      request,
      turn({ approvedOrigin: "https://other.example", userConfirmed: true })
    )

    expect(result.content).toContain("tab changed")
    expect(service.delegate).not.toHaveBeenCalled()
  })

  it("tells the model why a start was refused", async () => {
    const service = serviceStub({
      delegate: vi.fn(async () => {
        throw new AgentRunError("already_running", "busy")
      })
    })
    const result = await runner(service).run(request, turn())

    expect(result.isError).toBe(true)
    expect(result.content).toContain("Another browser task is still running")
  })

  it("stops waiting, not the run, once the wait runs out", async () => {
    const service = serviceStub({
      awaitSettled: vi.fn(
        (_runId: string, signal?: AbortSignal) =>
          new Promise<AgentRunState>((_resolve, reject) => {
            signal?.addEventListener("abort", () => reject(signal.reason))
          })
      )
    })
    const result = await runner(service, local, { waitMs: 5 }).run(
      request,
      turn()
    )

    expect(result.isError).toBeUndefined()
    expect(result.content).toContain("still running")
    expect(service.stop).not.toHaveBeenCalled()
  })

  it("stops the run when the user stops the turn", async () => {
    const controller = new AbortController()
    const service = serviceStub({
      awaitSettled: vi.fn(
        (_runId: string, signal?: AbortSignal) =>
          new Promise<AgentRunState>((_resolve, reject) => {
            signal?.addEventListener("abort", () => reject(signal.reason))
            controller.abort()
          })
      )
    })
    const result = await runner(service).run(
      request,
      turn({ signal: controller.signal })
    )

    expect(result.isError).toBe(true)
    expect(service.stop).toHaveBeenCalledWith("run-1")
  })

  it("starts nothing for a turn stopped while the task was admitted", async () => {
    const controller = new AbortController()
    controller.abort()
    const service = serviceStub()
    const result = await runner(service).run(
      request,
      turn({ signal: controller.signal })
    )

    expect(result.isError).toBe(true)
    expect(service.delegate).not.toHaveBeenCalled()
  })

  /**
   * A stop that lands while the run is being admitted fires before the wait
   * listens for it; the run that start produced is stopped regardless.
   */
  it("stops the run when the turn was stopped during its start", async () => {
    const controller = new AbortController()
    const service = serviceStub({
      delegate: vi.fn(async () => {
        controller.abort()
        return runState()
      }),
      awaitSettled: vi.fn(
        (_runId: string, signal?: AbortSignal) =>
          new Promise<AgentRunState>((_resolve, reject) => {
            if (signal?.aborted) reject(signal.reason)
            signal?.addEventListener("abort", () => reject(signal.reason))
          })
      )
    })
    const result = await runner(service).run(
      request,
      turn({ signal: controller.signal })
    )

    expect(result.isError).toBe(true)
    expect(service.stop).toHaveBeenCalledWith("run-1")
  })

  /** An older card's Continue must not follow whichever run came last. */
  it("follows the run the card named, whatever ran since", async () => {
    const service = serviceStub()
    await runner(service).run(
      request,
      turn({ previousAgentRunId: "newest", followUpRunId: "older" })
    )

    expect(service.delegate).toHaveBeenCalledWith(
      expect.objectContaining({ previousRunId: "older" })
    )
  })

  it("hands the delegating call's id to the run, and relays a second-task refusal", async () => {
    const service = serviceStub()
    await runner(service).run(request, turn({ toolCallId: "call-1" }))
    expect(service.delegate).toHaveBeenCalledWith(
      expect.objectContaining({ toolCallId: "call-1" })
    )

    const refusing = serviceStub({
      delegate: vi.fn(async () => {
        throw new AgentRunError("turn_has_run", "second")
      })
    })
    const result = await runner(refusing).run(request, turn())
    expect(result.isError).toBe(true)
    expect(result.content).toContain("already ran in this turn")
  })
})
