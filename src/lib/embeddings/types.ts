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
    sessionId?: string
    fileId?: string
    url?: string
    title?: string
    timestamp: number
    chunkIndex?: number
    totalChunks?: number
    role?: "user" | "assistant" | "system"
    chatId?: string
    messageId?: number
  }
}

export interface SearchResult {
  document: VectorDocument
  similarity: number
}
