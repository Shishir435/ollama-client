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
  /**
   * The raw vector. Rows written since the float32 format do not store it:
   * the read hook rebuilds it from the unit vector and `norm` on first access.
   */
  embedding: number[]
  /**
   * The L2-normalized vector, stored for performance. `Float32Array` in
   * current rows, `number[]` in rows written before the float32 format. Absent
   * on the oldest rows, where it is computed on the fly.
   */
  normalizedEmbedding?: Float32Array | number[]
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
    messageRevision?: string
    messageIndexToken?: string
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
