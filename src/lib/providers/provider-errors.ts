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
  /** A sharper localized key than the code alone names, when the text gave one. */
  messageKey?: string
}

/**
 * A wedged local endpoint says the same thing in two places: the safe `reason`
 * appended to a provider message, and the localized key the UI prefers. Keep
 * them adjacent so the English fallback and the translated copy cannot drift.
 */
const LOCAL_PROVIDER_BUSY_REASON =
  "The local endpoint is still finishing an earlier request and cannot start another."
const LOCAL_PROVIDER_BUSY_ADVICE = "Wait about a minute, or restart it."
const LOCAL_PROVIDER_BUSY_MESSAGE_KEY = "chat.errors.provider_busy"

/**
 * An Ollama model served from ollama.com rather than this machine: the tag is
 * `:cloud`, or a size tag ending `-cloud` (`gpt-oss:120b-cloud`). Only the
 * local server answers for it, so a refused or dropped request usually means
 * the server is not signed in, not that it is down.
 */
export const isOllamaCloudModel = (model?: string): boolean => {
  const tag = model?.trim().toLowerCase().split(":").at(1)
  return tag === "cloud" || Boolean(tag?.endsWith("-cloud"))
}

const OLLAMA_PROVIDER_ID = "ollama"

export interface ProviderFailureKeyInput {
  code: AppErrorCode
  status?: number
  model?: string
  providerId?: string
  baseUrl?: string
}

/**
 * The localized key for a classified failure. Every key reads `{{provider}}`
 * and `{{model}}` (and `{{setupGuideUrl}}` for the origins fix), which the
 * chat surface fills from the failure's own context.
 */
export const providerFailureMessageKey = ({
  code,
  status,
  model,
  providerId,
  baseUrl
}: ProviderFailureKeyInput): string | undefined => {
  if (providerId === OLLAMA_PROVIDER_ID && isOllamaCloudModel(model)) {
    /**
     * Only a 401 says "not signed in". A 403 is the origin block, which has
     * its own fix, and a dropped request cannot tell a stopped server from
     * one that refused the cloud model, so that copy names both causes.
     */
    if (status === 401 || (code === "OLC-AUTH-FAILED" && status !== 403)) {
      return "chat.errors.ollama_cloud_signin"
    }
    if (code === "OLC-PROVIDER-UNREACHABLE") {
      return "chat.errors.ollama_cloud_unreachable"
    }
  }
  switch (code) {
    case "OLC-PROVIDER-BUSY":
      return LOCAL_PROVIDER_BUSY_MESSAGE_KEY
    case "OLC-AUTH-FAILED":
      return "chat.errors.provider_auth"
    case "OLC-CORS-BLOCKED":
      if (providerId !== OLLAMA_PROVIDER_ID)
        return "chat.errors.provider_cors_other"
      return isLocalProviderBaseUrl(baseUrl)
        ? "chat.errors.provider_cors"
        : "chat.errors.provider_cors_remote"
    case "OLC-MODEL-REFUSED":
      return "chat.errors.provider_refused"
    case "OLC-PROVIDER-UNREACHABLE":
      return status ? undefined : "chat.errors.provider_unreachable"
    case "OLC-CONTEXT-TOO-LARGE":
      return status === 413 ? undefined : "chat.errors.context_too_long"
    case "OLC-PAYMENT-REQUIRED":
      return "chat.errors.payment_required"
    case "OLC-MODEL-NOT-FOUND":
      return "chat.errors.model_not_found"
    case "OLC-OUT-OF-MEMORY":
      return "chat.errors.out_of_memory"
    case "OLC-PROVIDER-HTTP":
      return status !== undefined &&
        status >= 500 &&
        isLocalProviderBaseUrl(baseUrl)
        ? "chat.errors.provider_server_error"
        : undefined
    default:
      return undefined
  }
}

/** The localized key for a classification, where one reads better than prose. */
export const providerErrorMessageKey = (
  code: AppErrorCode,
  context: Omit<ProviderFailureKeyInput, "code"> = {}
): string | undefined => providerFailureMessageKey({ ...context, code })

const reasonForCode = (code: AppErrorCode): string | undefined => {
  if (code === "OLC-CONTEXT-TOO-LARGE") return CONTEXT_TOO_LONG_REASON
  if (code === "OLC-OUT-OF-MEMORY") return OUT_OF_MEMORY_REASON
  if (code === "OLC-MODEL-NOT-FOUND") return MODEL_NOT_FOUND_REASON
  if (code === "OLC-MODEL-NOT-LOADED") return MODEL_NOT_LOADED_REASON
  if (code === "OLC-MODEL-LOADING") return MODEL_LOADING_REASON
  if (code === "OLC-INPUT-UNSUPPORTED") return INPUT_UNSUPPORTED_REASON
  if (code === "OLC-PROVIDER-BUSY") return LOCAL_PROVIDER_BUSY_REASON
  return undefined
}

/*
 * Safe reasons: what went wrong and what to do, in words that hold without a
 * provider or model name. Named copy for the same causes lives under
 * `chat.errors.*` and is preferred wherever the UI can translate.
 */
const CONTEXT_TOO_LONG_REASON =
  "This chat is too long for the model. Start a new chat or pick a model with a larger context."
const OUT_OF_MEMORY_REASON =
  "The model needs more memory than this machine has free. Close other apps or pick a smaller model."
const MODEL_CRASHED_REASON =
  "The model crashed while loading. Retry; if it repeats, check the provider's log."
const MODEL_NOT_FOUND_REASON =
  "The provider doesn't have this model. Pull it or pick another model."
const MODEL_NOT_LOADED_REASON =
  "The model isn't loaded. Load it in the provider, then retry."
const MODEL_LOADING_REASON =
  "The model is still loading. Wait a moment, then retry."
const INPUT_UNSUPPORTED_REASON =
  "The model can't handle part of this request, such as images or tools. Remove them or pick another model."

const includesAny = (value: string, patterns: RegExp[]) =>
  patterns.some((pattern) => pattern.test(value))

/**
 * Convert known provider messages into a small, safe vocabulary. Never return
 * provider text itself: it may contain prompts, filesystem paths, or secrets.
 *
 * `baseUrl` only ever narrows a status the caller already has; as elsewhere in
 * this module, an absent base URL is read as local.
 */
export const classifyProviderError = (
  status: number | undefined,
  detail?: string,
  baseUrl?: string
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
      reason: CONTEXT_TOO_LONG_REASON,
      recoveryAction: "reduce-input"
    }
  }
  if (
    includesAny(value, [
      /out of memory/i,
      /insufficient (?:system |video |gpu )?memory/i,
      /requires more (?:system |video |gpu )?memory/i,
      /cuda.{0,20}memory/i,
      /failed to allocate/i
    ])
  ) {
    return {
      code: "OLC-OUT-OF-MEMORY",
      reason: OUT_OF_MEMORY_REASON,
      recoveryAction: "choose-model"
    }
  }
  /**
   * Ollama's runner is a child process; when it dies loading or running a
   * model the server answers 500 with this text. The server is fine — the
   * model crashed — so "check that it is running" would be the wrong advice.
   */
  if (
    includesAny(value, [
      /llama runner process (?:has )?terminated/i,
      /runner process (?:has )?(?:terminated|exited|crashed)/i
    ])
  ) {
    return {
      code: "OLC-PROVIDER-HTTP",
      reason: MODEL_CRASHED_REASON,
      recoveryAction: "retry",
      messageKey: "chat.errors.model_crashed"
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
      reason: MODEL_NOT_FOUND_REASON,
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
      reason: MODEL_NOT_LOADED_REASON,
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
      reason: MODEL_LOADING_REASON,
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
      reason: INPUT_UNSUPPORTED_REASON,
      recoveryAction: "reduce-input"
    }
  }
  /**
   * Matched on text rather than status: older proxies forward the refusal
   * with the upstream's 502, and the status alone cannot tell a policy
   * refusal from a gateway that is down.
   */
  if (
    includesAny(value, [
      /free tier can only be used from within OpenCode/i,
      /FreeTierError/
    ])
  ) {
    return {
      code: "OLC-FREE-TIER-REFUSED",
      reason:
        "OpenCode's free tier refused this request from a third-party client. Use a model from a key-backed provider, or run this model in OpenCode's own app.",
      recoveryAction: "choose-model"
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
      reason:
        "The request is too large for the provider. Try a smaller image or a shorter message.",
      recoveryAction: "reduce-input"
    }
  }
  if (status === 429) {
    return {
      code: "OLC-RATE-LIMITED",
      recoveryAction: "wait-retry"
    }
  }
  /**
   * A local endpoint that answers 503 is single-flight and still occupied by a
   * request it has not finished — the olc proxy does exactly this after a
   * cancelled turn fails to stop. Nothing about the server is unreachable, so
   * the `>= 500` advice ("check the provider is running") sends the user to
   * debug a process that is working. A hosted 503 is left alone: there it means
   * genuine overload or maintenance, the user owns neither the queue nor the
   * restart, and `Retry-After` already carries the timing.
   */
  if (status === 503 && isLocalProviderBaseUrl(baseUrl)) {
    return {
      code: "OLC-PROVIDER-BUSY",
      reason: LOCAL_PROVIDER_BUSY_REASON,
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

const OLLAMA_ORIGINS_VALUE = "chrome-extension://*,moz-extension://*"

/**
 * A 401/403 from a LOCAL provider (Ollama et al.) is almost always a CORS/origin
 * rejection, not bad credentials — most often on Firefox, which can't rewrite the
 * request origin the way Chromium's declarativeNetRequest does. Point the user at
 * the origins fix and the setup guide instead of a misleading "check your API key".
 */
export const localCorsForbiddenMessage = (_status = 403): string =>
  `Your local provider blocked this extension. Allow ${OLLAMA_ORIGINS_VALUE.replace(",", " and ")} in its CORS settings, then retry. Setup guide: ${EXTERNAL_URLS.SETUP_GUIDE}`

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

interface ProviderUserMessageOptions {
  baseUrl?: string
  retryAfterMs?: number
  providerName?: string
  model?: string
  reason?: string
  /**
   * The provider speaks Ollama's wire. A browser always sends `Origin` on a
   * POST, and Ollama refuses an extension origin unless `OLLAMA_ORIGINS`
   * allows it — behind a reverse proxy as much as on localhost.
   */
  ollama?: boolean
}

const retryDelayMessage = (
  retryAfterMs: number | undefined,
  fallback: string
): string =>
  retryAfterMs
    ? ` Retry in about ${Math.max(1, Math.ceil(retryAfterMs / 1000))} seconds.`
    : fallback

const authFailureMessage = (
  provider: string,
  options: ProviderUserMessageOptions
): string => {
  if (options.ollama && !isLocalProviderBaseUrl(options.baseUrl)) {
    return `${provider} refused this extension's requests. Allow it by setting OLLAMA_ORIGINS=${OLLAMA_ORIGINS_VALUE} on the server.`
  }
  if (isLocalProviderBaseUrl(options.baseUrl)) {
    return options.ollama
      ? `${provider} blocked this extension. Restart it with OLLAMA_ORIGINS set. Setup guide: ${EXTERNAL_URLS.SETUP_GUIDE}`
      : `${provider} blocked this extension. Allow ${OLLAMA_ORIGINS_VALUE.replace(",", " and ")} in its CORS settings, then retry. Setup guide: ${EXTERNAL_URLS.SETUP_GUIDE}`
  }
  return `${provider} rejected the API key. Check it in provider settings.`
}

/**
 * Map a provider HTTP status to a clean, user-facing message: what happened
 * and what to do. The status itself stays in the error's `status` and
 * diagnostics; raw response bodies stay in `debug`. Translated copy for the
 * same causes lives under `chat.errors.*` (see {@link providerFailureMessageKey}).
 */
export const providerErrorUserMessage = (
  status: number,
  options: ProviderUserMessageOptions = {}
): string => {
  const provider = options.providerName?.trim() || "The provider"
  const model = options.model?.trim() || "the selected model"
  const reason = options.reason

  if (status === 400) {
    return (
      reason ??
      `${provider} couldn't use this request with ${model}. The model may not support part of it — for example, images on a model without vision.`
    )
  }
  if (status === 401 || status === 403) {
    return authFailureMessage(provider, options)
  }
  if (status === 402) {
    return `${provider} needs payment or credits for ${model}. Choose a local model or add credits.`
  }
  if (status === 404) {
    return (
      reason ??
      `${provider} doesn't have ${model}, or this isn't its address. Check the model name and the base URL.`
    )
  }
  if (status === 408 || status === 504) {
    return `${provider} took too long to answer. Check that it's responsive, then retry.`
  }
  if (status === 413) {
    return (
      reason ??
      `The request is too large for ${provider}. Try a smaller image or a shorter message.`
    )
  }
  if (status === 429) {
    return `${provider} is limiting requests.${retryDelayMessage(
      options.retryAfterMs,
      " Wait a moment, then retry."
    )}`
  }
  if (status === 529) {
    return `${provider} is overloaded. Wait a moment, then retry.`
  }
  if (status === 503 && isLocalProviderBaseUrl(options.baseUrl)) {
    return `${LOCAL_PROVIDER_BUSY_REASON} ${LOCAL_PROVIDER_BUSY_ADVICE}`
  }
  if (reason) return reason
  if (status >= 500) {
    return isLocalProviderBaseUrl(options.baseUrl)
      ? `${provider} hit an internal error running ${model}. Retry; if it repeats, check the server log.`
      : `${provider} is temporarily unavailable.${retryDelayMessage(
          options.retryAfterMs,
          " Retry shortly."
        )}`
  }
  return `${provider} couldn't answer with ${model}. Check its server log, then retry.`
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
      messageKey: providerFailureMessageKey({
        code: "OLC-PROVIDER-UNREACHABLE",
        model,
        providerId: context.providerId
      }),
      userMessage: `Can't reach ${providerName}${endpoint}. Start it, then retry. If it's running, check the base URL.`,
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
        userMessage: `The connection to ${providerName} dropped mid-answer. Retry to get a fresh response.`,
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
    typeof error.debug === "string" ? error.debug : undefined,
    context.baseUrl || error.baseUrl
  )
  /*
   * The Ollama adapter stamps its own id on every error; a custom provider
   * id from the resolved config replaces it below, so read it first.
   */
  const ollama =
    error.providerId === OLLAMA_PROVIDER_ID ||
    context.providerId === OLLAMA_PROVIDER_ID
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

  const keyInput: ProviderFailureKeyInput = {
    code: error.code,
    status: error.status,
    model: error.model,
    providerId: ollama ? OLLAMA_PROVIDER_ID : error.providerId,
    baseUrl: context.baseUrl || error.baseUrl
  }
  const cloudKey =
    ollama && isOllamaCloudModel(error.model)
      ? providerFailureMessageKey(keyInput)
      : undefined
  error.messageKey =
    (cloudKey === "chat.errors.ollama_cloud_signin" ||
    cloudKey === "chat.errors.ollama_cloud_unreachable"
      ? cloudKey
      : undefined) ??
    classification.messageKey ??
    providerFailureMessageKey(keyInput) ??
    error.messageKey

  if (
    error.status === 413 &&
    error.messageKey === "chat.errors.context_too_long"
  ) {
    error.messageKey = undefined
  }

  if (error.messageKey === "chat.errors.ollama_cloud_signin") {
    error.userMessage = `${error.model} runs on Ollama's cloud. Sign in with \`ollama signin\` or pick a local model.`
  } else if (error.messageKey === "chat.errors.ollama_cloud_unreachable") {
    error.userMessage = `Can't reach Ollama for ${error.model}. Start Ollama. If it's already running, this cloud model needs \`ollama signin\`.`
  } else if (error.status) {
    error.userMessage = providerErrorUserMessage(error.status, {
      retryAfterMs: error.retryAfterMs,
      providerName: error.providerName,
      model: error.model,
      baseUrl: error.baseUrl,
      reason:
        error.status === 413
          ? undefined
          : reasonForCode(error.code) || classification.reason,
      ollama
    })
  } else if (!error.userMessage) {
    const provider = error.providerName || "The provider"
    error.userMessage = `${provider} couldn't finish the answer. Check its server log, then retry.`
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
 * Ollama keeps its own local-provider 401/403 CORS advice.
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
  const classification = classifyProviderError(
    response.status,
    detail,
    options.baseUrl
  )
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
    messageKey:
      classification.messageKey ??
      providerFailureMessageKey({
        code: classification.code,
        status: response.status,
        model: options.model,
        providerId: options.providerId,
        baseUrl: options.baseUrl
      }),
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

/** Explicit wire refusals carry no raw model text and are never transient faults. */
export const throwProviderRefusal = (context: ProviderErrorContext): never => {
  throw createAppError("The model refused this request.", {
    ...context,
    kind: "provider",
    code: "OLC-MODEL-REFUSED",
    messageKey: providerErrorMessageKey("OLC-MODEL-REFUSED"),
    phase: "response",
    retryable: false,
    recoveryAction: "reduce-input",
    userMessage:
      "The model refused this request. Adjust the task or choose a different model."
  })
}
