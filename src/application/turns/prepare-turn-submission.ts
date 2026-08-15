import type { PermissionResumeSnapshot } from "@ollama-client/contracts/chat"
import type { TurnMode } from "@ollama-client/contracts/turns"
import type { DurableContextOptions } from "@/application/context/context-contract"
import type { DurableTurnStart } from "@/application/turns/turn-contract"
import type { ChatMessage, SelectedModelRef } from "@/types"

interface TurnSubmissionPolicy {
  id: string
  sessionId: string
  model: string
  selectedModel: string
  selectedModelRef: SelectedModelRef | null
  customModel?: string
  memoryEnabled: boolean
  maxTabContextChars: number
  maxRagContextChars: number
  createdAt: number
}

export interface PrepareNewTurnSubmissionInput extends TurnSubmissionPolicy {
  mode: "new"
  userMessage: ChatMessage
  userMessageId: number
  priorMessages: ChatMessage[]
  rawInput: string
  files?: DurableContextOptions["files"]
  hasTabContext: boolean
  contextText: string
  tabDocuments: DurableContextOptions["tabDocuments"]
  groundedOnlyMode: boolean
}

export interface PrepareReplayTurnSubmissionInput extends TurnSubmissionPolicy {
  mode: Exclude<TurnMode, "new">
  contextMessages: ChatMessage[]
}

export type PrepareTurnSubmissionInput =
  | PrepareNewTurnSubmissionInput
  | PrepareReplayTurnSubmissionInput

/**
 * Keep only send-time context that cannot be recovered from canonical message
 * rows. The permission notice owns this snapshot until generation starts.
 */
export const capturePermissionResumeSnapshot = (
  turn: DurableTurnStart
): PermissionResumeSnapshot => {
  const {
    messages: _messages,
    rawInput: _rawInput,
    ...context
  } = turn.submission.request.context
  return {
    version: 1,
    turnId: turn.submission.id,
    model: turn.submission.model,
    ...(turn.submission.providerId
      ? { providerId: turn.submission.providerId }
      : {}),
    createdAt: turn.submission.createdAt,
    context
  }
}

const replaySource = (
  messages: ChatMessage[]
):
  | { userMessage: ChatMessage & { id: number }; priorMessages: ChatMessage[] }
  | undefined => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== "user") continue
    if (typeof message.id !== "number") return undefined
    return {
      userMessage: message as ChatMessage & { id: number },
      priorMessages: messages.slice(0, index)
    }
  }
  return undefined
}

/** Rebuild the original new turn after its optional permission is granted. */
export const preparePermissionResumeSubmission = (input: {
  snapshot: PermissionResumeSnapshot
  sessionId: string
  contextMessages: ChatMessage[]
}): DurableTurnStart | undefined => {
  const replay = replaySource(input.contextMessages)
  if (!replay) return undefined

  return {
    submission: {
      id: input.snapshot.turnId,
      sessionId: input.sessionId,
      mode: "new",
      model: input.snapshot.model,
      ...(input.snapshot.providerId
        ? { providerId: input.snapshot.providerId }
        : {}),
      request: {
        version: 1,
        context: {
          rawInput: replay.userMessage.content,
          messages: replay.priorMessages,
          ...input.snapshot.context
        },
        userMessage: replay.userMessage
      },
      createdAt: input.snapshot.createdAt
    },
    userMessageId: replay.userMessage.id
  }
}

export function prepareTurnSubmission(
  input: PrepareNewTurnSubmissionInput
): DurableTurnStart
export function prepareTurnSubmission(
  input: PrepareReplayTurnSubmissionInput
): DurableTurnStart | undefined
export function prepareTurnSubmission(
  input: PrepareTurnSubmissionInput
): DurableTurnStart | undefined {
  const source =
    input.mode === "new"
      ? {
          userMessage: input.userMessage,
          userMessageId: input.userMessageId,
          context: {
            rawInput: input.rawInput,
            files: input.files,
            messages: input.priorMessages,
            hasTabContext: input.hasTabContext,
            contextText: input.contextText,
            tabDocuments: input.tabDocuments,
            groundedOnlyMode: input.groundedOnlyMode
          }
        }
      : (() => {
          const replay = replaySource(input.contextMessages)
          if (!replay) return undefined
          return {
            userMessage: replay.userMessage,
            userMessageId: replay.userMessage.id,
            context: {
              rawInput: replay.userMessage.content,
              files: undefined,
              messages: replay.priorMessages,
              hasTabContext: false,
              contextText: "",
              tabDocuments: [],
              groundedOnlyMode: false
            }
          }
        })()

  if (!source) return undefined

  const context: DurableContextOptions = {
    ...source.context,
    memoryEnabled: input.memoryEnabled,
    maxTabContextChars: input.maxTabContextChars,
    maxRagContextChars: input.maxRagContextChars,
    selectedModel: input.selectedModel,
    selectedModelRef: input.selectedModelRef,
    customModel: input.customModel
  }

  return {
    submission: {
      id: input.id,
      sessionId: input.sessionId,
      mode: input.mode,
      model: input.model,
      providerId: input.selectedModelRef?.providerId,
      request: {
        version: 1,
        context,
        userMessage: source.userMessage
      },
      createdAt: input.createdAt
    },
    userMessageId: source.userMessageId
  }
}
