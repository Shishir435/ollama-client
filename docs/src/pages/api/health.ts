import { apiError, apiJson } from "@/lib/api-response"

export function GET() {
  return apiJson({ status: "ok", service: "ollama-client-website", version: "v1" })
}

export function ALL() {
  return apiError(
    405,
    "method_not_allowed",
    "Only GET is supported by this read-only endpoint.",
    "Use GET /api/health."
  )
}
