/**
 * Test utility for generating and storing embeddings
 * This can be called from the browser console to test embedding functionality
 *
 * Usage in console:
 * import('/src/lib/embeddings/test-embedding.ts').then(m => m.testEmbeddingGeneration('Hello world'))
 */

import { logger } from "@/lib/logger"
import { generateEmbedding } from "./ollama-embedder"
import { storeVector } from "./vector-store"

/**
 * Test function to generate and store an embedding
 */
export const testEmbeddingGeneration = async (
  text: string,
  metadata?: {
    type?: "chat" | "file" | "webpage"
    sessionId?: string
    fileId?: string
    title?: string
  }
): Promise<{ success: boolean; error?: string; id?: number }> => {
  try {
    logger.info(
      `[Test Embedding] Generating embedding for: "${text.substring(0, 50)}..."`,
      "testEmbeddingGeneration"
    )

    // Generate embedding
    const result = await generateEmbedding(text)

    if ("error" in result) {
      logger.error(
        "[Test Embedding] Error generating embedding",
        "testEmbeddingGeneration",
        { error: result.error }
      )
      return { success: false, error: result.error }
    }

    logger.info(
      `[Test Embedding] Embedding generated: ${result.embedding.length} dimensions`,
      "testEmbeddingGeneration"
    )

    // Store in vector database
    const id = await storeVector(text, result.embedding, {
      type: metadata?.type || "chat",
      sessionId: metadata?.sessionId,
      fileId: metadata?.fileId,
      url: metadata?.title ? undefined : undefined,
      title: metadata?.title || "Test Embedding",
      source: "test-embedding",
      timestamp: Date.now()
    })

    logger.info(
      `[Test Embedding] Stored in vector database with ID: ${id}`,
      "testEmbeddingGeneration"
    )
    return { success: true, id }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error("[Test Embedding] Error", "testEmbeddingGeneration", {
      error: errorMessage
    })
    return { success: false, error: errorMessage }
  }
}

/**
 * Test function to generate embeddings for multiple texts
 */
export const testBatchEmbeddingGeneration = async (
  texts: string[],
  metadata?: {
    type?: "chat" | "file" | "webpage"
    fileId?: string
    title?: string
  }
): Promise<{ success: boolean; count: number; errors: string[] }> => {
  try {
    logger.info(
      `[Test Embedding] Generating embeddings for ${texts.length} texts`,
      "testBatchEmbeddingGeneration"
    )

    const { generateEmbeddingsBatch } = await import("./ollama-embedder")

    const results = await generateEmbeddingsBatch(
      texts,
      undefined,
      (current, total) => {
        if (current % 10 === 0 || current === total) {
          logger.info(
            `[Test Embedding] Progress: ${current}/${total}`,
            "testBatchEmbeddingGeneration"
          )
        }
      }
    )

    let successCount = 0
    const errors: string[] = []

    for (let i = 0; i < results.length; i++) {
      const result = results[i]
      if ("error" in result) {
        errors.push(`Text ${i + 1}: ${result.error}`)
        continue
      }

      try {
        await storeVector(texts[i], result.embedding, {
          type: metadata?.type || "file",
          fileId: metadata?.fileId,
          title: metadata?.title || `Chunk ${i + 1}`,
          source: "test-embedding",
          timestamp: Date.now(),
          chunkIndex: i,
          totalChunks: texts.length
        })
        successCount++
      } catch (error) {
        errors.push(
          `Storage error for text ${i + 1}: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }

    logger.info(
      `[Test Embedding] Completed: ${successCount}/${texts.length} embeddings stored`,
      "testBatchEmbeddingGeneration"
    )
    if (errors.length > 0) {
      logger.error("[Test Embedding] Errors", "testBatchEmbeddingGeneration", {
        errors
      })
    }

    return { success: errors.length === 0, count: successCount, errors }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error("[Test Embedding] Error", "testBatchEmbeddingGeneration", {
      error: errorMessage
    })
    return { success: false, count: 0, errors: [errorMessage] }
  }
}
