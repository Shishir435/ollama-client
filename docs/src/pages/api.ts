import {
  API_LINK_HEADER,
  API_VERSION_PATH,
  apiError,
  apiJson,
  RATE_LIMIT_DOC,
  SITE_ORIGIN,
  VERSIONING
} from "@/lib/api-response"

const service = {
  service: "Ollama Client website API",
  version: API_VERSION_PATH,
  description:
    "Read-only discovery metadata for Ollama Client. Inference runs locally through the olc CLI; this website does not host model requests.",
  docs: `${SITE_ORIGIN}/developers/`,
  openapi: `${SITE_ORIGIN}/openapi.json`,
  apiCatalog: `${SITE_ORIGIN}/.well-known/api-catalog`,
  agentMap: `${SITE_ORIGIN}/llms.txt`,
  cli: {
    name: "olc",
    description:
      "Local CLI that starts native Ollama, or exposes a local agent runtime over an OpenAI-compatible API.",
    source: "https://github.com/Shishir435/ollama-client/tree/main/packages/olc",
    install: {
      shell: `curl -fsSL ${SITE_ORIGIN}/olc.sh | sh`,
      powershell: `irm ${SITE_ORIGIN}/olc.ps1 | iex`
    },
    docs: `${SITE_ORIGIN}/developers/#quickstart`
  },
  endpoints: {
    self: `${SITE_ORIGIN}/api`,
    health: `${SITE_ORIGIN}/api/health`
  },
  errorFormat: {
    mediaType: "application/json",
    shape: "{ error: { status, code, message, resolution, documentation } }",
    statuses: {
      "404": "Unknown API route.",
      "405": "Method other than GET, HEAD, or OPTIONS.",
      "406": "No representation matches the Accept header.",
      "429": "Rate limit exceeded; retry after the Retry-After delay."
    }
  },
  contentNegotiation: {
    default: "text/html",
    markdown:
      "Send Accept: text/markdown to receive the Markdown twin of any documentation page at the same URL.",
    vary: "Accept, Accept-Encoding",
    unsupported: "406 with a JSON explanation of the available representations."
  },
  rateLimit: RATE_LIMIT_DOC,
  versioning: VERSIONING
}

export function GET() {
  return apiJson(service, 200, { Link: API_LINK_HEADER })
}

export function ALL() {
  return apiError(
    405,
    "method_not_allowed",
    "Only GET is supported by this read-only endpoint.",
    "Use GET /api for discovery metadata, or the local olc API for inference.",
    { Allow: "GET, HEAD, OPTIONS" }
  )
}
