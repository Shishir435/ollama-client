import type { ContentExtractionConfig, FileUploadConfig } from "@/types"
import {
  CANONICAL_EMBEDDING_MODEL,
  DEFAULT_EXCLUDE_URLS,
  DEFAULT_SHARED_EMBEDDING_PROVIDER_ID,
  FILE_UPLOAD
} from "./defaults"

export type ChunkingStrategy = "fixed" | "semantic" | "hybrid" | "markdown"

export interface EmbeddingConfig {
  // Chunking settings
  chunkSize: number // Tokens per chunk (default: 500)
  chunkOverlap: number // Overlap between chunks in tokens (default: 100)
  chunkingStrategy: ChunkingStrategy // "fixed" | "semantic" | "hybrid"
  useEnhancedChunking: boolean // Use new text splitters (RecursiveCharacterTextSplitter) (default: false - backward compat)

  // Embedding generation settings
  batchSize: number // Number of texts to embed in parallel (default: 5)
  maxEmbeddingsPerFile: number // Limit embeddings per file (default: 1000, 0 = unlimited)
  embeddingStrategy:
    | "auto"
    | "provider-native"
    | "shared-model"
    | "default-provider-only"
    | "ollama-only" // Legacy value for compatibility
  sharedEmbeddingModel: string // Provider-agnostic shared model target (default: all-MiniLM-L6-v2)
  sharedEmbeddingProviderId: string // Provider used for shared model strategy (default: default provider)
  warmupEmbeddingsInBackground: boolean // Best-effort background model preparation (default: true)

  // Performance settings
  useWebWorker: boolean // Use Web Worker for embedding generation (default: true)
  enableCaching: boolean // Cache embeddings for identical content (default: true)

  // Search settings
  defaultSearchLimit: number // Default number of results (default: 10)
  defaultMinSimilarity: number // Minimum similarity threshold (default: 0.5 for semantic search)

  // Search cache settings
  searchCacheTTL: number // Cache TTL in minutes (default: 5)
  searchCacheMaxSize: number // Max cached queries (default: 50)

  // Storage settings
  maxStorageSize: number // Max storage in MB (default: 100MB, 0 = unlimited)
  autoCleanup: boolean // Auto cleanup old embeddings (default: false)
  cleanupDaysOld: number // Days old for cleanup (default: 30)

  // HNSW Settings (Phase 2)
  useHNSW: boolean // Enable HNSW indexing (default: true)
  hnswM: number // Links per node, higher = better accuracy (default: 16, range: 8-64)
  hnswEfConstruction: number // Construction quality, higher = better (default: 200, range: 100-500)
  hnswEfSearch: number // Search quality, higher = better accuracy (default: 100, range: 50-500)
  hnswMinVectors: number // Min vectors before HNSW activates (default: 0 = always use)
  hnswAutoRebuild: boolean // Auto rebuild on schema changes (default: true)

  // RAG Advanced Settings (Phase 3)
  useReranking: boolean // Enable transformers.js re-ranking (default: true)
  useHybridSearch: boolean // Enable hybrid search (keyword + semantic) (default: true)
  keywordWeight: number // Hybrid search keyword weight 0-1 (default: 0.6)
  semanticWeight: number // Hybrid search semantic weight 0-1 (default: 0.4)

  // Quality Filtering
  minQualityScore: number // Content quality threshold 0-1 (default: 0.4)
  excludeGreetings: boolean // Filter out greetings/short messages (default: true)

  // Diversity Settings
  diversityEnabled: boolean // Enable MMR diversity (default: true)
  diversityLambda: number // MMR lambda 0-1 (default: 0.7)

  // Re-ranking Quality
  minRerankScore: number // Minimum re-ranking confidence threshold 0-1 (default: 0.6)

  // Adaptive Search (RAG v3.0)
  useAdaptiveWeights: boolean // Enable adaptive hybrid weights based on query type (default: true)

  // Temporal Relevance (RAG v3.0)
  useTemporalBoosting: boolean // Enable recency boost for time-sensitive content (default: true)
  temporalBoostWeight: number // Max boost multiplier 0-1 (default: 0.3 = 30% max boost)
  temporalHalfLife: number // Days for 50% decay (default: 90)

  // User Feedback Learning
  feedbackEnabled: boolean // Enable user feedback collection (default: true)
  showRetrievedChunks: boolean // Show retrieved chunks in chat UI (default: true)
  feedbackBlendWeight: number // Weight for learned scores 0-1 (default: 0.2)
}

export const DEFAULT_EMBEDDING_CONFIG: EmbeddingConfig = {
  chunkSize: 500, // Reduced from 1000 for better granularity
  chunkOverlap: 50,
  chunkingStrategy: "markdown", // Updated to new enhanced strategy
  useEnhancedChunking: true, // Enable enhanced chunking by default for better RAG quality
  batchSize: 5, // Process 5 at a time
  maxEmbeddingsPerFile: 1000, // Limit to prevent memory issues
  embeddingStrategy: "auto",
  sharedEmbeddingModel: CANONICAL_EMBEDDING_MODEL,
  sharedEmbeddingProviderId: DEFAULT_SHARED_EMBEDDING_PROVIDER_ID,
  warmupEmbeddingsInBackground: true,
  useWebWorker: true, // Offload to worker thread
  enableCaching: true, // Cache duplicate content
  defaultSearchLimit: 10,
  defaultMinSimilarity: 0.5, // Increased from 0.4 for better precision
  searchCacheTTL: 5, // 5 minutes
  searchCacheMaxSize: 50, // Max 50 cached queries
  maxStorageSize: 100, // 100MB limit
  autoCleanup: false,
  cleanupDaysOld: 30,
  // HNSW Phase 2 defaults
  useHNSW: true, // Always use HNSW for best quality
  hnswM: 16, // Good balance of accuracy and speed
  hnswEfConstruction: 200, // High quality index construction
  hnswEfSearch: 100, // High quality search results
  hnswMinVectors: 0, // Always use HNSW (no threshold)
  hnswAutoRebuild: true, // Auto rebuild for consistency

  // RAG Advanced Settings Defaults
  useReranking: false, // DISABLED: transformers.js incompatible with Chrome extension CSP
  useHybridSearch: true,
  keywordWeight: 0.6,
  semanticWeight: 0.4,
  minQualityScore: 0.4,
  excludeGreetings: true,
  diversityEnabled: true,
  diversityLambda: 0.7,
  minRerankScore: 0.6, // Prevent low-confidence results

  // Adaptive Search (RAG v3.0)
  useAdaptiveWeights: true,

  // Temporal Relevance (RAG v3.0)
  useTemporalBoosting: true,
  temporalBoostWeight: 0.3, // 30% max boost for recent content
  temporalHalfLife: 90, // 3 months half-life

  // User Feedback Learning
  feedbackEnabled: true,
  showRetrievedChunks: true,
  feedbackBlendWeight: 0.2
}

export const DEFAULT_CONTENT_EXTRACTION_CONFIG: ContentExtractionConfig = {
  enabled: true,
  showSelectionButton: true,
  contentScraper: "auto", // Try defuddle first, then readability
  excludedUrlPatterns: DEFAULT_EXCLUDE_URLS,
  scrollStrategy: "smart",
  scrollDepth: 0.8, // 80% of page
  scrollDelay: 300, // 300ms between scrolls
  mutationObserverTimeout: 2000, // Wait 2s for mutations
  networkIdleTimeout: 1000, // Wait 1s for network idle
  maxWaitTime: 10000, // 10s total timeout
  siteOverrides: {
    // YouTube: Disable scrolling since users primarily want transcript extraction
    // Scrolling on YouTube can trigger autoplay or load unnecessary content
    "youtube\\.com/watch": {
      scrollStrategy: "none",
      scrollDepth: 0, // No scrolling needed
      scrollDelay: 0, // No scroll delay needed
      mutationObserverTimeout: 1000, // Shorter timeout since we don't need lazy loading
      networkIdleTimeout: 500, // Shorter timeout for faster extraction
      maxWaitTime: 5000 // Faster overall timeout since we're just extracting transcript
    }
  }
}

export const DEFAULT_FILE_UPLOAD_CONFIG: FileUploadConfig = {
  maxFileSize: FILE_UPLOAD.MAX_SIZE,
  autoEmbedFiles: true, // Enable automatic embedding by default
  showEmbeddingProgress: true, // Show progress to users
  embeddingBatchSize: 3 // Process 3 chunks at a time (balanced performance)
}

export const CHAT_PAGINATION_LIMIT = 50
