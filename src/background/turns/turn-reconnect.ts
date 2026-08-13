import { safePostChatStreamEvent } from "@/background/lib/runtime-delivery"
import {
  attachDurableTurnObserver,
  cleanupTurnObservers,
  cleanupTurnRuntimeState,
  getTurnRuntimeSnapshot,
  isTerminalEvent,
  removeObserver,
  retainTurnRuntimeSnapshot,
  type TurnOutput
} from "@/background/turns/turn-observers"
import { getMessage } from "@/lib/repositories/chat-history"
import { getTurnRun } from "@/lib/repositories/turn-runs"
import { CHAT_STREAM_EVENT_TYPES } from "@/protocol/streams"

/**
 * Hand a returning panel everything it missed, then resume live delivery.
 *
 * The snapshot is assembled from the producer's in-memory state when there is
 * one and the persisted assistant row otherwise, which is what makes a reconnect
 * after a worker restart differ from one after a panel close.
 */
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
    const runtimeSnapshot = getTurnRuntimeSnapshot(turnId)
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
