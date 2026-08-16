import { z } from "zod"
import { createAppError } from "@/lib/error-utils"
import { decodeProviderJson } from "./response-decoding"

/**
 * Runtime validation for embedding responses.
 *
 * An embedding endpoint is the one provider path whose result is consumed as
 * raw numbers rather than rendered, so a malformed answer has no natural place
 * to surface: `data.data[0].embedding` on an error object throws an
 * unclassified `TypeError`, and a vector carrying `null` or a string reaches
 * cosine similarity as `NaN` and silently poisons every ranking it takes part
 * in. Both arrive as HTTP 200, so the status check upstream does not see them.
 *
 * The vector schema therefore rejects non-finite members explicitly — `NaN`
 * and `Infinity` are numbers to both TypeScript and `z.number()`.
 */
const EmbeddingVectorSchema = z
  .array(z.number().finite())
  .min(1)
  .describe("embedding vector")

const OpenAIEmbeddingResponseSchema = z.object({
  data: z
    .array(
      z.object({
        embedding: EmbeddingVectorSchema,
        index: z.number().int().nonnegative().optional()
      })
    )
    .min(1)
})

/**
 * Ollama answers `/api/embed` with `embeddings[]` and legacy `/api/embeddings`
 * with a single `embedding`. Either shape is accepted here so the caller does
 * not branch before it knows which endpoint answered.
 */
const OllamaEmbeddingResponseSchema = z.union([
  z.object({ embeddings: z.array(EmbeddingVectorSchema).min(1) }),
  z.object({ embedding: EmbeddingVectorSchema })
])

interface EmbeddingResponseContext {
  providerId: string
  providerName?: string
  baseUrl: string
  userMessage: string
}

const invalidEmbeddingError = (
  context: EmbeddingResponseContext,
  detail: string
) =>
  createAppError(`Provider returned an invalid embedding response: ${detail}`, {
    kind: "provider",
    phase: "response",
    providerId: context.providerId,
    providerName: context.providerName,
    baseUrl: context.baseUrl,
    userMessage: context.userMessage
  })

/** Decode one OpenAI-compatible embedding vector. */
export const decodeOpenAIEmbedding = async (
  response: Response,
  context: EmbeddingResponseContext
): Promise<number[]> => {
  const decoded = await decodeProviderJson(
    response,
    OpenAIEmbeddingResponseSchema,
    { ...context, label: "embedding response" }
  )
  return decoded.data[0].embedding
}

/**
 * Decode an OpenAI-compatible batch embedding response.
 *
 * The count is checked against the request: a server that silently drops or
 * merges inputs would otherwise return vectors that the caller zips back onto
 * the wrong texts, which is indistinguishable from a working index until
 * retrieval starts returning unrelated chunks. Results are ordered by `index`
 * when the server supplies one, since the spec permits any order.
 */
export const decodeOpenAIEmbeddingBatch = async (
  response: Response,
  expectedCount: number,
  context: EmbeddingResponseContext
): Promise<number[][]> => {
  const decoded = await decodeProviderJson(
    response,
    OpenAIEmbeddingResponseSchema,
    { ...context, label: "batch embedding response" }
  )

  if (decoded.data.length !== expectedCount) {
    throw invalidEmbeddingError(
      context,
      `expected ${expectedCount} vectors, received ${decoded.data.length}`
    )
  }

  const ordered = decoded.data.every((item) => item.index !== undefined)
    ? [...decoded.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    : decoded.data

  return ordered.map((item) => item.embedding)
}

/** Decode an Ollama embedding vector from either endpoint shape. */
export const decodeOllamaEmbedding = async (
  response: Response,
  context: EmbeddingResponseContext
): Promise<number[]> => {
  const decoded = await decodeProviderJson(
    response,
    OllamaEmbeddingResponseSchema,
    { ...context, label: "embedding response" }
  )
  return "embeddings" in decoded ? decoded.embeddings[0] : decoded.embedding
}

/**
 * Validate a vector obtained outside the decoders above.
 *
 * Vectors that reach storage must be finite and non-empty however they were
 * produced; a route that assembled one by hand still owes that guarantee.
 */
export const assertEmbeddingVector = (
  vector: unknown,
  context: EmbeddingResponseContext
): number[] => {
  const parsed = EmbeddingVectorSchema.safeParse(vector)
  if (!parsed.success) {
    throw invalidEmbeddingError(context, "vector is empty or not finite")
  }
  return parsed.data
}
