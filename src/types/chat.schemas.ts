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

// ---- Lenient import (salvage) --------------------------------------------
//
// The strict schema above is all-or-nothing: a single bad/missing sub-field
// anywhere in a session fails the whole-session parse, so the importer
// silently drops the entire chat. That makes import brittle against older
// exports, partial exports, and tool-calling turns (assistant messages with
// no content, images missing a re-encoded base64, a session row missing a
// timestamp). The lenient layer salvages instead of discarding: it coerces or
// defaults required scalars, drops only the invalid messages/sub-attachments,
// and keeps everything that can be rescued. `salvageImportedSession` reports
// what was dropped so the UI can surface it rather than fake success.

/** Keep only the array items that individually validate; drop the rest. */
const lenientArray = <T extends z.ZodTypeAny>(item: T) =>
  z.preprocess(
    (value) =>
      Array.isArray(value)
        ? value.filter((entry) => item.safeParse(entry).success)
        : undefined,
    z.array(item).optional()
  )

/**
 * A message that can be rescued. `role` is the only hard requirement — without
 * it the message is meaningless. `content` coerces to "" (tool/assistant turns
 * legitimately carry no text); every optional field is dropped if malformed
 * rather than failing the message.
 */
const LenientChatMessageSchema = z.object({
  id: z.union([z.number(), z.string()]).optional().catch(undefined),
  role: z.enum(["user", "assistant", "system", "tool"]),
  content: z.string().catch(""),
  thinking: z.string().optional().catch(undefined),
  done: z.boolean().optional().catch(undefined),
  model: z.string().optional().catch(undefined),
  attachments: lenientArray(FileAttachmentSchema),
  images: lenientArray(ImageAttachmentSchema),
  toolCalls: lenientArray(ToolCallSchema),
  toolName: z.string().optional().catch(undefined),
  toolCallId: z.string().optional().catch(undefined),
  timestamp: z.number().optional().catch(undefined),
  metrics: ChatMessageMetricsSchema.optional().catch(undefined),
  parentId: z.union([z.number(), z.string()]).optional().catch(undefined),
  childrenIds: z
    .array(z.union([z.number(), z.string()]))
    .optional()
    .catch(undefined),
  siblingIds: z
    .array(z.union([z.number(), z.string()]))
    .optional()
    .catch(undefined)
})

export interface SalvageOutcome {
  /** The rescued session, or `null` when nothing usable remained. */
  session: ChatSessionImportParsed | null
  /** Why the session was skipped, when `session` is null. */
  skipReason?: "not-an-object" | "no-rescuable-messages"
  /** The session's own id (or generated id), for log correlation. */
  sessionId?: string
  /** How many message entries the raw session contained. */
  messagesIn: number
  /** How many messages were kept after salvage. */
  messagesKept: number
  /** How many messages could not be rescued and were dropped. */
  droppedMessages: number
  /**
   * One short reason per dropped message (the failing field paths), so the
   * importer can log exactly what the file tripped on instead of guessing.
   */
  dropReasons: string[]
}

/** Summarize a zod error as "path:code" pairs for compact logging. */
const summarizeIssues = (error: z.ZodError): string =>
  error.issues
    .map((issue) => `${issue.path.join(".") || "<root>"}:${issue.code}`)
    .join(", ")

/**
 * Rescue one raw session object. Returns a structured outcome (never throws)
 * describing what was kept and what was dropped and why. `session` is null
 * only when nothing usable remains (not an object, or no valid messages).
 * Callers supply `now`/`makeId` so this stays free of ambient
 * `Date.now()`/`crypto` for testability.
 */
export const salvageImportedSession = (
  raw: unknown,
  now: number,
  makeId: () => string
): SalvageOutcome => {
  if (!raw || typeof raw !== "object") {
    return {
      session: null,
      skipReason: "not-an-object",
      messagesIn: 0,
      messagesKept: 0,
      droppedMessages: 0,
      dropReasons: []
    }
  }
  const obj = raw as Record<string, unknown>

  const rawMessages = Array.isArray(obj.messages) ? obj.messages : []
  const messages: z.infer<typeof LenientChatMessageSchema>[] = []
  const dropReasons: string[] = []
  for (const entry of rawMessages) {
    const parsed = LenientChatMessageSchema.safeParse(entry)
    if (parsed.success) messages.push(parsed.data)
    else dropReasons.push(summarizeIssues(parsed.error))
  }

  const id = typeof obj.id === "string" && obj.id ? obj.id : makeId()

  // A session with no rescuable messages is not worth importing.
  if (messages.length === 0) {
    return {
      session: null,
      skipReason: "no-rescuable-messages",
      sessionId: id,
      messagesIn: rawMessages.length,
      messagesKept: 0,
      droppedMessages: dropReasons.length,
      dropReasons
    }
  }

  const title = typeof obj.title === "string" ? obj.title : "Imported chat"
  const createdAt = typeof obj.createdAt === "number" ? obj.createdAt : now
  const updatedAt = typeof obj.updatedAt === "number" ? obj.updatedAt : now
  const modelId = typeof obj.modelId === "string" ? obj.modelId : undefined
  const currentLeafId =
    typeof obj.currentLeafId === "number" ||
    typeof obj.currentLeafId === "string"
      ? obj.currentLeafId
      : undefined

  return {
    session: {
      id,
      title,
      createdAt,
      updatedAt,
      modelId,
      currentLeafId,
      messages
    } as ChatSessionImportParsed,
    sessionId: id,
    messagesIn: rawMessages.length,
    messagesKept: messages.length,
    droppedMessages: dropReasons.length,
    dropReasons
  }
}

// -- Output type aliases for consumers that need typed results --

export type ChatMessageParsed = z.infer<typeof ChatMessageSchema>
export type ChatSessionParsed = z.infer<typeof ChatSessionSchema>
export type ChatSessionImportParsed = z.infer<typeof ChatSessionImportSchema>
