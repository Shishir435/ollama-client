/**
 * Document type compatible with LangChain's Document interface
 */
export interface Document {
  pageContent: string
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
    metadatas?: Record<string, any>[]
  ): Promise<Document[]>
}
