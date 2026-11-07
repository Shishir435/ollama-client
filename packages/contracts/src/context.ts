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

/** Immutable upper bound on the stores a turn may retrieve from. */
export const RetrievalPolicySchema = z.object({
  memoryEnabled: z.boolean(),
  ragEnabled: z.boolean(),
  groundedOnlyMode: z.boolean(),
  fileIds: z.array(z.string()),
  knowledgeSetId: z.string().optional()
})
export type RetrievalPolicy = z.infer<typeof RetrievalPolicySchema>

/** References and constraints for replay; no past request bodies are retained. */
export const ContextSelectionSchema = z.object({
  policy: RetrievalPolicySchema,
  hasTabContext: z.boolean(),
  tabs: z
    .array(
      z.object({ id: z.string(), title: z.string(), revision: z.string() })
    )
    .max(100),
  maxTabContextChars: z.number(),
  maxRagContextChars: z.number()
})
export type ContextSelection = z.infer<typeof ContextSelectionSchema>

/**
 * Persistable context-build command. Callback, toast, browser, and other
 * application-only state is deliberately excluded so a suspended background
 * runtime can resume the same turn from this value alone.
 */
export const DurableContextOptionsSchema = z.object({
  replayOfUserMessageId: z.number().int().positive().optional(),
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
