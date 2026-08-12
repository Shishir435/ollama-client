import type { LoadedModel } from "@ollama-client/contracts/model-rpc"
import { createAppError } from "@/lib/error-utils"

export const lifecycleRequestFailed = (
  operation: string,
  response: Response,
  providerId: string
) =>
  createAppError(`${operation} failed with ${response.status}`, {
    kind: "provider",
    status: response.status,
    userMessage:
      response.statusText || `The provider rejected the ${operation} request`,
    providerId,
    retryable: response.status >= 500
  })

interface OllamaPsModel {
  name?: string
  model?: string
  size?: number
  details?: {
    family?: string
    parameter_size?: string
    quantization_level?: string
  }
}

export const normalizeOllamaLoadedModel = (
  model: OllamaPsModel
): LoadedModel => ({
  name: model.name ?? model.model ?? "",
  sizeBytes: model.size ?? 0,
  family: model.details?.family ?? "",
  parameterSize: model.details?.parameter_size ?? "",
  quantizationLevel: model.details?.quantization_level ?? ""
})

interface LmStudioModel {
  id?: string
  arch?: string
  quantization?: string
}

export const normalizeLmStudioLoadedModel = (
  model: LmStudioModel
): LoadedModel => ({
  name: model.id ?? "",
  sizeBytes: 0,
  family: model.arch ?? "",
  parameterSize: "",
  quantizationLevel: model.quantization ?? ""
})

export const lmStudioApiRoot = (baseUrl: string): string =>
  baseUrl.replace(/\/v1\/?$/, "")
