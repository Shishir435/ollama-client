import { z } from "zod"

// ---- Metrics (used inside messages and for SQLite parseMetrics) ----

const RagSourceSchema = z.object({
  id: z.union([z.number(), z.string()]),
  title: z.string(),
  content: z.string(),
  score: z.number(),
  source: z.string().optional(),
  chunkIndex: z.number().optional(),
  fileId: z.string().optional(),
  type: z.string().optional()
})

const UsedContextChunkSchema = z.object({
  id: z.union([z.string(), z.number()]),
  title: z.string(),
  excerpt: z.string(),
  score: z.number(),
  sectionPath: z.string().optional(),
  source: z.string().optional(),
  chunkIndex: z.number().optional()
})

export const ChatMessageMetricsSchema = z.object({
  total_duration: z.number().optional(),
  load_duration: z.number().optional(),
  prompt_eval_count: z.number().optional(),
  prompt_eval_duration: z.number().optional(),
  eval_count: z.number().optional(),
  eval_duration: z.number().optional(),
  ragQuery: z.string().optional(),
  ragSources: z.array(RagSourceSchema).optional(),
  usedContextChunks: z.array(UsedContextChunkSchema).optional(),
  groundedOnlyMode: z.boolean().optional(),
  insufficientContext: z.boolean().optional(),
  promptInputLength: z.number().optional(),
  promptAugmentedLength: z.number().optional(),
  tabContextLength: z.number().optional(),
  ragContextLength: z.number().optional(),
  tabContextTruncated: z.boolean().optional(),
  contextBuildFailed: z.boolean().optional()
})

// ---- ChatMessage ----

export const ChatMessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
  thinking: z.string().optional(),
  done: z.boolean().optional(),
  model: z.string().optional(),
  timestamp: z.number().optional(),
  metrics: ChatMessageMetricsSchema.optional()
})

// ---- ChatSession ----

export const ChatSessionSchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  messages: z.array(ChatMessageSchema).optional()
})

/** Strict variant for import — messages are required. */
export const ChatSessionImportSchema = ChatSessionSchema.extend({
  messages: z.array(ChatMessageSchema)
})

// -- Output type aliases for consumers that need typed results --

export type ChatMessageParsed = z.infer<typeof ChatMessageSchema>
export type ChatSessionParsed = z.infer<typeof ChatSessionSchema>
export type ChatSessionImportParsed = z.infer<typeof ChatSessionImportSchema>
