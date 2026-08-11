import { z } from "zod"
import { AppFailureSchema } from "./app-failure"
import { ChatMessageMetricsSchema, ToolCallSchema } from "./chat-activity"
import { FileAttachmentSchema, ImageAttachmentSchema } from "./chat-attachments"
import { ProviderReplayArtifactSchema } from "./chat-replay"

/**
 * The message and session shapes everything else here composes into.
 *
 * Kept last in dependency order on purpose: a message references activity
 * metrics, attachments and replay state, and none of those reference it back.
 */

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
