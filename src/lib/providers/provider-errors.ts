import { EXTERNAL_URLS } from "@/lib/constants/urls"
import {
  type AppError,
  createAppError,
  getErrorMessage,
  isAbortError,
  sanitizeProviderBaseUrl
} from "@/lib/error-utils"

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
  const baseUrl = sanitizeProviderBaseUrl(options.baseUrl)
  const endpoint = baseUrl ? ` at ${baseUrl}` : ""
  const operation = model
    ? ` while generating a response with model "${model}"`
    : " while generating a response"
  const lead = `${provider}${endpoint} returned HTTP ${status}${operation}.`
  if (status === 400) {
    return `${lead} The ${selectedModel} may not support this input — for example, images on a model without vision support.`
  }
  if (status === 401 || status === 403) {
    if (isLocalProviderBaseUrl(options.baseUrl)) {
      return `${lead} This is likely a CORS/origin block. Allow chrome-extension://* and moz-extension://* in the provider's CORS or origin settings, then retry. Provider-specific setup: ${EXTERNAL_URLS.SETUP_GUIDE}`
    }
    return `${lead} Check its credentials, API key, or account access.`
  }
  if (status === 404) {
    return `${lead} ${provider} could not find the ${selectedModel} or endpoint. Check the model name and ${providerLower}'s base URL.`
  }
  if (status === 408 || status === 504) {
    return `${lead} Check that its server is responsive and try again.`
  }
  if (status === 413) {
    return `${lead} The request was too large. Try a smaller image or shorter message.`
  }
  if (status === 402) {
    return `${lead} The provider account has insufficient credits or requires payment. Add credits or choose another provider.`
  }
  if (status === 429) {
    const retryIn = options.retryAfterMs
      ? ` Retry in about ${Math.max(1, Math.ceil(options.retryAfterMs / 1000))} seconds.`
      : " Wait a moment and try again."
    return `${lead} The provider is rate-limiting requests.${retryIn}`
  }
  if (status === 529) {
    return `${lead} The hosted provider is temporarily overloaded. Wait a moment and try again.`
  }
  if (status >= 500) {
    if (!isLocalProviderBaseUrl(options.baseUrl)) {
      const retryIn = options.retryAfterMs
        ? ` Retry in about ${Math.max(1, Math.ceil(options.retryAfterMs / 1000))} seconds.`
        : " Try again shortly."
      return `${lead} The hosted provider is temporarily unavailable.${retryIn}`
    }
    return `${lead} Check that ${providerLower} is running, the ${selectedModel} is loaded, and its base URL/port are correct.`
  }
  return `${lead} Check ${providerLower}, the ${selectedModel}, and its server logs.`
}

export interface ProviderErrorContext {
  providerId?: string
  providerName?: string
  model?: string
  baseUrl?: string
}

export const throwProviderConnectionError = (
  error: unknown,
  context: ProviderErrorContext
): never => {
  if (isAbortError(error)) throw error

  const providerName = context.providerName?.trim() || "The provider"
  const baseUrl = sanitizeProviderBaseUrl(context.baseUrl)
  const endpoint = baseUrl ? ` at ${baseUrl}` : ""
  const model = context.model?.trim()
  const modelContext = model ? ` with model "${model}"` : ""

  throw createAppError(
    `${providerName}${endpoint} connection failed: ${getErrorMessage(error)}`,
    {
      kind: "provider",
      status: 0,
      providerId: context.providerId,
      providerName,
      model,
      baseUrl,
      retryable: true,
      userMessage: `${providerName}${endpoint} could not be reached while requesting a response${modelContext}. Check that the provider is running and the configured base URL is correct.`,
      debug: getErrorMessage(error),
      cause: error
    }
  )
}

export const readProviderStreamChunk = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  context: ProviderErrorContext
): Promise<ReadableStreamReadResult<Uint8Array>> => {
  try {
    return await reader.read()
  } catch (error) {
    return throwProviderConnectionError(error, context)
  }
}

/**
 * Add request context at the background boundary, where the resolved provider
 * config is authoritative. Provider adapters never need to duplicate this
 * metadata, and custom provider names survive transport to the UI.
 */
export const applyProviderErrorContext = (
  error: AppError,
  context: ProviderErrorContext
): AppError => {
  error.providerId = context.providerId || error.providerId
  error.providerName = context.providerName || error.providerName
  error.model = context.model || error.model
  error.baseUrl =
    sanitizeProviderBaseUrl(context.baseUrl) ||
    sanitizeProviderBaseUrl(error.baseUrl)

  if (error.status) {
    error.userMessage = providerErrorUserMessage(error.status, {
      retryAfterMs: error.retryAfterMs,
      providerName: error.providerName,
      model: error.model,
      baseUrl: error.baseUrl
    })
  } else if (!error.userMessage) {
    const provider = error.providerName || "The provider"
    const endpoint = error.baseUrl ? ` at ${error.baseUrl}` : ""
    const model = error.model ? ` with model "${error.model}"` : ""
    error.userMessage = `${provider}${endpoint} returned an error while generating a response${model}. Check its server logs and configuration.`
  }

  return error
}

/**
 * Shape a failed provider HTTP response into an `AppError` and throw it.
 * Shared by the OpenAI-compatible and Anthropic adapters, whose per-response
 * error handling was byte-identical: read the body for `debug`, parse
 * `Retry-After`, and map the status to a safe user message. Raw response
 * bodies stay in `debug`, never in `userMessage`.
 *
 * Ollama does NOT use this: its local-provider 401/403 CORS special-case and
 * `>= 500`-only retryability differ intentionally.
 */
export const throwProviderResponseError = async (
  response: Response,
  options: {
    label: string
    providerId: string
    baseUrl?: string
    providerName?: string
    model?: string
  }
): Promise<never> => {
  const detail = await response.text()
  const retryAfterMs = parseRetryAfter(response.headers.get("Retry-After"))
  throw createAppError(`${options.label} (${response.status}): ${detail}`, {
    kind: "provider",
    status: response.status,
    providerId: options.providerId,
    providerName: options.providerName,
    model: options.model,
    baseUrl: sanitizeProviderBaseUrl(options.baseUrl),
    retryable: isRetryableProviderStatus(response.status),
    retryAfterMs,
    userMessage: providerErrorUserMessage(response.status, {
      baseUrl: options.baseUrl,
      retryAfterMs,
      providerName: options.providerName,
      model: options.model
    }),
    debug: detail
  })
}
