/**
 * Type definitions for document loaders
 */

/**
 * Document metadata
 */
export interface DocumentMetadata {
  source: string
  type: string
  [key: string]: unknown
}

/**
 * Document structure matching LangChain format
 */
export interface LoaderDocument {
  pageContent: string
  metadata: DocumentMetadata
}

/**
 * Base document loader interface
 */
export interface DocumentLoader {
  /**
   * Load and parse content into documents
   */
  load(): Promise<LoaderDocument[]>
}

/**
 * CSV loader options
 */
export interface CsvLoaderOptions {
  /** URL or data URL of the CSV file */
  url: string
  /** Display name of the file */
  name: string
  /** Parser options */
  options?: {
    /** Extract specific column by name */
    column?: string
    /** Custom separator (default: comma) */
    separator?: string
  }
}

/**
 * HTML loader options
 */
export interface HtmlLoaderOptions {
  /** HTML content string */
  html: string
  /** Source URL or filename */
  url: string
}

/**
 * Image loader options (for OCR)
 */
export interface ImageLoaderOptions {
  /** Base64 data URL of the image */
  url: string
  /** Display name of the file */
  name: string
  /** OCR language (optional, uses default if not specified) */
  language?: string
}
