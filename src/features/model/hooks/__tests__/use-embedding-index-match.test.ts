import { renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import { vectorDb } from "@/lib/embeddings/db"
import { clearAllVectors } from "@/lib/embeddings/storage"
import type { VectorDocument } from "@/lib/embeddings/types"
import { useEmbeddingIndexMatch } from "../use-embedding-index-match"

const row = (embeddingModel: string): VectorDocument => ({
  content: "text",
  embedding: [1, 0],
  metadata: {
    source: "test",
    type: "file",
    fileId: "file-1",
    timestamp: 1,
    embeddingModel
  }
})

beforeEach(async () => {
  await clearAllVectors()
})

describe("useEmbeddingIndexMatch", () => {
  it("clears the warning when vectors for the model are written elsewhere", async () => {
    await vectorDb.vectors.add(row("nomic-embed-text"))
    const { result } = renderHook(() => useEmbeddingIndexMatch("bge-m3", true))
    await waitFor(() => expect(result.current).toBe(false))

    await vectorDb.vectors.add(row("bge-m3"))
    await waitFor(() => expect(result.current).toBe(true))
  })

  it("claims nothing while disabled", () => {
    const { result } = renderHook(() => useEmbeddingIndexMatch("bge-m3", false))
    expect(result.current).toBeNull()
  })
})
