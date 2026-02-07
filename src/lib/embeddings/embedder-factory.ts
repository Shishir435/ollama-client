import { logger } from "@/lib/logger"
import { generateEmbedding, generateEmbeddingsBatch } from "./ollama-embedder"

/**
 * Unified embedding generation factory
 * Uses the active provider and model to generate embeddings.
 */

export interface EmbeddingResult {
  embedding: number[]
  dimension: number
  model: string
}

export interface EmbeddingError {
  error: string
}

/**
 * Generate embedding using the current provider/model
 *
 * @param text - Text to embed
 * @returns Embedding result or error
 */
export async function generateEmbeddingUnified(
  text: string
): Promise<EmbeddingResult | EmbeddingError> {
  const result = await generateEmbedding(text)

  if ("error" in result) {
    return { error: result.error }
  }

  return {
    embedding: result.embedding,
    dimension: result.embedding.length,
    model: result.model
  }
}

/**
 * Generate batch embeddings
 */
export async function generateBatchEmbeddingsUnified(
  texts: string[]
): Promise<EmbeddingResult[] | EmbeddingError> {
  logger.info(
    `Generating ${texts.length} embeddings via Provider`,
    "EmbedderFactory"
  )

  const results = await generateEmbeddingsBatch(texts)

  const processed: EmbeddingResult[] = []
  for (const res of results) {
    if ("error" in res) return res
    processed.push({
      embedding: res.embedding,
      dimension: res.embedding.length,
      model: res.model
    })
  }

  return processed
}
