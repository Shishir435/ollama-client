import { z } from "zod"

/**
 * Opaque provider continuation state, kept only well-formed enough to replay.
 *
 * Signed Anthropic thinking blocks and OpenAI reasoning details are validated
 * for wire ownership and size and nothing else: their contents belong to the
 * provider, must survive a round trip byte-for-byte, and must never be rendered
 * or logged. `passthrough()` is deliberate — a field this version does not know
 * about is still part of what the provider expects back.
 */

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
