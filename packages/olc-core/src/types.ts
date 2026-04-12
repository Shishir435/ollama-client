export type ProviderKind = "ollama" | "openai-compatible"

export type Role = "system" | "user" | "assistant"

export type ChatMessage = {
  role: Role
  content: string
}

export type ChatMetrics = {
  total_duration?: number
  load_duration?: number
  prompt_eval_count?: number
  prompt_eval_duration?: number
  eval_count?: number
  eval_duration?: number
}

export type ChatChunk = {
  delta?: string
  thinkingDelta?: string
  done: boolean
  error?: string
  metrics?: ChatMetrics
}

export type ChatRequest = {
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

export type ProviderModel = {
  id: string
  name: string
  providerId: string
  providerName: string
  createdAt?: string
  size?: number
  raw?: unknown
}

export type ProviderCapabilities = {
  chat: boolean
  modelDiscovery: boolean
  modelPull: boolean
  modelUnload: boolean
  modelDelete: boolean
  providerVersion: boolean
}

export type ProviderConfig = {
  id: string
  name: string
  type: ProviderKind
  enabled: boolean
  baseUrl: string
  apiKey?: string
  modelId?: string
}

export type ModelMappings = Record<string, string>

export type RuntimeConfig = {
  schemaVersion: 1
  defaultProviderId: string
  providers: ProviderConfig[]
  modelMappings: ModelMappings
}

export type ResolvedProvider = {
  providerId: string
  providerName: string
  config: ProviderConfig
}

export type HealthStatus = {
  id: string
  name: string
  enabled: boolean
  reachable: boolean
  latencyMs?: number
  error?: string
}

export type StructuredLogEntry = {
  time: string
  level: "info" | "warn" | "error"
  action: string
  details?: Record<string, unknown>
}
