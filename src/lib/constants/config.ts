import type { ContentExtractionConfig, FileUploadConfig } from "@/types"
import { DEFAULT_EXCLUDE_URLS, FILE_UPLOAD } from "./defaults"

export type ChunkingStrategy = "fixed" | "semantic" | "hybrid"

export interface EmbeddingConfig {
  // Chunking settings
  chunkSize: number // Tokens per chunk (default: 500)
  chunkOverlap: number // Overlap between chunks in tokens (default: 100)
  chunkingStrategy: ChunkingStrategy // "fixed" | "semantic" | "hybrid"
  useEnhancedChunking: boolean // Use new text splitters (RecursiveCharacterTextSplitter) (default: false - backward compat)

  // Embedding generation settings
  batchSize: number // Number of texts to embed in parallel (default: 5)
  maxEmbeddingsPerFile: number // Limit embeddings per file (default: 1000, 0 = unlimited)

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
}

export const DEFAULT_EMBEDDING_CONFIG: EmbeddingConfig = {
  chunkSize: 500, // ~500 tokens per chunk
  chunkOverlap: 100, // 100 token overlap
  chunkingStrategy: "hybrid", // Best balance
  useEnhancedChunking: false, // Backward compatibility - users can enable in settings
  batchSize: 5, // Process 5 at a time
  maxEmbeddingsPerFile: 1000, // Limit to prevent memory issues
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
  hnswAutoRebuild: true // Auto rebuild for consistency
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
