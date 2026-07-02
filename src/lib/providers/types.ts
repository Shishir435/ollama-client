import type { ToolDefinition } from "@/lib/tools/types"
import type {
  ChatMessage,
  ChatStreamMessage,
  ProviderModel,
  ProviderModelDetails
} from "@/types"

export enum ProviderType {
  OLLAMA = "ollama",
  OPENAI = "openai",
  CUSTOM = "custom"
}

export enum ProviderId {
  OLLAMA = "ollama",
  LM_STUDIO = "lm studio",
  LLAMA_CPP = "llamacpp",
  VLLM = "vllm",
  LOCALAI = "localai",
  KOBOLDCPP = "koboldcpp",
  OPENAI = "openai"
}

/**
 * User-added providers get ids of the form `custom:<wire>:<random>`, where
 * `<wire>` is the wire protocol ("openai" | "ollama"). Encoding the protocol in
 * the id lets synchronous call sites (capability defaults, factory) resolve it
 * without an async config lookup. The protocol is immutable per provider — a
 * different protocol is a different provider.
 */
export const CUSTOM_PROVIDER_PREFIX = "custom:"

export type CustomProviderWire = "openai" | "ollama"

export const isCustomProviderId = (id: string): boolean =>
  id.startsWith(CUSTOM_PROVIDER_PREFIX)

export const makeCustomProviderId = (wire: CustomProviderWire): string =>
  `${CUSTOM_PROVIDER_PREFIX}${wire}:${crypto.randomUUID().slice(0, 8)}`

/** Wire protocol for a custom provider id; null when not a custom id. */
export const customProviderWireFromId = (
  id: string
): CustomProviderWire | null => {
  if (!isCustomProviderId(id)) return null
  const wire = id.slice(CUSTOM_PROVIDER_PREFIX.length).split(":")[0]
  return wire === "ollama" ? "ollama" : "openai"
}

/**
 * Storage keys used specifically for provider configurations and mappings.
 */
export enum ProviderStorageKey {
  CONFIG = "llm_providers_config_v1",
  /** Legacy flat map `modelName → providerId` (collision-lossy). Migrated to V2. */
  MODEL_MAPPINGS = "model_provider_mappings",
  /** Scoped map keyed `providerId::modelName` → providerId; collision-safe. */
  MODEL_MAPPINGS_V2 = "model_provider_mappings_v2"
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
  /**
   * Ollama thinking toggle. Used for short internal utility calls where hidden
   * reasoning would waste time and never be shown to the user.
   */
  think?: boolean
  /**
   * Tool definitions offered to the model. Only set for tool-capable models
   * (gated on resolved `toolCalling`); when absent the request is identical to
   * the pre-tool-calling wire shape, so non-tool models are unaffected.
   */
  tools?: ToolDefinition[]
  /**
   * Tool-call policy. "none" forbids new tool calls while keeping the `tools`
   * array in the payload, so strict OpenAI-compatible endpoints that reject a
   * message history with tool turns but no `tools` field do not 400. Used by the
   * synthesis pass after the tool loop hits its iteration cap. Ollama has no such
   * param, so its adapter expresses "none" by omitting tools (it accepts tool
   * history without them).
   */
  tool_choice?: "auto" | "none" | "required"
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
