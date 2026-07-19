import type { ToolCall } from "@/lib/tools/types"
import type { SelectedModelRef } from "@/types/model"

export type Role = "user" | "assistant" | "system" | "tool"

export interface FileAttachment {
  id?: number
  fileId: string
  fileName: string
  fileType: string
  fileSize: number
  textPreview?: string
  processedAt: number
  sessionId?: string
  messageId?: number
  data?: Uint8Array
}

/**
 * An image attached to a chat message for vision-capable models. Kept distinct
 * from {@link FileAttachment} (RAG files): images are message-scoped, carry
 * raw base64 (no `data:` prefix) for transport, and are never indexed/embedded.
 */
export interface ImageAttachment {
  id?: number
  imageId: string
  fileName: string
  mimeType: string
  size: number
  /** Raw base64 (no `data:` prefix). */
  base64: string
  width?: number
  height?: number
  sessionId?: string
  messageId?: number
}

export interface RagSource {
  id: number | string
  title: string
  content: string
  score: number
  source?: string
  chunkIndex?: number
  fileId?: string
  type?: string
}

export interface UsedContextChunk {
  id: string | number
  title: string
  excerpt: string
  score: number
  sectionPath?: string
  source?: string
  chunkIndex?: number
}

export interface RagSources {
  sources: RagSource[]
  query: string
}

export interface ActivityEvent {
  id: string
  kind:
    | "preparing_context"
    | "query_rewrite"
    | "searching_memory"
    | "searching_files"
    | "reading_page"
    | "calling_tool"
    | "generating_answer"
  label: string
  status: "running" | "done" | "error"
  startedAt: number
  finishedAt?: number
  inputPreview?: string
  outputPreview?: string
  resultCount?: number
  sourceTitles?: string[]
  error?: string
}

/**
 * Provider-owned continuation state. The UI must never render or inspect
 * `blocks`: Anthropic signatures and OpenRouter encrypted reasoning are opaque
 * protocol data that adapters echo back unchanged.
 */
export interface ProviderReplayArtifact {
  version: 1
  wire: "anthropic" | "openai"
  providerId: string
  model: string
  blocks: Array<Record<string, unknown>>
}

export interface ChatMessage {
  id?: number | string
  role: Role
  content: string
  thinking?: string
  /** Opaque provider continuation state, kept separate from display thinking. */
  replayArtifact?: ProviderReplayArtifact
  done?: boolean
  model?: string
  attachments?: FileAttachment[]
  /** Images attached for vision models. Distinct from RAG `attachments`. */
  images?: ImageAttachment[]
  /**
   * Tool calls requested by the model on an assistant turn. Used transiently
   * inside the background tool loop to echo the assistant turn back to the
   * provider; the visible/persisted assistant message is the final answer, with
   * the tool run summary in `metrics.toolRuns`.
   */
  toolCalls?: ToolCall[]
  /** For `role: "tool"` result messages — the tool whose output this carries. */
  toolName?: string
  /** For `role: "tool"` result messages — the originating tool call id. */
  toolCallId?: string
  /**
   * For `role: "tool"` result messages — true when the result is an error or
   * a user denial. Providers with a native error channel (Anthropic
   * `is_error`) surface it so the model doesn't read failures as successes.
   */
  toolIsError?: boolean
  /**
   * Terminal error for this assistant turn. Set when the stream ends in an
   * error so the UI can offer an inline retry for retryable failures.
   */
  error?: {
    status?: number
    kind?: import("./errors").AppErrorKind
    retryable?: boolean
    retryAfterMs?: number
  }
  timestamp?: number
  metrics?: {
    total_duration?: number
    load_duration?: number
    prompt_eval_count?: number
    prompt_eval_duration?: number
    eval_count?: number
    eval_duration?: number
    ragQuery?: string
    ragSources?: RagSource[]
    usedContextChunks?: UsedContextChunk[]
    activityEvents?: ActivityEvent[]
    toolRuns?: ToolRun[]
    groundedOnlyMode?: boolean
    insufficientContext?: boolean
    promptInputLength?: number
    promptAugmentedLength?: number
    tabContextLength?: number
    ragContextLength?: number
    tabContextTruncated?: boolean
    contextBuildFailed?: boolean
    thinkingOnlyResponse?: boolean
  }
  parentId?: number | string
  childrenIds?: Array<number | string>
  siblingIds?: Array<number | string>
}

export interface ToolRun {
  toolId: string
  label: string
  displayNameKey?: string
  iconKey?: string
  category?: import("@/lib/tools/types").ToolCategory
  risk?: import("@/lib/tools/types").ToolRiskLevel
  /**
   * Normalized origin a site-acting tool call binds to (from the definition's
   * `grantScopeResolver`), shown in the confirmation prompt so the user knows
   * which site an approval covers.
   */
  origin?: string
  status: "pending" | "running" | "done" | "error" | "awaiting-confirmation"
  /**
   * The tool-call id, echoed back in a CONFIRM_TOOL message when the run is
   * awaiting confirmation so the background can resolve the right pending call.
   */
  callId?: string
  startedAt: number
  completedAt?: number
  sources?: Array<{
    id?: string | number
    title: string
    url?: string
    excerpt?: string
    /** Publication date/age when the backend reports it. */
    publishedAt?: string
    /** Search engine / site label the backend reports. */
    source?: string
    /** Relevance score from the backend, when provided. */
    score?: number
    /** Result category, when provided. */
    category?: string
    /** Whether this source was sent to the model (vs only surfaced in the UI). */
    used?: boolean
  }>
  error?: string
  /** The tool's result was trimmed to the configured per-result char cap. */
  truncated?: boolean
  /** Arguments the model passed to the tool (shown as the step's input). */
  args?: Record<string, unknown>
  /** Short preview of the tool's output (shown as the step's result). */
  resultPreview?: string
}

export interface ChatSession {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  modelId?: string
  messages?: ChatMessage[]
  currentLeafId?: number | string
  /** Pinned sessions are grouped at the top of the list, above the date groups. */
  pinned?: boolean
  /**
   * Per-chat system prompt override. When set, it replaces the model's
   * configured system prompt for this session only.
   */
  systemPrompt?: string
  /** User-managed labels for filtering and organizing chat history. */
  tags?: string[]
}

export interface ChatStreamMessage {
  /**
   * Monotonic per-turn sequence number, stamped by the background at emission.
   * Lets the UI reducer drop duplicate/out-of-order chunks and (with the
   * durable turn snapshot) resume from the last applied sequence after an MV3
   * worker restart. Optional so legacy in-flight clients still parse.
   */
  seq?: number
  delta?: string
  thinkingDelta?: string
  /** Opaque provider continuation state; never log or render its blocks. */
  replayArtifact?: ProviderReplayArtifact
  done?: boolean
  content?: string
  aborted?: boolean
  /**
   * Tool calls the model emitted this turn, normalized across providers. The
   * background tool loop consumes these; they are not forwarded to the UI.
   */
  toolCalls?: ToolCall[]
  /**
   * A snapshot of the current tool-run trace. Forwarded to the UI, which
   * replaces `metrics.toolRuns` with the latest snapshot so the chain-of-thought
   * trace updates live as tools run.
   */
  toolRuns?: ToolRun[]
  error?: {
    status: number
    message: string
    kind?: import("./errors").AppErrorKind
    messageKey?: string
    userMessage?: string
    retryable?: boolean
    retryAfterMs?: number
    context?: string
    providerId?: string
  }
  metrics?: {
    total_duration?: number
    load_duration?: number
    prompt_eval_count?: number
    prompt_eval_duration?: number
    eval_count?: number
    eval_duration?: number
    sample_count?: number
    sample_duration?: number
  }
}

export interface ChatWithModelMessage {
  type: string
  payload: {
    model: string
    providerId?: string
    messages: ChatMessage[]
    sessionId?: string
    chatId?: string
    requestId?: string
    /**
     * True when the sender already built the turn's context (page/file/memory
     * RAG) in the UI, so the background must NOT run its own memory retrieval.
     * Without this, the normal-send path double-injects memory and — because
     * the UI ships the RAG-augmented text as the last user message — the
     * background would embed that augmented prompt instead of the raw query.
     *
     * Regenerate/fork paths leave this false: they send the original persisted
     * messages, so the background is the only memory source and correctly
     * embeds the original user query.
     */
    clientContextPrepared?: boolean
  }
}

/**
 * Request to build a turn's RAG/page/memory context in the background.
 * Sent over the provider stream port; the background streams progress back as
 * `context_progress` / `context_warning` messages and finishes with a single
 * `context_result` (or `context_error`). The UI no longer runs retrieval
 * itself — the background is the sole context owner.
 */
export interface BuildContextRequestPayload {
  requestId: string
  rawInput: string
  /** Prior conversation, for query classification / reformulation. */
  messages: ChatMessage[]
  hasTabContext: boolean
  contextText: string
  tabDocuments: Array<{ id: string; title: string; content: string }>
  memoryEnabled: boolean
  maxTabContextChars: number
  maxRagContextChars: number
  groundedOnlyMode: boolean
  selectedModel: string
  selectedModelRef: SelectedModelRef | null
  customModel?: string
  /** Minimal file shape for scope + full-text fallback (structural `ContextFileInput`). */
  files?: Array<{
    text: string
    metadata: { fileName: string; fileId?: string }
  }>
}

export interface BuildContextMessage {
  type: string
  payload: BuildContextRequestPayload
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

export interface ChatInput {
  input: string
  setInput: (text: string) => void
  appendInput: (text: string) => void
}

export interface LoadStreamState {
  isLoading: boolean
  isStreaming: boolean
  setIsLoading: (loading: boolean) => void
  setIsStreaming: (streaming: boolean) => void
}

export interface ChatSessionState {
  sessions: ChatSession[]
  currentSessionId: string | null
  hasSession: boolean
  hydrated: boolean
  createSession: () => Promise<string>
  deleteSession: (id: string) => Promise<void>
  renameSessionTitle: (id: string, title: string) => Promise<void>
  /** Toggle a session's pinned state and persist it. */
  togglePinSession: (id: string) => Promise<void>
  /** Set (or clear, with an empty string) a session's system-prompt override. */
  setSessionSystemPrompt: (id: string, systemPrompt: string) => Promise<void>
  setSessionTags?: (id: string, tags: string[]) => Promise<void>
  setCurrentSessionId: (id: string | null) => void
  loadSessions: () => Promise<void>
  /**
   * Drop the cached session list and re-read from the active backend.
   * Bypasses the `hydrated || sessions.length > 0` early-return that
   * `loadSessions` uses. Called after a startup reconcile migration
   * lands new rows in the backend underneath an already-hydrated store.
   */
  refreshSessions: () => Promise<void>
  loadSessionMessages: (sessionId: string) => Promise<void>
  hasMoreMessages: boolean
  loadMoreMessages: () => Promise<void>
  ensureMessageLoaded: (
    sessionId: string,
    timestamp: number,
    messageId?: number | string
  ) => Promise<void>
  highlightedMessage: { role: Role; content: string } | null
  setHighlightedMessage: (
    message: { role: Role; content: string } | null
  ) => void
  addMessage: (sessionId: string, message: ChatMessage) => Promise<number>
  updateMessage: (
    messageId: number,
    updates: Partial<ChatMessage>,
    skipDb?: boolean
  ) => Promise<void>
  deleteMessage: (messageId: number) => Promise<void>
  forkMessage: (
    sessionId: string,
    originalMessageId: number,
    newContent: string
  ) => Promise<number | undefined>
  navigateToNode: (
    sessionId: string,
    nodeId: number | string,
    exact?: boolean
  ) => Promise<void>
}
