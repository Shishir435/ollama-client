import { z } from "zod"
import { ChatMessageSchema } from "./chat"

/** Text already extracted from a user file for context construction. */
export const ContextFileInputSchema = z.object({
  text: z.string(),
  metadata: z.object({
    fileName: z.string(),
    fileId: z.string().optional()
  })
})

export type ContextFileInput = z.infer<typeof ContextFileInputSchema>

/**
 * Persistable context-build command. Callback, toast, browser, and other
 * application-only state is deliberately excluded so a suspended background
 * runtime can resume the same turn from this value alone.
 */
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
  customModel: z.string().optional(),
  /**
   * The tab the side panel showed when the message was sent: the one a
   * browser task the model delegates starts on. A service worker has no
   * window of its own to ask.
   */
  browserTabId: z.number().int().nonnegative().optional(),
  /**
   * The browser-agent run whose card drafted this message (Continue, Retry).
   * The background still reads that run's own rows and refuses one from
   * another chat; this only says which run was meant.
   */
  agentFollowUpRunId: z.string().min(1).max(200).optional()
})

/** Persisted context shape before application message normalization. */
export type DurableContextOptionsParsed = z.infer<
  typeof DurableContextOptionsSchema
>

/** Parse a persisted context command without application environment access. */
export const parseDurableContextOptions = (
  value: unknown
): DurableContextOptionsParsed => DurableContextOptionsSchema.parse(value)
