const DEFAULT_ERROR_MESSAGE = "An unexpected error occurred"

export type AppErrorKind =
  | "network"
  | "provider"
  | "storage"
  | "validation"
  | "abort"
  | "unknown"

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
