import type { ModelConfig } from "@/types"

// Default embedding model - use `mxbai-embed-large` for improved semantics
export const DEFAULT_EMBEDDING_MODEL = "mxbai-embed-large"

export const DEFAULT_CONTEXT_MENU_ID = "add-to-ollama-client"

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
  num_ctx: 6144,
  repeat_last_n: 64,
  seed: 0,
  num_predict: -1,
  min_p: 0.0
}

export const FILE_UPLOAD = {
  MAX_SIZE: 10 * 1024 * 1024, // 10MB
  EXTENSIONS: {
    PDF: "pdf",
    DOCX: "docx",
    CSV: "csv",
    TSV: "tsv",
    HTML: "html",
    HTM: "htm",
    PNG: "png",
    JPG: "jpg",
    JPEG: "jpeg",
    WEBP: "webp",
    GIF: "gif",
    BMP: "bmp"
  }
}
