import { z } from "zod"
import { AppFailureSchema } from "./app-failure"

const optionalString = z.preprocess(
  (value) => (value === null ? undefined : value),
  z.string().optional()
)

const optionalNumber = z.preprocess(
  (value) => (value === null ? undefined : value),
  z.number().optional()
)

const optionalBoolean = z.preprocess(
  (value) => (value === null ? undefined : value),
  z.boolean().optional()
)

/** ---- Metrics (used inside messages and for SQLite parseMetrics) ---- */

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

/** Bounded source excerpt recorded with a generated answer. */
export const UsedContextChunkSchema = z.object({
  id: z.union([z.string(), z.number()]),
  title: z.string(),
  titleKey: z.string().optional(),
  excerpt: z.string(),
  score: z.number(),
  sectionPath: z.string().optional(),
  source: z.string().optional(),
  chunkIndex: z.number().optional()
})

/** Persistable, presentation-safe summary of one model tool execution. */
export const ToolRunSchema = z.object({
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
  risk: z.enum(["low", "medium", "high", "critical"]).optional(),
  taintGeneration: z.number().int().nonnegative().optional(),
  origin: z.string().optional(),
  status: z.enum([
    "pending",
    "running",
    "done",
    "error",
    "awaiting-confirmation"
  ]),
  callId: z.string().optional(),
  startedAt: z.number(),
  completedAt: z.number().optional(),
  sources: z
    .array(
      z.object({
        id: z.union([z.string(), z.number()]).optional(),
        title: z.string(),
        url: optionalString,
        excerpt: optionalString,
        publishedAt: optionalString,
        source: optionalString,
        score: optionalNumber,
        category: optionalString,
        used: optionalBoolean
      })
    )
    .optional(),
  error: z.string().optional(),
  truncated: z.boolean().optional(),
  args: z.record(z.string(), z.unknown()).optional(),
  resultPreview: z.string().optional()
})

export const ActivityTextSchema = z.object({
  text: z.string(),
  textKey: z.string().optional()
})

/** Persistable progress event shown in a turn's reasoning trace. */
export const ActivityEventSchema = z.object({
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
  labelKey: z.string().optional(),
  status: z.enum(["running", "done", "error"]),
  startedAt: z.number(),
  finishedAt: z.number().optional(),
  inputPreview: z.string().optional(),
  outputPreview: z.union([z.string(), ActivityTextSchema]).optional(),
  resultCount: z.number().optional(),
  sourceTitles: z.array(z.union([z.string(), ActivityTextSchema])).optional(),
  error: z.string().optional()
})

/** Provider-neutral model-requested tool call. */
export const ToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  arguments: z.record(z.string(), z.unknown())
})

const MAX_REPLAY_ARTIFACT_BYTES = 1024 * 1024
const MAX_REPLAY_BLOCKS = 256

const AnthropicReplayBlockSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("thinking"),
      thinking: z.string(),
      signature: z.string()
    })
    .passthrough(),
  z
    .object({
      type: z.literal("redacted_thinking"),
      data: z.string()
    })
    .passthrough(),
  z.object({ type: z.literal("text"), text: z.string() }).passthrough(),
  z
    .object({
      type: z.literal("tool_use"),
      id: z.string(),
      name: z.string(),
      input: z.record(z.string(), z.unknown())
    })
    .passthrough()
])

const OpenAIReasoningCommonSchema = z.object({
  id: z.string().nullish(),
  format: z.string().nullish(),
  index: z.number().int().nonnegative().optional()
})

const OpenAIReplayBlockSchema = z.discriminatedUnion("type", [
  OpenAIReasoningCommonSchema.extend({
    type: z.literal("reasoning.summary"),
    summary: z.string()
  }).passthrough(),
  OpenAIReasoningCommonSchema.extend({
    type: z.literal("reasoning.encrypted"),
    data: z.string()
  }).passthrough(),
  OpenAIReasoningCommonSchema.extend({
    type: z.literal("reasoning.text"),
    text: z.string(),
    signature: z.string().nullish()
  }).passthrough()
])

const utf8ByteLength = (value: string): number => {
  let bytes = 0
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    bytes +=
      codePoint <= 0x7f
        ? 1
        : codePoint <= 0x7ff
          ? 2
          : codePoint <= 0xffff
            ? 3
            : 4
  }
  return bytes
}

const replayArtifactSize = (value: unknown): number => {
  try {
    const serialized = JSON.stringify(value)
    return typeof serialized === "string"
      ? utf8ByteLength(serialized)
      : Number.POSITIVE_INFINITY
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

/**
 * Versioned, opaque provider continuation state. Blocks are validated only
 * enough to preserve wire ownership and size limits; importers must never
 * render or log their opaque contents.
 */
export const ProviderReplayArtifactSchema = z
  .discriminatedUnion("wire", [
    z.object({
      version: z.literal(1),
      wire: z.literal("anthropic"),
      providerId: z.string().min(1),
      model: z.string().min(1),
      blocks: z.array(AnthropicReplayBlockSchema).min(1).max(MAX_REPLAY_BLOCKS)
    }),
    z.object({
      version: z.literal(1),
      wire: z.literal("openai"),
      providerId: z.string().min(1),
      model: z.string().min(1),
      blocks: z.array(OpenAIReplayBlockSchema).min(1).max(MAX_REPLAY_BLOCKS)
    })
  ])
  .refine(
    (artifact) => replayArtifactSize(artifact) <= MAX_REPLAY_ARTIFACT_BYTES,
    "Provider replay artifact exceeds the storage limit"
  )

/** Optional persisted generation, retrieval, and tool-execution measurements. */
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
  thinkingOnlyResponse: z.boolean().optional(),
  emptyResponse: z.boolean().optional(),
  interrupted: z.boolean().optional()
})

/**
 * Persisted/imported RAG attachment contract.
 *
 * Attachment bytes accept the runtime `Uint8Array`, JSON arrays, and the
 * index-keyed object produced when a typed array is stringified. Application
 * adapters normalize all accepted forms back to `Uint8Array` after parsing.
 */
export const FileAttachmentSchema = z.object({
  id: z.number().optional(),
  fileId: z.string(),
  fileName: z.string(),
  fileType: z.string(),
  fileSize: z.number(),
  textPreview: z.string().optional(),
  processedAt: z.number(),
  sessionId: z.string().optional(),
  messageId: z.number().optional(),
  /** Compatibility byte shapes; normalize before application use. */
  data: z
    .union([
      z.instanceof(Uint8Array),
      z.array(z.number()),
      z.record(z.string(), z.number())
    ])
    .optional()
})

/** Persisted attachment shape; `data` is not yet runtime-normalized. */
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

/** Partial safe failure persisted on a terminal assistant message. */
export const ChatMessageErrorSchema = AppFailureSchema.partial()

/**
 * Persisted and transported chat message contract. Attachment byte fields may
 * retain compatibility shapes and require application normalization.
 */
export const ChatMessageSchema = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  role: z.enum(["user", "assistant", "system", "tool"]),
  content: z.string(),
  thinking: z.string().optional(),
  replayArtifact: ProviderReplayArtifactSchema.optional(),
  done: z.boolean().optional(),
  model: z.string().optional(),
  attachments: z.array(FileAttachmentSchema).optional(),
  images: z.array(ImageAttachmentSchema).optional(),
  toolCalls: z.array(ToolCallSchema).optional(),
  toolName: z.string().optional(),
  toolCallId: z.string().optional(),
  toolIsError: z.boolean().optional(),
  error: ChatMessageErrorSchema.optional(),
  timestamp: z.number().optional(),
  metrics: ChatMessageMetricsSchema.optional(),
  parentId: z.union([z.number(), z.string()]).optional(),
  childrenIds: z.array(z.union([z.number(), z.string()])).optional(),
  siblingIds: z.array(z.union([z.number(), z.string()])).optional()
})

/** Version-independent persisted chat-session metadata and optional messages. */
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

/** Persisted message shape before application attachment normalization. */
export type ChatMessageParsed = z.infer<typeof ChatMessageSchema>
/** Persisted session with an optional message collection. */
export type ChatSessionParsed = z.infer<typeof ChatSessionSchema>
/** Import session shape requiring its complete message collection. */
export type ChatSessionImportParsed = z.infer<typeof ChatSessionImportSchema>
