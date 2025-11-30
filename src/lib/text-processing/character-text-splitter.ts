import type { Document, TextSplitter, TextSplitterConfig } from "./types"

/**
 * Character-based text splitter that splits on a specific separator
 * Simpler but less semantic than RecursiveCharacterTextSplitter
 */
export class CharacterTextSplitter implements TextSplitter {
  private chunkSize: number
  private chunkOverlap: number
  private separator: string
  private lengthFunction: (text: string) => number

  constructor(config: TextSplitterConfig & { separator?: string }) {
    this.chunkSize = config.chunkSize
    this.chunkOverlap = config.chunkOverlap
    this.separator = config.separator ?? "\n\n"
    this.lengthFunction = config.lengthFunction || ((text) => text.length)
  }

  /**
   * Split text into chunks using the separator
   */
  async splitText(text: string): Promise<string[]> {
    const splits = text.split(this.separator)
    return this.mergeSplits(splits, this.separator)
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

  /**
   * Merge splits into chunks of appropriate size
   */
  private mergeSplits(splits: string[], separator: string): string[] {
    const chunks: string[] = []
    const currentChunk: string[] = []
    let currentLength = 0

    for (const split of splits) {
      const splitLength = this.lengthFunction(split)

      // If adding this split would exceed chunk size and we have existing content
      if (
        currentLength + splitLength + separator.length > this.chunkSize &&
        currentLength > 0
      ) {
        // Save current chunk
        if (currentChunk.length > 0) {
          const chunk = currentChunk.join(separator)
          chunks.push(chunk)

          // Prepare next chunk with overlap
          while (
            currentLength > this.chunkOverlap ||
            (currentLength + splitLength + separator.length > this.chunkSize &&
              currentLength > 0)
          ) {
            currentChunk.shift()
            currentLength = this.lengthFunction(currentChunk.join(separator))
          }
        }
      }

      currentChunk.push(split)
      currentLength = this.lengthFunction(currentChunk.join(separator))
    }

    // Add final chunk
    if (currentChunk.length > 0) {
      chunks.push(currentChunk.join(separator))
    }

    return chunks
  }
}
