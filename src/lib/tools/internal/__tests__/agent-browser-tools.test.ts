import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getTab: vi.fn(),
  createTab: vi.fn(),
  updateTab: vi.fn(),
  onUpdatedAdd: vi.fn(),
  onUpdatedRemove: vi.fn(),
  sendContent: vi.fn(),
  classifyTabAccess: vi.fn()
}))

vi.mock("@/lib/browser-api", () => ({
  browser: {
    tabs: {
      get: (...args: unknown[]) => mocks.getTab(...args),
      create: (...args: unknown[]) => mocks.createTab(...args),
      update: (...args: unknown[]) => mocks.updateTab(...args),
      query: vi.fn(),
      onUpdated: {
        addListener: (...args: unknown[]) => mocks.onUpdatedAdd(...args),
        removeListener: (...args: unknown[]) => mocks.onUpdatedRemove(...args)
      }
    }
  }
}))

vi.mock("../tab-utils", () => ({
  accessDeniedMessage: vi.fn(() => "denied"),
  classifyTabAccess: (...args: unknown[]) => mocks.classifyTabAccess(...args),
  requestContentMessageWithRecovery: (...args: unknown[]) =>
    mocks.sendContent(...args)
}))

vi.mock("@/lib/tools/approval/approval-grants", () => ({
  hasAlwaysGrant: vi.fn(async () => false)
}))

vi.mock("@/background/lib/tool-session-grants", () => ({
  hasSessionGrant: vi.fn(() => false)
}))

import { resolveToolConfirmation } from "@/background/lib/tool-confirmation-registry"
import {
  prepareToolCall,
  runPreparedToolCall
} from "@/background/lib/tool-execution"
import type { ToolContext, ToolRegistry } from "@/lib/tools"
import {
  clickDefinition,
  runNavigate,
  runSnapshotPage
} from "../agent-browser-tools"

const agentContext = (): ToolContext => ({
  sessionId: "session-1",
  agent: {
    targetTabId: 7,
    allowedOrigins: ["https://allowed.example"],
    actionCount: 0,
    maxActions: 15,
    activeMs: 0,
    activeSince: Date.now(),
    maxActiveMs: 15 * 60 * 1000
  }
})

describe("agent browser boundaries", () => {
  beforeEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    mocks.classifyTabAccess.mockResolvedValue("ok")
    mocks.getTab.mockResolvedValue({
      id: 7,
      url: "https://allowed.example/page"
    })
    mocks.sendContent.mockResolvedValue({
      success: true,
      data: {
        snapshotId: "snapshot-1",
        title: "Page",
        url: "https://allowed.example/page",
        elements: [],
        truncated: 0,
        unsupportedCrossOriginFrames: 0
      }
    })
  })

  it("blocks observation outside the run origin allowlist", async () => {
    mocks.getTab.mockResolvedValue({
      id: 7,
      url: "https://blocked.example/page"
    })

    const result = await runSnapshotPage({ tabId: 7 }, agentContext())

    expect(result.isError).toBe(true)
    expect(result.content).toContain("origin boundary blocked")
    expect(mocks.sendContent).not.toHaveBeenCalled()
  })

  it("adds a destination origin only after approved navigation executes", async () => {
    mocks.getTab
      .mockResolvedValueOnce({
        id: 7,
        url: "https://allowed.example/page"
      })
      .mockResolvedValueOnce({
        id: 7,
        url: "https://new.example/path",
        status: "complete"
      })
    mocks.updateTab.mockResolvedValue({ id: 7 })
    const ctx = agentContext()

    const result = await runNavigate(
      { tabId: 7, url: "https://new.example/path" },
      ctx
    )

    expect(result.isError).not.toBe(true)
    expect(ctx.agent?.allowedOrigins).toContain("https://new.example")
  })

  it("waits for navigation readiness and content-runtime recovery", async () => {
    mocks.getTab
      .mockResolvedValueOnce({
        id: 7,
        url: "https://allowed.example/page"
      })
      .mockResolvedValueOnce({
        id: 7,
        url: "https://new.example/path",
        status: "loading"
      })
    mocks.updateTab.mockResolvedValue({ id: 7 })
    mocks.onUpdatedAdd.mockImplementation((listener) => {
      listener(7, { status: "complete" })
    })

    const result = await runNavigate(
      { tabId: 7, url: "https://new.example/path" },
      agentContext()
    )

    expect(result.isError).not.toBe(true)
    expect(mocks.onUpdatedAdd).toHaveBeenCalled()
    expect(mocks.sendContent).toHaveBeenCalled()
  })

  it("uses preflight page origin for approval metadata", async () => {
    mocks.sendContent.mockResolvedValue({
      success: true,
      data: {
        name: "Delete project",
        role: "button",
        url: "https://live.example/projects/1"
      }
    })
    const registry = {
      getDefinition: vi.fn(async () => clickDefinition)
    } as unknown as ToolRegistry

    const prepared = await prepareToolCall(
      registry,
      {
        id: "call-1",
        name: "click",
        arguments: { tabId: 7, snapshotId: "snapshot-1", elementId: 2 }
      },
      undefined,
      agentContext()
    )

    expect(prepared.origin).toBe("https://live.example")
    expect(prepared.run.origin).toBe("https://live.example")
    expect(prepared.run.approvalPreview).toContain("live.example")
  })

  it("marks the agent context when a hard action cap is reached", async () => {
    const ctx = agentContext()
    if (!ctx.agent) throw new Error("missing test agent")
    ctx.agent.actionCount = ctx.agent.maxActions
    const registry = {
      call: vi.fn()
    } as unknown as ToolRegistry

    const result = await runPreparedToolCall(
      {
        call: {
          id: "call-2",
          name: "click",
          arguments: { tabId: 7, snapshotId: "snapshot-1", elementId: 2 }
        },
        run: {
          toolId: "click",
          callId: "call-2",
          label: "click",
          status: "running",
          startedAt: Date.now()
        },
        policy: {
          enabled: true,
          timeoutMs: 1000,
          maxResultChars: 1000,
          cacheable: false,
          parallelizable: false
        },
        requiresConfirmation: true,
        origin: "https://allowed.example"
      },
      registry,
      ctx
    )

    expect(result.result.isError).toBe(true)
    expect(ctx.agent.capReason).toContain("page-action limit")
    expect(registry.call).not.toHaveBeenCalled()
  })

  it("excludes approval waiting from active time", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(2_000)
    const ctx = agentContext()
    if (!ctx.agent) throw new Error("missing test agent")
    ctx.agent.activeSince = 1_000
    const registry = {
      call: vi.fn(async () => ({ content: "clicked" }))
    } as unknown as ToolRegistry

    await runPreparedToolCall(
      {
        call: {
          id: "call-wait",
          name: "click",
          arguments: { tabId: 7, snapshotId: "snapshot-1", elementId: 2 }
        },
        run: {
          toolId: "click",
          callId: "call-wait",
          label: "click",
          status: "running",
          startedAt: 1_000
        },
        policy: {
          enabled: true,
          timeoutMs: 1_000,
          maxResultChars: 1_000,
          cacheable: false,
          parallelizable: false
        },
        requiresConfirmation: true,
        origin: "https://allowed.example"
      },
      registry,
      ctx,
      undefined,
      undefined,
      async () => {
        vi.setSystemTime(12_000)
        resolveToolConfirmation("call-wait", true)
      }
    )

    expect(ctx.agent.activeMs).toBe(1_000)
    expect(ctx.agent.activeSince).toBe(12_000)
  })
})
