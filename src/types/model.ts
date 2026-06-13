import type { ChatMessage } from "./chat"
import type { ChromeResponse } from "./messaging"

export type ProviderModel = {
  name: string
  model: string
  modified_at: string
  size: number
  digest: string
  providerId?: string
  providerName?: string
  details: {
    parent_model: string
    format: string
    family: string
    families: string[]
    parameter_size: string
    quantization_level: string
  }
  // Best-effort capability signals a provider can surface at list time, fed
  // into capability detection. Only populated by providers whose list endpoint
  // reports them (e.g. LM Studio model `type`); absent means "unknown".
  capabilityHints?: {
    /** LM Studio model type: "llm" | "vlm" | "embeddings". */
    modelType?: string
    /** Context window in tokens, when the list endpoint reports it. */
    contextLength?: number
  }
}

export interface SelectedModelRef {
  providerId: string
  modelId: string
}

// Legacy alias for provider-agnostic model metadata
export type OllamaModel = ProviderModel

export type ModelConfig = {
  temperature: number
  top_k: number
  top_p: number
  repeat_penalty: number
  stop: string[]
  system: string
  num_ctx: number
  repeat_last_n: number
  seed: number
  num_predict: number
  min_p: number
  num_thread?: number
  num_gpu?: number
  num_batch?: number
  keep_alive?: string | number
  warm_on_select?: boolean
  unload_on_switch?: boolean
}

export type ModelConfigMap = Record<string, ModelConfig>

export interface OllamaChatRequest {
  model: string
  messages: ChatMessage[]
  stream?: boolean
  format?: string
  keep_alive?: string | number
  options?: {
    temperature?: number
    top_k?: number
    top_p?: number
    repeat_penalty?: number
    stop?: string[]
    num_ctx?: number
    repeat_last_n?: number
    seed?: number
    num_predict?: number
    min_p?: number
    num_thread?: number
    num_gpu?: number
    num_batch?: number
  }
}

// Provider-agnostic aliases for default provider payloads (currently Ollama).
export type DefaultProviderChatRequest = OllamaChatRequest

export interface OllamaPullRequest {
  name: string
  insecure?: boolean
  stream?: boolean
}

export type DefaultProviderPullRequest = OllamaPullRequest

export interface OllamaShowRequest {
  name: string
  verbose?: boolean
}

export type DefaultProviderShowRequest = OllamaShowRequest

export type OllamaTagsRequest = Record<string, never>

export type DefaultProviderTagsRequest = OllamaTagsRequest

export interface OllamaChatResponse {
  model: string
  created_at: string
  message?: {
    role: "assistant" | "user" | "system"
    content: string
    images?: string[]
    thinking?: string
    reasoning?: string
    reasoning_content?: string
  }
  done: boolean
  total_duration?: number
  load_duration?: number
  prompt_eval_count?: number
  prompt_eval_duration?: number
  eval_count?: number
  eval_duration?: number
  sample_count?: number
  sample_duration?: number
  context?: number[]
}

export type DefaultProviderChatResponse = OllamaChatResponse

export interface OllamaPullResponse {
  status: string
  digest?: string
  total?: number
  completed?: number
  error?: string
}

export type DefaultProviderPullResponse = OllamaPullResponse

export interface OllamaShowResponse {
  license?: string
  modelfile?: string
  parameters?: string
  template?: string
  system?: string
  details?: {
    parent_model: string
    format: string
    family: string
    families: string[]
    parameter_size: string
    quantization_level: string
  }
  model_info?: {
    [key: string]: unknown
  }
  // Ollama /api/show capability tags, e.g. "completion", "vision", "tools",
  // "embedding", "thinking". Present on recent Ollama versions; absent on older
  // ones (treat missing as "unknown", never as "false").
  capabilities?: string[]
}

export type DefaultProviderShowResponse = OllamaShowResponse

export interface OllamaTagsResponse {
  models: OllamaModel[]
}

export type DefaultProviderTagsResponse = OllamaTagsResponse

export interface OllamaErrorResponse {
  error: string
}

export type DefaultProviderErrorResponse = OllamaErrorResponse

export type ProviderModelDetails = DefaultProviderShowResponse
export type ProviderModelListResponse = DefaultProviderTagsResponse

export interface ModelCheckResponse extends ChromeResponse {
  data?: {
    exists: boolean
  }
}

export interface PullStreamMessage {
  status?: string
  progress?: number
  done?: boolean
  error?:
    | string
    | {
        status: number
        message: string
        kind?: import("./errors").AppErrorKind
        userMessage?: string
        retryable?: boolean
        context?: string
        providerId?: string
      }
}

export interface ModelPullMessage {
  payload: string | { model: string; providerId?: string }
  cancel?: boolean
}
