import { describe, expect, it, vi } from "vitest"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { getEmbeddingConfig } from "../config"

describe("getEmbeddingConfig", () => {
  it("normalizes legacy backend values", async () => {
    vi.mocked(plasmoGlobalStorage.get).mockResolvedValueOnce({
      annBackend: "wasm-hnsw",
      rerankerBackend: "transformers-js",
      useReranking: true
    } as unknown)

    const config = await getEmbeddingConfig()

    expect(config.annBackend).toBe("ts-hnsw")
    expect(config.rerankerBackend).toBe("cosine")
  })

  it("forces cosine when reranking is enabled", async () => {
    vi.mocked(plasmoGlobalStorage.get).mockResolvedValueOnce({
      rerankerBackend: "none",
      useReranking: true
    } as unknown)

    const config = await getEmbeddingConfig()

    expect(config.rerankerBackend).toBe("cosine")
  })
})
