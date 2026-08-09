import type {
  DurableTurnRun as RuntimeDurableTurnRun,
  TurnSubmission as RuntimeTurnSubmission
} from "@ollama-client/chat-runtime/turn-runtime"
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
