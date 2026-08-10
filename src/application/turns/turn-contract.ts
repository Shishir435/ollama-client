import type {
  DurableTurnRun as RuntimeDurableTurnRun,
  TurnSubmission as RuntimeTurnSubmission
} from "@ollama-client/chat-runtime/turn-runtime"
import type { AppFailure } from "@ollama-client/contracts/app-failure"
import { PersistedTurnRequestSchema } from "@ollama-client/contracts/turns"
import {
  type DurableContextOptions,
  parseDurableContextOptions
} from "@/application/context/context-contract"
import type { ChatMessage } from "@/types"
import { toRuntimeChatMessage } from "@/types/chat.schemas"

/** Runtime-normalized request used after the persisted contract is decoded. */
export interface PersistedTurnRequest {
  version: 1
  context: DurableContextOptions
  userMessage: ChatMessage
}

export const parsePersistedTurnRequest = (
  value: unknown
): PersistedTurnRequest => {
  const parsed = PersistedTurnRequestSchema.parse(value)
  return {
    version: parsed.version,
    context: parseDurableContextOptions(parsed.context),
    userMessage: toRuntimeChatMessage(parsed.userMessage)
  }
}

export type TurnSubmission = RuntimeTurnSubmission<
  DurableContextOptions,
  ChatMessage
>

export interface DurableTurnStart {
  submission: TurnSubmission
  userMessageId: number
}

export type DurableTurnRun = RuntimeDurableTurnRun<
  DurableContextOptions,
  ChatMessage
>

/**
 * Carries a terminal stream failure to the lifecycle owner unflattened.
 *
 * The turn row, the assistant row, the reconnect snapshot and the bubble should
 * all show the failure the provider actually produced. Throwing a plain Error
 * built from its text meant every one of them showed a reconstruction instead —
 * a provider 500 reached the bubble as a bare "Turn failed before completion."
 */
export class DurableTurnGenerationError extends Error {
  constructor(readonly failure: AppFailure) {
    super(failure.userMessage || failure.message || "Generation failed")
    this.name = "DurableTurnGenerationError"
  }
}

/** The failure a turn should record, preserved when generation produced one. */
export const failureForTurn = (error: unknown): AppFailure | undefined =>
  error instanceof DurableTurnGenerationError ? error.failure : undefined
