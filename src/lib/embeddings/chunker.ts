import type { ChunkingStrategy } from "@/lib/constants"
import { createAppError } from "@/lib/error-utils"

export interface ChunkOptions {
  chunkSize: number
  chunkOverlap: number
  strategy: ChunkingStrategy
}

export interface TextChunk {
  text: string
  index: number
  startPos: number
  endPos: number
}

export interface ChunkDocument {
  pageContent: string
  metadata: Record<string, unknown>
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function tokensToChars(tokens: number): number {
  return tokens * 4
}

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

    start = end - charOverlap
    if (start <= chunks[chunks.length - 1].startPos && end >= text.length) break
    index++
  }

  return chunks
}

function semanticChunking(
  text: string,
  chunkSize: number,
  chunkOverlap: number
): TextChunk[] {
  const charOverlap = tokensToChars(chunkOverlap)
  const chunks: TextChunk[] = []
  const paragraphs = text.split(/\n\n+/).filter((p) => p.trim().length > 0)

  let currentChunk = ""
  let currentStartPos = 0
  let index = 0

  for (const paragraph of paragraphs) {
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
      currentChunk = overlapText ? `${overlapText}\n\n${paragraph}` : paragraph
      currentStartPos = endPos - charOverlap
      index++
    } else {
      currentChunk = potentialChunk
    }
  }

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

const splitSentences = (paragraph: string): string[] =>
  paragraph
    .replace(/([.!?]+)(\s+)/g, "$1|SPLIT|$2")
    .split("|SPLIT|")
    .filter((sentence) => sentence.trim())

const appendOversizedParagraph = ({
  paragraph,
  chunkSize,
  charOverlap,
  chunks,
  index,
  startPos
}: {
  paragraph: string
  chunkSize: number
  charOverlap: number
  chunks: TextChunk[]
  index: number
  startPos: number
}): { index: number; startPos: number } => {
  let sentenceChunk = ""
  let sentenceStartPos = startPos
  let nextIndex = index

  for (const sentence of splitSentences(paragraph)) {
    const potentialChunk = sentenceChunk
      ? `${sentenceChunk}. ${sentence}`
      : sentence

    if (estimateTokens(potentialChunk) > chunkSize && sentenceChunk) {
      const endPos = sentenceStartPos + sentenceChunk.length
      chunks.push({
        text: sentenceChunk,
        index: nextIndex,
        startPos: sentenceStartPos,
        endPos
      })
      const overlapText = sentenceChunk.slice(-charOverlap)
      sentenceChunk = overlapText ? `${overlapText}. ${sentence}` : sentence
      sentenceStartPos = endPos - charOverlap
      nextIndex++
    } else {
      sentenceChunk = potentialChunk
    }
  }

  if (!sentenceChunk) return { index: nextIndex, startPos: sentenceStartPos }

  const endPos = sentenceStartPos + sentenceChunk.length
  chunks.push({
    text: sentenceChunk,
    index: nextIndex,
    startPos: sentenceStartPos,
    endPos
  })
  return { index: nextIndex + 1, startPos: endPos }
}

function hybridChunking(
  text: string,
  chunkSize: number,
  chunkOverlap: number
): TextChunk[] {
  const charOverlap = tokensToChars(chunkOverlap)
  const chunks: TextChunk[] = []
  const paragraphs = text.split(/\n\n+/).filter((p) => p.trim().length > 0)

  let currentChunk = ""
  let currentStartPos = 0
  let index = 0

  for (const paragraph of paragraphs) {
    if (estimateTokens(paragraph) > chunkSize) {
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

      const oversized = appendOversizedParagraph({
        paragraph,
        chunkSize,
        charOverlap,
        chunks,
        index,
        startPos: currentStartPos
      })
      index = oversized.index
      currentStartPos = oversized.startPos
      continue
    }

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
      currentChunk = overlapText ? `${overlapText}\n\n${paragraph}` : paragraph
      currentStartPos = endPos - charOverlap
      index++
    } else {
      currentChunk = potentialChunk
    }
  }

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

function markdownChunking(
  text: string,
  chunkSize: number,
  chunkOverlap: number
): TextChunk[] {
  const charOverlap = tokensToChars(chunkOverlap)
  const chunks: TextChunk[] = []
  const codeBlocks: string[] = []
  const textWithPlaceholders = text.replace(/```[\s\S]*?```/g, (match) => {
    codeBlocks.push(match)
    return `__CODE_BLOCK_${codeBlocks.length - 1}__`
  })

  const sections = textWithPlaceholders.split(/^(#{1,6}\s+.+)$/m)
  let currentChunk = ""
  let currentStartPos = 0
  let index = 0

  for (const rawSection of sections) {
    if (!rawSection.trim()) continue
    const section = rawSection.replace(
      /__CODE_BLOCK_(\d+)__/g,
      (_, id) => codeBlocks[parseInt(id, 10)]
    )

    if (estimateTokens(section) > chunkSize) {
      if (currentChunk) {
        chunks.push({
          text: currentChunk,
          index,
          startPos: currentStartPos,
          endPos: currentStartPos + currentChunk.length
        })
        index++
        currentChunk = ""
        currentStartPos += chunks[chunks.length - 1].text.length
      }

      const subChunks = hybridChunking(section, chunkSize, chunkOverlap)
      for (const subChunk of subChunks) {
        chunks.push({
          ...subChunk,
          index,
          startPos: currentStartPos + subChunk.startPos
        })
        index++
      }
      currentStartPos += section.length
      continue
    }

    const potentialChunk = currentChunk
      ? `${currentChunk}\n${section}`
      : section

    if (estimateTokens(potentialChunk) > chunkSize && currentChunk) {
      chunks.push({
        text: currentChunk,
        index,
        startPos: currentStartPos,
        endPos: currentStartPos + currentChunk.length
      })

      const overlapText = currentChunk.slice(-charOverlap)
      currentChunk = overlapText ? `${overlapText}\n${section}` : section
      currentStartPos +=
        chunks[chunks.length - 1].text.length - overlapText.length
      index++
    } else {
      currentChunk = potentialChunk
    }
  }

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

export function chunkText(text: string, options: ChunkOptions): TextChunk[] {
  const { strategy, chunkSize, chunkOverlap } = options

  if (chunkSize <= 0) {
    throw createAppError("Chunk size must be positive", { kind: "validation" })
  }
  if (chunkOverlap < 0 || chunkOverlap >= chunkSize) {
    throw createAppError("Overlap must be between 0 and chunk size", {
      kind: "validation"
    })
  }
  if (!text || text.trim().length === 0) return []
  if (estimateTokens(text) <= chunkSize) {
    return [{ text, index: 0, startPos: 0, endPos: text.length }]
  }

  switch (strategy) {
    case "fixed":
      return fixedSizeChunking(text, chunkSize, chunkOverlap)
    case "semantic":
      return semanticChunking(text, chunkSize, chunkOverlap)
    case "hybrid":
      return hybridChunking(text, chunkSize, chunkOverlap)
    case "markdown":
      return markdownChunking(text, chunkSize, chunkOverlap)
    default:
      return hybridChunking(text, chunkSize, chunkOverlap)
  }
}

export async function chunkTextAsync(
  text: string,
  options: ChunkOptions
): Promise<TextChunk[]> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  return chunkText(text, options)
}

export async function chunkDocuments(
  documents: ChunkDocument[],
  options: ChunkOptions
): Promise<ChunkDocument[]> {
  const chunked: ChunkDocument[] = []

  for (const document of documents) {
    const chunks = await chunkTextAsync(document.pageContent, options)
    for (const chunk of chunks) {
      chunked.push({
        pageContent: chunk.text,
        metadata: {
          ...document.metadata,
          chunkIndex: chunked.length
        }
      })
    }
  }

  const totalChunks = chunked.length
  return chunked.map((document) => ({
    ...document,
    metadata: { ...document.metadata, totalChunks }
  }))
}

export function mergeChunks(chunks: TextChunk[]): string {
  return chunks.map((chunk) => chunk.text).join("\n\n---CHUNK---\n\n")
}

export function getChunkStats(chunks: TextChunk[]) {
  const totalChars = chunks.reduce((sum, chunk) => sum + chunk.text.length, 0)
  const avgChunkSize = totalChars / chunks.length
  const minChunkSize = Math.min(...chunks.map((chunk) => chunk.text.length))
  const maxChunkSize = Math.max(...chunks.map((chunk) => chunk.text.length))

  return {
    totalChunks: chunks.length,
    totalCharacters: totalChars,
    avgChunkSize: Math.round(avgChunkSize),
    minChunkSize,
    maxChunkSize,
    estimatedTokens: Math.ceil(totalChars / 4)
  }
}
