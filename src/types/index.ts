import type browser from "webextension-polyfill"

export type OllamaModel = {
  name: string
  model: string
  modified_at: string
  size: number
  digest: string
  details: {
    parent_model: string
    format: string
    family: string
    families: string[]
    parameter_size: string
    quantization_level: string
  }
}

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
}

export type ModelConfigMap = Record<string, ModelConfig>

export type Role = "user" | "assistant" | "system"

export interface ChatMessage {
  role: Role
  content: string
  done?: boolean
  model?: string
  metrics?: {
    total_duration?: number
    load_duration?: number
    prompt_eval_count?: number
    prompt_eval_duration?: number
    eval_count?: number
    eval_duration?: number
  }
}

export interface ChatSession {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: ChatMessage[]
}

export interface ChromePort extends browser.Runtime.Port {
  postMessage(message: ChromeMessage): void
  onMessage: browser.Events.Event<(message: ChromeMessage) => void>
  onDisconnect: browser.Events.Event<() => void>
}

export interface ChromeMessage {
  type: string
  payload?: unknown
  query?: string
  name?: string
  cancel?: boolean
}

export interface ChromeResponse {
  success: boolean
  data?: unknown
  error?: {
    status: number
    message: string
  }
  tabs?: browser.Tabs.Tab[]
  html?: string
  title?: string
}

export interface OllamaChatRequest {
  model: string
  messages: ChatMessage[]
  stream?: boolean
  temperature?: number
  top_k?: number
  top_p?: number
  repeat_penalty?: number
  stop?: string[]
  system?: string
  num_ctx?: number
  repeat_last_n?: number
  seed?: number
  num_predict?: number
  min_p?: number
}

export interface OllamaPullRequest {
  name: string
  insecure?: boolean
  stream?: boolean
}

export interface OllamaShowRequest {
  name: string
  verbose?: boolean
}

export type OllamaTagsRequest = Record<string, never>

export interface OllamaChatResponse {
  model: string
  created_at: string
  message?: {
    role: "assistant" | "user" | "system"
    content: string
    images?: string[]
  }
  done: boolean
  total_duration?: number
  load_duration?: number
  prompt_eval_count?: number
  prompt_eval_duration?: number
  eval_count?: number
  eval_duration?: number
  context?: number[]
}

export interface OllamaPullResponse {
  status: string
  digest?: string
  total?: number
  completed?: number
  error?: string
}

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
}

export interface OllamaTagsResponse {
  models: OllamaModel[]
}

export interface OllamaErrorResponse {
  error: string
}

export interface ChatStreamMessage {
  delta?: string
  done?: boolean
  content?: string
  aborted?: boolean
  error?: {
    status: number
    message: string
  }
  metrics?: {
    total_duration?: number
    load_duration?: number
    prompt_eval_count?: number
    prompt_eval_duration?: number
    eval_count?: number
    eval_duration?: number
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
      }
}

export interface ModelPullMessage {
  payload: string
  cancel?: boolean
}

export interface ChatWithModelMessage {
  type: string
  payload: {
    model: string
    messages: ChatMessage[]
  }
}

export interface StreamChunkResult {
  buffer: string
  fullText: string
  isDone: boolean
}

export interface StreamProcessingState {
  buffer: string
  fullText: string
  hasReceivedData: boolean
  timeoutId: NodeJS.Timeout | null
}

export interface DNRRule {
  id: number
  priority: number
  action: {
    type: chrome.declarativeNetRequest.RuleActionType
    requestHeaders: Array<{
      header: string
      operation: chrome.declarativeNetRequest.HeaderOperation
      value: string
    }>
  }
  condition: {
    urlFilter: string
    resourceTypes: chrome.declarativeNetRequest.ResourceType[]
  }
}

export type SendResponseFunction = (response: ChromeResponse) => void
export type PortStatusFunction = () => boolean

export interface AbortControllerMap {
  [modelName: string]: AbortController
}

export interface NetworkError extends Error {
  status?: number
  statusText?: string
}

export interface ParseError extends Error {
  line?: string
  data?: unknown
}

export interface ChatSessionState {
  sessions: ChatSession[]
  currentSessionId: string | null
  hasSession: boolean
  hydrated: boolean
  createSession: () => Promise<void>
  deleteSession: (id: string) => Promise<void>
  updateMessages: (
    id: string,
    messages: ChatSession["messages"]
  ) => Promise<void>
  renameSessionTitle: (id: string, title: string) => Promise<void>
  setCurrentSessionId: (id: string | null) => void
  loadSessions: () => Promise<void>
}

export interface SelectedTabsState {
  selectedTabIds: string[]
  errors: Record<number, string>
  setSelectedTabIds: (tabs: string[]) => void
  setErrors: (errors: Record<number, string>) => void
}

export type Theme = "dark" | "light" | "system"

export interface ThemeState {
  theme: Theme
  setTheme: (theme: Theme) => void
}

export type PromptTemplate = {
  id: string
  title: string
  description?: string
  category?: string
  systemPrompt?: string
  userPrompt: string
  tags?: string[]
  createdAt?: Date
  usageCount?: number
}

export interface TabContentState {
  builtContent: string
  setBuiltContent: (builtContent: string) => void
}

export interface LoadStreamState {
  isLoading: boolean
  isStreaming: boolean
  setIsLoading: (loading: boolean) => void
  setIsStreaming: (streaming: boolean) => void
}

export interface ChatInput {
  input: string
  setInput: (value: string) => void
}

export type ScrollStrategy = "none" | "gradual" | "instant" | "smart"

export interface ContentExtractionConfig {
  enabled: boolean
  excludedUrlPatterns: string[] // URL patterns to exclude from extraction
  scrollStrategy: ScrollStrategy
  scrollDepth: number // 0-1 (percentage of page)
  scrollDelay: number // ms between scroll steps
  mutationObserverTimeout: number // ms to wait for DOM changes
  networkIdleTimeout: number // ms to wait for network idle
  maxWaitTime: number // total timeout in ms
  siteOverrides: Record<string, Partial<ContentExtractionConfig>>
}

export interface ExtractionMetrics {
  startTime: number
  endTime?: number
  duration?: number
  scrollSteps: number
  mutationsDetected: number
  contentLength: number
  config: ContentExtractionConfig
  site?: string
  detectedPatterns: string[]
}

export interface ExtractionLogEntry {
  timestamp: number
  url: string
  site: string
  metrics: ExtractionMetrics
  config: ContentExtractionConfig
  detectedPatterns: string[]
  errors?: string[]
}
