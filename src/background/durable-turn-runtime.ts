import type { TurnToast } from "@ollama-client/contracts/turns"
import {
  makeStreamReducerState,
  reduceStreamEvent,
  type StreamReducerState,
  type StreamTerminal
} from "@ollama-client/runtime-core/chat-stream-reducer"
import type { ThinkingParserState } from "@ollama-client/runtime-core/thinking-stream"
import type { BuildRagContextOptions } from "@/application/context/build-context"
import { ContextService } from "@/application/context/context-service"
import {
  DurableTurnGenerationError,
  type DurableTurnRun,
  failureForTurn,
  type TurnSubmission
} from "@/application/turns/turn-contract"
import {
  type TurnGenerationInput,
  type TurnGenerationOwner,
  TurnService
} from "@/application/turns/turn-service"
import { resolveRetrievalToolsActive } from "@/background/handlers/handle-build-context"
import { handleChatWithModel } from "@/background/handlers/handle-chat-with-model"
import { safePostChatStreamEvent } from "@/background/lib/utils"
import { MESSAGE_KEYS } from "@/lib/constants"
import { logger } from "@/lib/logger"
import {
  appendMessage,
  getMessage,
  getSession,
  updateMessage
} from "@/lib/repositories/chat-history"
import {
  createTurnRun,
  finalizeInterruptedCancellations,
  getIncompleteTurnRuns,
  getTurnRun,
  markTurnCancelling,
  updateTurnRun
} from "@/lib/repositories/turn-runs"
import {
  CHAT_STREAM_EVENT_TYPES,
  type ChatStreamServerEvent,
  parseChatStreamServerEvent
} from "@/protocol/streams"
import type {
  ActivityEvent,
  ChatMessage,
  ChatWithModelMessage,
  ChromePort,
  PortStatusFunction
} from "@/types"

interface TurnOutput {
  port?: ChromePort
  isPortClosed?: PortStatusFunction
}

interface TurnObserver extends TurnOutput {
  ready: boolean
  pending: ChatStreamServerEvent[]
  detach?: () => void
}

interface TurnRuntimeSnapshot {
  assistant: ChatMessage
  thinkingState: ThinkingParserState
  seq: number
}

const turnObservers = new Map<string, Set<TurnObserver>>()
const turnRuntimeSnapshots = new Map<string, TurnRuntimeSnapshot>()
const turnReconnectLeases = new Map<string, number>()
const pendingRuntimeCleanup = new Set<string>()

const removeObserver = (turnId: string, observer: TurnObserver): void => {
  const observers = turnObservers.get(turnId)
  observers?.delete(observer)
  if (observers?.size === 0) turnObservers.delete(turnId)
  if (observer.detach && observer.port?.onDisconnect) {
    observer.port.onDisconnect.removeListener(observer.detach)
  }
}

export const attachDurableTurnObserver = (
  turnId: string,
  output: TurnOutput,
  ready = true
): TurnObserver | null => {
  if (!output.port) return null
  const observer: TurnObserver = { ...output, ready, pending: [] }
  const observers = turnObservers.get(turnId) ?? new Set<TurnObserver>()
  observers.add(observer)
  turnObservers.set(turnId, observers)
  if (output.port.onDisconnect) {
    observer.detach = () => removeObserver(turnId, observer)
    output.port.onDisconnect.addListener(observer.detach)
  }
  return observer
}

const isTerminalEvent = (message: ChatStreamServerEvent): boolean =>
  message.type === CHAT_STREAM_EVENT_TYPES.CHUNK &&
  Boolean(message.done || message.error || message.aborted)

const cleanupTurnObservers = (turnId: string): void => {
  const observers = turnObservers.get(turnId)
  if (observers) {
    for (const observer of observers) {
      if (observer.detach && observer.port?.onDisconnect) {
        observer.port.onDisconnect.removeListener(observer.detach)
      }
    }
  }
  turnObservers.delete(turnId)
}

const cleanupTurnRuntimeState = (turnId: string): void => {
  cleanupTurnObservers(turnId)
  if ((turnReconnectLeases.get(turnId) ?? 0) > 0) {
    pendingRuntimeCleanup.add(turnId)
    return
  }
  turnRuntimeSnapshots.delete(turnId)
}

const retainTurnRuntimeSnapshot = (turnId: string): (() => void) => {
  turnReconnectLeases.set(turnId, (turnReconnectLeases.get(turnId) ?? 0) + 1)
  return () => {
    const remaining = (turnReconnectLeases.get(turnId) ?? 1) - 1
    if (remaining > 0) {
      turnReconnectLeases.set(turnId, remaining)
      return
    }
    turnReconnectLeases.delete(turnId)
    if (pendingRuntimeCleanup.delete(turnId)) {
      turnRuntimeSnapshots.delete(turnId)
    }
  }
}

const forwardTurn = (turnId: string, message: ChatStreamServerEvent): void => {
  const observers = turnObservers.get(turnId)
  if (observers) {
    for (const observer of observers) {
      if (!observer.port || observer.isPortClosed?.()) {
        removeObserver(turnId, observer)
        continue
      }
      if (!observer.ready) {
        observer.pending.push(message)
        continue
      }
      safePostChatStreamEvent(observer.port, message)
    }
    if (observers.size === 0) turnObservers.delete(turnId)
  }
  // Ports can detach as soon as the terminal event is queued, but the
  // authoritative in-memory snapshot must survive until persistence settles.
  if (isTerminalEvent(message)) cleanupTurnObservers(turnId)
}

const persistAssistant = (
  assistantMessageId: number,
  assistant: ChatMessage
): Promise<number> =>
  updateMessage(assistantMessageId, {
    content: assistant.content,
    thinking: assistant.thinking,
    replayArtifact: assistant.replayArtifact,
    metrics: assistant.metrics,
    done: assistant.done,
    error: assistant.error
  })

/**
 * Record a failed turn on its assistant row.
 *
 * The structured failure is used whenever generation produced one; the generic
 * text is the last resort for a turn that died before the stream said anything
 * — a context build that threw, a worker lost mid-claim.
 */
const persistTurnFailure = async (
  assistantMessageId: number | undefined,
  model: string,
  error: unknown
): Promise<void> => {
  if (assistantMessageId === undefined) return
  const failure = failureForTurn(error)
  const fallback = "Turn failed before completion."
  await persistAssistant(assistantMessageId, {
    role: "assistant",
    content: failure?.userMessage || failure?.message || fallback,
    done: true,
    model,
    error: failure ?? { status: 0, userMessage: fallback }
  }).catch(() => undefined)
}

const makeGenerationOwner = (): TurnGenerationOwner => ({
  start: async ({
    submission,
    context,
    userMessageId,
    assistantMessageId
  }: TurnGenerationInput) => {
    const metrics: ChatMessage["metrics"] = {
      ...context.result.promptContextStats,
      ...(context.result.ragSources
        ? {
            ragSources: context.result.ragSources.sources,
            ragQuery: context.result.ragSources.query
          }
        : {})
    }
    const assistant: ChatMessage = {
      role: "assistant",
      content: "",
      done: false,
      model: submission.model,
      metrics
    }
    const resolvedAssistantId =
      assistantMessageId ??
      (await appendMessage(
        {
          ...assistant,
          sessionId: submission.sessionId,
          parentId: userMessageId
        },
        [],
        (await getSession(submission.sessionId)) ?? undefined
      ))

    await persistAssistant(resolvedAssistantId, assistant)

    if (context.result.promptContextStats.insufficientContext) {
      const message = {
        ...assistant,
        content: "Insufficient page context.",
        done: true
      }
      await persistAssistant(resolvedAssistantId, message)
      turnRuntimeSnapshots.set(submission.id, {
        assistant: message,
        thinkingState: makeStreamReducerState(message).thinkingState,
        seq: 0
      })
      forwardTurn(submission.id, {
        version: 1,
        type: CHAT_STREAM_EVENT_TYPES.CHUNK,
        seq: 0,
        delta: message.content,
        done: true
      })
      return {
        outcome: "completed",
        userMessageId,
        assistantMessageId: resolvedAssistantId
      }
    }

    const messages = [
      ...submission.request.context.messages,
      {
        ...submission.request.userMessage,
        content: context.result.contentWithRAG
      }
    ]
    let state: StreamReducerState<ChatMessage> = makeStreamReducerState({
      ...assistant,
      id: resolvedAssistantId
    })
    const completion: {
      terminal?: StreamTerminal<ChatMessage>
      aborted: boolean
    } = {
      aborted: false
    }
    let persistence = Promise.resolve()

    const receive = (raw: unknown) => {
      const parsed = parseChatStreamServerEvent(raw)
      if (
        !parsed.success ||
        (parsed.data.type !== CHAT_STREAM_EVENT_TYPES.CHUNK &&
          parsed.data.type !== CHAT_STREAM_EVENT_TYPES.RAG_SOURCES)
      ) {
        return
      }
      const message = parsed.data
      const reduction = reduceStreamEvent(state, message)
      state = reduction.state
      if (!reduction.dropped) {
        turnRuntimeSnapshots.set(submission.id, {
          assistant: state.assistant,
          thinkingState: state.thinkingState,
          seq: state.lastSeq
        })
      }
      if (!reduction.dropped && (reduction.changed || reduction.terminal)) {
        const durableAssistant =
          reduction.terminal?.type === "error"
            ? {
                ...reduction.terminal.partial,
                content:
                  reduction.terminal.partial.content ||
                  reduction.terminal.error.userMessage ||
                  reduction.terminal.error.message,
                done: true,
                error: reduction.terminal.error
              }
            : state.assistant
        persistence = persistence.then(async () => {
          await persistAssistant(resolvedAssistantId, durableAssistant)
        })
      }
      if (reduction.terminal) completion.terminal = reduction.terminal
      if (message.type === CHAT_STREAM_EVENT_TYPES.CHUNK && message.aborted) {
        completion.aborted = true
      }
      forwardTurn(submission.id, message)
    }

    const sink = {
      name: MESSAGE_KEYS.PROVIDER.STREAM_RESPONSE,
      abortScopeKey: submission.id,
      postMessage: receive
    } as unknown as ChromePort
    const chatMessage: ChatWithModelMessage = {
      version: 1,
      type: MESSAGE_KEYS.PROVIDER.CHAT_WITH_MODEL,
      payload: {
        model: submission.model,
        providerId: submission.providerId,
        messages,
        sessionId: submission.sessionId,
        requestId: submission.id,
        clientContextPrepared: true
      }
    }

    await handleChatWithModel(chatMessage, sink, () => false)
    await persistence

    if (!completion.terminal) {
      throw new Error("Generation ended without a terminal result")
    }
    if (completion.terminal.type === "error") {
      // The stream already produced a structured failure with a status, kind,
      // message key and incident id. Rebuilding an Error from its text threw
      // all of that away, which is why a provider 500 reached the bubble as a
      // bare "Turn failed before completion."
      throw new DurableTurnGenerationError(completion.terminal.error)
    }
    return {
      outcome: completion.aborted ? "cancelled" : "completed",
      userMessageId,
      assistantMessageId: resolvedAssistantId
    }
  }
})

const createService = (): TurnService =>
  new TurnService(
    { create: createTurnRun, update: updateTurnRun },
    new ContextService(),
    makeGenerationOwner()
  )

const withLiveCallbacks = (submission: TurnSubmission) => {
  const context = submission.request.context
  return {
    ...context,
    onActivityEvent: (events: ActivityEvent[]) =>
      forwardTurn(submission.id, {
        version: 1,
        type: CHAT_STREAM_EVENT_TYPES.CONTEXT_PROGRESS,
        requestId: submission.id,
        events
      }),
    toast: (warning: TurnToast) =>
      forwardTurn(submission.id, {
        version: 1,
        type: CHAT_STREAM_EVENT_TYPES.CONTEXT_WARNING,
        requestId: submission.id,
        payload: warning
      })
  }
}

const withRetrievalToolState = async (
  submission: TurnSubmission,
  options: BuildRagContextOptions
): Promise<BuildRagContextOptions> => {
  const context = submission.request.context
  const model =
    context.customModel ||
    context.selectedModelRef?.modelId ||
    context.selectedModel
  const retrievalToolsActive = await resolveRetrievalToolsActive(
    model,
    submission.providerId,
    context.rawInput
  )
  return { ...options, retrievalToolsActive }
}

export const startDurableTurn = async (
  submission: TurnSubmission,
  userMessageId: number,
  assistantMessageId: number,
  output: TurnOutput
): Promise<void> => {
  attachDurableTurnObserver(submission.id, output)
  const contextOptions = withLiveCallbacks(submission)
  try {
    await createService().start({
      id: submission.id,
      sessionId: submission.sessionId,
      mode: submission.mode,
      model: submission.model,
      providerId: submission.providerId,
      contextOptions,
      userMessage: submission.request.userMessage,
      userMessageId,
      assistantMessageId,
      prepareContextOptions: (options) =>
        withRetrievalToolState(submission, options),
      createdAt: submission.createdAt
    })
  } catch (error) {
    await persistTurnFailure(assistantMessageId, submission.model, error)
    throw error
  } finally {
    cleanupTurnRuntimeState(submission.id)
  }
}

export const reconnectDurableTurn = async (
  turnId: string,
  afterSeq: number,
  output: TurnOutput
): Promise<void> => {
  if (!output.port || output.isPortClosed?.()) return
  const releaseSnapshot = retainTurnRuntimeSnapshot(turnId)
  try {
    // Buffer first, but do not expose live chunks until the snapshot has been
    // sent. This closes the async persistence-read race without missing events.
    const observer = attachDurableTurnObserver(turnId, output, false)
    if (!observer) return
    const turn = await getTurnRun(turnId).catch((error) => {
      removeObserver(turnId, observer)
      throw error
    })
    if (!turn) {
      safePostChatStreamEvent(output.port, {
        version: 1,
        type: CHAT_STREAM_EVENT_TYPES.SNAPSHOT,
        requestId: turnId,
        seq: -1,
        sequenceReset: true,
        status: "failed",
        failure: {
          status: 404,
          message: "Durable turn not found",
          kind: "storage"
        }
      })
      cleanupTurnRuntimeState(turnId)
      return
    }

    const persistedAssistant =
      turn.assistantMessageId === undefined
        ? null
        : await getMessage(turn.assistantMessageId).catch((error) => {
            removeObserver(turnId, observer)
            throw error
          })
    if (!output.port || output.isPortClosed?.()) {
      removeObserver(turnId, observer)
      return
    }
    const runtimeSnapshot = turnRuntimeSnapshots.get(turnId)
    const assistant = runtimeSnapshot?.assistant ?? persistedAssistant
    const seq = runtimeSnapshot?.seq ?? -1
    // A lower producer cursor means the worker restarted and began a fresh
    // sequence epoch. The snapshot remains authoritative for accumulated text.
    const sequenceReset = runtimeSnapshot === undefined || seq < afterSeq
    safePostChatStreamEvent(output.port, {
      version: 1,
      type: CHAT_STREAM_EVENT_TYPES.SNAPSHOT,
      requestId: turnId,
      seq,
      sequenceReset,
      status: turn.status,
      ...(assistant ? { assistant } : {}),
      ...(runtimeSnapshot
        ? { thinkingState: runtimeSnapshot.thinkingState }
        : {}),
      ...(turn.failure
        ? {
            failure: turn.failure
          }
        : {})
    })
    observer.ready = true
    const buffered = observer.pending.splice(0)
    for (const message of buffered) {
      if (
        message.type === CHAT_STREAM_EVENT_TYPES.CHUNK &&
        message.seq !== undefined &&
        message.seq <= seq
      ) {
        continue
      }
      safePostChatStreamEvent(output.port, message)
    }
    if (
      assistant?.done ||
      turn.status === "completed" ||
      turn.status === "failed" ||
      turn.status === "cancelled" ||
      buffered.some(isTerminalEvent)
    ) {
      cleanupTurnObservers(turnId)
    }
  } finally {
    releaseSnapshot()
  }
}

const resumeTurn = async (turn: DurableTurnRun): Promise<void> => {
  try {
    const service = createService()
    await service.resume(turn, (options) =>
      withRetrievalToolState(turn, options)
    )
  } finally {
    cleanupTurnRuntimeState(turn.id)
  }
}

/**
 * Record that the user asked this turn to stop, before anything acts on it.
 *
 * Called on the stop path ahead of the abort, so the order is: intent commits,
 * then the controller is aborted. A worker that dies between the two restarts
 * into `cancelling`, which recovery skips — where a row still reading
 * `generating` was handed straight back to the provider.
 *
 * Resolves false when the id names no live turn, which is the normal answer for
 * a selection-action scope key or a stop that arrives twice.
 */
export const requestDurableTurnStop = async (
  turnId: string
): Promise<boolean> => {
  try {
    return await markTurnCancelling(turnId)
  } catch (error) {
    // Never block the abort on persistence. Losing the intent costs one
    // reissued turn on the next boot; refusing to stop is worse.
    logger.error("Failed to record turn cancellation intent", "BackgroundSW", {
      turnId,
      error
    })
    return false
  }
}

export const resumeIncompleteTurnRuns = async (): Promise<void> => {
  // Cancellations whose worker died mid-stop are finished here, not resumed:
  // the user already said stop, so this settles the row and issues nothing.
  const finalized = await finalizeInterruptedCancellations().catch((error) => {
    logger.error(
      "Failed to finalize interrupted cancellations",
      "BackgroundSW",
      {
        error
      }
    )
    return 0
  })
  if (finalized > 0) {
    logger.info("Finalized interrupted turn cancellations", "BackgroundSW", {
      count: finalized
    })
  }
  const turns = await getIncompleteTurnRuns()
  for (const turn of turns) {
    try {
      await resumeTurn(turn)
    } catch (error) {
      await persistTurnFailure(turn.assistantMessageId, turn.model, error)
      logger.error("Failed to resume durable turn", "BackgroundSW", {
        turnId: turn.id,
        error
      })
    }
  }
}
