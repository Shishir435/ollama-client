import type { DurableTurnRun } from "@/application/turns/turn-contract"
import { persistTurnFailure } from "@/background/turns/turn-generation"
import { cleanupTurnRuntimeState } from "@/background/turns/turn-observers"
import {
  createTurnService,
  withRetrievalToolState
} from "@/background/turns/turn-service-factory"
import { logger } from "@/lib/logger"
import { updateMessage } from "@/lib/repositories/chat-history"
import {
  finalizeCancelledTurn,
  getIncompleteTurnRuns,
  getInterruptedCancellations,
  markTurnCancelling
} from "@/lib/repositories/turn-runs"

const resumeTurn = async (turn: DurableTurnRun): Promise<void> => {
  try {
    const service = createTurnService()
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

/**
 * Finish cancellations whose worker died mid-stop, without reissuing anything.
 *
 * Assistant row first, turn row second, one turn at a time. The two writes
 * belong to different repositories and cannot share a transaction, so the order
 * carries the guarantee instead: a worker that exits between them leaves the
 * turn at `cancelling`, and the next boot finds it and repeats an assistant
 * write that is idempotent. Settling the turn first would close that door with
 * the assistant still unfinished, and the stale-message sweep would then offer
 * a retry for a response the user deliberately stopped.
 *
 * A turn whose assistant cannot be finished is left `cancelling` for the same
 * reason, and retried on the next boot rather than settled over.
 */
const finishInterruptedCancellations = async (): Promise<void> => {
  const interrupted = await getInterruptedCancellations().catch((error) => {
    logger.error("Failed to read interrupted cancellations", "BackgroundSW", {
      error
    })
    return []
  })
  let settled = 0
  for (const cancelled of interrupted) {
    if (cancelled.assistantMessageId !== undefined) {
      try {
        await updateMessage(cancelled.assistantMessageId, { done: true })
      } catch (error) {
        logger.error("Failed to finish a cancelled assistant", "BackgroundSW", {
          turnId: cancelled.id,
          error
        })
        continue
      }
    }
    if (await finalizeCancelledTurn(cancelled.id).catch(() => false)) {
      settled += 1
    }
  }
  if (settled > 0) {
    logger.info("Finalized interrupted turn cancellations", "BackgroundSW", {
      count: settled
    })
  }
}

/**
 * Restart-time turn recovery, in the order the lifecycle requires.
 *
 * Cancellations settle first: they reissue nothing, and leaving them for later
 * would mean resumption walks past rows whose user already asked them to stop.
 * Resumption then runs one turn at a time, because each one owns a provider
 * request and a boot that reissues them all at once is a thundering herd against
 * whatever endpoint the user was talking to.
 */
export const resumeIncompleteTurnRuns = async (): Promise<void> => {
  await finishInterruptedCancellations()
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
