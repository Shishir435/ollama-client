import { logger } from "@/lib/logger"
import {
  ensureEmbeddingRouteReady,
  generateEmbedding,
  generateEmbeddingsBatch,
  getEmbeddingRouteCapabilities
} from "./embedding-client"

/**
 * Unified embedding generation factory
 * Uses the active provider and model to generate embeddings.
 */

export interface EmbeddingResult {
  embedding: number[]
  dimension: number
  model: string
  providerId: string
}

export interface EmbeddingError {
  error: string
}

export interface EmbeddingFactoryCapabilities {
  activeProviderId?: string
  providerNativeAvailable: boolean
  sharedProviderId: string
  sharedModel: string
  sharedProviderAvailable: boolean
  defaultFallbackAvailable: boolean
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
    model: result.model,
    providerId: result.providerId
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
      model: res.model,
      providerId: res.providerId
    })
  }

  return processed
}

/**
 * Get embedding strategy capabilities for diagnostics and readiness checks.
 */
export async function getEmbeddingCapabilitiesUnified(): Promise<EmbeddingFactoryCapabilities> {
  return getEmbeddingRouteCapabilities()
}

/**
 * Trigger best-effort background warmup for embedding routes.
 */
export async function ensureEmbeddingReadyUnified(): Promise<{
  ready: boolean
  warmingUp: boolean
  details?: string
}> {
  return ensureEmbeddingRouteReady()
}
