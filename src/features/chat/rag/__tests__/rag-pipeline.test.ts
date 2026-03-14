import { describe, expect, it } from "vitest"

import type { VectorDocument } from "@/lib/embeddings/types"
import { formatEnhancedResults } from "../rag-pipeline"

describe("formatEnhancedResults", () => {
  it("formats context with doc attributes and includes page metadata in sources", () => {
    const document: VectorDocument = {
      id: 7,
      content: "Hello from page 3",
      embedding: [0.1, 0.2],
      metadata: {
        source: "doc.pdf",
        title: "Doc",
        type: "file",
        timestamp: Date.now(),
        page: 3,
        chunkIndex: 1,
        totalChunks: 5
      }
    }

    const { formattedContext, sources } = formatEnhancedResults(
      [{ document, score: 0.876 }],
      1000
    )

    expect(formattedContext).toBe(
      '<doc id="1" source="Doc" page="3" chunk="2/5" score="0.876">\nHello from page 3\n</doc>'
    )
    expect(sources[0].page).toBe(3)
  })
})
