import { z } from "zod"
import type { ChatMessage, SelectedModelRef } from "@/types"
import { ChatMessageSchema } from "@/types/chat.schemas"

export const ContextFileInputSchema = z.object({
  text: z.string(),
  metadata: z.object({
    fileName: z.string(),
    fileId: z.string().optional()
  })
})

export type ContextFileInput = z.infer<typeof ContextFileInputSchema>

export const DurableContextOptionsSchema = z.object({
  rawInput: z.string(),
  files: z.array(ContextFileInputSchema).optional(),
  messages: z.array(ChatMessageSchema),
  hasTabContext: z.boolean(),
  contextText: z.string(),
  tabDocuments: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      content: z.string()
    })
  ),
  memoryEnabled: z.boolean(),
  maxTabContextChars: z.number(),
  maxRagContextChars: z.number(),
  groundedOnlyMode: z.boolean(),
  retrievalToolsActive: z.boolean().optional(),
  selectedModel: z.string(),
  selectedModelRef: z
    .object({
      providerId: z.string(),
      modelId: z.string()
    })
    .nullable(),
  customModel: z.string().optional()
})

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
): DurableContextOptions =>
  DurableContextOptionsSchema.parse(value) as DurableContextOptions
