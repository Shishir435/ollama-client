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

/**
 * Drives the approval policy (see `approval/approval-policy.ts`):
 * - low:      read-only — runs automatically
 * - medium:   leaves a trace (opens tabs, schedules) — confirm once per chat
 * - high:     mutates data — confirm each call, "always allow" available
 * - critical: submit/purchase/auth-adjacent — always confirm, never grantable
 */
export type ToolRiskLevel = "low" | "medium" | "high" | "critical"

export type ToolRequirement =
  | "tabs"
  | "storage"
  | "selection"
  | "network"
  /** Tool returns image content; only offer it to vision-capable models. */
  | "vision"

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
  /**
   * Require an explicit per-call user approval before this tool runs. Set on
   * destructive/irreversible actions (deletes, cancels). The tool loop pauses
   * and surfaces an inline Allow/Deny prompt; a denial returns a declined result
   * to the model instead of executing.
   */
  requiresConfirmation?: boolean
  /**
   * For site-acting tools: derive the normalized origin this call acts on
   * (`new URL(target).origin`) from the tool's OWN resolved target — the
   * actual tab URL, never model-provided text. Declaring a resolver makes
   * every approval grant for this tool origin-scoped: a wildcard `*` grant no
   * longer matches, and when the origin cannot be resolved no grant is
   * checked or persisted (fail closed — the call just re-prompts). Tools
   * without a resolver intentionally keep the wildcard (they act on no
   * specific site).
   */
  grantScopeResolver?: (
    args: Record<string, unknown>,
    ctx: ToolContext
  ) => Promise<string | undefined> | string | undefined
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
  /** Stable per-run source id for UI lookup. */
  id?: string | number
  title: string
  url?: string
  excerpt?: string
  /** Publication date/age when the backend reports it (helps judge recency). */
  publishedAt?: string
  /** Search engine / site label the backend reports. */
  source?: string
  /** Relevance score from the backend, when provided. */
  score?: number
  /** Result category, when provided. */
  category?: string
  /**
   * Whether this source was included in the content handed to the model.
   * Search tools may surface more results than they feed the model (capped),
   * so the UI can show "used" vs "also found" — false/undefined = not sent.
   */
  used?: boolean
}

/** An image a tool produced, to be shown to a vision model. */
export interface ToolResultImage {
  /** Raw base64, no `data:` prefix (matches `ImageAttachment.base64`). */
  base64: string
  mimeType: string
}

/** The outcome of executing a tool, fed back to the model as a `tool` message. */
export interface ToolResult {
  /** Plain-text content handed back to the model. */
  content: string
  /** True when the tool failed; the content carries the error explanation. */
  isError?: boolean
  /** Provenance shown in the reasoning trace (what the tool looked at). */
  sources?: ToolResultSource[]
  /**
   * Images the tool produced (e.g. a screenshot). The tool loop forwards these
   * to the model as a follow-up user message, since `tool`-role messages can't
   * carry images on Ollama / OpenAI-compatible providers.
   */
  images?: ToolResultImage[]
}

/** Ambient context handed to a tool at call time. */
export interface ToolContext {
  signal?: AbortSignal
  sessionId?: string
  model?: string
  /**
   * The normalized origin the user's approval (or standing grant) was
   * resolved against, for origin-scoped tools. The target can change between
   * approval and execution (e.g. the user switches tabs while the prompt is
   * open), so the tool MUST re-check its actual target against this value and
   * refuse to act when they differ — the approval named this origin, not
   * whatever is active by the time the tool runs.
   */
  approvedOrigin?: string
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
