import {
  isRetryableProviderStatus,
  parseRetryAfter
} from "@ollama-client/runtime-core/retry"
import { EXTERNAL_URLS } from "@/lib/constants/urls"
import {
  type AppError,
  type AppErrorCode,
  type AppErrorRecoveryAction,
  createAppError,
  getErrorMessage,
  isAbortError,
  sanitizeProviderBaseUrl
} from "@/lib/error-utils"

export interface ProviderErrorClassification {
  code: AppErrorCode
  reason?: string
  recoveryAction: AppErrorRecoveryAction
}

const reasonForCode = (code: AppErrorCode): string | undefined => {
  if (code === "OLC-CONTEXT-TOO-LARGE")
    return "Request exceeds model context limit."
  if (code === "OLC-OUT-OF-MEMORY")
    return "Provider could not allocate enough memory for this model."
  if (code === "OLC-MODEL-NOT-FOUND")
    return "Provider could not find selected model."
  if (code === "OLC-MODEL-NOT-LOADED")
    return "Selected model is not loaded by provider."
  if (code === "OLC-MODEL-LOADING") return "Selected model is still loading."
  if (code === "OLC-INPUT-UNSUPPORTED")
    return "Selected model does not support part of this request."
  return undefined
}

const includesAny = (value: string, patterns: RegExp[]) =>
  patterns.some((pattern) => pattern.test(value))

/**
 * Convert known provider messages into a small, safe vocabulary. Never return
 * provider text itself: it may contain prompts, filesystem paths, or secrets.
 */
export const classifyProviderError = (
  status: number | undefined,
  detail?: string
): ProviderErrorClassification => {
  const value = detail?.slice(0, 8_000) ?? ""

  if (
    includesAny(value, [
      /context.{0,30}(?:length|window|limit).{0,30}(?:exceed|large|maximum)/i,
      /maximum context length/i,
      /too many tokens/i,
      /context_length_exceeded/i
    ])
  ) {
    return {
      code: "OLC-CONTEXT-TOO-LARGE",
      reason: "Request exceeds model context limit.",
      recoveryAction: "reduce-input"
    }
  }
  if (
    includesAny(value, [
      /out of memory/i,
      /insufficient (?:system |video |gpu )?memory/i,
      /cuda.{0,20}memory/i,
      /failed to allocate/i
    ])
  ) {
    return {
      code: "OLC-OUT-OF-MEMORY",
      reason: "Provider could not allocate enough memory for this model.",
      recoveryAction: "choose-model"
    }
  }
  if (
    includesAny(value, [
      /model.{0,30}(?:not found|does not exist|unknown)/i,
      /no such model/i,
      /pull model/i
    ])
  ) {
    return {
      code: "OLC-MODEL-NOT-FOUND",
      reason: "Provider could not find selected model.",
      recoveryAction: "choose-model"
    }
  }
  if (status === 404) {
    return {
      code: "OLC-RESOURCE-NOT-FOUND",
      recoveryAction: "test-connection"
    }
  }
  if (
    includesAny(value, [
      /model.{0,30}(?:not loaded|unloaded)/i,
      /load (?:a |the )?model first/i
    ])
  ) {
    return {
      code: "OLC-MODEL-NOT-LOADED",
      reason: "Selected model is not loaded by provider.",
      recoveryAction: "test-connection"
    }
  }
  if (
    includesAny(value, [
      /model.{0,30}(?:loading|initializing)/i,
      /loading model/i
    ])
  ) {
    return {
      code: "OLC-MODEL-LOADING",
      reason: "Selected model is still loading.",
      recoveryAction: "wait-retry"
    }
  }
  if (
    includesAny(value, [
      /(?:image|vision).{0,30}(?:not supported|unsupported)/i,
      /does not support.{0,30}(?:image|vision|tool)/i,
      /tool.{0,30}(?:not supported|unsupported)/i
    ])
  ) {
    return {
      code: "OLC-INPUT-UNSUPPORTED",
      reason: "Selected model does not support part of this request.",
      recoveryAction: "reduce-input"
    }
  }
  if (status === 401 || status === 403) {
    return {
      code: "OLC-AUTH-FAILED",
      recoveryAction: "test-connection"
    }
  }
  if (status === 402) {
    return {
      code: "OLC-PAYMENT-REQUIRED",
      recoveryAction: "choose-model"
    }
  }
  if (status === 408 || status === 504) {
    return {
      code: "OLC-PROVIDER-TIMEOUT",
      recoveryAction: "retry"
    }
  }
  if (status === 413) {
    return {
      code: "OLC-CONTEXT-TOO-LARGE",
      reason: "Request is larger than provider accepts.",
      recoveryAction: "reduce-input"
    }
  }
  if (status === 429) {
    return {
      code: "OLC-RATE-LIMITED",
      recoveryAction: "wait-retry"
    }
  }
  if (status === 529 || (status !== undefined && status >= 500)) {
    return {
      code: status === 529 ? "OLC-PROVIDER-OVERLOADED" : "OLC-PROVIDER-HTTP",
      recoveryAction: "retry"
    }
  }
  return {
    code: "OLC-PROVIDER-HTTP",
    recoveryAction: "test-connection"
  }
}

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

interface ProviderUserMessageContext {
  lead: string
  reason: string
  provider: string
  providerLower: string
  selectedModel: string
  baseUrl?: string
  retryAfterMs?: number
}

const retryDelayMessage = (
  retryAfterMs: number | undefined,
  fallback: string
): string =>
  retryAfterMs
    ? ` Retry in about ${Math.max(1, Math.ceil(retryAfterMs / 1000))} seconds.`
    : fallback

const authFailureMessage = (
  lead: string,
  baseUrl: string | undefined
): string =>
  isLocalProviderBaseUrl(baseUrl)
    ? `${lead} This is likely a CORS/origin block. Allow chrome-extension://* and moz-extension://* in the provider's CORS or origin settings, then retry. Provider-specific setup: ${EXTERNAL_URLS.SETUP_GUIDE}`
    : `${lead} Check its credentials, API key, or account access.`

const serverFailureMessage = ({
  lead,
  reason,
  providerLower,
  selectedModel,
  baseUrl,
  retryAfterMs
}: ProviderUserMessageContext): string => {
  if (!isLocalProviderBaseUrl(baseUrl)) {
    return `${lead}${reason} The hosted provider is temporarily unavailable.${retryDelayMessage(
      retryAfterMs,
      " Try again shortly."
    )}`
  }
  return `${lead}${reason} Check that ${providerLower} is running, the ${selectedModel} is loaded, and its base URL/port are correct.`
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
    reason?: string
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
  const reason = options.reason ? ` ${options.reason}` : ""
  const context: ProviderUserMessageContext = {
    lead,
    reason,
    provider,
    providerLower,
    selectedModel,
    baseUrl: options.baseUrl,
    retryAfterMs: options.retryAfterMs
  }

  if (status === 400) {
    return `${lead}${reason || ` The ${selectedModel} may not support this input — for example, images on a model without vision support.`}`
  }
  if (status === 401 || status === 403) {
    return authFailureMessage(lead, options.baseUrl)
  }
  if (status === 404) {
    return `${lead}${reason || ` ${provider} could not find the ${selectedModel} or endpoint.`} Check the model name and ${providerLower}'s base URL.`
  }
  if (status === 408 || status === 504) {
    return `${lead} Check that its server is responsive and try again.`
  }
  if (status === 413) {
    return `${lead}${reason || " The request was too large."} Try a smaller image or shorter message.`
  }
  if (status === 402) {
    return `${lead} The provider account has insufficient credits or requires payment. Add credits or choose another provider.`
  }
  if (status === 429) {
    return `${lead} The provider is rate-limiting requests.${retryDelayMessage(
      options.retryAfterMs,
      " Wait a moment and try again."
    )}`
  }
  if (status === 529) {
    return `${lead} The hosted provider is temporarily overloaded. Wait a moment and try again.`
  }
  if (status >= 500) return serverFailureMessage(context)
  return `${lead}${reason} Check ${providerLower}, the ${selectedModel}, and its server logs.`
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
      code: "OLC-PROVIDER-UNREACHABLE",
      phase: "connect",
      recoveryAction: "test-connection",
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
    if (isAbortError(error)) throw error
    const providerName = context.providerName?.trim() || "The provider"
    const baseUrl = sanitizeProviderBaseUrl(context.baseUrl)
    const endpoint = baseUrl ? ` at ${baseUrl}` : ""
    const model = context.model ? ` with model "${context.model}"` : ""
    throw createAppError(
      `${providerName} stream failed: ${getErrorMessage(error)}`,
      {
        kind: "provider",
        status: 0,
        code: "OLC-STREAM-DROPPED",
        phase: "read-stream",
        recoveryAction: "retry",
        providerId: context.providerId,
        providerName,
        model: context.model,
        baseUrl,
        retryable: true,
        userMessage: `${providerName}${endpoint} connection dropped while reading the response${model}. Retry to continue with a fresh response.`,
        debug: getErrorMessage(error),
        cause: error
      }
    )
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
  const classification = classifyProviderError(
    error.status,
    typeof error.debug === "string" ? error.debug : undefined
  )
  if (error.code === "OLC-UNKNOWN") error.code = classification.code
  if (!error.recoveryAction)
    error.recoveryAction = classification.recoveryAction
  if (error.phase === "unknown") error.phase = "response"
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
      baseUrl: error.baseUrl,
      reason: reasonForCode(error.code) || classification.reason
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
  const classification = classifyProviderError(response.status, detail)
  if (
    (response.status === 401 || response.status === 403) &&
    isLocalProviderBaseUrl(options.baseUrl)
  ) {
    classification.code = "OLC-CORS-BLOCKED"
  }
  throw createAppError(`${options.label} (${response.status}): ${detail}`, {
    kind: "provider",
    status: response.status,
    providerId: options.providerId,
    providerName: options.providerName,
    model: options.model,
    baseUrl: sanitizeProviderBaseUrl(options.baseUrl),
    retryable: isRetryableProviderStatus(response.status),
    retryAfterMs,
    code: classification.code,
    phase: "response",
    recoveryAction: classification.recoveryAction,
    userMessage: providerErrorUserMessage(response.status, {
      baseUrl: options.baseUrl,
      retryAfterMs,
      providerName: options.providerName,
      model: options.model,
      reason: classification.reason
    }),
    debug: detail
  })
}
