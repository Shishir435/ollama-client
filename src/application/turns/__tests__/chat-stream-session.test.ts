import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  type ChatStreamPort,
  ChatStreamSession,
  type ChatStreamSessionCallbacks
} from "@/application/turns/chat-stream-session"
import { MESSAGE_KEYS } from "@/lib/constants"
import type { ChatMessage } from "@/types"

class FakePort implements ChatStreamPort {
  readonly posted: unknown[] = []
  readonly messageListeners = new Set<(message: unknown) => void>()
  readonly disconnectListeners = new Set<() => void>()
  disconnect = vi.fn()

  postMessage(message: never) {
    this.posted.push(message)
  }

  addMessageListener(listener: (message: unknown) => void) {
    this.messageListeners.add(listener)
  }

  removeMessageListener(listener: (message: unknown) => void) {
    this.messageListeners.delete(listener)
  }

  addDisconnectListener(listener: () => void) {
    this.disconnectListeners.add(listener)
  }

  removeDisconnectListener(listener: () => void) {
    this.disconnectListeners.delete(listener)
  }

  emit(message: unknown) {
    for (const listener of [...this.messageListeners]) listener(message)
  }

  drop() {
    for (const listener of [...this.disconnectListeners]) listener()
  }
}

const startOptions = {
  model: "llama3",
  messages: [{ role: "user" as const, content: "Hello" }]
}

describe("ChatStreamSession", () => {
  let ports: FakePort[]
  let callbacks: ChatStreamSessionCallbacks
  let rendered: ChatMessage[]

  beforeEach(() => {
    ports = []
    rendered = []
    callbacks = {
      onAssistant: (assistant) => {
        rendered.push(assistant)
      },
      onStartRejected: vi.fn(),
      onTerminal: vi.fn()
    }
  })

  const createSession = () =>
    new ChatStreamSession(
      {
        connectPort: () => {
          const port = new FakePort()
          ports.push(port)
          return port
        },
        schedule: (callback) => callback(),
        createRequestId: () => "request-1"
      },
      callbacks
    )

  it("enforces single-flight before and after a port is opened", () => {
    const session = createSession()
    const claim = session.claimStream()

    expect(claim).not.toBeNull()
    expect(session.claimStream()).toBeNull()
    expect(session.start(startOptions, claim ?? undefined)).toBe(true)
    expect(session.start({ ...startOptions, model: "other" })).toBe(false)
    expect(ports).toHaveLength(1)
    expect(callbacks.onStartRejected).toHaveBeenCalledWith("request-1")
  })

  it("parses and reduces stream events without React", () => {
    const session = createSession()
    expect(session.start(startOptions)).toBe(true)

    ports[0].emit({ seq: 0, delta: "Hello" })
    ports[0].emit({ seq: 1, delta: " world", done: true })

    expect(rendered.at(-1)).toMatchObject({ content: "Hello" })
    expect(callbacks.onTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "success",
        message: expect.objectContaining({
          content: "Hello world",
          done: true
        })
      }),
      startOptions
    )
    expect(ports[0].disconnect).toHaveBeenCalledOnce()
  })

  it("reconnects a durable stream and ignores the replaced port", () => {
    const session = createSession()
    const durableTurn = {
      submission: {
        id: "turn-1",
        sessionId: "session-1",
        mode: "new" as const,
        model: "llama3",
        request: {
          version: 1 as const,
          context: {
            rawInput: "Hello",
            messages: [],
            hasTabContext: false,
            contextText: "",
            tabDocuments: [],
            memoryEnabled: false,
            maxTabContextChars: 1000,
            maxRagContextChars: 1000,
            groundedOnlyMode: false,
            selectedModel: "llama3",
            selectedModelRef: null
          },
          userMessage: { role: "user" as const, content: "Hello" }
        },
        createdAt: 1
      },
      userMessageId: 1,
      assistantMessageId: 2
    }
    session.start({ ...startOptions, durableTurn })
    const firstPort = ports[0]
    firstPort.emit({ seq: 3, delta: "partial" })
    firstPort.drop()

    expect(ports).toHaveLength(2)
    expect(ports[1].posted.at(-1)).toEqual({
      version: 1,
      type: MESSAGE_KEYS.PROVIDER.RECONNECT_STREAM,
      payload: { requestId: "turn-1", afterSeq: 3 }
    })
    expect(firstPort.messageListeners.size).toBe(0)

    firstPort.emit({ seq: 4, delta: " stale" })
    ports[1].emit({ seq: 4, delta: " resumed", done: true })
    expect(callbacks.onTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({ content: "partial resumed" })
      }),
      expect.anything()
    )
  })

  it("cancels with the active request id and cleanly finalizes the partial", () => {
    const session = createSession()
    session.start(startOptions)
    ports[0].emit({ delta: "partial" })

    expect(session.stop()).toBe(true)
    expect(ports[0].posted.at(-1)).toEqual({
      version: 1,
      type: MESSAGE_KEYS.PROVIDER.STOP_GENERATION,
      payload: { requestId: "request-1" }
    })
    expect(rendered.at(-1)).toMatchObject({
      content: "partial",
      done: true
    })
    expect(rendered.at(-1)?.metrics?.interrupted).toBeUndefined()
  })
})
