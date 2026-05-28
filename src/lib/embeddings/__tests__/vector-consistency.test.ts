import { beforeEach, describe, expect, it } from "vitest"
import { vectorDb } from "../db"
import type { VectorDocument } from "../types"
import { checkVectorConsistency } from "../vector-consistency"

const vector = ({
  metadata,
  ...overrides
}: Partial<VectorDocument> = {}): VectorDocument => ({
  content: "content",
  embedding: [0.1, 0.2],
  ...overrides,
  metadata: {
    source: "test",
    type: "chat",
    sessionId: "session-1",
    messageId: 1,
    timestamp: 1,
    chunkIndex: 0,
    embeddingDim: 2,
    ...metadata
  }
})

describe("checkVectorConsistency", () => {
  beforeEach(async () => {
    await vectorDb.vectors.clear()
  })

  it("reports duplicate vectors and mixed dimensions", async () => {
    await vectorDb.vectors.bulkAdd([
      vector(),
      vector(),
      vector({
        content: "other",
        embedding: [0.1, 0.2, 0.3],
        metadata: {
          source: "test",
          type: "chat",
          sessionId: "session-1",
          messageId: 2,
          timestamp: 1,
          chunkIndex: 0,
          embeddingDim: 3
        }
      })
    ])

    const report = await checkVectorConsistency()

    expect(report).toEqual(
      expect.objectContaining({
        totalVectors: 3,
        duplicateVectors: 1,
        mixedDimensions: true,
        byDimension: { "2": 2, "3": 1 }
      })
    )
  })

  it("reports orphan chat and file vectors when source ids are provided", async () => {
    await vectorDb.vectors.bulkAdd([
      vector({
        metadata: {
          source: "test",
          type: "chat",
          sessionId: "missing-session",
          messageId: 1,
          timestamp: 1,
          embeddingDim: 2
        }
      }),
      vector({
        metadata: {
          source: "test",
          type: "chat",
          sessionId: "session-1",
          messageId: 404,
          timestamp: 1,
          embeddingDim: 2
        }
      }),
      vector({
        metadata: {
          source: "test",
          type: "file",
          fileId: "missing-file",
          timestamp: 1,
          embeddingDim: 2
        }
      })
    ])

    const report = await checkVectorConsistency({
      existingSessionIds: new Set(["session-1"]),
      existingMessageIds: new Set([1]),
      existingFileIds: new Set(["file-1"])
    })

    expect(report.orphanChatVectors).toBe(2)
    expect(report.orphanFileVectors).toBe(1)
  })
})
