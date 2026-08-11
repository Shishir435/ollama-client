import type { TurnToast } from "@ollama-client/contracts/turns"
import type { TurnSubmission } from "@/application/turns/turn-contract"
import { persistTurnFailure } from "@/background/turns/turn-generation"
import {
  attachDurableTurnObserver,
  cleanupTurnRuntimeState,
  forwardTurn,
  type TurnOutput
} from "@/background/turns/turn-observers"
import {
  createTurnService,
  withRetrievalToolState
} from "@/background/turns/turn-service-factory"
import { CHAT_STREAM_EVENT_TYPES } from "@/protocol/streams"
import type { ActivityEvent } from "@/types"

export { attachDurableTurnObserver } from "@/background/turns/turn-observers"
export { reconnectDurableTurn } from "@/background/turns/turn-reconnect"
export {
  requestDurableTurnStop,
  resumeIncompleteTurnRuns
} from "@/background/turns/turn-recovery"

/**
 * Attach the callbacks a live submission has and a resumed one cannot.
 *
 * Context progress and warnings are delivered to whoever is watching now, so
 * they are wired here rather than persisted with the turn: a turn resumed after
 * a restart has no panel to narrate to, and rebuilding these from the stored
 * request would post events into nothing.
 */
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

export const startDurableTurn = async (
  submission: TurnSubmission,
  userMessageId: number,
  assistantMessageId: number,
  output: TurnOutput
): Promise<void> => {
  attachDurableTurnObserver(submission.id, output)
  const contextOptions = withLiveCallbacks(submission)
  try {
    await createTurnService().start({
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
