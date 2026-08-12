import { z } from "zod"
import {
  DEFAULT_CONTENT_EXTRACTION_CONFIG,
  DEFAULT_EMBEDDING_CONFIG,
  DEFAULT_FILE_UPLOAD_CONFIG,
  type EmbeddingConfig
} from "@/lib/constants"
import type { ContentExtractionConfig, FileUploadConfig } from "@/types"

const finite = z.number().finite()
const nonNegative = finite.nonnegative()
const positive = finite.positive()
const nonNegativeInteger = z.number().int().nonnegative()
const positiveInteger = z.number().int().positive()
const unitInterval = finite.min(0).max(1)

const ContentExtractionOverrideSchema = z
  .object({
    enabled: z.boolean(),
    showSelectionButton: z.boolean(),
    selectionActionsEnabled: z.boolean(),
    selectionActionsMinChars: nonNegativeInteger,
    selectionActionsEnabledIds: z.array(z.string()),
    contentScraper: z.enum(["auto", "defuddle", "readability"]),
    excludedUrlPatterns: z.array(z.string()),
    scrollStrategy: z.enum(["none", "gradual", "instant", "smart"]),
    scrollDepth: unitInterval,
    scrollDelay: nonNegative,
    mutationObserverTimeout: nonNegative,
    networkIdleTimeout: nonNegative,
    maxWaitTime: nonNegative
  })
  .partial()

/**
 * Accepts partial values written by older releases, drops unknown fields, and
 * returns one complete config. A malformed known field rejects the stored
 * object so callers receive the descriptor default instead of mixed bad data.
 */
export const ContentExtractionConfigSchema = z
  .object({
    ...ContentExtractionOverrideSchema.shape,
    siteOverrides: z.record(z.string(), ContentExtractionOverrideSchema)
  })
  .partial()
  .transform(
    (stored): ContentExtractionConfig => ({
      ...DEFAULT_CONTENT_EXTRACTION_CONFIG,
      ...stored,
      siteOverrides:
        stored.siteOverrides ?? DEFAULT_CONTENT_EXTRACTION_CONFIG.siteOverrides
    })
  )

const storedRerankerBackend = z
  .enum(["none", "cosine", "transformers-js", "onnxruntime-web"])
  .transform<EmbeddingConfig["rerankerBackend"]>((value) =>
    value === "none" ? "none" : "cosine"
  )

const storedAnnBackend = z
  .string()
  .transform<EmbeddingConfig["annBackend"]>((value) =>
    value === "bruteforce" ? "bruteforce" : "ts-hnsw"
  )

/** Runtime contract for synced embedding configuration. */
export const EmbeddingConfigSchema = z
  .object({
    chunkSize: positiveInteger,
    chunkOverlap: nonNegativeInteger,
    chunkingStrategy: z.enum(["fixed", "semantic", "hybrid", "markdown"]),
    useEnhancedChunking: z.boolean(),
    batchSize: positiveInteger,
    maxEmbeddingsPerFile: nonNegativeInteger,
    embeddingStrategy: z.enum([
      "auto",
      "provider-native",
      "shared-model",
      "default-provider-only",
      "ollama-only"
    ]),
    sharedEmbeddingModel: z.string(),
    sharedEmbeddingProviderId: z.string(),
    warmupEmbeddingsInBackground: z.boolean(),
    showAdvancedEmbeddingModels: z.boolean(),
    enableCaching: z.boolean(),
    defaultSearchLimit: positiveInteger,
    defaultMinSimilarity: unitInterval,
    searchCacheTTL: nonNegative,
    searchCacheMaxSize: nonNegativeInteger,
    annBackend: storedAnnBackend,
    annMinVectors: nonNegativeInteger,
    maxStorageSize: nonNegative,
    autoCleanup: z.boolean(),
    cleanupDaysOld: nonNegative,
    useHNSW: z.boolean(),
    hnswM: positiveInteger,
    hnswEfConstruction: positiveInteger,
    hnswEfSearch: positiveInteger,
    hnswMinVectors: nonNegativeInteger,
    hnswAutoRebuild: z.boolean(),
    useReranking: z.boolean(),
    useHybridSearch: z.boolean(),
    keywordWeight: unitInterval,
    semanticWeight: unitInterval,
    minQualityScore: unitInterval,
    excludeGreetings: z.boolean(),
    diversityEnabled: z.boolean(),
    diversityLambda: unitInterval,
    minRerankScore: unitInterval,
    rerankerBackend: storedRerankerBackend,
    feedbackEnabled: z.boolean(),
    showRetrievedChunks: z.boolean(),
    feedbackBlendWeight: unitInterval
  })
  .partial()
  .transform((stored): EmbeddingConfig => {
    const merged = { ...DEFAULT_EMBEDDING_CONFIG, ...stored }
    return {
      ...merged,
      rerankerBackend:
        merged.useReranking && merged.rerankerBackend === "none"
          ? "cosine"
          : merged.rerankerBackend
    }
  })

/** Runtime contract for upload limits and embedding behavior. */
export const FileUploadConfigSchema = z
  .object({
    maxFileSize: positive,
    autoEmbedFiles: z.boolean(),
    showEmbeddingProgress: z.boolean(),
    embeddingBatchSize: positiveInteger
  })
  .partial()
  .transform(
    (stored): FileUploadConfig => ({
      ...DEFAULT_FILE_UPLOAD_CONFIG,
      ...stored
    })
  )

export const SelectedModelRefSchema = z
  .object({
    providerId: z.string().min(1),
    modelId: z.string().min(1)
  })
  .strict()
  .nullable()
