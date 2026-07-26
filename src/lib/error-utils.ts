const DEFAULT_ERROR_MESSAGE = "An unexpected error occurred"

export type AppErrorKind =
  | "network"
  | "provider"
  | "storage"
  | "validation"
  | "abort"
  | "unknown"

export type AppErrorCode =
  | "OLC-PROVIDER-DISABLED"
  | "OLC-PROVIDER-UNREACHABLE"
  | "OLC-PROVIDER-HTTP"
  | "OLC-MODEL-NOT-FOUND"
  | "OLC-RESOURCE-NOT-FOUND"
  | "OLC-MODEL-NOT-LOADED"
  | "OLC-CORS-BLOCKED"
  | "OLC-AUTH-FAILED"
  | "OLC-PAYMENT-REQUIRED"
  | "OLC-CONTEXT-TOO-LARGE"
  | "OLC-INPUT-UNSUPPORTED"
  | "OLC-OUT-OF-MEMORY"
  | "OLC-MODEL-LOADING"
  | "OLC-RATE-LIMITED"
  | "OLC-PROVIDER-OVERLOADED"
  | "OLC-PROVIDER-TIMEOUT"
  | "OLC-STREAM-DROPPED"
  | "OLC-UNKNOWN"

export type AppErrorPhase =
  | "configuration"
  | "connect"
  | "response"
  | "read-stream"
  | "tool"
  | "persistence"
  | "unknown"

export type AppErrorRecoveryAction =
  | "retry"
  | "enable-provider"
  | "test-connection"
  | "choose-model"
  | "reduce-input"
  | "wait-retry"
  | "open-diagnostics"

export type AppErrorOptions = {
  kind?: AppErrorKind
  status?: number
  messageKey?: string
  messageParams?: Record<string, string | number | boolean>
  userMessage?: string
  retryable?: boolean
  retryAfterMs?: number
  context?: string
  providerId?: string
  providerName?: string
  model?: string
  baseUrl?: string
  debug?: unknown
  cause?: unknown
  code?: AppErrorCode
  phase?: AppErrorPhase
  incidentId?: string
  durationMs?: number
  recoveryAction?: AppErrorRecoveryAction
}

export const createIncidentId = (): string => {
  try {
    return `INC-${crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`
  } catch {
    return `INC-${Date.now().toString(36).toUpperCase()}`
  }
}

export class AppError extends Error {
  kind: AppErrorKind
  status?: number
  messageKey?: string
  messageParams?: Record<string, string | number | boolean>
  userMessage?: string
  retryable?: boolean
  retryAfterMs?: number
  context?: string
  providerId?: string
  providerName?: string
  model?: string
  baseUrl?: string
  debug?: unknown
  code: AppErrorCode
  phase: AppErrorPhase
  incidentId: string
  durationMs?: number
  recoveryAction?: AppErrorRecoveryAction

  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, { cause: options.cause })
    this.name = "AppError"
    this.kind = options.kind || "unknown"
    this.status = options.status
    this.messageKey = options.messageKey
    this.messageParams = options.messageParams
    this.userMessage = options.userMessage
    this.retryable = options.retryable
    this.retryAfterMs = options.retryAfterMs
    this.context = options.context
    this.providerId = options.providerId
    this.providerName = options.providerName
    this.model = options.model
    this.baseUrl = options.baseUrl
    this.debug = options.debug
    this.code = options.code || "OLC-UNKNOWN"
    this.phase = options.phase || "unknown"
    this.incidentId = options.incidentId || createIncidentId()
    this.durationMs = options.durationMs
    this.recoveryAction = options.recoveryAction
  }
}

export const createAppError = (
  message: string,
  options: AppErrorOptions = {}
) => new AppError(message, options)

export const isAppError = (error: unknown): error is AppError =>
  error instanceof AppError

export const getErrorMessage = (
  error: unknown,
  fallbackMessage = DEFAULT_ERROR_MESSAGE
) => {
  if (error instanceof Error) return error.message || fallbackMessage
  if (typeof error === "string") return error || fallbackMessage
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === "string" && message) return message
  }

  return fallbackMessage
}

export const isNamedError = (error: unknown, name: string) =>
  error instanceof Error
    ? error.name === name
    : !!(
        error &&
        typeof error === "object" &&
        "name" in error &&
        (error as { name?: unknown }).name === name
      )

export const isAbortError = (error: unknown) =>
  isNamedError(error, "AbortError")

/**
 * Keep provider endpoints useful for support without ever exposing embedded
 * credentials, query parameters, or fragments.
 */
export const sanitizeProviderBaseUrl = (
  baseUrl?: string
): string | undefined => {
  if (!baseUrl?.trim()) return undefined
  try {
    const url = new URL(baseUrl.trim())
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined
    url.username = ""
    url.password = ""
    url.search = ""
    url.hash = ""
    return url.toString().replace(/\/$/, "")
  } catch {
    return undefined
  }
}

/**
 * Model IDs are useful for support, but local backends may use an absolute
 * filesystem path as the ID. Keep the filename and shape while hiding account
 * names and home-directory details.
 */
export const sanitizeModelIdentifier = (model?: string): string | undefined => {
  const value = model?.trim()
  if (!value) return undefined

  const sanitizedUrl = sanitizeProviderBaseUrl(value)
  if (sanitizedUrl) return sanitizedUrl.slice(0, 240)

  return value
    .replace(/\/Users\/[^/]+/gi, "/Users/<redacted>")
    .replace(/\/home\/[^/]+/gi, "/home/<redacted>")
    .replace(/[A-Z]:\\Users\\[^\\]+/gi, "C:\\Users\\<redacted>")
    .replace(/\\\\[^\\]+\\Users\\[^\\]+/gi, "\\\\<host>\\Users\\<redacted>")
    .slice(0, 240)
}
