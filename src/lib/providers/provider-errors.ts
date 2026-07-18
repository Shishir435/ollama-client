import { EXTERNAL_URLS } from "@/lib/constants/urls"

/**
 * A 401/403 from a LOCAL provider (Ollama et al.) is almost always a CORS/origin
 * rejection, not bad credentials — most often on Firefox, which can't rewrite the
 * request origin the way Chromium's declarativeNetRequest does. Point the user at
 * the origins fix and the setup guide instead of a misleading "check your API key".
 */
export const localCorsForbiddenMessage = (status = 403): string =>
  `Your local provider blocked this request (${status} ${
    status === 401 ? "Unauthorized" : "Forbidden"
  }). This is likely a CORS / origin block — most common on Firefox, which can't rewrite the request origin the way Chromium does. Allow chrome-extension://* and moz-extension://* in your provider's CORS or origin settings, then retry. Provider-specific setup: ${EXTERNAL_URLS.SETUP_GUIDE}`

export const isLocalProviderBaseUrl = (baseUrl?: string): boolean => {
  if (!baseUrl) return true

  try {
    const { hostname } = new URL(baseUrl)
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname.endsWith(".localhost")
    )
  } catch {
    return false
  }
}

export const parseRetryAfter = (
  value: string | null,
  now = Date.now()
): number | undefined => {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000)
  }

  const retryAt = Date.parse(value)
  if (Number.isNaN(retryAt)) return undefined
  return Math.max(0, retryAt - now)
}

export const isRetryableProviderStatus = (status: number): boolean =>
  status === 408 || status === 429 || status === 529 || status >= 500

export const buildProviderServerIssueUrl = (
  status: number,
  options: { providerName?: string; model?: string } = {}
): string => {
  const providerName = options.providerName?.trim()
  const model = options.model?.trim()
  const subject = providerName
    ? `${providerName} server error`
    : "Provider server error"
  const params = new URLSearchParams({
    title: `[bug] ${subject} (${status})`,
    body: [
      "**What happened**",
      "The provider server returned an error while generating a response.",
      "",
      "**Checks tried**",
      "- Provider app is running: ",
      "- Selected model is loaded: ",
      "- Base URL/port is correct: ",
      "",
      "**Details**",
      `- Error status: ${status}`,
      `- Provider/model: ${[providerName, model].filter(Boolean).join(" / ")}`,
      "- Browser: ",
      "- Extension version: ",
      "",
      "**Steps to reproduce**",
      "1. "
    ].join("\n")
  })

  return `${EXTERNAL_URLS.GITHUB_NEW_ISSUE}?${params.toString()}`
}

/**
 * Map a provider HTTP status to a clean, user-facing message. Keeps raw
 * provider response bodies (which can be JSON or stack traces) out of the chat
 * UI — those stay in the error's `debug` field for diagnostics.
 */
export const providerErrorUserMessage = (
  status: number,
  options: {
    baseUrl?: string
    retryAfterMs?: number
    providerName?: string
    model?: string
  } = {}
): string => {
  const providerName = options.providerName?.trim()
  const provider = providerName || "The provider"
  const providerLower = providerName || "the provider"
  const model = options.model?.trim()
  const selectedModel = model ? `model "${model}"` : "selected model"
  if (status === 400) {
    return `${provider} rejected the request. The ${selectedModel} may not support this input — for example, images on a model without vision support.`
  }
  if (status === 401 || status === 403) {
    if (isLocalProviderBaseUrl(options.baseUrl)) {
      return localCorsForbiddenMessage(status)
    }
    return `${provider} rejected your credentials. Check its API key or account access.`
  }
  if (status === 404) {
    return `${provider} could not find the ${selectedModel} or endpoint. Check the model name and ${providerLower}'s base URL.`
  }
  if (status === 408 || status === 504) {
    return `${provider} timed out. Check that its server is responsive and try again.`
  }
  if (status === 413) {
    return "The request was too large. Try a smaller image or shorter message."
  }
  if (status === 402) {
    return "The provider account has insufficient credits or requires payment. Add credits or choose another provider."
  }
  if (status === 429) {
    const retryIn = options.retryAfterMs
      ? ` Retry in about ${Math.max(1, Math.ceil(options.retryAfterMs / 1000))} seconds.`
      : " Wait a moment and try again."
    return `${provider} is rate-limiting requests.${retryIn}`
  }
  if (status === 529) {
    return "The hosted provider is temporarily overloaded. Wait a moment and try again."
  }
  if (status >= 500) {
    if (!isLocalProviderBaseUrl(options.baseUrl)) {
      const retryIn = options.retryAfterMs
        ? ` Retry in about ${Math.max(1, Math.ceil(options.retryAfterMs / 1000))} seconds.`
        : " Try again shortly."
      return `${providerName || "The hosted provider"} is temporarily unavailable.${retryIn}`
    }
    return `${provider} returned a server error. Check that ${providerLower} is running, the ${selectedModel} is loaded, and its base URL/port are correct.`
  }
  return `${provider} returned an error. Check ${providerLower}, the ${selectedModel}, and its server logs.`
}
