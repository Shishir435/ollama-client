/**
 * Document type compatible with LangChain's Document interface
 */
export interface Document {
  pageContent: string
  // biome-ignore lint/suspicious/noExplicitAny: Flexible metadata storage
  metadata: Record<string, any>
}

/**
 * Text splitter configuration
 */
export interface TextSplitterConfig {
  chunkSize: number
  chunkOverlap: number
  lengthFunction?: (text: string) => number
}

/**
 * Base interface for text splitters
 */
export interface TextSplitter {
  splitText(text: string): Promise<string[]>
  splitDocuments(documents: Document[]): Promise<Document[]>
  createDocuments(
    texts: string[],
    // biome-ignore lint/suspicious/noExplicitAny: Flexible metadata storage
    metadatas?: Record<string, any>[]
  ): Promise<Document[]>
}
