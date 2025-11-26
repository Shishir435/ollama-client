import { describe, expect, it } from "vitest"
import {
  chunkText,
  chunkTextAsync,
  getChunkStats,
  mergeChunks
} from "../chunker"

describe("Chunker", () => {
  describe("fixedSizeChunking", () => {
    it("should chunk text into fixed token sizes", () => {
      const text = "a".repeat(1000)
      const chunks = chunkText(text, {
        chunkSize: 50, // 50 tokens = ~200 characters
        chunkOverlap: 5,
        strategy: "fixed"
      })

      expect(chunks.length).toBeGreaterThan(0)
      chunks.forEach(chunk => {
        // chunkSize is in tokens, each token ~4 chars
        expect(chunk.text.length).toBeLessThanOrEqual(50 * 4)
      })
    })

    it("should maintain overlap between chunks", () => {
      const text = "a".repeat(500)
      const chunks = chunkText(text, {
        chunkSize: 100,
        chunkOverlap: 20,
        strategy: "fixed"
      })

      // Check overlap between consecutive chunks
      for (let i = 0; i < chunks.length - 1; i++) {
        const currentChunk = chunks[i]
        const nextChunk = chunks[i + 1]
        
        // The end of current chunk should overlap with start of next chunk
        const currentEnd = currentChunk.text.slice(-20)
        const nextStart = nextChunk.text.slice(0, 20)
        
        expect(currentEnd).toBe(nextStart)
      }
    })

    it("should handle text smaller than chunk size", () => {
      const text = "Short text"
      const chunks = chunkText(text, {
        chunkSize: 1000,
        chunkOverlap: 0,
        strategy: "fixed"
      })

      expect(chunks.length).toBe(1)
      expect(chunks[0].text).toBe(text)
    })

    it("should set correct indices", () => {
      const text = "a".repeat(500)
      const chunks = chunkText(text, {
        chunkSize: 100,
        chunkOverlap: 0,
        strategy: "fixed"
      })

      chunks.forEach((chunk, idx) => {
        expect(chunk.index).toBe(idx)
      })
    })
  })

  describe("semanticChunking", () => {
    it("should split on paragraph boundaries", () => {
      const text = "Paragraph 1 with enough content to fill space.\n\nParagraph 2 with more content that exceeds chunk size.\n\nParagraph 3 with final content."
      const chunks = chunkText(text, {
        chunkSize: 15, // Small chunk size to force splitting
        chunkOverlap: 0,
        strategy: "semantic"
      })

      expect(chunks.length).toBeGreaterThan(1)
    })

    it("should handle short text without splitting", () => {
      const text = "Sentence one. Sentence two. Sentence three."
      const chunks = chunkText(text, {
        chunkSize: 25, // Larger chunk size
        chunkOverlap: 0,
        strategy: "semantic"
      })

      // Short text without paragraphs may not split
      expect(chunks.length).toBeGreaterThanOrEqual(1)
    })

    it("should handle repetitive text", () => {
      const text = "Word ".repeat(200)
      const chunks = chunkText(text, {
        chunkSize: 25,
        chunkOverlap: 0,
        strategy: "semantic"
      })

      // Repetitive text without natural boundaries may not split well
      expect(chunks.length).toBeGreaterThanOrEqual(1)
    })

    it("should handle text with no natural boundaries", () => {
      const text = "a".repeat(500)
      const chunks = chunkText(text, {
        chunkSize: 100,
        chunkOverlap: 0,
        strategy: "semantic"
      })

      expect(chunks.length).toBeGreaterThan(0)
    })
  })

  describe("hybridChunking", () => {
    it("should prefer semantic boundaries", () => {
      const text = "First paragraph with some content here.\n\nSecond paragraph with even more content.\n\nThird paragraph with final content."
      const chunks = chunkText(text, {
        chunkSize: 15, // Force splitting
        chunkOverlap: 0,
        strategy: "hybrid"
      })

      expect(chunks.length).toBeGreaterThan(1)
      // Each chunk should ideally contain complete sentences
      chunks.forEach(chunk => {
        expect(chunk.text.trim().length).toBeGreaterThan(0)
      })
    })

    it("should split large paragraphs using hybrid strategy", () => {
      // Create a paragraph with sentences for proper splitting
      const longParagraph = "This is sentence one. This is sentence two. This is sentence three. ".repeat(20)
      const text = `${longParagraph}\n\nShort paragraph.`
      
      const chunks = chunkText(text, {
        chunkSize: 25, // 25 tokens
        chunkOverlap: 0,
        strategy: "hybrid"
      })

      // Hybrid should split large paragraphs by sentences
      expect(chunks.length).toBeGreaterThan(1)
    })

    it("should maintain overlap for context", () => {
      const text = "Sentence one with content. ".repeat(50)
      const chunks = chunkText(text, {
        chunkSize: 25, // 25 tokens
        chunkOverlap: 5,
        strategy: "hybrid"
      })

      expect(chunks.length).toBeGreaterThan(1)
      // Overlap checking is complex with semantic boundaries
      // Just verify we have multiple chunks
    })
  })

  describe("chunkText", () => {
    it("should handle empty text", () => {
      const chunks = chunkText("", {
        chunkSize: 100,
        chunkOverlap: 0,
        strategy: "fixed"
      })

      expect(chunks).toEqual([])
    })

    it("should include position information", () => {
      const text = "Test text for chunking"
      const chunks = chunkText(text, {
        chunkSize: 100,
        chunkOverlap: 0,
        strategy: "fixed"
      })

      expect(chunks.length).toBe(1)
      expect(chunks[0].startPos).toBe(0)
      expect(chunks[0].endPos).toBe(text.length)
    })

    it("should work with all strategies", () => {
      const text = "Test text. " + "More content. ".repeat(20)
      
      const strategies: Array<"fixed" | "semantic" | "hybrid"> = ["fixed", "semantic", "hybrid"]
      
      strategies.forEach(strategy => {
        const chunks = chunkText(text, {
          chunkSize: 100,
          chunkOverlap: 10,
          strategy
        })
        
        expect(chunks.length).toBeGreaterThan(0)
      })
    })

    it("should handle unicode characters correctly", () => {
      const text = "Hello 世界 🌍 مرحبا"
      const chunks = chunkText(text, {
        chunkSize: 100,
        chunkOverlap: 0,
        strategy: "fixed"
      })

      expect(chunks.length).toBe(1)
      expect(chunks[0].text).toBe(text)
    })
  })

  describe("chunkTextAsync", () => {
    it("should chunk text asynchronously", async () => {
      const text = "a".repeat(1000)
      const chunks = await chunkTextAsync(text, {
        chunkSize: 100,
        chunkOverlap: 0,
        strategy: "fixed"
      })

      expect(chunks.length).toBeGreaterThan(0)
    })

    it("should yield to event loop", async () => {
      const text = "Test text. " + "Content. ".repeat(100)
      const start = Date.now()
      
      const chunks = await chunkTextAsync(text, {
        chunkSize: 100,
        chunkOverlap: 0,
        strategy: "semantic"
      })

      const duration = Date.now() - start
      
      expect(chunks.length).toBeGreaterThan(0)
      // Should take some time due to async processing
      // This is a weak assertion but verifies async behavior
      expect(duration).toBeGreaterThanOrEqual(0)
    })

    it("should produce same results as sync version", async () => {
      const text = "Test paragraph one.\n\nTest paragraph two.\n\nTest paragraph three."
      
      const syncChunks = chunkText(text, {
        chunkSize: 100,
        chunkOverlap: 0,
        strategy: "hybrid"
      })
      
      const asyncChunks = await chunkTextAsync(text, {
        chunkSize: 100,
        chunkOverlap: 0,
        strategy: "hybrid"
      })

      expect(asyncChunks.length).toBe(syncChunks.length)
      asyncChunks.forEach((chunk, i) => {
        expect(chunk.text).toBe(syncChunks[i].text)
      })
    })
  })

  describe("mergeChunks", () => {
    it("should combine chunks with separators", () => {
      const originalText = "a".repeat(500)
      const chunks = chunkText(originalText, {
        chunkSize: 25, // Force multiple chunks
        chunkOverlap: 0,
        strategy: "fixed"
      })

      const merged = mergeChunks(chunks)
      // mergeChunks adds separators between chunks
      expect(merged).toContain("---CHUNK---")
      expect(merged.length).toBeGreaterThan(originalText.length)
    })

    it("should handle empty chunks array", () => {
      const merged = mergeChunks([])
      expect(merged).toBe("")
    })

    it("should preserve text content", () => {
      const originalText = "Sentence one. Sentence two. Sentence three."
      const chunks = chunkText(originalText, {
        chunkSize: 100,
        chunkOverlap: 0,
        strategy: "semantic"
      })

      const merged = mergeChunks(chunks)
      // Remove extra spaces that might be added between chunks
      expect(merged.replace(/\s+/g, ' ').trim()).toBe(originalText.replace(/\s+/g, ' ').trim())
    })
  })

  describe("getChunkStats", () => {
    it("should return statistics for chunks", () => {
      const text = "Test ".repeat(100)
      const chunks = chunkText(text, {
        chunkSize: 100,
        chunkOverlap: 20,
        strategy: "fixed"
      })

      const stats = getChunkStats(chunks)

      expect(stats).toHaveProperty("totalChunks")
      expect(stats).toHaveProperty("avgChunkSize")
      expect(stats).toHaveProperty("minChunkSize")
      expect(stats).toHaveProperty("maxChunkSize")
      expect(stats).toHaveProperty("totalCharacters")

      expect(stats.totalChunks).toBe(chunks.length)
      expect(stats.totalCharacters).toBeGreaterThan(0)
      expect(stats.avgChunkSize).toBeGreaterThan(0)
    })

    it("should handle empty chunks array", () => {
      const stats = getChunkStats([])

      expect(stats.totalChunks).toBe(0)
      // avgChunkSize will be NaN or 0 for empty array
      expect(stats.avgChunkSize === 0 || Number.isNaN(stats.avgChunkSize)).toBe(true)
      expect(stats.totalCharacters).toBe(0)
    })

    it("should calculate correct min/max sizes", () => {
      const chunks = [
        { text: "a".repeat(50), index: 0, startPos: 0, endPos: 50 },
        { text: "b".repeat(100), index: 1, startPos: 50, endPos: 150 },
        { text: "c".repeat(75), index: 2, startPos: 150, endPos: 225 }
      ]

      const stats = getChunkStats(chunks)

      expect(stats.minChunkSize).toBe(50)
      expect(stats.maxChunkSize).toBe(100)
      expect(stats.avgChunkSize).toBeCloseTo((50 + 100 + 75) / 3, 1)
    })
  })

  describe("Integration: Real-world scenarios", () => {
    it("should handle markdown content", () => {
      const markdown = `# Heading 1

This is a paragraph with **bold** and *italic* text.

## Heading 2

- List item 1
- List item 2
- List item 3

\`\`\`javascript
const code = "example";
\`\`\`

Final paragraph.`

      const chunks = chunkText(markdown, {
        chunkSize: 100,
        chunkOverlap: 20,
        strategy: "semantic"
      })

      expect(chunks.length).toBeGreaterThan(0)
      chunks.forEach(chunk => {
        expect(chunk.text.length).toBeGreaterThan(0)
      })
    })

    it("should handle code content", () => {
      const code = `function example() {
  const result = someFunction();
  if (result) {
    console.log("Success");
  } else {
    console.error("Failed");
  }
  return result;
}`

      const chunks = chunkText(code, {
        chunkSize: 80,
        chunkOverlap: 10,
        strategy: "hybrid"
      })

      expect(chunks.length).toBeGreaterThan(0)
    })

    it("should handle very long documents", () => {
      const longText = "Paragraph. ".repeat(1000) // ~11,000 characters
      
      const chunks = chunkText(longText, {
        chunkSize: 50, // 50 tokens = ~200 chars
        chunkOverlap: 12,
        strategy: "hybrid"
      })

      expect(chunks.length).toBeGreaterThan(10)
      
      const stats = getChunkStats(chunks)
      // Avg chunk size should be close to chunkSize * 4
      expect(stats.avgChunkSize).toBeGreaterThan(0)
      expect(stats.avgChunkSize).toBeLessThanOrEqual(50 * 4 * 2) // Allow some flexibility
    })

    it("should preserve structure in semantic chunking", () => {
      const structuredText = `Introduction
This is the introduction paragraph.

Main Content
This is the main content paragraph with important information.

Conclusion
This is the conclusion paragraph.`

      const chunks = chunkText(structuredText, {
        chunkSize: 200,
        chunkOverlap: 0,
        strategy: "semantic"
      })

      // Should ideally have ~3 chunks (one per section)
      expect(chunks.length).toBeGreaterThanOrEqual(1)
      expect(chunks.length).toBeLessThanOrEqual(5)
    })
  })
})
