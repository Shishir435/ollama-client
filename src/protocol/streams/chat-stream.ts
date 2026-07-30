import { z } from "zod"
import {
  ContextReceiptSchema,
  type PersistedTurnRequest,
  PersistedTurnRequestSchema,
  TurnModeSchema
} from "@/application/turns/turn-contract"
import { MESSAGE_KEYS } from "@/lib/constants"
import { AppFailureSchema } from "@/protocol/app-failure"
import type { ChatMessage, ProviderReplayArtifact, ToolRun } from "@/types"
import {
  ChatMessageSchema,
  ProviderReplayArtifactSchema,
  ToolRunSchema
} from "@/types/chat.schemas"
import {
  SelectionStreamClientEventSchemas,
  SelectionStreamServerEventSchemas
} from "./selection-stream"
import { STREAM_PROTOCOL_VERSION } from "./version"

const version = z.literal(STREAM_PROTOCOL_VERSION)

const SelectedModelRefSchema = z.object({
  providerId: z.string().min(1),
  modelId: z.string().min(1)
})

const ContextFileSchema = z.object({
  text: z.string(),
  metadata: z.object({
    fileName: z.string(),
    fileId: z.string().optional()
  })
})

const toRuntimeChatMessage = (
  message: z.infer<typeof ChatMessageSchema>
): ChatMessage => {
  const { attachments, ...rest } = message
  return {
    ...rest,
    ...(attachments
      ? {
          attachments: attachments.map((attachment) => {
            const { data, ...attachmentRest } = attachment
            return {
              ...attachmentRest,
              ...(data
                ? {
                    data:
                      data instanceof Uint8Array
                        ? data
                        : Uint8Array.from(
                            Array.isArray(data) ? data : Object.values(data)
                          )
                  }
                : {})
            }
          })
        }
      : {})
  }
}

const RuntimeChatMessageSchema =
  ChatMessageSchema.transform(toRuntimeChatMessage)

const ContextRequestPayloadSchema = z.object({
  requestId: z.string().min(1),
  turnId: z.string().min(1).optional(),
  mode: TurnModeSchema.optional(),
  rawInput: z.string(),
  messages: z.array(RuntimeChatMessageSchema),
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
  selectedModel: z.string(),
  selectedModelRef: SelectedModelRefSchema.nullable(),
  customModel: z.string().optional(),
  files: z.array(ContextFileSchema).optional()
})

export const ChatStreamClientEventSchema = z.discriminatedUnion("type", [
  z.object({
    version,
    type: z.literal(MESSAGE_KEYS.PROVIDER.CHAT_WITH_MODEL),
    payload: z.object({
      model: z.string().min(1),
      providerId: z.string().optional(),
      messages: z.array(RuntimeChatMessageSchema),
      sessionId: z.string().optional(),
      chatId: z.string().optional(),
      requestId: z.string().optional(),
      clientContextPrepared: z.boolean().optional()
    })
  }),
  z.object({
    version,
    type: z.literal(MESSAGE_KEYS.PROVIDER.START_TURN),
    payload: z.object({
      start: z.object({
        submission: z.object({
          id: z.string().min(1),
          sessionId: z.string().min(1),
          mode: TurnModeSchema,
          model: z.string().min(1),
          providerId: z.string().optional(),
          request: PersistedTurnRequestSchema.transform(
            (request): PersistedTurnRequest => ({
              ...request,
              context: {
                ...request.context,
                messages: request.context.messages.map(toRuntimeChatMessage)
              },
              userMessage: toRuntimeChatMessage(request.userMessage)
            })
          ),
          createdAt: z.number().int().nonnegative()
        }),
        userMessageId: z.number().int().nonnegative()
      }),
      assistantMessageId: z.number().int().nonnegative()
    })
  }),
  z.object({
    version,
    type: z.literal(MESSAGE_KEYS.PROVIDER.BUILD_CONTEXT),
    payload: ContextRequestPayloadSchema
  }),
  z.object({
    version,
    type: z.literal(MESSAGE_KEYS.PROVIDER.STOP_GENERATION),
    payload: z.object({ requestId: z.string().min(1) }).optional()
  }),
  z.object({
    version,
    type: z.literal(MESSAGE_KEYS.PROVIDER.RECONNECT_STREAM),
    payload: z.object({
      requestId: z.string().min(1),
      afterSeq: z.number().int().min(-1)
    })
  }),
  ...SelectionStreamClientEventSchemas
])

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

const TurnToastSchema = z.object({
  variant: z.enum(["default", "destructive"]).optional(),
  titleKey: z.string(),
  descriptionKey: z.string().optional(),
  descriptionValues: z.record(z.string(), z.string()).optional()
})

const RagSourceSchema = z.object({
  id: z.union([z.string(), z.number()]),
  title: z.string(),
  content: z.string(),
  score: z.number(),
  source: z.string().optional(),
  chunkIndex: z.number().int().optional(),
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
  chunkIndex: z.number().int().optional()
})

const BuildContextResultSchema = z.object({
  contentWithRAG: z.string(),
  ragSources: z
    .object({
      sources: z.array(RagSourceSchema),
      query: z.string()
    })
    .nullable(),
  promptContextStats: z.object({
    promptInputLength: z.number().int().nonnegative(),
    promptAugmentedLength: z.number().int().nonnegative(),
    tabContextLength: z.number().int().nonnegative(),
    ragContextLength: z.number().int().nonnegative(),
    tabContextTruncated: z.boolean(),
    groundedOnlyMode: z.boolean(),
    insufficientContext: z.boolean(),
    usedContextChunks: z.array(UsedContextChunkSchema),
    activityEvents: z.array(ActivityEventSchema)
  }),
  pageContextAdded: z.boolean()
})

const ChatChunkSchema = z
  .object({
    version,
    type: z.literal("chat_chunk"),
    seq: z.number().int().nonnegative().optional(),
    delta: z.string().optional(),
    thinkingDelta: z.string().optional(),
    replayArtifact: ProviderReplayArtifactSchema.transform(
      (artifact) => artifact as ProviderReplayArtifact
    ).optional(),
    toolRuns: z
      .array(ToolRunSchema)
      .transform((runs) => runs as ToolRun[])
      .optional(),
    done: z.boolean().optional(),
    aborted: z.boolean().optional(),
    error: AppFailureSchema.optional(),
    metrics: z.record(z.string(), z.unknown()).optional(),
    message: z
      .object({
        content: z.string().optional(),
        thinking: z.string().optional(),
        reasoning: z.string().optional(),
        reasoning_content: z.string().optional()
      })
      .optional()
  })
  .refine(
    (event) =>
      event.delta !== undefined ||
      event.thinkingDelta !== undefined ||
      event.replayArtifact !== undefined ||
      event.toolRuns !== undefined ||
      event.done === true ||
      event.aborted === true ||
      event.error !== undefined ||
      event.metrics !== undefined ||
      event.message !== undefined,
    "Chat chunk has no payload"
  )

export const ChatStreamServerEventSchema = z.discriminatedUnion("type", [
  ChatChunkSchema,
  z.object({
    version,
    type: z.literal("rag_sources"),
    seq: z.number().int().nonnegative().optional(),
    payload: z.object({
      sources: z.array(RagSourceSchema),
      query: z.string().optional()
    })
  }),
  z.object({
    version,
    type: z.literal("context_progress"),
    requestId: z.string().min(1),
    events: z.array(ActivityEventSchema)
  }),
  z.object({
    version,
    type: z.literal("context_warning"),
    requestId: z.string().min(1),
    payload: TurnToastSchema
  }),
  z.object({
    version,
    type: z.literal("context_result"),
    requestId: z.string().min(1),
    result: BuildContextResultSchema,
    receipt: ContextReceiptSchema
  }),
  z.object({
    version,
    type: z.literal("context_error"),
    requestId: z.string().min(1),
    failure: AppFailureSchema
  }),
  z.object({
    version,
    type: z.literal("stream_snapshot"),
    requestId: z.string().min(1),
    seq: z.number().int().min(-1),
    sequenceReset: z.boolean(),
    status: z.enum([
      "submitted",
      "building-context",
      "generating",
      "completed",
      "failed",
      "cancelled"
    ]),
    assistant: RuntimeChatMessageSchema.optional(),
    thinkingState: z
      .object({
        inThinking: z.boolean(),
        pending: z.string()
      })
      .optional(),
    failure: AppFailureSchema.optional()
  }),
  ...SelectionStreamServerEventSchemas
])

export type ChatStreamClientEvent = z.infer<typeof ChatStreamClientEventSchema>
export type ChatStreamServerEvent = z.infer<typeof ChatStreamServerEventSchema>

export const parseChatStreamClientEvent = (value: unknown) =>
  ChatStreamClientEventSchema.safeParse(normalizeLegacyClientEvent(value))

export const parseChatStreamServerEvent = (value: unknown) =>
  ChatStreamServerEventSchema.safeParse(normalizeLegacyServerEvent(value))

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value)

/**
 * One-boundary compatibility shim for an extension page and worker that were
 * already connected while the extension updated. Everything beyond this
 * function sees v1. New emitters always send v1.
 */
const normalizeLegacyClientEvent = (value: unknown): unknown => {
  if (!isRecord(value) || value.version !== undefined) return value
  return { ...value, version: STREAM_PROTOCOL_VERSION }
}

const normalizeLegacyServerEvent = (value: unknown): unknown => {
  if (!isRecord(value)) return value
  const versioned =
    value.version === undefined
      ? { ...value, version: STREAM_PROTOCOL_VERSION }
      : value

  if (typeof versioned.type !== "string") {
    return { ...versioned, type: "chat_chunk" }
  }
  if (
    versioned.type === "context_error" &&
    typeof versioned.error === "string"
  ) {
    const { error: message, ...rest } = versioned
    return {
      ...rest,
      failure: { status: 0, message }
    }
  }
  if (versioned.type === MESSAGE_KEYS.BROWSER.SELECTION_ACTION_ERROR) {
    const { error, ...rest } = versioned
    const failure = isRecord(error)
      ? error
      : { status: 0, message: "Selection action failed. Try again." }
    return { ...rest, failure }
  }
  return versioned
}
