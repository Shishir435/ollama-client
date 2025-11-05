/**
 * Test utility for generating and storing embeddings
 * This can be called from the browser console to test embedding functionality
 *
 * Usage in console:
 * import('/src/lib/embeddings/test-embedding.ts').then(m => m.testEmbeddingGeneration('Hello world'))
 */

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
    console.log(
      `[Test Embedding] Generating embedding for: "${text.substring(0, 50)}..."`
    )

    // Generate embedding
    const result = await generateEmbedding(text)

    if ("error" in result) {
      console.error(
        "[Test Embedding] Error generating embedding:",
        result.error
      )
      return { success: false, error: result.error }
    }

    console.log(
      `[Test Embedding] Embedding generated: ${result.embedding.length} dimensions`
    )

    // Store in vector database
    const id = await storeVector(text, result.embedding, {
      type: metadata?.type || "chat",
      sessionId: metadata?.sessionId,
      fileId: metadata?.fileId,
      url: metadata?.title ? undefined : undefined,
      title: metadata?.title || "Test Embedding",
      timestamp: Date.now()
    })

    console.log(`[Test Embedding] Stored in vector database with ID: ${id}`)
    return { success: true, id }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error("[Test Embedding] Error:", errorMessage)
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
    console.log(
      `[Test Embedding] Generating embeddings for ${texts.length} texts`
    )

    const { generateEmbeddingsBatch } = await import("./ollama-embedder")

    const results = await generateEmbeddingsBatch(
      texts,
      undefined,
      (current, total) => {
        console.log(`[Test Embedding] Progress: ${current}/${total}`)
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

    console.log(
      `[Test Embedding] Completed: ${successCount}/${texts.length} embeddings stored`
    )
    if (errors.length > 0) {
      console.error("[Test Embedding] Errors:", errors)
    }

    return { success: errors.length === 0, count: successCount, errors }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error("[Test Embedding] Error:", errorMessage)
    return { success: false, count: 0, errors: [errorMessage] }
  }
}
