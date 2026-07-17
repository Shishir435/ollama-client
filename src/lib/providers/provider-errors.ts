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

const providerServerIssueUrl = (status: number): string => {
  const params = new URLSearchParams({
    title: `[bug] Provider server error (${status})`,
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
      "- Provider/model: ",
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
  options: { baseUrl?: string; retryAfterMs?: number } = {}
): string => {
  if (status === 400) {
    return "The provider rejected the request. The selected model may not support this input — for example, images on a model without vision support."
  }
  if (status === 401 || status === 403) {
    if (isLocalProviderBaseUrl(options.baseUrl)) {
      return localCorsForbiddenMessage(status)
    }
    return "The provider rejected your credentials. Check the API key or access for this provider."
  }
  if (status === 404) {
    return "The model or endpoint was not found. Check the model name and the provider's base URL."
  }
  if (status === 408 || status === 504) {
    return "The provider timed out. Check that the server is responsive and try again."
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
    return `The provider is rate-limiting requests.${retryIn}`
  }
  if (status === 529) {
    return "The hosted provider is temporarily overloaded. Wait a moment and try again."
  }
  if (status >= 500) {
    if (!isLocalProviderBaseUrl(options.baseUrl)) {
      const retryIn = options.retryAfterMs
        ? ` Retry in about ${Math.max(1, Math.ceil(options.retryAfterMs / 1000))} seconds.`
        : " Try again shortly."
      return `The hosted provider is temporarily unavailable.${retryIn}`
    }
    return `The provider server returned an error. Check that the provider app is running, the selected model is loaded, and the base URL/port are correct. If it keeps happening, this may be a bug — [open an issue](${providerServerIssueUrl(status)}).`
  }
  return "The provider returned an error. Check the provider, model, and server logs."
}
