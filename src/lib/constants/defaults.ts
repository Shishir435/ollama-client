import type { ModelConfig } from "@/types"

/** Local-friendly default embedding model. */
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

/**
 * Local-only fallback for OpenAI-compatible providers. A missing base URL must
 * never silently send data to a cloud API; remote endpoints require explicit
 * user configuration.
 */
export const DEFAULT_OPENAI_COMPATIBLE_BASE_URL = "http://localhost:11434/v1"
/** Default provider model catalog: Ollama's public library. */
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

/** Default for user-disableable browser-tab context and tool access. */
export const DEFAULT_TABS_ACCESS = true

/** Default user-overridable image input limit in MiB. */
export const DEFAULT_MAX_IMAGE_SIZE_MB = 10
/**
 * Image formats reliably decoded by supported local vision backends. GIF/BMP
 * are inconsistent and browsers cannot decode HEIC/HEIF for this pipeline.
 */
export const SUPPORTED_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp"
] as const

/** HEIC/HEIF MIME values used for a specific conversion-required error. */
export const HEIC_MIME_TYPES = ["image/heic", "image/heif"] as const
export const HEIC_EXTENSION_PATTERN = /\.(heic|heif)$/i

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
