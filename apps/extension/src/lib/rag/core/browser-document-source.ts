import type { DocumentSource, RagDocument } from "./interfaces"

export type DocumentLoader = (signal?: AbortSignal) => Promise<RagDocument[]>

/**
 * Browser-safe document source adapter.
 * Keeps ingestion transport concerns outside RAG core.
 */
export class BrowserDocumentSource implements DocumentSource {
  constructor(private readonly loader: DocumentLoader) {}

  async readAll(signal?: AbortSignal): Promise<RagDocument[]> {
    if (signal?.aborted) {
      throw new Error("Document source aborted")
    }

    return this.loader(signal)
  }
}
