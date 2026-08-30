import type {
  EmbeddingsGenerateRequest,
  EmbeddingsGenerateResult
} from "@ollama-client/contracts/model-rpc"
import { RpcMethod } from "@ollama-client/contracts/rpc"
import { extensionRpcClient } from "./extension-client"

export interface EmbeddingResult {
  embedding: number[]
  model: string
  providerId: string
}

export interface EmbeddingError {
  error: string
  code?: string
}

/** Page-side embedding client. Provider resolution stays background-owned. */
export const generateEmbedding = async (
  text: string,
  model?: string
): Promise<EmbeddingResult | EmbeddingError> => {
  const request: EmbeddingsGenerateRequest = {
    text,
    ...(model ? { model } : {})
  }
  const result: EmbeddingsGenerateResult = await extensionRpcClient.call(
    RpcMethod.EmbeddingsGenerate,
    request
  )
  if (!result.ok) {
    return {
      error: result.error,
      ...(result.code ? { code: result.code } : {})
    }
  }
  return {
    embedding: result.embedding,
    model: result.model,
    providerId: result.providerId
  }
}
