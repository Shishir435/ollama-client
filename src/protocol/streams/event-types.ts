export const CHAT_STREAM_EVENT_TYPES = {
  CHUNK: "chat_chunk",
  RAG_SOURCES: "rag_sources",
  CONTEXT_PROGRESS: "context_progress",
  CONTEXT_WARNING: "context_warning",
  CONTEXT_RESULT: "context_result",
  CONTEXT_ERROR: "context_error",
  SNAPSHOT: "stream_snapshot"
} as const

export const MODEL_PULL_EVENT_TYPES = {
  START: "model_pull_start",
  CANCEL: "model_pull_cancel",
  PROGRESS: "model_pull_progress",
  COMPLETE: "model_pull_complete",
  ERROR: "model_pull_error"
} as const
