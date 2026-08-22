/** Shared shapes for the OpenAI wire format and generic proxy configuration. */

export interface OpenAIToolCall {
  id?: string
  type?: string
  function?: { name?: string; arguments?: string }
}

export interface OpenAIToolDefinition {
  type?: string
  function?: {
    name?: unknown
    description?: unknown
    parameters?: unknown
  }
}

export interface OpenAIMessage {
  role?: string
  content?: unknown
  name?: string
  tool_call_id?: string
  tool_calls?: OpenAIToolCall[]
}

export interface ChatCompletionRequest {
  messages?: OpenAIMessage[]
  model?: unknown
  stream?: unknown
  tools?: unknown
  tool_choice?: unknown
  reasoning_effort?: unknown
  reasoning?: unknown
}

export interface ImageGenerationRequest {
  model?: unknown
  prompt?: unknown
  n?: unknown
  response_format?: unknown
}

export const REASONING_EFFORTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max"
] as const

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number]

/** One tool a backend can make its agent call, taken from the request. */
export interface BridgeToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
}

/** A client tool call a backend is blocked on. */
export interface PendingToolCall {
  callId: string
  turnId: string
  tool: string
  args: Record<string, unknown>
  emitted: boolean
  createdAt: number
}

export interface ToolResultMessage {
  toolCallId: string
  content: string
}

/**
 * Configuration the proxy core owns.
 *
 * Backend-specific settings are not here: a backend resolves its own from the same
 * options and environment through its own resolver, so adding one does not mean
 * widening this type. See `src/backends/opencode/config.ts` for an example.
 */
export interface ProxyConfig {
  PORT: number
  BIND_HOST: string
  API_KEY: string
  SYSTEM_PROMPT: string
  /** Which backend adapter serves requests. */
  BACKEND: string
  /** Browser origins allowed to call the API. Exact, `<scheme>://*`, or `*`. */
  ALLOWED_ORIGINS: string[]
  REQUEST_TIMEOUT_MS: number
  BRIDGE_ENABLED: boolean
  BRIDGE_PATH: string
  BRIDGE_TOKEN: string
  /** Absolute URL a backend runtime posts client tool calls to. */
  BRIDGE_ENDPOINT: string
  BRIDGE_CALL_TIMEOUT_MS: number
  BRIDGE_BATCH_MS: number
  SUSPENDED_TURN_TTL_MS: number
  DEBUG: boolean
}

export type ProxyLogger = (message: string, details?: unknown) => void

export type RetryAsync = <T>(
  operation: () => Promise<T>,
  options?: { label?: string }
) => Promise<T>
