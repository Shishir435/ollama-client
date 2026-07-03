import { describe, expect, it } from "vitest"
import {
  type ChunkOptions,
  chunkDocuments,
  chunkText,
  chunkTextAsync,
  estimateTokens,
  getChunkStats,
  mergeChunks
} from "../chunker"

describe("Chunker", () => {
  const defaultOptions: ChunkOptions = {
    chunkSize: 50, // Small size for testing
    chunkOverlap: 10,
    strategy: "fixed"
  }

  describe("estimateTokens", () => {
    it("estimates tokens correctly (approx 4 chars/token)", () => {
      expect(estimateTokens("1234")).toBe(1)
      expect(estimateTokens("12345678")).toBe(2)
      expect(estimateTokens("")).toBe(0)
    })
  })

  describe("fixedSizeChunking", () => {
    it("chunks text into fixed sizes with overlap", () => {
      const text = "A".repeat(100) // 25 tokens approx
      // Chunk size 10 (40 chars), overlap 2 (8 chars)
      const chunks = chunkText(text, {
        ...defaultOptions,
        chunkSize: 10,
        chunkOverlap: 2
      })

      expect(chunks.length).toBeGreaterThan(1)
      expect(chunks[0].text.length).toBeLessThanOrEqual(40)
      // Check overlap
      const overlap = chunks[0].text.slice(-8)
      expect(chunks[1].text.startsWith(overlap)).toBe(true)
    })
  })

  describe("markdownChunking", () => {
    it("preserves headers in chunks", () => {
      const text = `
# Header 1
Content under header 1.

## Header 2
Content under header 2.
`
      const chunks = chunkText(text, {
        ...defaultOptions,
        strategy: "markdown",
        chunkSize: 20
      })
      // Should ideally split ensuring headers stay with content or define boundaries
      // Our implementation splits ON headers, effectively creating new blocks.
      // Or accumulates them.

      expect(chunks).toBeDefined()
      expect(chunks.some((c) => c.text.includes("# Header 1"))).toBe(true)
    })

    it("respects code blocks", () => {
      // Long code block
      const code = "const x = 1;\n".repeat(20)
      const text = `Here is code:\n\`\`\`javascript\n${code}\`\`\`\nEnd.`

      // If code block is larger than chunk size, it might get split by hybrid fallback,
      // BUT markdown chunker tries to keep it together if possible or split internally.
      // Let's test a case where it fits in one chunk but might be split by generic splitter.

      const chunks = chunkText(text, {
        ...defaultOptions,
        strategy: "markdown",
        chunkSize: 100
      })
      // Should be kept together
      expect(chunks.some((c) => c.text.includes("```javascript"))).toBe(true)
    })

    it("falls back to hybrid chunking when a section between headers exceeds chunkSize", () => {
      // A section body that is much larger than chunkSize triggers the
      // `if (estimateTokens(section) > chunkSize)` branch inside markdownChunking.
      // 1 token ≈ 4 chars, so chunkSize=10 means ~40 chars per chunk.
      // Build a body of ~400 chars (100 tokens) so it definitely exceeds chunkSize=10.
      const largeBody = "Word ".repeat(80) // 400 chars ≈ 100 tokens
      const text = `# Big Section\n${largeBody}`

      const chunks = chunkText(text, {
        ...defaultOptions,
        strategy: "markdown",
        chunkSize: 10,
        chunkOverlap: 1
      })

      // The large section must have been split into more than one chunk
      expect(chunks.length).toBeGreaterThan(1)
      // Every chunk must be non-empty
      chunks.forEach((c) => {
        expect(c.text.trim().length).toBeGreaterThan(0)
      })
    })
  })

  it("chunkText falls back to hybrid for an unknown strategy string", () => {
    // The `default:` branch in chunkText's switch should behave identically to "hybrid".
    const para1 = "A".repeat(100) // ~25 tokens
    const para2 = "B".repeat(100)
    const text = `${para1}\n\n${para2}`
    const options = {
      chunkSize: 20,
      chunkOverlap: 2,
      strategy: "unknown-strategy" as any
    }

    const unknownChunks = chunkText(text, options)
    const hybridChunks = chunkText(text, { ...options, strategy: "hybrid" })

    expect(unknownChunks.length).toBeGreaterThan(1)
    expect(unknownChunks).toEqual(hybridChunks)
  })

  describe("Fallback behavior", () => {
    it("handles empty text", () => {
      expect(chunkText("", defaultOptions)).toEqual([])
    })

    it("handles text smaller than chunk size", () => {
      const text = "Small text"
      const chunks = chunkText(text, { ...defaultOptions, chunkSize: 100 })
      expect(chunks).toHaveLength(1)
      expect(chunks[0].text).toBe(text)
    })
  })
})

describe("chunkText — validation errors", () => {
  it("throws when chunkSize <= 0", () => {
    expect(() =>
      chunkText("some text", {
        chunkSize: 0,
        chunkOverlap: 0,
        strategy: "fixed"
      })
    ).toThrow()
    expect(() =>
      chunkText("some text", {
        chunkSize: -5,
        chunkOverlap: 0,
        strategy: "fixed"
      })
    ).toThrow()
  })

  it("throws an AppError with kind 'validation' when chunkSize <= 0", () => {
    try {
      chunkText("some text", {
        chunkSize: 0,
        chunkOverlap: 0,
        strategy: "fixed"
      })
      expect.fail("should have thrown")
    } catch (err: any) {
      expect(err.kind).toBe("validation")
    }
  })

  it("throws when chunkOverlap < 0", () => {
    expect(() =>
      chunkText("some text", {
        chunkSize: 10,
        chunkOverlap: -1,
        strategy: "fixed"
      })
    ).toThrow()

    try {
      chunkText("some text", {
        chunkSize: 10,
        chunkOverlap: -1,
        strategy: "fixed"
      })
      expect.fail("should have thrown")
    } catch (err: any) {
      expect(err.kind).toBe("validation")
    }
  })

  it("throws when chunkOverlap >= chunkSize", () => {
    expect(() =>
      chunkText("some text", {
        chunkSize: 10,
        chunkOverlap: 10,
        strategy: "fixed"
      })
    ).toThrow()
    expect(() =>
      chunkText("some text", {
        chunkSize: 10,
        chunkOverlap: 15,
        strategy: "fixed"
      })
    ).toThrow()

    try {
      chunkText("some text", {
        chunkSize: 10,
        chunkOverlap: 10,
        strategy: "fixed"
      })
      expect.fail("should have thrown")
    } catch (err: any) {
      expect(err.kind).toBe("validation")
    }
  })
})

describe("semanticChunking", () => {
  it("splits multi-paragraph text into multiple chunks", () => {
    // Each paragraph is ~25 tokens (100 chars). chunkSize=20 so second paragraph triggers new chunk.
    const para1 = "A".repeat(80) // ~20 tokens
    const para2 = "B".repeat(80)
    const para3 = "C".repeat(80)
    const text = `${para1}\n\n${para2}\n\n${para3}`

    const chunks = chunkText(text, {
      chunkSize: 20,
      chunkOverlap: 2,
      strategy: "semantic"
    })

    expect(chunks.length).toBeGreaterThan(1)
  })

  it("chunks contain paragraph content", () => {
    const para1 = "First paragraph content here."
    const para3 = "Third paragraph content here."
    // Make para2 large enough to force a split
    const bigPara2 = "B".repeat(200) // ~50 tokens
    const text = `${para1}\n\n${bigPara2}\n\n${para3}`

    const chunks = chunkText(text, {
      chunkSize: 20,
      chunkOverlap: 2,
      strategy: "semantic"
    })

    const allText = chunks.map((c) => c.text).join(" ")
    expect(allText).toContain(para1)
    expect(allText).toContain(para3)
  })

  it("final leftover paragraph becomes the last chunk", () => {
    const para1 = "A".repeat(100) // ~25 tokens — exceeds chunkSize
    const lastPara = "Last paragraph stands alone."
    const text = `${para1}\n\n${lastPara}`

    const chunks = chunkText(text, {
      chunkSize: 20,
      chunkOverlap: 2,
      strategy: "semantic"
    })

    const lastChunk = chunks[chunks.length - 1]
    expect(lastChunk.text).toContain("Last paragraph stands alone.")
  })
})

describe("hybridChunking", () => {
  it("accumulates normal-sized paragraphs together", () => {
    // Two small paragraphs that together fit within chunkSize
    const para1 = "Short paragraph one."
    const para2 = "Short paragraph two."
    const text = `${para1}\n\n${para2}`

    const chunks = chunkText(text, {
      chunkSize: 100,
      chunkOverlap: 5,
      strategy: "hybrid"
    })

    // Both fit in one chunk since combined tokens << 100
    expect(chunks).toHaveLength(1)
    expect(chunks[0].text).toContain(para1)
    expect(chunks[0].text).toContain(para2)
  })

  it("splits a large paragraph by sentences", () => {
    // One very large paragraph that exceeds chunkSize — should be split by sentences
    const longPara =
      "This is the first sentence of a very long paragraph. " +
      "This is the second sentence. ".repeat(5) +
      "This is the final sentence here."
    // Force a small chunkSize so the paragraph exceeds it
    const text = longPara

    const chunks = chunkText(text, {
      chunkSize: 10, // 40 chars — triggers sentence splitting
      chunkOverlap: 1,
      strategy: "hybrid"
    })

    expect(chunks.length).toBeGreaterThan(1)
  })

  it("produces at least 1 chunk from non-empty text", () => {
    const text = "Hello world."

    const chunks = chunkText(text, {
      chunkSize: 100,
      chunkOverlap: 5,
      strategy: "hybrid"
    })

    expect(chunks.length).toBeGreaterThanOrEqual(1)
  })
})

describe("chunkTextAsync", () => {
  it("resolves to the same result as chunkText for the same input", async () => {
    const text = "A".repeat(200)
    const options: ChunkOptions = {
      chunkSize: 20,
      chunkOverlap: 2,
      strategy: "fixed"
    }

    const syncResult = chunkText(text, options)
    const asyncResult = await chunkTextAsync(text, options)

    expect(asyncResult).toEqual(syncResult)
  })

  it("resolves to empty array for empty text", async () => {
    const options: ChunkOptions = {
      chunkSize: 20,
      chunkOverlap: 2,
      strategy: "fixed"
    }
    const result = await chunkTextAsync("", options)
    expect(result).toEqual([])
  })
})

describe("mergeChunks", () => {
  it("returns empty string for 0 chunks", () => {
    expect(mergeChunks([])).toBe("")
  })

  it("returns just the chunk text for a single chunk (no separator)", () => {
    const chunks = [{ text: "Only chunk", index: 0, startPos: 0, endPos: 10 }]
    expect(mergeChunks(chunks)).toBe("Only chunk")
  })

  it("joins 2+ chunks with the separator", () => {
    const chunks = [
      { text: "First chunk", index: 0, startPos: 0, endPos: 11 },
      { text: "Second chunk", index: 1, startPos: 11, endPos: 23 },
      { text: "Third chunk", index: 2, startPos: 23, endPos: 34 }
    ]
    const result = mergeChunks(chunks)
    expect(result).toBe(
      "First chunk\n\n---CHUNK---\n\nSecond chunk\n\n---CHUNK---\n\nThird chunk"
    )
  })
})

describe("getChunkStats", () => {
  const chunks = [
    { text: "Hello", index: 0, startPos: 0, endPos: 5 }, // 5 chars
    { text: "World!", index: 1, startPos: 5, endPos: 11 }, // 6 chars
    { text: "Hi there", index: 2, startPos: 11, endPos: 19 } // 8 chars
  ]
  // totalChars = 19, avgChunkSize = ceil(19/3) = 6 (rounded), min = 5, max = 8

  it("returns correct totalChunks", () => {
    expect(getChunkStats(chunks).totalChunks).toBe(3)
  })

  it("returns correct totalCharacters", () => {
    expect(getChunkStats(chunks).totalCharacters).toBe(19)
  })

  it("returns correct estimatedTokens (ceil of totalChars / 4)", () => {
    // ceil(19 / 4) = 5
    expect(getChunkStats(chunks).estimatedTokens).toBe(5)
  })

  it("returns correct avgChunkSize (rounded)", () => {
    // avg = 19 / 3 ≈ 6.33 → rounds to 6
    expect(getChunkStats(chunks).avgChunkSize).toBe(Math.round(19 / 3))
  })

  it("returns correct minChunkSize and maxChunkSize", () => {
    expect(getChunkStats(chunks).minChunkSize).toBe(5)
    expect(getChunkStats(chunks).maxChunkSize).toBe(8)
  })
})

describe("chunkDocuments", () => {
  it("preserves metadata and assigns stable global chunk indexes", async () => {
    const chunks = await chunkDocuments(
      [
        { pageContent: "A".repeat(24), metadata: { page: 1 } },
        { pageContent: "B".repeat(24), metadata: { page: 2 } }
      ],
      { chunkSize: 4, chunkOverlap: 0, strategy: "fixed" }
    )

    expect(chunks.length).toBeGreaterThan(2)
    expect(chunks.map((chunk) => chunk.metadata.chunkIndex)).toEqual(
      chunks.map((_, index) => index)
    )
    expect(
      chunks.every((chunk) => chunk.metadata.totalChunks === chunks.length)
    ).toBe(true)
    expect(chunks.some((chunk) => chunk.metadata.page === 2)).toBe(true)
  })
})
