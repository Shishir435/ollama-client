/**
 * Type-category match with legacy tolerance: a processor bug used to write
 * the file's MIME type (e.g. "text/html") into `metadata.type`, so when
 * querying for "file", any row that isn't a known non-file category counts
 * as a file. Keeps pre-fix rows visible without a data migration.
 */
export const matchesVectorType = (
  docType: string | undefined,
  wanted: string
): boolean => {
  if (docType === wanted) return true
  return wanted === "file" && docType !== "chat" && docType !== "webpage"
}

export interface VectorDocument {
  id?: number
  content: string
  embedding: number[]
  // Normalized embedding (L2 normalized) - stored separately for performance
  // If not present, will be computed on-the-fly for backwards compatibility
  normalizedEmbedding?: number[]
  // Pre-computed L2 norm - speeds up similarity calculation
  norm?: number
  metadata: {
    source: string
    type: "chat" | "file" | "webpage"
    /** Original MIME type of the source file (e.g. "text/html"). */
    contentType?: string
    sessionId?: string
    fileId?: string
    url?: string
    title?: string
    timestamp: number
    chunkIndex?: number
    totalChunks?: number
    page?: number
    role?: "user" | "assistant" | "system" | "tool"
    chatId?: string
    messageId?: number
    // Quality assessment metadata (added during migration/embedding)
    qualityScore?: number
    qualityReasons?: string
    embeddingModel?: string
    embeddingProviderId?: string
    embeddingDim?: number
  }
}

export interface SearchResult {
  document: VectorDocument
  similarity: number
}
