import { chunkTextAsync, estimateTokens } from "@/lib/embeddings/chunker"
import type { Chunker, ChunkingRequest, RagChunk } from "./interfaces"

/**
 * Browser chunker adapter backed by existing chunking strategies.
 */
export class BrowserChunker implements Chunker {
  async chunk(
    request: ChunkingRequest,
    signal?: AbortSignal
  ): Promise<RagChunk[]> {
    if (signal?.aborted) {
      throw new Error("Chunking aborted")
    }

    const chunks = await chunkTextAsync(request.document.content, {
      chunkSize: request.maxChunkTokens,
      chunkOverlap: request.overlapTokens,
      strategy: request.strategy
    })

    return chunks.map((chunk, index) => {
      if (signal?.aborted) {
        throw new Error("Chunking aborted")
      }

      return {
        id: `${request.document.id}:${index}`,
        documentId: request.document.id,
        text: chunk.text,
        tokenEstimate: estimateTokens(chunk.text),
        chunkIndex: index,
        totalChunks: chunks.length,
        metadata: {
          ...request.document.metadata,
          sourceType: request.document.sourceType
        }
      }
    })
  }
}
