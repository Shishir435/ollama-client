import type {
  ChatMessage,
  ChatStreamMessage,
  ProviderModel,
  ProviderModelDetails
} from "@/types"

export enum ProviderType {
  OLLAMA = "ollama",
  OPENAI = "openai",
  ANTHROPIC = "anthropic",
  CUSTOM = "custom"
}

export enum ProviderId {
  OLLAMA = "ollama",
  LM_STUDIO = "lm studio",
  LLAMA_CPP = "llamacpp",
  VLLM = "vllm",
  LOCALAI = "localai",
  KOBOLDCPP = "koboldcpp",
  OPENAI = "openai",
  ANTHROPIC = "anthropic"
}

/**
 * Storage keys used specifically for provider configurations and mappings.
 */
export enum ProviderStorageKey {
  CONFIG = "llm_providers_config_v1",
  MODEL_MAPPINGS = "model_provider_mappings"
}

export interface ProviderConfig {
  id: string | ProviderId
  type: ProviderType
  enabled: boolean
  baseUrl?: string
  apiKey?: string
  modelId?: string
  name: string
  customModels?: string[]
}

export interface ChatRequest {
  model: string
  messages: ChatMessage[]
  temperature?: number
  top_p?: number
  top_k?: number
  repeat_penalty?: number
  repeat_last_n?: number
  seed?: number
  num_ctx?: number
  num_predict?: number
  min_p?: number
  stop?: string[]
  num_thread?: number
  num_gpu?: number
  num_batch?: number
  keep_alive?: string | number
  max_tokens?: number
  stream?: boolean
}

export interface EmbeddingSupport {
  supported: boolean
  mode: "native" | "openai-compatible" | "none"
  notes?: string
}

export interface ProviderCapabilities {
  chat: boolean
  embeddings: boolean
  modelDiscovery: boolean
  modelDetails: boolean
  modelPull: boolean
  modelUnload: boolean
  modelDelete: boolean
  providerVersion: boolean
  toolCalling: boolean
}

export interface LLMProvider {
  id: string
  config: ProviderConfig
  capabilities: ProviderCapabilities

  streamChat(
    request: ChatRequest,
    onChunk: (chunk: ChatStreamMessage) => void,
    signal?: AbortSignal
  ): Promise<void>

  getModels(): Promise<ProviderModel[]>
  getModelDetails?(model: string): Promise<ProviderModelDetails | null>
  getEmbeddingSupport?(): Promise<EmbeddingSupport>
  embed?(text: string, model?: string): Promise<number[]>
  embedBatch?(texts: string[], model?: string): Promise<number[][]>
}
