export type Role = "user" | "assistant" | "system"

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

export interface ChatMessage {
  id?: number | string
  role: Role
  content: string
  thinking?: string
  done?: boolean
  model?: string
  attachments?: FileAttachment[]
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
    toolRuns?: ToolRun[]
    groundedOnlyMode?: boolean
    insufficientContext?: boolean
    promptInputLength?: number
    promptAugmentedLength?: number
    tabContextLength?: number
    ragContextLength?: number
    tabContextTruncated?: boolean
    contextBuildFailed?: boolean
  }
  parentId?: number | string
  childrenIds?: Array<number | string>
  siblingIds?: Array<number | string>
}

export interface ToolRun {
  toolId: string
  label: string
  status: "pending" | "running" | "done" | "error"
  startedAt: number
  completedAt?: number
  sources?: Array<{
    title: string
    url?: string
    excerpt?: string
  }>
  error?: string
}

export interface ChatSession {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  modelId?: string
  messages?: ChatMessage[]
  currentLeafId?: number | string
}

export interface ChatStreamMessage {
  delta?: string
  thinkingDelta?: string
  done?: boolean
  content?: string
  aborted?: boolean
  error?: {
    status: number
    message: string
    kind?: import("./errors").AppErrorKind
    userMessage?: string
    retryable?: boolean
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
