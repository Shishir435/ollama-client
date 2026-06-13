import { afterEach, describe, expect, it } from "vitest"
import { rerankerService } from "../reranker"

describe("rerankerService", () => {
  afterEach(() => {
    rerankerService.setEnabled(false)
    rerankerService.setBackend("none")
  })

  it("orders results by cosine similarity", async () => {
    rerankerService.setBackend("cosine")
    rerankerService.setEnabled(true)

    const queryEmbedding = [1, 0]
    const results = await rerankerService.rerank(
      queryEmbedding,
      [
        { content: "match", embedding: [1, 0] },
        { content: "mismatch", embedding: [0, 1] }
      ],
      2
    )

    expect(results[0]?.content).toBe("match")
    expect(results[0]?.score).toBeGreaterThan(results[1]?.score ?? 0)
  })

  it("keeps documents without embeddings instead of dropping them", async () => {
    rerankerService.setBackend("cosine")
    rerankerService.setEnabled(true)

    const queryEmbedding = [1, 0]
    const results = await rerankerService.rerank(
      queryEmbedding,
      [
        { content: "with-embedding", embedding: [1, 0] },
        { content: "no-embedding" }
      ],
      5
    )

    const contents = results.map((r) => r.content)
    expect(contents).toContain("with-embedding")
    expect(contents).toContain("no-embedding")
    // Embedded doc that matches the query ranks above the neutral-scored one.
    expect(results[0]?.content).toBe("with-embedding")
  })
})
