import {
  makeStreamReducerState,
  reduceStreamEvent,
  type StreamReducerState,
  type StreamReduction,
  type StreamTerminal
} from "@ollama-client/runtime-core/chat-stream-reducer"
import type { DurableTurnStart } from "@/application/turns/turn-contract"
import { MESSAGE_KEYS } from "@/lib/constants"
import {
  CHAT_STREAM_EVENT_TYPES,
  type ChatStreamClientEvent,
  type ChatStreamServerEvent,
  parseChatStreamServerEvent,
  STREAM_PROTOCOL_VERSION
} from "@/protocol/streams"
import type { ChatMessage } from "@/types"

export type ChatStreamClaim = symbol

export interface ChatStreamStartOptions {
  model: string
  providerId?: string
  messages: ChatMessage[]
  sessionId?: string
  generatedMessage?: ChatMessage
  /** See {@link import("@/types/messaging").ChatWithModelMessage}. */
  clientContextPrepared?: boolean
  durableTurn?: DurableTurnStart & { assistantMessageId: number }
}

export interface ChatStreamPort {
  postMessage(message: ChatStreamClientEvent): void
  disconnect(): void
  addMessageListener(listener: (message: unknown) => void): void
  removeMessageListener(listener: (message: unknown) => void): void
  addDisconnectListener(listener: () => void): void
  removeDisconnectListener(listener: () => void): void
}

export interface ChatStreamSessionCallbacks {
  onAssistant?: (
    assistant: ChatMessage,
    options: ChatStreamStartOptions
  ) => void | Promise<void>
  onActivityChange?: (activity: {
    loading: boolean
    streaming: boolean
  }) => void
  onToken?: (token: string) => void
  onTerminal?: (
    terminal: StreamTerminal<ChatMessage>,
    options: ChatStreamStartOptions
  ) => void
  onWarning?: (
    warning: Extract<
      ChatStreamServerEvent,
      { type: typeof CHAT_STREAM_EVENT_TYPES.CONTEXT_WARNING }
    >["payload"]
  ) => void
  onInvalidEvent?: (issueCount: number) => void
  onStartRejected?: (requestId: string | null) => void
  onStopWithoutActiveStream?: () => void
  onStopError?: (error: unknown) => void
  onDisconnectError?: (message: string) => void
}

export interface ChatStreamSessionDependencies {
  connectPort: () => ChatStreamPort
  schedule: (callback: () => void, delayMs: number) => unknown
  createRequestId: () => string
  getLastDisconnectError?: () => string | undefined
}

interface ActiveStream {
  requestId: string
  options: ChatStreamStartOptions
  requestMessage: ChatStreamClientEvent
  port: ChatStreamPort
  state: StreamReducerState<ChatMessage>
  settled: boolean
  resumeAttempts: number
  messageListener?: (message: unknown) => void
  disconnectListener?: () => void
}

const isSettledSnapshot = (
  event: Extract<
    ChatStreamServerEvent,
    { type: typeof CHAT_STREAM_EVENT_TYPES.SNAPSHOT }
  >
) =>
  event.assistant?.done ||
  event.status === "completed" ||
  event.status === "failed" ||
  event.status === "cancelled"

/**
 * Framework-independent owner of one chat stream lifecycle.
 *
 * React supplies effects through callbacks, while this class exclusively owns
 * single-flight admission, ports, protocol parsing, reduction, reconnects and
 * cancellation. A stale port can never mutate the stream that replaced it.
 */
export class ChatStreamSession {
  private callbacks: ChatStreamSessionCallbacks
  private claim: ChatStreamClaim | null = null
  private active: ActiveStream | null = null

  constructor(
    private readonly dependencies: ChatStreamSessionDependencies,
    callbacks: ChatStreamSessionCallbacks = {}
  ) {
    this.callbacks = callbacks
  }

  updateCallbacks(callbacks: ChatStreamSessionCallbacks) {
    this.callbacks = callbacks
  }

  claimStream(): ChatStreamClaim | null {
    if (this.active || this.claim) return null
    this.claim = Symbol("chat-stream-claim")
    return this.claim
  }

  releaseStreamClaim(claim: ChatStreamClaim) {
    if (this.claim === claim) this.claim = null
  }

  start(
    options: ChatStreamStartOptions,
    suppliedClaim?: ChatStreamClaim
  ): boolean {
    if (this.active) {
      if (suppliedClaim) this.releaseStreamClaim(suppliedClaim)
      this.callbacks.onStartRejected?.(this.active.requestId)
      return false
    }

    const claim = suppliedClaim ?? this.claimStream()
    if (!claim || this.claim !== claim) {
      this.callbacks.onStartRejected?.(null)
      return false
    }
    this.claim = null

    const requestId =
      options.durableTurn?.submission.id || this.dependencies.createRequestId()
    const requestMessage: ChatStreamClientEvent = options.durableTurn
      ? {
          version: STREAM_PROTOCOL_VERSION,
          type: MESSAGE_KEYS.PROVIDER.START_TURN,
          payload: {
            start: {
              submission: options.durableTurn.submission,
              userMessageId: options.durableTurn.userMessageId
            },
            assistantMessageId: options.durableTurn.assistantMessageId
          }
        }
      : {
          version: STREAM_PROTOCOL_VERSION,
          type: MESSAGE_KEYS.PROVIDER.CHAT_WITH_MODEL,
          payload: {
            model: options.model,
            providerId: options.providerId,
            messages: options.messages,
            sessionId: options.sessionId,
            requestId,
            clientContextPrepared: options.clientContextPrepared
          }
        }
    const assistant = options.generatedMessage || {
      role: "assistant" as const,
      content: "",
      model: options.model
    }
    const active: ActiveStream = {
      requestId,
      options,
      requestMessage,
      port: this.dependencies.connectPort(),
      state: makeStreamReducerState(assistant),
      settled: false,
      resumeAttempts: 0
    }
    this.active = active
    this.callbacks.onActivityChange?.({ loading: true, streaming: false })
    this.callbacks.onAssistant?.(assistant, options)
    this.attach(active, active.port)
    active.port.postMessage(requestMessage)
    return true
  }

  stop(): boolean {
    const active = this.active
    if (!active) {
      this.callbacks.onStopWithoutActiveStream?.()
      this.callbacks.onActivityChange?.({ loading: false, streaming: false })
      return false
    }

    try {
      if (!active.state.assistant.done) {
        active.state = {
          ...active.state,
          assistant: { ...active.state.assistant, done: true }
        }
        this.callbacks.onAssistant?.(active.state.assistant, active.options)
      }
      active.port.postMessage({
        version: STREAM_PROTOCOL_VERSION,
        type: MESSAGE_KEYS.PROVIDER.STOP_GENERATION,
        payload: { requestId: active.requestId }
      })
      this.finish(active)
      return true
    } catch (error) {
      this.callbacks.onStopError?.(error)
      this.finish(active)
      return false
    }
  }

  private readonly handleMessage = (active: ActiveStream, raw: unknown) => {
    if (!this.isCurrent(active)) return
    const parsed = parseChatStreamServerEvent(raw)
    if (!parsed.success) {
      this.callbacks.onInvalidEvent?.(parsed.error.issues.length)
      return
    }
    const event = parsed.data

    if (event.type === CHAT_STREAM_EVENT_TYPES.CONTEXT_WARNING) {
      this.callbacks.onWarning?.(event.payload)
      return
    }
    if (
      event.type === CHAT_STREAM_EVENT_TYPES.CONTEXT_PROGRESS ||
      event.type === CHAT_STREAM_EVENT_TYPES.CONTEXT_RESULT ||
      event.type === CHAT_STREAM_EVENT_TYPES.CONTEXT_ERROR ||
      event.type === MESSAGE_KEYS.BROWSER.SELECTION_ACTION_CHUNK ||
      event.type === MESSAGE_KEYS.BROWSER.SELECTION_ACTION_DONE ||
      event.type === MESSAGE_KEYS.BROWSER.SELECTION_ACTION_ERROR
    ) {
      return
    }
    if (event.type === CHAT_STREAM_EVENT_TYPES.SNAPSHOT) {
      if (!event.sequenceReset && event.seq < active.state.lastSeq) return
      if (event.assistant) {
        active.state = {
          ...makeStreamReducerState(event.assistant),
          ...(event.thinkingState
            ? { thinkingState: event.thinkingState }
            : {}),
          lastSeq: event.seq,
          started: Boolean(event.assistant.content || event.assistant.thinking)
        }
        this.callbacks.onAssistant?.(event.assistant, active.options)
      } else {
        active.state = { ...active.state, lastSeq: event.seq }
      }
      if (isSettledSnapshot(event)) this.finish(active)
      return
    }

    const result: StreamReduction<ChatMessage> = reduceStreamEvent(
      active.state,
      event
    )
    active.state = result.state
    if (result.dropped) return
    if (result.justStarted) {
      this.callbacks.onActivityChange?.({ loading: true, streaming: true })
    }
    for (const token of result.tokens) this.callbacks.onToken?.(token)
    if (result.terminal) {
      this.callbacks.onTerminal?.(result.terminal, active.options)
      this.finish(active)
      return
    }
    if (result.changed) {
      this.callbacks.onAssistant?.(active.state.assistant, active.options)
    }
  }

  private readonly handleDisconnect = (
    active: ActiveStream,
    disconnectedPort: ChatStreamPort
  ) => {
    if (!this.isCurrent(active) || active.port !== disconnectedPort) return
    const disconnectError = this.dependencies.getLastDisconnectError?.()
    if (disconnectError) this.callbacks.onDisconnectError?.(disconnectError)

    const awaitingConfirmation =
      active.state.assistant.metrics?.toolRuns?.some(
        (run) => run.status === "awaiting-confirmation"
      ) ?? false
    if (
      !active.state.assistant.done &&
      (active.options.durableTurn !== undefined || awaitingConfirmation) &&
      active.resumeAttempts < 3
    ) {
      active.resumeAttempts += 1
      this.detach(active, disconnectedPort)
      this.dependencies.schedule(() => this.reconnect(active), 250)
      return
    }

    if (!active.state.assistant.done) {
      active.state = {
        ...active.state,
        assistant: {
          ...active.state.assistant,
          done: true,
          metrics: { ...active.state.assistant.metrics, interrupted: true }
        }
      }
      this.callbacks.onAssistant?.(active.state.assistant, active.options)
    }
    this.finish(active, false)
  }

  private reconnect(active: ActiveStream) {
    if (!this.isCurrent(active) || active.state.assistant.done) return
    if (!active.options.durableTurn) {
      active.state = { ...active.state, lastSeq: -1 }
    }
    const port = this.dependencies.connectPort()
    active.port = port
    this.attach(active, port)
    port.postMessage(
      active.options.durableTurn
        ? {
            version: STREAM_PROTOCOL_VERSION,
            type: MESSAGE_KEYS.PROVIDER.RECONNECT_STREAM,
            payload: {
              requestId: active.requestId,
              afterSeq: active.state.lastSeq
            }
          }
        : active.requestMessage
    )
  }

  private attach(active: ActiveStream, port: ChatStreamPort) {
    const messageListener = (message: unknown) =>
      this.handleMessage(active, message)
    active.messageListener = messageListener
    port.addMessageListener(messageListener)
    const disconnectListener = () => this.handleDisconnect(active, port)
    active.disconnectListener = disconnectListener
    port.addDisconnectListener(disconnectListener)
  }

  private detach(active: ActiveStream, port: ChatStreamPort) {
    if (active.messageListener) {
      port.removeMessageListener(active.messageListener)
      active.messageListener = undefined
    }
    if (active.disconnectListener) {
      port.removeDisconnectListener(active.disconnectListener)
      active.disconnectListener = undefined
    }
  }

  private finish(active: ActiveStream, disconnect = true) {
    if (!this.isCurrent(active)) return
    active.settled = true
    this.detach(active, active.port)
    if (disconnect) active.port.disconnect()
    this.active = null
    this.callbacks.onActivityChange?.({ loading: false, streaming: false })
  }

  private isCurrent(active: ActiveStream) {
    return this.active === active && !active.settled
  }
}
