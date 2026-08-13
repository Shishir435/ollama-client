import type { ThinkingParserState } from "@ollama-client/runtime-core/thinking-stream"
import { safePostChatStreamEvent } from "@/background/lib/runtime-delivery"
import {
  CHAT_STREAM_EVENT_TYPES,
  type ChatStreamServerEvent
} from "@/protocol/streams"
import type { ChatMessage, ChromePort, PortStatusFunction } from "@/types"

/**
 * Where a durable turn's events are delivered, if anywhere.
 *
 * Optional because a turn outlives its audience: generation is owned by the
 * background and continues with no panel attached, and the same turn may be
 * observed again later by a different one.
 */
export interface TurnOutput {
  port?: ChromePort
  isPortClosed?: PortStatusFunction
}

export interface TurnObserver extends TurnOutput {
  ready: boolean
  pending: ChatStreamServerEvent[]
  detach?: () => void
}

/**
 * The producer's authoritative view of a turn, held in memory.
 *
 * Distinct from the persisted assistant row: it carries the reducer's thinking
 * state and sequence cursor, which a reconnecting panel needs to resume mid
 * stream rather than restart from stored text.
 */
export interface TurnRuntimeSnapshot {
  assistant: ChatMessage
  thinkingState: ThinkingParserState
  seq: number
}

const turnObservers = new Map<string, Set<TurnObserver>>()
const turnRuntimeSnapshots = new Map<string, TurnRuntimeSnapshot>()
const turnReconnectLeases = new Map<string, number>()
const pendingRuntimeCleanup = new Set<string>()

export const removeObserver = (
  turnId: string,
  observer: TurnObserver
): void => {
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

export const isTerminalEvent = (message: ChatStreamServerEvent): boolean =>
  message.type === CHAT_STREAM_EVENT_TYPES.CHUNK &&
  Boolean(message.done || message.error || message.aborted)

export const cleanupTurnObservers = (turnId: string): void => {
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

export const cleanupTurnRuntimeState = (turnId: string): void => {
  cleanupTurnObservers(turnId)
  if ((turnReconnectLeases.get(turnId) ?? 0) > 0) {
    pendingRuntimeCleanup.add(turnId)
    return
  }
  turnRuntimeSnapshots.delete(turnId)
}

/**
 * Hold a turn's snapshot alive across an in-flight reconnect.
 *
 * A reconnect reads persistence between attaching and sending its snapshot, and
 * the turn can finish inside that window. Without the lease the producer's
 * cleanup would drop the snapshot the reconnect is about to send, and the panel
 * would be handed stored text with no sequence cursor.
 */
export const retainTurnRuntimeSnapshot = (turnId: string): (() => void) => {
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

export const getTurnRuntimeSnapshot = (
  turnId: string
): TurnRuntimeSnapshot | undefined => turnRuntimeSnapshots.get(turnId)

export const setTurnRuntimeSnapshot = (
  turnId: string,
  snapshot: TurnRuntimeSnapshot
): void => {
  turnRuntimeSnapshots.set(turnId, snapshot)
}

export const forwardTurn = (
  turnId: string,
  message: ChatStreamServerEvent
): void => {
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
