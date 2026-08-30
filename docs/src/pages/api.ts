import { apiError, apiJson } from "@/lib/api-response"

const service = {
  service: "Ollama Client website API",
  version: "v1",
  description:
    "Read-only discovery metadata for Ollama Client. Inference runs locally through the olc CLI; this website does not host model requests.",
  docs: "https://www.ollamaclient.in/developers/",
  openapi: "https://www.ollamaclient.in/openapi.json",
  agentMap: "https://www.ollamaclient.in/llms.txt",
  endpoints: {
    self: "https://www.ollamaclient.in/api",
    health: "https://www.ollamaclient.in/api/health"
  },
  rateLimit: {
    policy: "60 requests per 60 seconds",
    headers: [
      "RateLimit-Policy",
      "RateLimit",
      "RateLimit-Limit",
      "RateLimit-Remaining",
      "RateLimit-Reset"
    ],
    retry: "429 responses include Retry-After"
  }
}

export function GET() {
  return apiJson(service)
}

export function ALL() {
  return apiError(
    405,
    "method_not_allowed",
    "Only GET is supported by this read-only endpoint.",
    "Use GET /api for discovery metadata or the local olc API for inference."
  )
}
