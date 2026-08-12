import { describe, expect, it } from "vitest"
import {
  DEFAULT_CONTENT_EXTRACTION_CONFIG,
  DEFAULT_EMBEDDING_CONFIG,
  DEFAULT_FILE_UPLOAD_CONFIG
} from "@/lib/constants"
import { ModelConfigMapSchema } from "@/lib/model-config-utils"
import { PerSiteProfileSettingsSchema } from "@/lib/per-site-profile-settings"
import {
  ContentExtractionConfigSchema,
  EmbeddingConfigSchema,
  FileUploadConfigSchema,
  SelectedModelRefSchema
} from "../setting-schemas"

describe("structured setting schemas", () => {
  it("normalizes partial content extraction config", () => {
    expect(
      ContentExtractionConfigSchema.parse({
        enabled: false,
        scrollDepth: 0.25,
        unknown: "drop"
      })
    ).toEqual({
      ...DEFAULT_CONTENT_EXTRACTION_CONFIG,
      enabled: false,
      scrollDepth: 0.25
    })
  })

  it("rejects unsafe content extraction limits", () => {
    expect(
      ContentExtractionConfigSchema.safeParse({ scrollDepth: 2 }).success
    ).toBe(false)
    expect(
      ContentExtractionConfigSchema.safeParse({ maxWaitTime: Number.NaN })
        .success
    ).toBe(false)
  })

  it("validates nested content extraction overrides", () => {
    const parsed = ContentExtractionConfigSchema.parse({
      siteOverrides: {
        "docs.example.com": { scrollStrategy: "none", scrollDepth: 0 }
      }
    })
    expect(parsed.siteOverrides["docs.example.com"]).toEqual({
      scrollStrategy: "none",
      scrollDepth: 0
    })
    expect(
      ContentExtractionConfigSchema.safeParse({
        siteOverrides: { bad: { scrollStrategy: "teleport" } }
      }).success
    ).toBe(false)
  })

  it("normalizes partial embedding config", () => {
    expect(EmbeddingConfigSchema.parse({ batchSize: 9 })).toEqual({
      ...DEFAULT_EMBEDDING_CONFIG,
      batchSize: 9
    })
  })

  it("retains legacy embedding backend migrations", () => {
    const parsed = EmbeddingConfigSchema.parse({
      annBackend: "wasm-hnsw",
      rerankerBackend: "transformers-js",
      useReranking: true
    })
    expect(parsed.annBackend).toBe("ts-hnsw")
    expect(parsed.rerankerBackend).toBe("cosine")
  })

  it("forces cosine when reranking remains enabled", () => {
    expect(
      EmbeddingConfigSchema.parse({
        useReranking: true,
        rerankerBackend: "none"
      }).rerankerBackend
    ).toBe("cosine")
  })

  it("rejects invalid embedding bounds", () => {
    expect(EmbeddingConfigSchema.safeParse({ chunkSize: 0 }).success).toBe(
      false
    )
    expect(
      EmbeddingConfigSchema.safeParse({ defaultMinSimilarity: 1.1 }).success
    ).toBe(false)
    expect(EmbeddingConfigSchema.safeParse({ batchSize: 1.5 }).success).toBe(
      false
    )
  })

  it("normalizes and validates file upload config", () => {
    expect(FileUploadConfigSchema.parse({ embeddingBatchSize: 7 })).toEqual({
      ...DEFAULT_FILE_UPLOAD_CONFIG,
      embeddingBatchSize: 7
    })
    expect(FileUploadConfigSchema.safeParse({ maxFileSize: 0 }).success).toBe(
      false
    )
  })

  it("requires complete provider-qualified model refs", () => {
    expect(
      SelectedModelRefSchema.safeParse({
        providerId: "ollama",
        modelId: "qwen"
      }).success
    ).toBe(true)
    expect(
      SelectedModelRefSchema.safeParse({ providerId: "", modelId: "qwen" })
        .success
    ).toBe(false)
    expect(
      SelectedModelRefSchema.safeParse({ providerId: "ollama" }).success
    ).toBe(false)
  })

  it("rejects malformed model configs and per-site profiles", () => {
    expect(
      ModelConfigMapSchema.safeParse({ qwen: { temperature: "hot" } }).success
    ).toBe(false)
    expect(
      PerSiteProfileSettingsSchema.safeParse({
        profiles: [{ id: "bad", pattern: 42 }]
      }).success
    ).toBe(false)
  })
})
