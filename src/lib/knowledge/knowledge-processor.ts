import { type ChunkDocument, chunkDocuments } from "@/lib/embeddings/chunker"
import { getEmbeddingConfig } from "@/lib/embeddings/config"
import { fromDocuments } from "@/lib/embeddings/vector-store"
import { getErrorMessage } from "@/lib/error-utils"
import { logger } from "@/lib/logger"

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
  pages?: Array<{ pageNumber: number; text: string }>
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
  const { fileId, fileName, content, pages, contentType, onProgress } = options

  try {
    // Report initial status
    onProgress?.({
      fileId,
      fileName,
      status: "processing",
      processedChunks: 0,
      totalChunks: 0
    })

    // 1. Create documents from content (preserve page metadata when available)
    // `type` is the vector-store category ("file"), NOT the MIME type — a
    // MIME string here makes the chunks invisible to every type:"file" query
    // (attachment preview, file search). The MIME goes in `contentType`.
    const baseMetadata = {
      fileId,
      source: fileName,
      title: fileName,
      contentType,
      type: "file" as const
    }

    const pageDocuments = (pages || [])
      .filter((page) => page.text.trim().length > 0)
      .map(
        (page): ChunkDocument => ({
          pageContent: page.text,
          metadata: {
            ...baseMetadata,
            page: page.pageNumber
          }
        })
      )

    const documents: ChunkDocument[] =
      pageDocuments.length > 0
        ? pageDocuments
        : [
            {
              pageContent: content,
              metadata: baseMetadata
            }
          ]

    // 2. Split through the one app-owned chunker used by every RAG source.
    const embeddingConfig = await getEmbeddingConfig()
    logger.verbose("Splitting document", "processKnowledge", { fileName })
    const chunks = await chunkDocuments(documents, {
      chunkSize: embeddingConfig.chunkSize,
      chunkOverlap: embeddingConfig.chunkOverlap,
      strategy: embeddingConfig.chunkingStrategy
    })
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

    // 3. Store chunks with embeddings
    logger.verbose("Storing embeddings for document", "processKnowledge", {
      fileName
    })
    const vectorIds = await fromDocuments(
      chunks.map((chunk) => ({
        pageContent: chunk.pageContent,
        metadata: {
          ...chunk.metadata,
          fileId: (chunk.metadata.fileId as string) || fileId,
          source: (chunk.metadata.source as string) || fileName,
          title: (chunk.metadata.title as string) || fileName,
          // Force the store category last so nothing in chunk.metadata (e.g.
          // a legacy MIME `type`) can override it.
          type: "file" as const
        }
      })),
      fileId
    )

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
      vectorCount: vectorIds.length
    })

    return {
      success: true,
      vectorIds: vectorIds,
      chunkCount: chunks.length
    }
  } catch (error) {
    const errorMessage = getErrorMessage(error)

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
    pages?: Array<{ pageNumber: number; text: string }>
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
