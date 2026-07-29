import type { BuildRagContextOptions } from "@/application/context/build-context"
import { ContextService } from "@/application/context/context-service"
import {
  makeStreamReducerState,
  reduceStreamEvent,
  type StreamMessage,
  type StreamReducerState,
  type StreamTerminal
} from "@/application/turns/chat-stream-reducer"
import type {
  DurableTurnRun,
  TurnSubmission,
  TurnToast
} from "@/application/turns/turn-contract"
import {
  type TurnGenerationInput,
  type TurnGenerationOwner,
  TurnService
} from "@/application/turns/turn-service"
import { resolveRetrievalToolsActive } from "@/background/handlers/handle-build-context"
import { handleChatWithModel } from "@/background/handlers/handle-chat-with-model"
import { safePostMessage } from "@/background/lib/utils"
import { MESSAGE_KEYS } from "@/lib/constants"
import { logger } from "@/lib/logger"
import {
  appendMessage,
  getSession,
  updateMessage
} from "@/lib/repositories/chat-history"
import {
  createTurnRun,
  getIncompleteTurnRuns,
  updateTurnRun
} from "@/lib/repositories/turn-runs"
import type {
  ActivityEvent,
  ChatMessage,
  ChatWithModelMessage,
  ChromeMessage,
  ChromePort,
  PortStatusFunction
} from "@/types"

interface TurnOutput {
  port?: ChromePort
  isPortClosed?: PortStatusFunction
}

const forward = (output: TurnOutput, message: Record<string, unknown>) => {
  if (!output.port || output.isPortClosed?.()) return
  safePostMessage(output.port, message as unknown as ChromeMessage)
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

const makeGenerationOwner = (output: TurnOutput): TurnGenerationOwner => ({
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
      forward(output, { delta: message.content, done: true })
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
    let state: StreamReducerState = makeStreamReducerState({
      ...assistant,
      id: resolvedAssistantId
    })
    const completion: { terminal?: StreamTerminal; aborted: boolean } = {
      aborted: false
    }
    let persistence = Promise.resolve()

    const receive = (raw: unknown) => {
      const message = raw as StreamMessage
      const reduction = reduceStreamEvent(state, message)
      state = reduction.state
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
      if (message.aborted) completion.aborted = true
      forward(output, message as unknown as Record<string, unknown>)
    }

    const sink = {
      name: MESSAGE_KEYS.PROVIDER.STREAM_RESPONSE,
      abortScopeKey: submission.id,
      postMessage: receive
    } as unknown as ChromePort
    const chatMessage: ChatWithModelMessage = {
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
      throw new Error(
        completion.terminal.error.userMessage ||
          completion.terminal.error.message ||
          "Generation failed"
      )
    }
    return {
      outcome: completion.aborted ? "cancelled" : "completed",
      userMessageId,
      assistantMessageId: resolvedAssistantId
    }
  }
})

const createService = (output: TurnOutput): TurnService =>
  new TurnService(
    { create: createTurnRun, update: updateTurnRun },
    new ContextService(),
    makeGenerationOwner(output)
  )

const withLiveCallbacks = (submission: TurnSubmission, output: TurnOutput) => {
  const context = submission.request.context
  return {
    ...context,
    onActivityEvent: (events: ActivityEvent[]) =>
      forward(output, {
        type: "context_progress",
        requestId: submission.id,
        events
      }),
    toast: (warning: TurnToast) =>
      forward(output, {
        type: "context_warning",
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
  const contextOptions = withLiveCallbacks(submission, output)
  try {
    await createService(output).start({
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
    await persistAssistant(assistantMessageId, {
      role: "assistant",
      content: "Turn failed before completion.",
      done: true,
      model: submission.model,
      error: {
        status: 0,
        userMessage: "Turn failed before completion."
      }
    }).catch(() => undefined)
    throw error
  }
}

const resumeTurn = async (turn: DurableTurnRun): Promise<void> => {
  const service = createService({})
  await service.resume(turn, (options) => withRetrievalToolState(turn, options))
}

export const resumeIncompleteTurnRuns = async (): Promise<void> => {
  const turns = await getIncompleteTurnRuns()
  for (const turn of turns) {
    try {
      await resumeTurn(turn)
    } catch (error) {
      if (turn.assistantMessageId !== undefined) {
        await persistAssistant(turn.assistantMessageId, {
          role: "assistant",
          content: "Turn failed before completion.",
          done: true,
          model: turn.model,
          error: {
            status: 0,
            userMessage: "Turn failed before completion."
          }
        }).catch(() => undefined)
      }
      logger.error("Failed to resume durable turn", "BackgroundSW", {
        turnId: turn.id,
        error
      })
    }
  }
}
