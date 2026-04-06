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
})
