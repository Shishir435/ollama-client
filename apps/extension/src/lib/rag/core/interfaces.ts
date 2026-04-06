export type RagSourceType = "chat" | "file" | "webpage" | "manual"

export type RagMetadataValue = string | number | boolean
export type RagMetadata = Record<string, RagMetadataValue | undefined>

export interface RagDocument {
  id: string
  content: string
  sourceType: RagSourceType
  metadata: RagMetadata
  createdAt: number
  updatedAt?: number
}

export interface RagChunk {
  id: string
  documentId: string
  text: string
  tokenEstimate: number
  chunkIndex: number
  totalChunks: number
  metadata: RagMetadata
}

export interface ChunkingRequest {
  document: RagDocument
  maxChunkTokens: number
  overlapTokens: number
  strategy: "fixed" | "semantic" | "hybrid" | "markdown"
}

export interface DocumentSource {
  /**
   * Returns raw documents to ingest. Implementations should stream when possible
   * to keep extension memory bounded.
   */
  readAll(signal?: AbortSignal): Promise<RagDocument[]>
}

export interface Chunker {
  chunk(request: ChunkingRequest, signal?: AbortSignal): Promise<RagChunk[]>
}

export interface EmbeddingRequest {
  texts: string[]
  model?: string
  signal?: AbortSignal
}

export interface EmbeddingResponse {
  vectors: number[][]
  model: string
  dimension: number
}

export interface EmbedderCapabilities {
  nativeEmbeddingsAvailable: boolean
  sharedModelAvailable: boolean
  fallbackAvailable: boolean
}

export interface EmbedderReadiness {
  ready: boolean
  warmingUp: boolean
  details?: string
}

export interface Embedder {
  /**
   * Browser-safe contract: all embedding implementations must be reachable
   * via HTTP or local in-browser logic. Callers should not depend on transport.
   */
  embed(request: EmbeddingRequest): Promise<EmbeddingResponse>
  getCapabilities?(): Promise<EmbedderCapabilities>
  ensureReady?(signal?: AbortSignal): Promise<EmbedderReadiness>
}

export interface VectorRecord {
  chunk: RagChunk
  vector: number[]
  normalizedVector?: number[]
  norm?: number
}

export interface VectorFilter {
  sourceType?: RagSourceType
  documentIds?: string[]
  metadata?: Record<string, RagMetadataValue | RagMetadataValue[]>
  createdAfter?: number
  createdBefore?: number
}

export interface VectorSearchRequest {
  queryVector: number[]
  limit: number
  minScore: number
  filter?: VectorFilter
  metric?: "cosine" | "dot"
}

export interface VectorSearchResult {
  record: VectorRecord
  score: number
}

export interface VectorStore {
  upsert(records: VectorRecord[], signal?: AbortSignal): Promise<void>
  search(request: VectorSearchRequest): Promise<VectorSearchResult[]>
  deleteByDocumentIds(documentIds: string[]): Promise<number>
  clear(): Promise<void>
  stats(): Promise<{
    totalVectors: number
    estimatedBytes: number
    inMemoryVectors: number
  }>
}

export interface RetrieveRequest {
  query: string
  maxResults: number
  maxContextTokens: number
  minScore: number
  filter?: VectorFilter
  includeDiversity?: boolean
  recencyBias?: number
}

export interface RetrievedChunk {
  chunk: RagChunk
  score: number
  reasons: string[]
}

export interface RetrieveResponse {
  query: string
  chunks: RetrievedChunk[]
  tokenEstimate: number
}

export interface Retriever {
  retrieve(
    request: RetrieveRequest,
    signal?: AbortSignal
  ): Promise<RetrieveResponse>
}

export interface PromptAssembleRequest {
  systemPrompt: string
  userPrompt: string
  chatHistory: Array<{ role: "system" | "user" | "assistant"; content: string }>
  retrieved: RetrieveResponse
  modelContextWindow: number
  responseReserveTokens: number
}

export interface PromptAssembleResponse {
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>
  contextTokenEstimate: number
  truncated: boolean
  truncationReason?:
    | "context_budget"
    | "history_budget"
    | "single_chunk_too_large"
}

export interface PromptAssembler {
  assemble(request: PromptAssembleRequest): PromptAssembleResponse
}
