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

const ToolRunSchema = z.object({
  toolId: z.string(),
  label: z.string(),
  displayNameKey: z.string().optional(),
  iconKey: z.string().optional(),
  category: z
    .enum([
      "browser",
      "knowledge",
      "files",
      "selection",
      "web",
      "system",
      "external"
    ])
    .optional(),
  risk: z.enum(["low", "medium", "high"]).optional(),
  status: z.enum(["pending", "running", "done", "error"]),
  startedAt: z.number(),
  completedAt: z.number().optional(),
  sources: z
    .array(
      z.object({
        title: z.string(),
        url: z.string().optional(),
        excerpt: z.string().optional()
      })
    )
    .optional(),
  error: z.string().optional(),
  truncated: z.boolean().optional(),
  args: z.record(z.string(), z.unknown()).optional(),
  resultPreview: z.string().optional()
})

const ActivityEventSchema = z.object({
  id: z.string(),
  kind: z.enum([
    "preparing_context",
    "query_rewrite",
    "searching_memory",
    "searching_files",
    "reading_page",
    "calling_tool",
    "generating_answer"
  ]),
  label: z.string(),
  status: z.enum(["running", "done", "error"]),
  startedAt: z.number(),
  finishedAt: z.number().optional(),
  inputPreview: z.string().optional(),
  outputPreview: z.string().optional(),
  resultCount: z.number().optional(),
  sourceTitles: z.array(z.string()).optional(),
  error: z.string().optional()
})

const ToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  arguments: z.record(z.string(), z.unknown())
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
  activityEvents: z.array(ActivityEventSchema).optional(),
  toolRuns: z.array(ToolRunSchema).optional(),
  groundedOnlyMode: z.boolean().optional(),
  insufficientContext: z.boolean().optional(),
  promptInputLength: z.number().optional(),
  promptAugmentedLength: z.number().optional(),
  tabContextLength: z.number().optional(),
  ragContextLength: z.number().optional(),
  tabContextTruncated: z.boolean().optional(),
  contextBuildFailed: z.boolean().optional(),
  thinkingOnlyResponse: z.boolean().optional()
})

// ---- FileAttachment ----

const FileAttachmentSchema = z.object({
  id: z.number().optional(),
  fileId: z.string(),
  fileName: z.string(),
  fileType: z.string(),
  fileSize: z.number(),
  textPreview: z.string().optional(),
  processedAt: z.number(),
  sessionId: z.string().optional(),
  messageId: z.number().optional(),
  // Bytes export as a JSON array, but a Uint8Array that slips through
  // JSON.stringify serializes to an index-keyed object ({"0":..,"1":..}).
  // Accept both so one stray byte field can't fail validation and silently
  // skip the whole session on import.
  data: z
    .union([z.array(z.number()), z.record(z.string(), z.number())])
    .optional()
})

export type FileAttachmentParsed = z.infer<typeof FileAttachmentSchema>

const ImageAttachmentSchema = z.object({
  id: z.number().optional(),
  imageId: z.string(),
  fileName: z.string(),
  mimeType: z.string(),
  size: z.number(),
  base64: z.string(),
  width: z.number().optional(),
  height: z.number().optional(),
  sessionId: z.string().optional(),
  messageId: z.number().optional()
})

// ---- ChatMessage ----

export const ChatMessageSchema = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  role: z.enum(["user", "assistant", "system", "tool"]),
  content: z.string(),
  thinking: z.string().optional(),
  done: z.boolean().optional(),
  model: z.string().optional(),
  attachments: z.array(FileAttachmentSchema).optional(),
  images: z.array(ImageAttachmentSchema).optional(),
  toolCalls: z.array(ToolCallSchema).optional(),
  toolName: z.string().optional(),
  toolCallId: z.string().optional(),
  timestamp: z.number().optional(),
  metrics: ChatMessageMetricsSchema.optional(),
  parentId: z.union([z.number(), z.string()]).optional(),
  childrenIds: z.array(z.union([z.number(), z.string()])).optional(),
  siblingIds: z.array(z.union([z.number(), z.string()])).optional()
})

// ---- ChatSession ----

export const ChatSessionSchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  modelId: z.string().optional(),
  currentLeafId: z.union([z.number(), z.string()]).optional(),
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
