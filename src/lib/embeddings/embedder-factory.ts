import { logger } from "@/lib/logger"
import { generateEmbedding as generateOllamaEmbedding } from "./ollama-embedder"

/**
 * Unified embedding generation factory
 * Currently uses Ollama-only due to CSP constraints with WebGPU WASM loading
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
 * Generate embedding using Ollama
 *
 * @param text - Text to embed
 * @returns Embedding result or error
 */
export async function generateEmbeddingUnified(
  text: string
): Promise<EmbeddingResult | EmbeddingError> {
  logger.info("Generating embedding via Ollama", "EmbedderFactory", {
    textLength: text.length
  })

  try {
    return await generateViaOllama(text)
  } catch (error) {
    logger.error("Embedding generation failed", "EmbedderFactory", { error })
    return {
      error: error instanceof Error ? error.message : "Unknown error"
    }
  }
}

/**
 * Generate batch embeddings (more efficient than multiple single calls)
 */
export async function generateBatchEmbeddingsUnified(
  texts: string[]
): Promise<EmbeddingResult[] | EmbeddingError> {
  logger.info(
    `Generating ${texts.length} embeddings via Ollama`,
    "EmbedderFactory"
  )

  try {
    const embeddings: EmbeddingResult[] = []
    for (const text of texts) {
      const result = await generateViaOllama(text)
      if ("error" in result) {
        return result
      }
      embeddings.push(result)
    }
    return embeddings
  } catch (error) {
    logger.error("Batch embedding generation failed", "EmbedderFactory", {
      error
    })
    return {
      error: error instanceof Error ? error.message : "Unknown error"
    }
  }
}

/**
 * Generate embedding via Ollama
 */
async function generateViaOllama(
  text: string
): Promise<EmbeddingResult | EmbeddingError> {
  const result = await generateOllamaEmbedding(text)

  if ("error" in result) {
    return { error: result.error }
  }

  // For Ollama embeddings, we don't track the specific model in results
  // The model is configured separately in settings
  const dimension = 768 // Default Ollama dimension (nomic-embed-text)

  return {
    embedding: result.embedding,
    dimension,
    model: result.model || "ollama" // Model configured separately in settings
  }
}
