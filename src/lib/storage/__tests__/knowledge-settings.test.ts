import { describe, expect, it } from "vitest"
import { KNOWLEDGE_SETTINGS } from "@/lib/storage/knowledge-settings"

describe("knowledge settings", () => {
  it("rejects malformed numeric and enum values", () => {
    expect(KNOWLEDGE_SETTINGS.CHUNK_SIZE.parser?.safeParse(-1).success).toBe(
      false
    )
    expect(
      KNOWLEDGE_SETTINGS.CHUNK_OVERLAP.parser?.safeParse(Number.NaN).success
    ).toBe(false)
    expect(
      KNOWLEDGE_SETTINGS.SPLITTING_STRATEGY.parser?.safeParse("token").success
    ).toBe(false)
    expect(
      KNOWLEDGE_SETTINGS.RETRIEVAL_TOP_K.parser?.safeParse(2.5).success
    ).toBe(false)
  })

  it("accepts the persisted legacy-compatible values", () => {
    expect(KNOWLEDGE_SETTINGS.CHUNK_SIZE.parser?.safeParse(1000).success).toBe(
      true
    )
    expect(
      KNOWLEDGE_SETTINGS.SPLITTING_STRATEGY.parser?.safeParse("recursive")
        .success
    ).toBe(true)
    expect(
      KNOWLEDGE_SETTINGS.EMBEDDING_MODEL.parser?.safeParse(null).success
    ).toBe(true)
  })
})
