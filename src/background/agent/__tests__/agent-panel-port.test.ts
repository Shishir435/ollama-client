import type { AgentPanelMessage } from "@ollama-client/contracts"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { registerAgentPanelPort } from "../agent-panel-port"
import { AgentRunError, type AgentRunService } from "../agent-run-service"

const connectListeners = new Set<(port: unknown) => void>()

vi.mock("@/lib/browser-api", () => ({
  browser: {
    runtime: {
      id: "extension-id",
      getURL: () => "chrome-extension://extension-id/",
      onConnect: {
        addListener: (listener: (port: unknown) => void) => {
          connectListeners.add(listener)
        },
        removeListener: (listener: (port: unknown) => void) => {
          connectListeners.delete(listener)
        }
      }
    }
  }
}))

const service = (
  overrides: Partial<AgentRunService> = {}
): AgentRunService => ({
  start: vi.fn(async () => {
    throw new Error("unused")
  }),
  pause: vi.fn(async () => undefined),
  resume: vi.fn(async () => undefined),
  stop: vi.fn(async () => undefined),
  completeTakeover: vi.fn(async () => undefined),
  answerApproval: vi.fn(() => true),
  answerTakeover: vi.fn(() => true),
  snapshot: vi.fn(async () => ({ steps: [] })),
  activeRunId: vi.fn(() => undefined),
  latestRunId: vi.fn(async () => undefined),
  subscribe: vi.fn(() => () => undefined),
  adopt: vi.fn(),
  ...overrides
})

const createPort = (
  sender: Record<string, unknown> = {
    id: "extension-id",
    url: "chrome-extension://extension-id/sidepanel.html"
  },
  name = "agent-run-port"
) => {
  const messages: AgentPanelMessage[] = []
  const onMessage = new Set<(message: unknown) => void>()
  const onDisconnect = new Set<() => void>()
  return {
    messages,
    emit: (message: unknown) => {
      for (const listener of onMessage) listener(message)
    },
    close: () => {
      for (const listener of onDisconnect) listener()
    },
    port: {
      name,
      sender,
      postMessage: (message: AgentPanelMessage) => messages.push(message),
      disconnect: vi.fn(),
      onMessage: { addListener: (l: (m: unknown) => void) => onMessage.add(l) },
      onDisconnect: { addListener: (l: () => void) => onDisconnect.add(l) }
    }
  }
}

const connect = (port: unknown) => {
  for (const listener of connectListeners) listener(port)
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("Agent panel port", () => {
  beforeEach(() => {
    connectListeners.clear()
  })

  it("holds commands and snapshots until startup recovery finishes", async () => {
    let release = () => {}
    const ready = new Promise<void>((resolve) => {
      release = resolve
    })
    const agent = service()
    registerAgentPanelPort({ service: agent, ready })
    const connection = createPort()
    connect(connection.port)
    connection.emit({ type: "agent_resume", runId: "run-1" })
    await settled()
    expect(agent.resume).not.toHaveBeenCalled()
    expect(agent.latestRunId).not.toHaveBeenCalled()
    expect(connection.messages).toEqual([])
    release()
    await settled()
    expect(agent.resume).toHaveBeenCalledWith("run-1")
    expect(agent.latestRunId).toHaveBeenCalled()
  })

  it("refuses a content-script connection", async () => {
    registerAgentPanelPort({ service: service() })
    const { port } = createPort({
      id: "extension-id",
      tab: { id: 7 },
      url: "https://example.com"
    })

    connect(port)
    await settled()

    expect(port.disconnect).toHaveBeenCalledOnce()
  })

  it("ignores ports that are not the Agent run port", async () => {
    registerAgentPanelPort({ service: service() })
    const { port, messages } = createPort(undefined, "chat-stream")

    connect(port)
    await settled()

    expect(port.disconnect).not.toHaveBeenCalled()
    expect(messages).toEqual([])
  })

  it("publishes a snapshot on connect and on every announcement", async () => {
    let announce: ((runId: string) => void) | undefined
    const agent = service({
      activeRunId: () => "run-1",
      latestRunId: async () => "run-1",
      subscribe: (listener) => {
        announce = listener
        return () => undefined
      },
      snapshot: async () => ({
        run: undefined,
        steps: [],
        pending: undefined
      })
    })
    registerAgentPanelPort({
      service: agent,
      resolveProvider: async () => ({
        name: "opencode",
        model: "qwen3",
        location: "local"
      })
    })
    const { port, messages } = createPort()

    connect(port)
    await settled()
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      type: "agent_snapshot",
      snapshot: { provider: { name: "opencode", model: "qwen3" } }
    })

    announce?.("run-1")
    await settled()
    expect(messages).toHaveLength(2)
  })

  it("discloses the provider bound to the run, not the current selection", async () => {
    const resolveProvider = vi.fn(async () => ({
      name: "Run provider",
      model: "run-model",
      location: "remote" as const
    }))
    const agent = service({
      latestRunId: async () => "run-1",
      snapshot: async () => ({
        run: {
          version: 1,
          id: "run-1",
          goal: "Read page",
          status: "paused",
          stepCount: 0,
          observationCount: 1,
          controlledTabId: 7,
          providerId: "run-provider",
          modelId: "run-model",
          allowedOrigins: ["https://example.com"],
          createdAt: 1,
          updatedAt: 2
        },
        steps: []
      })
    })
    registerAgentPanelPort({ service: agent, resolveProvider })

    connect(createPort().port)
    await settled()

    expect(resolveProvider).toHaveBeenCalledWith("run-provider", "run-model")
  })

  it("disconnects on a command the contract does not describe", async () => {
    registerAgentPanelPort({ service: service() })
    const { port, emit } = createPort()

    connect(port)
    await settled()
    emit({ type: "agent_start" })
    await settled()

    expect(port.disconnect).toHaveBeenCalledOnce()
  })

  it("reports a refusal as a key with safe text", async () => {
    const agent = service({
      start: vi.fn(async () => {
        throw new AgentRunError(
          "tab_unsupported",
          "Agent tab access denied: excluded for https://secret.example/page"
        )
      })
    })
    registerAgentPanelPort({ service: agent })
    const { port, emit, messages } = createPort()

    connect(port)
    await settled()
    emit({
      type: "agent_start",
      goal: "Find the pricing page",
      tabId: 7,
      providerId: "ollama",
      modelId: "qwen3"
    })
    await settled()

    const failure = messages.find(
      (message) => message.type === "agent_command_failed"
    )
    expect(failure).toMatchObject({
      command: "agent_start",
      messageKey: "agent.error.tab_unsupported"
    })
    expect(JSON.stringify(failure)).not.toContain("secret.example")
  })

  it("answers the parked request the panel names", async () => {
    const agent = service({
      activeRunId: () => "run-1",
      latestRunId: async () => "run-1"
    })
    registerAgentPanelPort({ service: agent })
    const { port, emit } = createPort()

    connect(port)
    await settled()
    emit({
      type: "agent_approve",
      runId: "run-1",
      requestId: "approval-1"
    })
    await settled()

    expect(agent.answerApproval).toHaveBeenCalledWith({
      runId: "run-1",
      requestId: "approval-1",
      decision: { type: "approved" }
    })
  })

  it("stops publishing once the panel closes", async () => {
    let announce: ((runId: string) => void) | undefined
    const unsubscribe = vi.fn()
    const agent = service({
      activeRunId: () => "run-1",
      latestRunId: async () => "run-1",
      subscribe: (listener) => {
        announce = listener
        return unsubscribe
      }
    })
    registerAgentPanelPort({ service: agent })
    const { port, messages, close } = createPort()

    connect(port)
    await settled()
    const delivered = messages.length
    close()
    announce?.("run-1")
    await settled()

    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(agent.pause).toHaveBeenCalledWith("run-1")
    expect(messages).toHaveLength(delivered)
  })

  it("keeps running while another Agent panel remains connected", async () => {
    const agent = service({ activeRunId: () => "run-1" })
    registerAgentPanelPort({ service: agent })
    const first = createPort()
    const second = createPort()

    connect(first.port)
    connect(second.port)
    await settled()
    first.close()
    await settled()

    expect(agent.pause).not.toHaveBeenCalled()

    second.close()
    await settled()
    expect(agent.pause).toHaveBeenCalledWith("run-1")
  })
})
