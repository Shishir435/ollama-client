import {
  API_VERSION_PATH,
  apiError,
  apiJson,
  SITE_ORIGIN
} from "@/lib/api-response"

export function GET() {
  return apiJson({
    status: "ok",
    service: "ollama-client-website",
    version: API_VERSION_PATH,
    checks: {
      docs: "static",
      inference: "not-hosted"
    },
    self: `${SITE_ORIGIN}/api/health`
  })
}

export function ALL() {
  return apiError(
    405,
    "method_not_allowed",
    "Only GET is supported by this read-only endpoint.",
    "Use GET /api/health.",
    { Allow: "GET, HEAD, OPTIONS" }
  )
}
