import {
  type ContextFileInput,
  DurableContextOptionsSchema
} from "@ollama-client/contracts/context"
import type { ChatMessage, SelectedModelRef } from "@/types"
import { toRuntimeChatMessage } from "@/types/chat.schemas"

export * from "@ollama-client/contracts/context"

/** Runtime-normalized context command used inside the application. */
export interface DurableContextOptions {
  rawInput: string
  files?: ContextFileInput[]
  messages: ChatMessage[]
  hasTabContext: boolean
  contextText: string
  tabDocuments: Array<{ id: string; title: string; content: string }>
  memoryEnabled: boolean
  maxTabContextChars: number
  maxRagContextChars: number
  groundedOnlyMode: boolean
  retrievalToolsActive?: boolean
  selectedModel: string
  selectedModelRef: SelectedModelRef | null
  customModel?: string
}

export const parseDurableContextOptions = (
  value: unknown
): DurableContextOptions => {
  const parsed = DurableContextOptionsSchema.parse(value)
  return {
    ...parsed,
    messages: parsed.messages.map(toRuntimeChatMessage)
  }
}
