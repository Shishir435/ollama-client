import type { LucideIcon } from "lucide-react"

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
}

export type ModelConfigMap = Record<string, ModelConfig>

export interface SocialLink {
  label: string
  href: string
  icon: LucideIcon
}

export type Role = "user" | "assistant"

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

export interface ChromePort extends chrome.runtime.Port {
  postMessage(message: any): void
  onMessage: chrome.events.Event<(message: any) => void>
  onDisconnect: chrome.events.Event<() => void>
}

export interface ChromeMessage {
  type: string
  payload?: any
  query?: string
  name?: string
  cancel?: boolean
}

export interface ChromeResponse {
  success: boolean
  data?: any
  error?: {
    status: number
    message: string
  }
  tabs?: chrome.tabs.Tab[]
  html?: string
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

export interface OllamaTagsRequest {}

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
    [key: string]: any
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
  data?: any
}
