/**
 * The backend port.
 *
 * Purpose: everything OpenAI-shaped — the HTTP surface, the tool-call correlation
 * ids, the parked-call registry, the suspend/resume handshake with the client —
 * belongs to the core and is the same for any agent runtime behind it. A backend
 * supplies only what is genuinely runtime-specific: how to reach it, what models it
 * has, how to make it able to call the client's tools, and how to read one turn.
 *
 * Contract for a new backend:
 *
 * - `startTurn` begins generation and returns a handle. It must not block until the
 *   turn finishes; `run` streams it.
 * - A backend that wants the client to execute a tool calls
 *   `context.callClientTool`. That promise resolves with the client's output, or
 *   rejects when the client never answers — it is the only channel, and the core
 *   decides how the call reaches the client.
 * - `run`/`resume` resolve `suspended` when `signals.suspended` settles, which is how
 *   the core says "a tool call is parked; hand this leg back to the client".
 * - `resume` must call `signals.releaseToolResults` once it is ready to receive
 *   continued output. Releasing earlier can let a continuation arrive before the
 *   backend is listening.
 */
import type { ProxyOptions } from "../config.js"
import type { Router } from "../core/http.js"
import type {
  OpenAIMessage,
  ProxyConfig,
  ProxyLogger,
  RetryAsync,
  ToolResultMessage
} from "../types.js"

/** One model, in the shape an OpenAI-compatible catalog publishes. */
export interface CatalogModel {
  id: string
  object: "model"
  created: number
  owned_by: string
  name: string
  context_length?: number
  max_tokens?: number
  input_modalities: string[]
  supported_parameters: string[]
  capabilities: {
    function_calling: boolean
    vision: boolean
    reasoning: boolean
  }
  status?: string
}

export interface ClientToolInvocation {
  /** The backend's own turn id, as returned by `startTurn`. */
  turnId: string
  tool: string
  args: unknown
  signal?: AbortSignal
}

export interface BackendContext {
  config: ProxyConfig
  /** Command-line options, for a backend to resolve its own settings from. */
  options: ProxyOptions
  /** Config-file options, ranked below the environment by convention. */
  fileOptions: ProxyOptions
  log: ProxyLogger
  retryAsync: RetryAsync
  /** Ask the connected client to run one of its own tools and await the result. */
  callClientTool: (invocation: ClientToolInvocation) => Promise<string>
}

export interface TurnStreamHandlers {
  onText: (delta: string) => void
  onReasoning: (delta: string) => void
  /** Backend-specific extras a client may ignore, such as OpenCode patches. */
  onAuxiliary?: (payload: unknown) => void
}

export interface TurnRunSignals {
  /** Settles when the core parks a client tool call for this turn. */
  suspended: Promise<void>
  /** Whether a call is already parked but not yet announced to the client. */
  hasUnannouncedToolCalls: () => boolean
  /** Hand the client's tool results to the parked calls. Resume only. */
  releaseToolResults?: () => void
}

export type TurnResult =
  | {
      status: "completed"
      content: string
      reasoning: string
      finish?: string | null
    }
  | { status: "suspended" }
  | { status: "failed"; error: { message: string; type: string } }

export interface BackendTurn {
  readonly id: string
  run: (
    handlers: TurnStreamHandlers,
    signals: TurnRunSignals
  ) => Promise<TurnResult>
  resume: (
    results: ToolResultMessage[],
    handlers: TurnStreamHandlers,
    signals: TurnRunSignals
  ) => Promise<TurnResult>
  abort: () => Promise<void>
  dispose: () => Promise<void>
}

export interface StartTurnInput {
  requestId: string
  model: { providerId: string; modelId: string }
  messages: OpenAIMessage[]
  /** The request's OpenAI `tools` array, unmodified. */
  tools: unknown
}

export type ResolvedModel =
  | { providerId: string; modelId: string }
  | { error: string }

export interface AgentBackend {
  readonly id: string
  /** Start or adopt the runtime. Called before the first turn of a request. */
  ensureReady: () => Promise<void>
  listModels: () => Promise<CatalogModel[]>
  /** Turn a client-supplied model id into a routable provider and model. */
  resolveModel: (requested: unknown) => Promise<ResolvedModel>
  startTurn: (input: StartTurnInput) => Promise<BackendTurn>
  /** The live turn with this id, if the backend still holds it. */
  findTurn: (turnId: string) => BackendTurn | undefined
  /** Routes only this backend needs, such as a callback its runtime posts to. */
  registerRoutes?: (router: Router) => void
  shutdown: () => Promise<void>
}

export type BackendFactory = (context: BackendContext) => AgentBackend
