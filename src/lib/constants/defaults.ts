import type { ModelConfig } from "@/types"

// Default embedding model - local-friendly default
export const DEFAULT_EMBEDDING_MODEL = "all-minilm:latest"
export const EMBEDDING_MODEL_ALIASES: Record<string, string> = {
  "all-minilm": DEFAULT_EMBEDDING_MODEL,
  "all-minilm-l6-v2": DEFAULT_EMBEDDING_MODEL,
  "sentence-transformers/all-minilm-l6-v2": DEFAULT_EMBEDDING_MODEL
}

export const normalizeEmbeddingModelName = (modelName?: string): string => {
  const trimmed = (modelName || "").trim()
  if (!trimmed) return DEFAULT_EMBEDDING_MODEL

  const normalized = trimmed.toLowerCase()
  const alias = EMBEDDING_MODEL_ALIASES[normalized]
  if (alias) return alias

  return trimmed
}
export const DEFAULT_PROVIDER_ID = "ollama"
export const DEFAULT_SHARED_EMBEDDING_PROVIDER_ID = DEFAULT_PROVIDER_ID

// OpenAI-compatible providers fall back to a LOCAL endpoint, never a cloud API.
// A privacy-first, local-first extension must not silently egress to a frontier
// provider when a base URL is left blank. Users pointing at their own remote
// open-weight server (e.g. a remote Ollama/llama.cpp host) set the base URL
// explicitly in provider settings. This matches Ollama's OpenAI-compatible
// endpoint, which is the default provider.
export const DEFAULT_OPENAI_COMPATIBLE_BASE_URL = "http://localhost:11434/v1"
// Default provider model catalog (Ollama public library).
export const DEFAULT_MODEL_LIBRARY_BASE_URL = "https://ollama.com"

export const RECOMMENDED_EMBEDDING_MODELS = [DEFAULT_EMBEDDING_MODEL] as const

export const LEGACY_CONTEXT_MENU_ID = "add-to-ollama-client"
export const DEFAULT_CONTEXT_MENU_ID = "add-to-local-llm-client"
export const LEGACY_DEFAULT_MODEL_CONTEXT_SIZE = 6144
export const DEFAULT_MODEL_CONTEXT_SIZE = 65536

export const DEFAULT_EXCLUDE_URLS = [
  "^chrome://",
  "^chrome-extension://",
  "^edge://",
  "^brave://",
  "^vivaldi://",
  "^opera://",
  "^moz-extension://",
  "^about:.*"
]

export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  temperature: 0.7,
  top_k: 40,
  top_p: 0.9,
  repeat_penalty: 1.1,
  stop: [],
  system: `You are a helpful, honest, and concise AI assistant.
- Always provide accurate information.
- Be clear and to the point, but offer details when helpful.
- Use friendly, natural language.
- If unsure about something, say so rather than making up facts.
- Avoid repeating yourself unless it helps clarity.
- Format responses with markdown for readability when appropriate.`,
  num_ctx: DEFAULT_MODEL_CONTEXT_SIZE,
  repeat_last_n: 64,
  seed: 0,
  num_predict: -1,
  min_p: 0.0,
  num_thread: undefined,
  num_gpu: undefined,
  num_batch: undefined,
  keep_alive: undefined,
  warm_on_select: false,
  unload_on_switch: false
}

// Image input (vision models). Max size is the default; users can override it
// on the options page via STORAGE_KEYS.IMAGES.MAX_SIZE_MB.
export const DEFAULT_MAX_IMAGE_SIZE_MB = 10
export const SUPPORTED_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/bmp"
] as const

export const FILE_UPLOAD = {
  MAX_SIZE: 10 * 1024 * 1024, // 10MB
  EXTENSIONS: {
    PDF: "pdf",
    DOCX: "docx",
    CSV: "csv",
    TSV: "tsv",
    HTML: "html",
    HTM: "htm"
  }
}
