import {
  makeStreamReducerState,
  reduceStreamEvent,
  type StreamReducerState,
  type StreamTerminal
} from "@ollama-client/runtime-core/chat-stream-reducer"
import {
  DurableTurnGenerationError,
  failureForTurn
} from "@/application/turns/turn-contract"
import type {
  TurnGenerationInput,
  TurnGenerationOwner
} from "@/application/turns/turn-service"
import { handleChatWithModel } from "@/background/handlers/handle-chat-with-model"
import {
  forwardTurn,
  setTurnRuntimeSnapshot
} from "@/background/turns/turn-observers"
import { MESSAGE_KEYS } from "@/lib/constants"
import {
  appendMessage,
  getSession,
  updateMessage
} from "@/lib/repositories/chat-history"
import {
  CHAT_STREAM_EVENT_TYPES,
  parseChatStreamServerEvent
} from "@/protocol/streams"
import type { ChatMessage, ChatStreamSink, ChatWithModelMessage } from "@/types"

export const persistAssistant = (
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
export const persistTurnFailure = async (
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

/**
 * Provider invocation, stream reduction, and assistant persistence.
 *
 * The chat handler is reused rather than reimplemented so a durable turn and a
 * legacy port-driven chat take the same provider path — tools, retries, abort
 * scope and all. The difference is only where events land: this sink reduces
 * them into durable state instead of shipping them to a panel, and forwards a
 * copy to whichever observers happen to be attached.
 */
export const makeGenerationOwner = (): TurnGenerationOwner => ({
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
      setTurnRuntimeSnapshot(submission.id, {
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
        setTurnRuntimeSnapshot(submission.id, {
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

    const sink: ChatStreamSink = {
      name: MESSAGE_KEYS.PROVIDER.STREAM_RESPONSE,
      abortScopeKey: submission.id,
      postMessage: receive
    }
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
