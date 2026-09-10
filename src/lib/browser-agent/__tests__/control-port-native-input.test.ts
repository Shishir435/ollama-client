import { AgentEffectNotAppliedError } from "@ollama-client/agent-runtime"
import { describe, expect, it, vi } from "vitest"

import { MESSAGE_KEYS } from "@/lib/constants"
import {
  AGENT_CONTROL_VERSION,
  type AgentControlPort,
  type AgentDomMutationInstruction,
  AgentPrepareNativeInputRequestSchema,
  AgentSettleNativeInputRequestSchema,
  attachAgentControlContentPort,
  createAgentControlSession
} from "../control-port"

class FakeEvent<T extends (...args: never[]) => unknown> {
  private listeners = new Set<T>()
  addListener(listener: T) {
    this.listeners.add(listener)
  }
  removeListener(listener: T) {
    this.listeners.delete(listener)
  }
  emit(...args: Parameters<T>) {
    for (const listener of [...this.listeners]) listener(...args)
  }
}

const binding = {
  runId: "run-1",
  tabId: 7,
  frameId: 0 as const,
  nonce: "0123456789abcdef",
  documentId: "document-1"
}

const identity = {
  snapshotId: "snapshot-1",
  generation: 1,
  tabId: 7,
  frameId: 0,
  documentId: "document-1"
}

const instruction = (
  type: "click" | "double_click" | "hover" | "select" = "click"
): AgentDomMutationInstruction =>
  ({
    command: {
      type,
      ref: "e1",
      snapshotId: "snapshot-1",
      generation: 1,
      ...(type === "select" ? { value: "x" } : {})
    },
    target: {
      ref: "e1",
      frameId: 0,
      tag: "div",
      sensitive: false,
      maySubmit: false
    },
    snapshotIdentity: identity,
    frame: identity
  }) as AgentDomMutationInstruction

const createPort = () => {
  const onMessage = new FakeEvent<(message: unknown) => void>()
  const onDisconnect = new FakeEvent<() => void>()
  const port: AgentControlPort = {
    name: MESSAGE_KEYS.AGENT.CONTROL_PORT,
    postMessage: vi.fn(),
    disconnect: vi.fn(),
    onMessage,
    onDisconnect
  }
  return { port, onMessage, onDisconnect }
}

/** Wires a background session straight into a content port, both ends real. */
const connected = (handlers: {
  prepare?: () => { point: { x: number; y: number }; focused: boolean }
  settle?: () => { events: never[] } | undefined
}) => {
  const background = createPort()
  const content = createPort()
  vi.mocked(background.port.postMessage).mockImplementation((raw) =>
    queueMicrotask(() => content.onMessage.emit(raw))
  )
  vi.mocked(content.port.postMessage).mockImplementation((raw) =>
    queueMicrotask(() => background.onMessage.emit(raw))
  )
  const prepareNativeInput = vi.fn(
    handlers.prepare ?? (() => ({ point: { x: 3, y: 4 }, focused: true }))
  )
  const settleNativeInput = vi.fn(handlers.settle ?? (() => ({ events: [] })))
  attachAgentControlContentPort(content.port, {
    buildObservation: vi.fn(),
    executeDomMutation: vi.fn(),
    executeScroll: vi.fn(),
    prepareNativeInput,
    settleNativeInput,
    measureElements: vi.fn(() => []),
    hitTest: vi.fn(() => null)
  })
  const session = createAgentControlSession({
    port: background.port,
    binding,
    sender: { tabId: 7, frameId: 0, documentId: "document-1" }
  })
  return { session, background, content, prepareNativeInput, settleNativeInput }
}

describe("Agent control port native input", () => {
  it("carries a preparation to the page and its point and focus back, then the record", async () => {
    const { session, background, prepareNativeInput } = connected({})
    await expect(
      session.prepareNativeInput(instruction("hover"))
    ).resolves.toEqual({
      point: { x: 3, y: 4 },
      focused: true
    })
    const request = AgentPrepareNativeInputRequestSchema.parse(
      vi.mocked(background.port.postMessage).mock.calls[0]?.[0]
    )
    expect(request.instruction.command.type).toBe("hover")
    expect(prepareNativeInput).toHaveBeenCalledOnce()
    await expect(session.settleNativeInput()).resolves.toEqual({ events: [] })
    const settle = AgentSettleNativeInputRequestSchema.parse(
      vi.mocked(background.port.postMessage).mock.calls[1]?.[0]
    )
    expect(settle.sequence).toBe(2)
  })

  it("turns a typed page-side refusal into a non-applied effect, and any other failure into a control failure", async () => {
    const refused = connected({
      prepare: () => {
        throw new AgentEffectNotAppliedError("covered")
      }
    })
    await expect(
      refused.session.prepareNativeInput(instruction())
    ).rejects.toBeInstanceOf(AgentEffectNotAppliedError)

    const broken = connected({
      prepare: () => {
        throw new Error("layout unavailable")
      }
    })
    await expect(
      broken.session.prepareNativeInput(instruction())
    ).rejects.toMatchObject({ reason: "execution_failed" })
  })

  it("reports an unarmed document as having no record", async () => {
    const { session } = connected({ settle: () => undefined })
    await expect(session.settleNativeInput()).resolves.toBeUndefined()
  })

  it("refuses to prepare a command that is not an element interaction before sending it", () => {
    const { session, background, prepareNativeInput } = connected({})
    expect(() =>
      session.prepareNativeInput({
        ...instruction(),
        command: {
          type: "scroll",
          direction: "down",
          snapshotId: "snapshot-1",
          generation: 1
        }
      } as never)
    ).toThrow(/only DOM mutation commands/)
    expect(background.port.postMessage).not.toHaveBeenCalled()
    expect(prepareNativeInput).not.toHaveBeenCalled()
  })

  it("closes the port on a preparation whose frame binding is not this document", () => {
    const content = createPort()
    const prepareNativeInput = vi.fn()
    attachAgentControlContentPort(content.port, {
      buildObservation: vi.fn(),
      executeDomMutation: vi.fn(),
      executeScroll: vi.fn(),
      prepareNativeInput,
      settleNativeInput: vi.fn(),
      measureElements: vi.fn(() => []),
      hitTest: vi.fn(() => null)
    })
    content.onMessage.emit({
      version: AGENT_CONTROL_VERSION,
      type: "agent_prepare_native_input",
      ...binding,
      sequence: 1,
      instruction: {
        ...instruction(),
        frame: { ...identity, documentId: "document-2" }
      }
    })
    expect(prepareNativeInput).not.toHaveBeenCalled()
    expect(content.port.disconnect).toHaveBeenCalledOnce()
  })
})
