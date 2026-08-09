import type { AppFailure } from "@ollama-client/contracts/app-failure"
import {
  type ContextReceipt,
  PersistedTurnRequestSchema,
  type TurnMode,
  type TurnStatus
} from "@ollama-client/contracts/turns"
import {
  type DurableContextOptions,
  parseDurableContextOptions
} from "@/application/context/context-contract"
import type { ChatMessage } from "@/types"
import { toRuntimeChatMessage } from "@/types/chat.schemas"

export * from "@ollama-client/contracts/turns"

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

export interface TurnSubmission {
  id: string
  sessionId: string
  mode: TurnMode
  model: string
  providerId?: string
  request: PersistedTurnRequest
  createdAt: number
}

export interface DurableTurnStart {
  submission: TurnSubmission
  userMessageId: number
}

export interface DurableTurnRun extends TurnSubmission {
  status: TurnStatus
  contextReceipt?: ContextReceipt
  userMessageId?: number
  assistantMessageId?: number
  failure?: AppFailure
  updatedAt: number
}
