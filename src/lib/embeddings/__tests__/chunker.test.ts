import { describe, expect, it } from "vitest"
import { chunkText, estimateTokens, type ChunkOptions } from "../chunker"

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
      const chunks = chunkText(text, { ...defaultOptions, chunkSize: 10, chunkOverlap: 2 })
      
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
      const chunks = chunkText(text, { ...defaultOptions, strategy: "markdown", chunkSize: 20 })
      // Should ideally split ensuring headers stay with content or define boundaries
      // Our implementation splits ON headers, effectively creating new blocks.
      // Or accumulates them.
      
      expect(chunks).toBeDefined()
      expect(chunks.some(c => c.text.includes("# Header 1"))).toBe(true)
    })

    it("respects code blocks", () => {
      // Long code block
      const code = "const x = 1;\n".repeat(20)
      const text = `Here is code:\n\`\`\`javascript\n${code}\`\`\`\nEnd.`
      
      // If code block is larger than chunk size, it might get split by hybrid fallback,
      // BUT markdown chunker tries to keep it together if possible or split internally.
      // Let's test a case where it fits in one chunk but might be split by generic splitter.
      
      const chunks = chunkText(text, { ...defaultOptions, strategy: "markdown", chunkSize: 100 })
      // Should be kept together
      expect(chunks.some(c => c.text.includes("```javascript"))).toBe(true)
    })
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
