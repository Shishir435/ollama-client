import type { ChunkingStrategy } from "@/lib/constants"

export interface ChunkOptions {
  chunkSize: number // Size in tokens (approximate)
  chunkOverlap: number // Overlap in tokens
  strategy: ChunkingStrategy
}

export interface TextChunk {
  text: string
  index: number
  startPos: number
  endPos: number
}

/**
 * Estimates the number of tokens in a text
 * Rule of thumb: 1 token ≈ 4 characters for English text
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Converts token count to approximate character count
 */
function tokensToChars(tokens: number): number {
  return tokens * 4
}

/**
 * Fixed-size chunking: Simple splitting based on character count
 * Preserves overlap between chunks for context continuity
 */
function fixedSizeChunking(
  text: string,
  chunkSize: number,
  chunkOverlap: number
): TextChunk[] {
  const charSize = tokensToChars(chunkSize)
  const charOverlap = tokensToChars(chunkOverlap)
  const chunks: TextChunk[] = []

  let start = 0
  let index = 0

  while (start < text.length) {
    const end = Math.min(start + charSize, text.length)
    const chunkText = text.slice(start, end)

    chunks.push({
      text: chunkText,
      index,
      startPos: start,
      endPos: end
    })

    // Move start position forward, accounting for overlap
    start = end - charOverlap

    // Prevent infinite loop if overlap is too large
    if (start <= chunks[chunks.length - 1].startPos && end >= text.length) {
      break
    }

    index++
  }

  return chunks
}

/**
 * Semantic chunking: Split on natural boundaries (paragraphs, sentences)
 * while respecting size limits
 */
function semanticChunking(
  text: string,
  chunkSize: number,
  chunkOverlap: number
): TextChunk[] {
  const _targetCharSize = tokensToChars(chunkSize)
  const charOverlap = tokensToChars(chunkOverlap)
  const chunks: TextChunk[] = []

  // Split into paragraphs first
  const paragraphs = text.split(/\n\n+/).filter((p) => p.trim().length > 0)

  let currentChunk = ""
  let currentStartPos = 0
  let index = 0

  for (let i = 0; i < paragraphs.length; i++) {
    const paragraph = paragraphs[i]
    const potentialChunk = currentChunk
      ? `${currentChunk}\n\n${paragraph}`
      : paragraph

    // If adding this paragraph exceeds size, save current chunk
    if (estimateTokens(potentialChunk) > chunkSize && currentChunk) {
      const endPos = currentStartPos + currentChunk.length
      chunks.push({
        text: currentChunk,
        index,
        startPos: currentStartPos,
        endPos
      })

      // Start new chunk with overlap from previous chunk
      const overlapText = currentChunk.slice(-charOverlap)
      currentChunk = overlapText ? `${overlapText}\n\n${paragraph}` : paragraph
      currentStartPos = endPos - charOverlap
      index++
    } else {
      currentChunk = potentialChunk
    }
  }

  // Add final chunk
  if (currentChunk) {
    chunks.push({
      text: currentChunk,
      index,
      startPos: currentStartPos,
      endPos: currentStartPos + currentChunk.length
    })
  }

  return chunks
}

/**
 * Hybrid chunking: Uses semantic boundaries but enforces size limits
 * Combines best of both approaches
 */
function hybridChunking(
  text: string,
  chunkSize: number,
  chunkOverlap: number
): TextChunk[] {
  const _targetCharSize = tokensToChars(chunkSize)
  const charOverlap = tokensToChars(chunkOverlap)
  const chunks: TextChunk[] = []

  // Split into paragraphs
  const paragraphs = text.split(/\n\n+/).filter((p) => p.trim().length > 0)

  let currentChunk = ""
  let currentStartPos = 0
  let index = 0

  for (const paragraph of paragraphs) {
    // If a single paragraph is too large, split it by sentences
    if (estimateTokens(paragraph) > chunkSize) {
      // Save current chunk if exists
      if (currentChunk) {
        const endPos = currentStartPos + currentChunk.length
        chunks.push({
          text: currentChunk,
          index,
          startPos: currentStartPos,
          endPos
        })
        index++
        currentChunk = ""
      }

      // Split large paragraph by sentences
      // Split large paragraph by sentences, preserving punctuation
      // Match sentence endings but keep them attached to the sentence
      const sentences = paragraph
        .replace(/([.!?]+)(\s+)/g, "$1|SPLIT|$2")
        .split("|SPLIT|")
        .filter((s) => s.trim())
      let sentenceChunk = ""
      let sentenceStartPos = currentStartPos

      for (const sentence of sentences) {
        const potentialChunk = sentenceChunk
          ? `${sentenceChunk}. ${sentence}`
          : sentence

        if (estimateTokens(potentialChunk) > chunkSize && sentenceChunk) {
          const endPos = sentenceStartPos + sentenceChunk.length
          chunks.push({
            text: sentenceChunk,
            index,
            startPos: sentenceStartPos,
            endPos
          })

          const overlapText = sentenceChunk.slice(-charOverlap)
          sentenceChunk = overlapText ? `${overlapText}. ${sentence}` : sentence
          sentenceStartPos = endPos - charOverlap
          index++
        } else {
          sentenceChunk = potentialChunk
        }
      }

      if (sentenceChunk) {
        const endPos = sentenceStartPos + sentenceChunk.length
        chunks.push({
          text: sentenceChunk,
          index,
          startPos: sentenceStartPos,
          endPos
        })
        currentStartPos = endPos
        index++
      }
    } else {
      // Normal-sized paragraph
      const potentialChunk = currentChunk
        ? `${currentChunk}\n\n${paragraph}`
        : paragraph

      if (estimateTokens(potentialChunk) > chunkSize && currentChunk) {
        const endPos = currentStartPos + currentChunk.length
        chunks.push({
          text: currentChunk,
          index,
          startPos: currentStartPos,
          endPos
        })

        const overlapText = currentChunk.slice(-charOverlap)
        currentChunk = overlapText
          ? `${overlapText}\n\n${paragraph}`
          : paragraph
        currentStartPos = endPos - charOverlap
        index++
      } else {
        currentChunk = potentialChunk
      }
    }
  }

  // Add final chunk
  if (currentChunk) {
    chunks.push({
      text: currentChunk,
      index,
      startPos: currentStartPos,
      endPos: currentStartPos + currentChunk.length
    })
  }

  return chunks
}

/**
 * Main chunking function that selects the appropriate strategy
 */
export function chunkText(text: string, options: ChunkOptions): TextChunk[] {
  const { strategy, chunkSize, chunkOverlap } = options

  // Validate inputs
  if (chunkSize <= 0) {
    throw new Error("Chunk size must be positive")
  }

  if (chunkOverlap < 0 || chunkOverlap >= chunkSize) {
    throw new Error("Overlap must be between 0 and chunk size")
  }

  if (!text || text.trim().length === 0) {
    return []
  }

  // If text is smaller than chunk size, return as single chunk
  if (estimateTokens(text) <= chunkSize) {
    return [
      {
        text,
        index: 0,
        startPos: 0,
        endPos: text.length
      }
    ]
  }

  // Select chunking strategy
  switch (strategy) {
    case "fixed":
      return fixedSizeChunking(text, chunkSize, chunkOverlap)
    case "semantic":
      return semanticChunking(text, chunkSize, chunkOverlap)
    case "hybrid":
      return hybridChunking(text, chunkSize, chunkOverlap)
    default:
      // Fallback to hybrid if unknown strategy
      return hybridChunking(text, chunkSize, chunkOverlap)
  }
}

/**
 * Async version of chunkText that yields to the event loop to avoid blocking the UI
 * Useful for large files
 */
export async function chunkTextAsync(
  text: string,
  options: ChunkOptions
): Promise<TextChunk[]> {
  // For now, we'll just wrap the sync version with a yield if it's very large
  // In a real implementation, we would rewrite the chunking algos to be generators
  // But this is a good first step: yield before starting
  await new Promise((resolve) => setTimeout(resolve, 0))

  // If text is huge, we might want to split it and chunk parts, but that's complex for semantic chunking
  // For now, let's rely on the fact that we yielded once.
  // A better approach would be to run this in a worker, but that requires more setup.
  // Alternatively, we can implement a simple yielding loop here if we refactor the chunkers.

  return chunkText(text, options)
}

/**
 * Utility to merge chunks back into original text
 * Useful for debugging and validation
 */
export function mergeChunks(chunks: TextChunk[]): string {
  return chunks.map((chunk) => chunk.text).join("\n\n---CHUNK---\n\n")
}

/**
 * Get statistics about chunking result
 */
export function getChunkStats(chunks: TextChunk[]) {
  const totalChars = chunks.reduce((sum, chunk) => sum + chunk.text.length, 0)
  const avgChunkSize = totalChars / chunks.length
  const minChunkSize = Math.min(...chunks.map((c) => c.text.length))
  const maxChunkSize = Math.max(...chunks.map((c) => c.text.length))

  return {
    totalChunks: chunks.length,
    totalCharacters: totalChars,
    avgChunkSize: Math.round(avgChunkSize),
    minChunkSize,
    maxChunkSize,
    estimatedTokens: Math.ceil(totalChars / 4)
  }
}
