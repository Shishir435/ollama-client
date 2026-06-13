/**
 * Provider-agnostic tool-calling domain types.
 *
 * These normalize the wire formats of the different providers (Ollama returns a
 * whole `message.tool_calls` array with parsed-object arguments; OpenAI streams
 * `delta.tool_calls` fragments with string arguments) into one shape the tool
 * runtime understands. The same normalization is the seam future tool *sources*
 * plug into — internal tools today, MCP servers later — so nothing downstream of
 * the registry needs to know where a tool came from.
 */

/** JSON Schema for a tool's arguments. Kept loose; providers pass it through. */
export interface ToolParameterSchema {
  type: "object"
  properties: Record<string, unknown>
  required?: string[]
}

export type ToolCategory =
  | "browser"
  | "knowledge"
  | "files"
  | "selection"
  | "web"
  | "system"
  | "external"

export type ToolRiskLevel = "low" | "medium" | "high"

export type ToolRequirement = "tabs" | "storage" | "selection" | "network"

export interface ToolRuntimePolicy {
  timeoutMs: number
  maxResultChars: number
  cacheable: boolean
  parallelizable: boolean
  enabled: boolean
}

export type ToolRuntimePolicyOverrides = Partial<ToolRuntimePolicy>

/** A tool the model may call, in normalized form. */
export interface ToolDefinition {
  /**
   * Provider-safe, registry-unique name. Must match `^[a-zA-Z0-9_-]{1,64}$`
   * (both Ollama and OpenAI constrain function names). For sources that can emit
   * arbitrary names (e.g. MCP), the source is responsible for sanitizing.
   */
  name: string
  description: string
  parameters: ToolParameterSchema
  displayNameKey?: string
  descriptionKey?: string
  category?: ToolCategory
  iconKey?: string
  risk?: ToolRiskLevel
  cacheable?: boolean
  requires?: ToolRequirement[]
  runtime?: ToolRuntimePolicyOverrides
}

/** A model's request to invoke a tool, normalized across providers. */
export interface ToolCall {
  /** Provider-supplied id when present, else synthesized by the adapter. */
  id: string
  name: string
  /** Parsed argument object (never a raw JSON string). */
  arguments: Record<string, unknown>
}

export interface ToolResultSource {
  title: string
  url?: string
  excerpt?: string
}

/** The outcome of executing a tool, fed back to the model as a `tool` message. */
export interface ToolResult {
  /** Plain-text content handed back to the model. */
  content: string
  /** True when the tool failed; the content carries the error explanation. */
  isError?: boolean
  /** Provenance shown in the reasoning trace (what the tool looked at). */
  sources?: ToolResultSource[]
}

/** Ambient context handed to a tool at call time. */
export interface ToolContext {
  signal?: AbortSignal
  sessionId?: string
  model?: string
}

/**
 * A source of tools. The internal source is one implementation; each future MCP
 * server is another. The registry treats them uniformly — it only needs to list
 * a source's tools and route a call to it.
 */
export interface ToolSource {
  /** Stable id, e.g. `"internal"` or `"mcp:<server>"`. */
  id: string
  listTools(): Promise<ToolDefinition[]> | ToolDefinition[]
  callTool(
    name: string,
    args: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResult>
}

/** A registered tool paired with the source that owns it. */
export interface RegisteredTool {
  definition: ToolDefinition
  sourceId: string
}
