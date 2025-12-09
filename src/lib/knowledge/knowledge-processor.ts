import { fromDocuments } from "@/lib/embeddings/vector-store"
import { logger } from "@/lib/logger"
import { getTextSplitter } from "@/lib/text-processing"
import type { Document } from "@/lib/text-processing/types"

export interface ProcessingProgress {
  fileId: string
  fileName: string
  status: "pending" | "processing" | "completed" | "error"
  processedChunks: number
  totalChunks: number
  error?: string
}

export interface KnowledgeProcessorOptions {
  fileId: string
  fileName: string
  content: string
  contentType: string
  onProgress?: (progress: ProcessingProgress) => void
}

/**
 * Processes a document into chunks and stores embeddings
 * This is the main pipeline for knowledge base processing
 */
export async function processKnowledge(
  options: KnowledgeProcessorOptions
): Promise<{
  success: boolean
  vectorIds: number[]
  chunkCount: number
  error?: string
}> {
  const { fileId, fileName, content, contentType, onProgress } = options

  try {
    // Report initial status
    onProgress?.({
      fileId,
      fileName,
      status: "processing",
      processedChunks: 0,
      totalChunks: 0
    })

    // 1. Create a document from the content
    const document: Document = {
      pageContent: content,
      metadata: {
        fileId,
        source: fileName,
        title: fileName,
        type: contentType,
        timestamp: Date.now()
      }
    }

    // 2. Get configured text splitter
    const textSplitter = await getTextSplitter()

    // 3. Split document into chunks
    logger.verbose("Splitting document", "processKnowledge", { fileName })
    const chunks = await textSplitter.splitDocuments([document])
    logger.verbose("Created chunks from document", "processKnowledge", {
      fileName,
      chunkCount: chunks.length
    })

    // Update progress with total chunks
    onProgress?.({
      fileId,
      fileName,
      status: "processing",
      processedChunks: 0,
      totalChunks: chunks.length
    })

    // 4. Store chunks with embeddings
    logger.verbose("Storing embeddings for document", "processKnowledge", {
      fileName
    })
    const result = await fromDocuments(chunks, fileId)

    // Report completion
    onProgress?.({
      fileId,
      fileName,
      status: "completed",
      processedChunks: chunks.length,
      totalChunks: chunks.length
    })

    logger.info("Successfully processed document", "processKnowledge", {
      fileName,
      vectorCount: result.vectorIds.length
    })

    return {
      success: true,
      vectorIds: result.vectorIds,
      chunkCount: chunks.length
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)

    logger.error("Error processing document", "processKnowledge", {
      fileName,
      error: errorMessage
    })

    // Report error
    onProgress?.({
      fileId,
      fileName,
      status: "error",
      processedChunks: 0,
      totalChunks: 0,
      error: errorMessage
    })

    return {
      success: false,
      vectorIds: [],
      chunkCount: 0,
      error: errorMessage
    }
  }
}

/**
 * Processes multiple files in batch
 */
export async function processKnowledgeBatch(
  files: Array<{
    fileId: string
    fileName: string
    content: string
    contentType: string
  }>,
  onProgress?: (fileId: string, progress: ProcessingProgress) => void
): Promise<
  Map<string, { success: boolean; chunkCount: number; error?: string }>
> {
  const results = new Map<
    string,
    { success: boolean; chunkCount: number; error?: string }
  >()

  for (const file of files) {
    const result = await processKnowledge({
      ...file,
      onProgress: (progress) => onProgress?.(file.fileId, progress)
    })

    results.set(file.fileId, {
      success: result.success,
      chunkCount: result.chunkCount,
      error: result.error
    })

    // Small delay between files to prevent overwhelming the system
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  return results
}
