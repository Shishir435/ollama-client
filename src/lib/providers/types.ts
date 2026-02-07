import type {
  ChatMessage,
  ChatStreamMessage,
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
  max_tokens?: number
  stream?: boolean
}

export interface EmbeddingSupport {
  supported: boolean
  mode: "native" | "openai-compatible" | "none"
  notes?: string
}

export interface LLMProvider {
  id: string
  config: ProviderConfig

  streamChat(
    request: ChatRequest,
    onChunk: (chunk: ChatStreamMessage) => void,
    signal?: AbortSignal
  ): Promise<void>

  getModels(): Promise<string[]>
  getModelDetails?(model: string): Promise<ProviderModelDetails | null>
  getEmbeddingSupport?(): Promise<EmbeddingSupport>
  embed?(text: string, model?: string): Promise<number[]>
  embedBatch?(texts: string[], model?: string): Promise<number[][]>
}
