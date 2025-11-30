import type { Document, TextSplitter, TextSplitterConfig } from "./types"

/**
 * Recursive character text splitter that tries multiple separators
 * Preserves semantic structure better by trying paragraph, sentence, word splits
 */
export class RecursiveCharacterTextSplitter implements TextSplitter {
  private chunkSize: number
  private chunkOverlap: number
  private separators: string[]
  private lengthFunction: (text: string) => number

  constructor(config: TextSplitterConfig & { separators?: string[] }) {
    this.chunkSize = config.chunkSize
    this.chunkOverlap = config.chunkOverlap
    // Default separators in order of preference (coarsest to finest)
    this.separators = config.separators || [
      "\n\n", // Paragraphs
      "\n", // Lines
      ". ", // Sentences
      "! ", // Exclamations
      "? ", // Questions
      "; ", // Semi-colons
      ", ", // Commas
      " ", // Words
      "" // Characters
    ]
    this.lengthFunction = config.lengthFunction || ((text) => text.length)
  }

  /**
   * Split text recursively using separators
   */
  async splitText(text: string): Promise<string[]> {
    const finalChunks: string[] = []

    // Start with the text as a single piece
    const pieces = [text]

    for (const piece of pieces) {
      if (this.lengthFunction(piece) <= this.chunkSize) {
        finalChunks.push(piece)
      } else {
        const newChunks = await this.splitTextRecursive(piece, this.separators)
        finalChunks.push(...newChunks)
      }
    }

    return finalChunks
  }

  /**
   * Recursively split text using separators
   */
  private async splitTextRecursive(
    text: string,
    separators: string[]
  ): Promise<string[]> {
    const finalChunks: string[] = []

    // Get the separator to use
    let separator = separators[separators.length - 1]
    let newSeparators: string[] = []

    for (let i = 0; i < separators.length; i++) {
      const sep = separators[i]
      if (sep === "") {
        separator = sep
        break
      }
      if (text.includes(sep)) {
        separator = sep
        newSeparators = separators.slice(i + 1)
        break
      }
    }

    // Split the text
    const splits = separator === "" ? text.split("") : text.split(separator)

    // Merge splits into chunks
    let currentChunk: string[] = []
    let currentLength = 0

    for (const split of splits) {
      const splitLength = this.lengthFunction(split)

      // If this split is too large, recursively split it
      if (splitLength > this.chunkSize) {
        if (currentChunk.length > 0) {
          const chunk = this.joinSplits(currentChunk, separator)
          finalChunks.push(chunk)
          currentChunk = []
          currentLength = 0
        }

        // Recursively split if we have more separators
        if (newSeparators.length > 0) {
          const recursiveChunks = await this.splitTextRecursive(
            split,
            newSeparators
          )
          finalChunks.push(...recursiveChunks)
        } else {
          // Can't split further, just take what we can
          finalChunks.push(split.substring(0, this.chunkSize))
        }
        continue
      }

      // Determine if adding this split would exceed chunk size
      const projectedLength =
        currentLength +
        splitLength +
        (currentChunk.length > 0 ? separator.length : 0)

      if (projectedLength > this.chunkSize && currentLength > 0) {
        // Save current chunk
        if (currentChunk.length > 0) {
          const chunk = this.joinSplits(currentChunk, separator)
          finalChunks.push(chunk)

          // Handle overlap
          while (
            currentLength > this.chunkOverlap ||
            (currentLength + splitLength + separator.length > this.chunkSize &&
              currentLength > 0)
          ) {
            currentChunk.shift()
            currentLength =
              currentChunk.length > 0
                ? this.lengthFunction(this.joinSplits(currentChunk, separator))
                : 0
          }
        }
      }

      currentChunk.push(split)
      currentLength = this.lengthFunction(
        this.joinSplits(currentChunk, separator)
      )
    }

    // Add final chunk
    if (currentChunk.length > 0) {
      finalChunks.push(this.joinSplits(currentChunk, separator))
    }

    return finalChunks
  }

  /**
   * Join splits with separator
   */
  private joinSplits(splits: string[], separator: string): string {
    return separator === "" ? splits.join("") : splits.join(separator)
  }

  /**
   * Split documents into chunks
   */
  async splitDocuments(documents: Document[]): Promise<Document[]> {
    const texts = documents.map((doc) => doc.pageContent)
    const metadatas = documents.map((doc) => doc.metadata)
    return this.createDocuments(texts, metadatas)
  }

  /**
   * Create documents from texts and metadata
   */
  async createDocuments(
    texts: string[],
    metadatas?: Record<string, any>[]
  ): Promise<Document[]> {
    const _metadatas =
      metadatas || new Array(texts.length).fill(null).map(() => ({}))
    const documents: Document[] = []

    for (let i = 0; i < texts.length; i++) {
      const text = texts[i]
      const chunks = await this.splitText(text)

      for (let j = 0; j < chunks.length; j++) {
        documents.push({
          pageContent: chunks[j],
          metadata: {
            ..._metadatas[i],
            chunkIndex: j,
            totalChunks: chunks.length
          }
        })
      }
    }

    return documents
  }
}
