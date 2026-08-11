import { z } from "zod"

/**
 * What a turn *did*, as opposed to what it said.
 *
 * Retrieval sources, tool executions and reasoning-trace events all end up
 * inside `ChatMessageMetrics`, which is why they live together: they are
 * written by the same turn, read by the same panels, and versioned as one.
 *
 * Everything here is presentation-safe by construction — excerpts and previews,
 * never whole documents or raw tool output.
 */

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

/** ---- Metrics ---- */
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
